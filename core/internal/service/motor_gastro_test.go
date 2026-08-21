package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"gorm.io/datatypes"
)

// innerFake es un MotorService de mentira: devuelve compromisos con las horas
// en UTC, tal como las deja el motor real (pgx en un contenedor UTC). El sujeto
// del test es que el vertical las corrija a la TZ del negocio antes de salir.
type innerFake struct {
	resp *dto.CompromisoResponse
}

func (f innerFake) Crear(context.Context, string, dto.CrearCompromisoInput) (*dto.CompromisoResponse, error) {
	return f.copia(), nil
}
func (f innerFake) Obtener(context.Context, string, string) (*dto.CompromisoResponse, error) {
	return f.copia(), nil
}
func (f innerFake) Listar(context.Context, string, dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	return []dto.CompromisoResponse{*f.copia()}, nil
}
func (f innerFake) Transicionar(context.Context, string, string, model.EstadoCompromiso, OpcionesTransicion) (*dto.CompromisoResponse, error) {
	return f.copia(), nil
}

func (f innerFake) copia() *dto.CompromisoResponse {
	c := *f.resp
	return &c
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

// respUTC arma un compromiso con inicio, fin y timestamps en UTC.
func respUTC() *dto.CompromisoResponse {
	inicio := time.Date(2026, 8, 19, 18, 0, 0, 0, time.UTC) // 15:00 en Mendoza
	fin := time.Date(2026, 8, 19, 19, 0, 0, 0, time.UTC)
	confirmado := time.Date(2026, 8, 19, 17, 30, 0, 0, time.UTC)
	return &dto.CompromisoResponse{
		ID:           "comp-1",
		NegocioID:    "neg-1",
		Inicio:       &inicio,
		Fin:          &fin,
		CreadoEn:     time.Date(2026, 8, 19, 17, 0, 0, 0, time.UTC),
		ConfirmadoEn: &confirmado,
	}
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
	motor := NewMotorGastro(innerFake{resp: respUTC()}, negocioFake{tz: "America/Argentina/Mendoza"})

	resp, err := motor.Obtener(context.Background(), "neg-1", "comp-1")
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
type avisadorFake struct{ avisos []AvisoPedidoConfirmado }

func (a *avisadorFake) PedidoConfirmado(_ context.Context, av AvisoPedidoConfirmado) error {
	a.avisos = append(a.avisos, av)
	return nil
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
	motor := NewMotorGastro(innerFake{resp: respUTC()}, negocioFake{tz: "America/Argentina/Mendoza"})

	lista, err := motor.Listar(context.Background(), "neg-1", dto.FiltroCompromisos{})
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
