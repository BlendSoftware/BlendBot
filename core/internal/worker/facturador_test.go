package worker

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"copiloto/core/internal/infra"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/shopspring/decimal"
)

const claveTest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// ── Dobles ────────────────────────────────────────────────────────────────

// repoFalso reproduce la semántica que importa del repositorio real: el barrido
// devuelve lo pendiente cuyo next_retry_at venció, y la toma es condicional
// sobre esa misma condición. La versión con SQL se prueba contra Postgres en
// internal/repository.
type repoFalso struct {
	repository.CobroRepository // el resto de los métodos no se usan acá

	mu    sync.Mutex
	filas []*filaFalsa
}

type filaFalsa struct {
	p           repository.ComprobantePendiente
	estado      model.EstadoComprobante
	nextRetryAt *time.Time
	intentos    int
	ultimoError string
	cae         string
	numero      int64
}

func (r *repoFalso) ComprobantesPendientes(_ context.Context, ahora time.Time, _ int) ([]repository.ComprobantePendiente, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []repository.ComprobantePendiente
	for _, f := range r.filas {
		if f.estado != model.ComprobantePendiente {
			continue
		}
		if f.nextRetryAt != nil && f.nextRetryAt.After(ahora) {
			continue
		}
		p := f.p
		p.RetryCount = f.intentos
		out = append(out, p)
	}
	return out, nil
}

func (r *repoFalso) TomarComprobante(_ context.Context, id string, ahora time.Time, lease time.Duration) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, f := range r.filas {
		if f.p.ComprobanteID != id {
			continue
		}
		if f.estado != model.ComprobantePendiente {
			return false, nil
		}
		if f.nextRetryAt != nil && f.nextRetryAt.After(ahora) {
			return false, nil
		}
		v := ahora.Add(lease)
		f.nextRetryAt = &v
		return true, nil
	}
	return false, nil
}

func (r *repoFalso) SellarComprobante(_ context.Context, id string, rf repository.ResultadoFactura, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, f := range r.filas {
		if f.p.ComprobanteID == id && f.estado == model.ComprobantePendiente {
			f.estado = model.ComprobanteEmitido
			f.cae, f.numero, f.nextRetryAt = rf.CAE, rf.Numero, nil
		}
	}
	return nil
}

func (r *repoFalso) ProgramarReintento(_ context.Context, id string, intentos int, proximo *time.Time, motivo string, estado model.EstadoComprobante) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, f := range r.filas {
		if f.p.ComprobanteID == id && f.estado == model.ComprobantePendiente {
			f.intentos, f.nextRetryAt, f.ultimoError, f.estado = intentos, proximo, motivo, estado
		}
	}
	return nil
}

// pubFalso guarda lo que se encoló en vez de hablar con Redis.
type pubFalso struct {
	mu    sync.Mutex
	msgs  []MensajeSalida
	falla error
}

func (p *pubFalso) Publicar(_ context.Context, m MensajeSalida) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.falla != nil {
		return p.falla
	}
	p.msgs = append(p.msgs, m)
	return nil
}

// ── Fixtures ──────────────────────────────────────────────────────────────

func armarPendiente(t *testing.T, c infra.Cifrador) *filaFalsa {
	t.Helper()
	cert, err := c.Cifrar("CERT-PEM")
	if err != nil {
		t.Fatal(err)
	}
	key, err := c.Cifrar("KEY-PEM")
	if err != nil {
		t.Fatal(err)
	}
	inicio := time.Date(2026, 8, 18, 13, 0, 0, 0, time.UTC)
	return &filaFalsa{
		estado: model.ComprobantePendiente,
		p: repository.ComprobantePendiente{
			ComprobanteID:   "cmp-1",
			NegocioID:       "neg-1",
			NegocioNombre:   "Consultorio Gómez",
			Timezone:        "America/Argentina/Mendoza",
			WaPhoneID:       "wa-1",
			TipoCbte:        model.TipoCbteFacturaC,
			PuntoVenta:      1,
			ReceptorDocTipo: model.DocTipoConsumidorFinal,
			Importe:         decimal.RequireFromString("12500.00"),
			CUIT:            "20123456789",
			Modo:            model.ModoHomologacion,
			CertPEMCifrado:  cert,
			KeyPEMCifrado:   key,
			ClienteNombre:   "Ana",
			Telefono:        "5492610000001",
			ServicioDesde:   inicio,
			ServicioHasta:   inicio.Add(30 * time.Minute),
		},
	}
}

