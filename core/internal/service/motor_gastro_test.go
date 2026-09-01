package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"gorm.io/datatypes"
)

// innerFake es un MotorService de mentira. Arma el response leyendo el huso del
// contexto, igual que hace el motor real desde que existe `dto.Hora`: la
// localización dejó de ser un paso posterior del vertical y pasó a estar en la
// construcción del DTO (capability `hora-local`).
//
// El sujeto del test no cambió —que un compromiso salga en la hora del negocio
// y nunca con Z— pero el mecanismo sí, y el test lo sigue.
type innerFake struct{}

func (f innerFake) Crear(ctx context.Context, _ string, _ dto.CrearCompromisoInput) (*dto.CompromisoResponse, error) {
	return respDelCtx(ctx), nil
}
func (f innerFake) Obtener(ctx context.Context, _, _ string) (*dto.CompromisoResponse, error) {
	return respDelCtx(ctx), nil
}
func (f innerFake) Listar(ctx context.Context, _ string, _ dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	return []dto.CompromisoResponse{*respDelCtx(ctx)}, nil
}
func (f innerFake) Transicionar(ctx context.Context, _, _ string, _ model.EstadoCompromiso, _ OpcionesTransicion) (*dto.CompromisoResponse, error) {
	return respDelCtx(ctx), nil
}

// negocioFake resuelve un negocio con la timezone que le pasemos.
type negocioFake struct{ tz string }

func (n negocioFake) Negocio(context.Context, string) (*model.Negocio, error) {
	return &model.Negocio{
		ID:       "neg-1",
		Timezone: n.tz,
		Config:   datatypes.JSON([]byte(`{}`)),
	}, nil
}

// respDelCtx arma un compromiso cuyos instantes están guardados en UTC —como
// los devuelve Postgres— y los envuelve con el huso que traiga el contexto,
// que es exactamente lo que hace el motor real.
func respDelCtx(ctx context.Context) *dto.CompromisoResponse {
	inicio := time.Date(2026, 8, 19, 18, 0, 0, 0, time.UTC) // 15:00 en Mendoza
	fin := time.Date(2026, 8, 19, 19, 0, 0, 0, time.UTC)
	confirmado := time.Date(2026, 8, 19, 17, 30, 0, 0, time.UTC)
	return &dto.CompromisoResponse{
		ID:           "comp-1",
		NegocioID:    "neg-1",
		Inicio:       dto.HoraPtrDe(ctx, &inicio),
		Fin:          dto.HoraPtrDe(ctx, &fin),
		CreadoEn:     dto.HoraDe(ctx, time.Date(2026, 8, 19, 17, 0, 0, 0, time.UTC)),
		ConfirmadoEn: dto.HoraPtrDe(ctx, &confirmado),
	}
}

// ctxEnMendoza es el contexto que arma el middleware de timezone en producción.
func ctxEnMendoza(t *testing.T) context.Context {
	t.Helper()
	loc, err := time.LoadLocation("America/Argentina/Mendoza")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	return dto.ConLocation(context.Background(), loc)
}

func campo(t *testing.T, resp *dto.CompromisoResponse, nombre string) string {
	t.Helper()
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var s string
	if err := json.Unmarshal(m[nombre], &s); err != nil {
		t.Fatalf("campo %q no es string: %s", nombre, m[nombre])
	}
	return s
}

func TestMotorGastroLocalizaTimestampsALaTZDelNegocio(t *testing.T) {
	motor := NewMotorGastro(innerFake{}, negocioFake{tz: "America/Argentina/Mendoza"})

	resp, err := motor.Obtener(ctxEnMendoza(t), "neg-1", "comp-1")
	if err != nil {
		t.Fatalf("Obtener: %v", err)
	}

	// El offset del negocio (-03:00), nunca Z: es lo que el panel corta como
	// hora de pared.
	for _, f := range []string{"inicio", "fin", "confirmado_en", "creado_en"} {
		v := campo(t, resp, f)
		if strings.HasSuffix(v, "Z") {
			t.Fatalf("%s salió en UTC (%s): el panel mostraría la hora corrida", f, v)
		}
		if !strings.Contains(v, "-03:00") {
			t.Fatalf("%s no trae el offset del negocio: %s", f, v)
		}
	}

	// La hora de pared tiene que ser la del negocio: 18:00 UTC = 15:00 Mendoza.
	if got := campo(t, resp, "inicio"); !strings.HasPrefix(got, "2026-08-19T15:00:00") {
		t.Fatalf("inicio no quedó en hora de pared del negocio: %s", got)
	}
}

// avisadorFake captura el aviso en vez de publicarlo a Redis.
type avisadorFake struct {
	avisos []AvisoPedidoConfirmado
	listos []AvisoPedidoListo
	falla  error // para probar que un aviso roto no voltea la transición
}

func (a *avisadorFake) PedidoConfirmado(_ context.Context, av AvisoPedidoConfirmado) error {
	a.avisos = append(a.avisos, av)
	return a.falla
}

func (a *avisadorFake) PedidoListo(_ context.Context, av AvisoPedidoListo) error {
	a.listos = append(a.listos, av)
	return a.falla
}

// innerTrans devuelve un response fijo desde Transicionar (para el test del aviso).
type innerTrans struct{ resp *dto.CompromisoResponse }

func (innerTrans) Crear(context.Context, string, dto.CrearCompromisoInput) (*dto.CompromisoResponse, error) {
	return nil, nil
}
func (innerTrans) Obtener(context.Context, string, string) (*dto.CompromisoResponse, error) {
	return nil, nil
}
func (innerTrans) Listar(context.Context, string, dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	return nil, nil
}
func (f innerTrans) Transicionar(context.Context, string, string, model.EstadoCompromiso, OpcionesTransicion) (*dto.CompromisoResponse, error) {
	c := *f.resp
	return &c, nil
}

func pedidoConfirmado(demora *int, origen model.OrigenCompromiso, tel string) *dto.CompromisoResponse {
	nombre := "Juani"
	return &dto.CompromisoResponse{
		ID: "comp-1", NegocioID: "neg-1",
		Tipo: model.CompromisoPedido, Estado: model.EstadoConfirmado,
		Origen: origen, DemoraMin: demora,
		ClienteNombre: &nombre, ClienteTelefono: tel,
	}
}

func TestAvisoAlConfirmarPedidoDeWhatsApp(t *testing.T) {
	d := 40
	casos := []struct {
		nombre string
		resp   *dto.CompromisoResponse
		avisa  bool
	}{
		{"pedido whatsapp con demora → avisa", pedidoConfirmado(&d, model.OrigenWhatsApp, "549260111"), true},
		{"sin demora → no avisa", pedidoConfirmado(nil, model.OrigenWhatsApp, "549260111"), false},
		{"origen panel → no avisa (no hay WhatsApp del otro lado)", pedidoConfirmado(&d, model.OrigenPanel, "549260111"), false},
		{"sin teléfono → no avisa", pedidoConfirmado(&d, model.OrigenWhatsApp, ""), false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			av := &avisadorFake{}
			motor := NewMotorGastro(innerTrans{resp: c.resp}, negocioFake{tz: "America/Argentina/Mendoza"}, ConAvisadorPedido(av))
			if _, err := motor.Transicionar(context.Background(), "neg-1", "comp-1", model.EstadoConfirmado, OpcionesTransicion{}); err != nil {
				t.Fatalf("Transicionar: %v", err)
			}
			if c.avisa && len(av.avisos) != 1 {
				t.Fatalf("esperaba 1 aviso, hubo %d", len(av.avisos))
			}
			if !c.avisa && len(av.avisos) != 0 {
				t.Fatalf("no debía avisar, hubo %d", len(av.avisos))
			}
			if c.avisa && av.avisos[0].DemoraMin != d {
				t.Fatalf("la demora no llegó al aviso: %d", av.avisos[0].DemoraMin)
			}
		})
	}
}

func TestMotorGastroLocalizaEnListar(t *testing.T) {
	motor := NewMotorGastro(innerFake{}, negocioFake{tz: "America/Argentina/Mendoza"})

	lista, err := motor.Listar(ctxEnMendoza(t), "neg-1", dto.FiltroCompromisos{})
	if err != nil {
		t.Fatalf("Listar: %v", err)
	}
	if len(lista) != 1 {
		t.Fatalf("esperaba 1 compromiso, hubo %d", len(lista))
	}
	if got := campo(t, &lista[0], "inicio"); !strings.HasPrefix(got, "2026-08-19T15:00:00") || strings.HasSuffix(got, "Z") {
		t.Fatalf("Listar no localizó el inicio: %s", got)
	}
}

// ── El aviso de "tu pedido está listo" ───────────────────────────────────────
//
// El segundo de los dos avisos que manda el producto. `FLUJOS.md` prometía tres
// (EN_COCINA → LISTO → ENTREGADO) y había uno solo; se decidió mandar dos, que
// son los momentos en que el cliente HACE algo con la información.