// sidecarFalso devuelve el server y las solicitudes que recibió.
func sidecarFalso(t *testing.T, responder func(w http.ResponseWriter, in solicitudFactura)) (*httptest.Server, *[]solicitudFactura) {
	t.Helper()
	var mu sync.Mutex
	recibidas := []solicitudFactura{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/facturar" {
			t.Errorf("ruta inesperada: %s", r.URL.Path)
		}
		crudo, _ := io.ReadAll(r.Body)
		var in solicitudFactura
		if err := json.Unmarshal(crudo, &in); err != nil {
			t.Errorf("body no es JSON: %v", err)
		}
		mu.Lock()
		recibidas = append(recibidas, in)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		responder(w, in)
	}))
	t.Cleanup(srv.Close)
	return srv, &recibidas
}

func facturadorDePrueba(t *testing.T, repo *repoFalso, pub Publicador, url string, ahora func() time.Time) *Facturador {
	t.Helper()
	c, err := infra.NewCifrador(claveTest)
	if err != nil {
		t.Fatal(err)
	}
	w := NewFacturador(FacturadorConfig{
		Repo: repo, Pub: pub, Cifrador: c,
		SidecarURL: url, InternalToken: "token-interno",
		HTTP: &http.Client{Timeout: 5 * time.Second}, Ahora: ahora,
	})
	if w == nil {
		t.Fatal("NewFacturador devolvió nil con la configuración completa")
	}
	return w
}

// ── Tests ─────────────────────────────────────────────────────────────────

func TestFacturadorEmiteYAvisaAlCliente(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)
	fila := armarPendiente(t, c)
	repo := &repoFalso{filas: []*filaFalsa{fila}}
	pub := &pubFalso{}

	var tokenVisto string
	srv, recibidas := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
		_, _ = w.Write([]byte(`{"ok":true,"numero":123,"cae":"71234567891234","cae_vencimiento":"2026-08-28"}`))
	})
	srv.Config.Handler = envolverConToken(srv.Config.Handler, &tokenVisto)

	w := facturadorDePrueba(t, repo, pub, srv.URL, nil)
	n, err := w.Tick(context.Background())
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if n != 1 {
		t.Fatalf("esperaba 1 emitida, obtuvo %d", n)
	}

	if len(*recibidas) != 1 {
		t.Fatalf("esperaba 1 POST, obtuvo %d", len(*recibidas))
	}
	in := (*recibidas)[0]
	if in.TipoCbte != model.TipoCbteFacturaC {
		t.Errorf("tipo_cbte: esperaba 11 (Factura C), obtuvo %d", in.TipoCbte)
	}
	if in.Concepto != ConceptoServicios {
		t.Errorf("concepto: esperaba 2 (servicios), obtuvo %d", in.Concepto)
	}
	if in.ServicioDesde != "2026-08-18" || in.ServicioHasta != "2026-08-18" {
		t.Errorf("fechas de servicio en la TZ del negocio: %s → %s", in.ServicioDesde, in.ServicioHasta)
	}
	if in.CertPEM != "CERT-PEM" || in.KeyPEM != "KEY-PEM" {
		t.Errorf("los PEM no llegaron descifrados: %q / %q", in.CertPEM, in.KeyPEM)
	}
	if in.DocTipo != model.DocTipoConsumidorFinal || in.DocNro != "0" {
		t.Errorf("consumidor final: doc_tipo=%d doc_nro=%q", in.DocTipo, in.DocNro)
	}
	if in.ImporteTotal != "12500.00" {
		t.Errorf("importe: %q", in.ImporteTotal)
	}
	if tokenVisto != "token-interno" {
		t.Errorf("X-Internal-Token: %q", tokenVisto)
	}

	if fila.estado != model.ComprobanteEmitido || fila.cae != "71234567891234" || fila.numero != 123 {
		t.Fatalf("no quedó sellado: %+v", fila)
	}

	if len(pub.msgs) != 1 {
		t.Fatalf("esperaba 1 aviso encolado, obtuvo %d", len(pub.msgs))
	}
	m := pub.msgs[0]
	if m.Tipo != TipoTexto || m.Telefono != "5492610000001" || m.WaPhoneID != "wa-1" {
		t.Errorf("mensaje mal armado: %+v", m)
	}
	for _, esperado := range []string{"0001-00000123", "$12.500,00", "71234567891234", "28/08/2026"} {
		if !strings.Contains(m.Texto, esperado) {
			t.Errorf("el aviso no menciona %q: %s", esperado, m.Texto)
		}
	}
	// Lo que jamás puede salir en un mensaje al cliente.
	if strings.Contains(m.Texto, "CERT-PEM") || strings.Contains(m.Texto, "KEY-PEM") {
		t.Fatal("el aviso filtró material del certificado")
	}
}