func pedidoListo(entrega *model.TipoEntrega, origen model.OrigenCompromiso, tel string) *dto.CompromisoResponse {
	nombre := "Juani"
	return &dto.CompromisoResponse{
		ID: "comp-1", NegocioID: "neg-1",
		Tipo: model.CompromisoPedido, Estado: model.EstadoListo,
		Origen: origen, Entrega: entrega,
		ClienteNombre: &nombre, ClienteTelefono: tel,
	}
}

func entrega(e model.TipoEntrega) *model.TipoEntrega { return &e }

func TestAvisoAlPasarAListo(t *testing.T) {
	casos := []struct {
		nombre string
		resp   *dto.CompromisoResponse
		avisa  bool
	}{
		{"retira → avisa que pase a buscarlo",
			pedidoListo(entrega(model.EntregaRetira), model.OrigenWhatsApp, "549260111"), true},
		{"delivery → avisa que salió",
			pedidoListo(entrega(model.EntregaDelivery), model.OrigenWhatsApp, "549260111"), true},
		// El mozo se lo lleva a la mesa: un WhatsApp acá es ruido que se paga.
		{"en_local → NO avisa",
			pedidoListo(entrega(model.EntregaEnLocal), model.OrigenWhatsApp, "549260111"), false},
		{"sin entrega → no avisa (no hay frase posible)",
			pedidoListo(nil, model.OrigenWhatsApp, "549260111"), false},
		{"origen panel → no avisa (no hay WhatsApp del otro lado)",
			pedidoListo(entrega(model.EntregaRetira), model.OrigenPanel, "549260111"), false},
		{"sin teléfono → no avisa",
			pedidoListo(entrega(model.EntregaRetira), model.OrigenWhatsApp, ""), false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			av := &avisadorFake{}
			motor := NewMotorGastro(innerTrans{resp: c.resp}, negocioFake{tz: "America/Argentina/Mendoza"}, ConAvisadorPedido(av))
			if _, err := motor.Transicionar(context.Background(), "neg-1", "comp-1", model.EstadoListo, OpcionesTransicion{}); err != nil {
				t.Fatalf("Transicionar: %v", err)
			}
			if c.avisa && len(av.listos) != 1 {
				t.Fatalf("esperaba 1 aviso de listo, hubo %d", len(av.listos))
			}
			if !c.avisa && len(av.listos) != 0 {
				t.Fatalf("no debía avisar, hubo %d", len(av.listos))
			}
			if c.avisa && av.listos[0].Entrega != string(*c.resp.Entrega) {
				t.Fatalf("la entrega no llegó al aviso: %q", av.listos[0].Entrega)
			}
		})
	}
}

// TestElAvisoDeListoNoExigeDemora es la diferencia deliberada con el aviso de
// confirmación, que sí la exige porque su texto la usa. Copiar esa condición sin
// pensarla dejaría mudo el aviso justo en los pedidos que se confirmaron sin
// cargar demora — donde el cliente MÁS necesita que le avisen.
func TestElAvisoDeListoNoExigeDemora(t *testing.T) {
	resp := pedidoListo(entrega(model.EntregaRetira), model.OrigenWhatsApp, "549260111")
	resp.DemoraMin = nil

	av := &avisadorFake{}
	motor := NewMotorGastro(innerTrans{resp: resp}, negocioFake{tz: "America/Argentina/Mendoza"}, ConAvisadorPedido(av))
	if _, err := motor.Transicionar(context.Background(), "neg-1", "comp-1", model.EstadoListo, OpcionesTransicion{}); err != nil {
		t.Fatalf("Transicionar: %v", err)
	}
	if len(av.listos) != 1 {
		t.Fatalf("sin demora tenía que avisar igual, hubo %d avisos", len(av.listos))
	}
}

// TestUnAvisoRotoNoVolteaLaTransicion: el aviso es best-effort. La transición ya
// está persistida cuando se intenta avisar; hacerla fallar por un Redis caído
// dejaría el pedido en un estado distinto del que la cocina ya ejecutó.
func TestUnAvisoRotoNoVolteaLaTransicion(t *testing.T) {
	resp := pedidoListo(entrega(model.EntregaDelivery), model.OrigenWhatsApp, "549260111")
	av := &avisadorFake{falla: errors.New("redis caído")}
	motor := NewMotorGastro(innerTrans{resp: resp}, negocioFake{tz: "America/Argentina/Mendoza"}, ConAvisadorPedido(av))

	out, err := motor.Transicionar(context.Background(), "neg-1", "comp-1", model.EstadoListo, OpcionesTransicion{})
	if err != nil {
		t.Fatalf("un aviso roto volteó la transición: %v", err)
	}
	if out == nil || out.Estado != model.EstadoListo {
		t.Fatal("la transición tenía que quedar hecha igual")
	}
}