// EL test del módulo: dos ticks seguidos no pueden facturar dos veces el mismo
// cobro. Ante ARCA eso no se deshace.
func TestFacturadorNoFacturaDosVeces(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)
	repo := &repoFalso{filas: []*filaFalsa{armarPendiente(t, c)}}
	pub := &pubFalso{}

	srv, recibidas := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
		_, _ = w.Write([]byte(`{"ok":true,"numero":7,"cae":"1111","cae_vencimiento":"20260828"}`))
	})

	w := facturadorDePrueba(t, repo, pub, srv.URL, nil)
	ctx := context.Background()
	if _, err := w.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Tick(ctx); err != nil {
		t.Fatal(err)
	}

	if len(*recibidas) != 1 {
		t.Fatalf("el sidecar recibió %d POST: la toma condicional no está frenando el segundo tick", len(*recibidas))
	}
	if len(pub.msgs) != 1 {
		t.Fatalf("se encolaron %d avisos", len(pub.msgs))
	}
}

func TestFacturadorProgramaReintentoYSeRindeALos10(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)
	fila := armarPendiente(t, c)
	repo := &repoFalso{filas: []*filaFalsa{fila}}

	srv, _ := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
		_, _ = w.Write([]byte(`{"ok":false,"error":"ARCA: CUIT no habilitado"}`))
	})

	ahora := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	w := facturadorDePrueba(t, repo, &pubFalso{}, srv.URL, func() time.Time { return ahora })
	ctx := context.Background()

	for i := 1; i <= FacturadorMaxIntentos; i++ {
		if _, err := w.Tick(ctx); err != nil {
			t.Fatal(err)
		}
		if fila.intentos != i {
			t.Fatalf("intento %d: el contador quedó en %d", i, fila.intentos)
		}
		if i < FacturadorMaxIntentos {
			if fila.estado != model.ComprobantePendiente {
				t.Fatalf("intento %d: se rindió antes de tiempo", i)
			}
			if fila.nextRetryAt == nil {
				t.Fatalf("intento %d: no programó el próximo intento", i)
			}
			// El reloj avanza hasta la ventana para que el tick siguiente lo tome.
			ahora = *fila.nextRetryAt
		}
	}

	if fila.estado != model.ComprobanteError {
		t.Fatalf("a los %d intentos tenía que quedar en error, quedó en %s", FacturadorMaxIntentos, fila.estado)
	}
	if fila.nextRetryAt != nil {
		t.Fatal("un comprobante en error no se vuelve a agendar")
	}
	if !strings.Contains(fila.ultimoError, "CUIT no habilitado") {
		t.Fatalf("last_error perdió el motivo: %q", fila.ultimoError)
	}

	// Y ya no lo toma nadie más.
	if _, err := w.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	if fila.intentos != FacturadorMaxIntentos {
		t.Fatalf("siguió intentando después del error: %d", fila.intentos)
	}
}

func TestFacturadorSidecarCaidoNoSella(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)
	fila := armarPendiente(t, c)
	repo := &repoFalso{filas: []*filaFalsa{fila}}
	pub := &pubFalso{}

	srv, _ := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"ok":false,"error":"sin conexion con ARCA"}`))
	})

	w := facturadorDePrueba(t, repo, pub, srv.URL, nil)
	n, err := w.Tick(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("no se emitió nada y devolvió %d", n)
	}
	if fila.estado != model.ComprobantePendiente || fila.intentos != 1 {
		t.Fatalf("esperaba pendiente con un intento: %+v", fila)
	}
	if len(pub.msgs) != 0 {
		t.Fatal("se avisó al cliente de una factura que no existe")
	}
}

// Una clave rotada sin re-cifrar no es un error transitorio: gastar diez
// intentos contra eso sólo llena la base de ruido.
func TestFacturadorCertificadoIlegibleEsPermanente(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)
	fila := armarPendiente(t, c)
	fila.p.CertPEMCifrado = "esto-no-es-un-ciphertext"
	repo := &repoFalso{filas: []*filaFalsa{fila}}

	llamado := false
	srv, _ := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
		llamado = true
		_, _ = w.Write([]byte(`{"ok":true,"numero":1,"cae":"x"}`))
	})

	w := facturadorDePrueba(t, repo, &pubFalso{}, srv.URL, nil)
	if _, err := w.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if llamado {
		t.Fatal("se llamó al sidecar con un certificado que no se pudo descifrar")
	}
	if fila.estado != model.ComprobanteError {
		t.Fatalf("esperaba error permanente, quedó en %s", fila.estado)
	}
}

// El 422 del sidecar es "este request nunca va a servir": no se reintenta.
// El 401 sí, porque se cura arreglando una variable de entorno.
func TestFacturadorDistingue422De401(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)

	t.Run("422 es permanente", func(t *testing.T) {
		fila := armarPendiente(t, c)
		repo := &repoFalso{filas: []*filaFalsa{fila}}
		srv, _ := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"ok":false,"error":"cuit_emisor invalido: el digito verificador no cierra"}`))
		})
		w := facturadorDePrueba(t, repo, &pubFalso{}, srv.URL, nil)
		if _, err := w.Tick(context.Background()); err != nil {
			t.Fatal(err)
		}
		if fila.estado != model.ComprobanteError {
			t.Fatalf("un 422 tiene que cortar la serie de una, quedó en %s", fila.estado)
		}
		if fila.intentos != 1 {
			t.Fatalf("gastó %d intentos en algo que no mejora", fila.intentos)
		}
	})

	t.Run("401 se reintenta", func(t *testing.T) {
		fila := armarPendiente(t, c)
		repo := &repoFalso{filas: []*filaFalsa{fila}}
		srv, _ := sidecarFalso(t, func(w http.ResponseWriter, _ solicitudFactura) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"detail":"token interno invalido"}`))
		})
		w := facturadorDePrueba(t, repo, &pubFalso{}, srv.URL, nil)
		if _, err := w.Tick(context.Background()); err != nil {
			t.Fatal(err)
		}
		if fila.estado != model.ComprobantePendiente || fila.nextRetryAt == nil {
			t.Fatalf("un 401 se arregla y se reintenta: %+v", fila)
		}
	})
}

func TestBackoffFacturacion(t *testing.T) {
	casos := []struct {
		intento int
		espera  time.Duration
	}{
		{1, time.Minute},
		{2, 5 * time.Minute},
		{3, 25 * time.Minute},
		{4, 125 * time.Minute},
		{5, 6 * time.Hour}, // 625m pasa el tope
		{9, 6 * time.Hour}, // y se queda ahí
		{0, time.Minute},   // defensivo
		{-3, time.Minute},  //
	}
	for _, c := range casos {
		if got := BackoffFacturacion(c.intento); got != c.espera {
			t.Errorf("intento %d: esperaba %v, obtuvo %v", c.intento, c.espera, got)
		}
	}
}

func TestMontoES(t *testing.T) {
	casos := map[string]string{
		"12500.00":   "$12.500,00",
		"0.00":       "$0,00",
		"999.50":     "$999,50",
		"1234567.89": "$1.234.567,89",
	}
	for in, esperado := range casos {
		if got := montoES(in); got != esperado {
			t.Errorf("montoES(%q) = %q, esperaba %q", in, got, esperado)
		}
	}
}

func TestNewFacturadorSinLoIndispensable(t *testing.T) {
	c, _ := infra.NewCifrador(claveTest)
	if NewFacturador(FacturadorConfig{Cifrador: c, SidecarURL: "http://x"}) != nil {
		t.Error("arrancó sin repositorio")
	}
	if NewFacturador(FacturadorConfig{Repo: &repoFalso{}, SidecarURL: "http://x"}) != nil {
		t.Error("arrancó sin cifrador: facturaría con certificados que no puede leer")
	}
	if NewFacturador(FacturadorConfig{Repo: &repoFalso{}, Cifrador: c}) != nil {
		t.Error("arrancó sin URL del sidecar")
	}
}

// envolverConToken captura el header interno sin tocar el handler original.
func envolverConToken(h http.Handler, destino *string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*destino = r.Header.Get("X-Internal-Token")
		h.ServeHTTP(w, r)
	})
}
