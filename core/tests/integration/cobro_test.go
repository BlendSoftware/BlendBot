// Tests de E8 (cobro + ARCA) contra el PostgreSQL real y el código real de
// W4-A. Lo que se prueba acá y no en internal/: el circuito completo con la
// base de verdad — el UNIQUE que arbitra el doble cobro, la toma condicional
// del comprobante bajo el SQL posta, el descifrado del certificado en el viaje
// al sidecar, y el cierre del día agregado en la timezone del negocio.
//
// El sidecar de ARCA es un httptest.Server: nunca sale un paquete a la red.
package integration

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	// tzdata embebida: el cierre se agrega en la zona del negocio y el test no
	// puede depender de que la imagen donde corre traiga /usr/share/zoneinfo.
	_ "time/tzdata"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/infra"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"
	"copiloto/core/internal/worker"

	"gorm.io/gorm"
)

const (
	// cuitDePrueba pasa el dígito verificador de ARCA: el service lo valida y
	// un CUIT inventado al azar rebotaría con ErrCUITInvalido.
	cuitDePrueba = "20304050609"
	tokenInterno = "token-interno-del-sidecar-de-test"

	certDePrueba  = "-----BEGIN CERTIFICATE-----\nMIIB-de-prueba\n-----END CERTIFICATE-----"
	claveDePrueba = "-----BEGIN PRIVATE KEY-----\nMIIE-de-prueba\n-----END PRIVATE KEY-----"

	// 64 hex = 32 bytes: la clave AES-256 que pide FISCAL_CIPHER_KEY.
	claveCifradoTest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

// ── Andamio del cobro ───────────────────────────────────────────────────────

func cifradorTest(t *testing.T) infra.Cifrador {
	t.Helper()
	c, err := infra.NewCifrador(claveCifradoTest)
	if err != nil {
		t.Fatalf("cifrador fiscal de test: %v", err)
	}
	return c
}

func cobroService(t *testing.T, db *gorm.DB) service.CobroService {
	t.Helper()
	return service.NewCobroService(
		repository.NewCobroRepository(db),
		repository.NewNegocioDatosRepository(db),
		cifradorTest(t),
	)
}

// configFiscal deja al negocio en condiciones de facturar. Va por el service y
// no por un INSERT a mano a propósito: así el cifrado de los certificados entra
// en el circuito y el test del facturador prueba el viaje entero (PEM cifrado
// en la base → PEM descifrado → PEM que recibe el sidecar).
func configFiscal(t *testing.T, ctx context.Context, svc service.CobroService, negocioID string) {
	t.Helper()
	razon := "Consultorio Gómez"
	condicion := "monotributo"
	punto := 3
	modo := model.ModoHomologacion
	cert := certDePrueba
	key := claveDePrueba

	resp, err := svc.ConfigurarFiscal(ctx, negocioID, dto.ConfigFiscalInput{
		CUIT:        cuitDePrueba,
		RazonSocial: &razon,
		Condicion:   &condicion,
		PuntoVenta:  &punto,
		Modo:        &modo,
		CertPEM:     &cert,
		KeyPEM:      &key,
	})
	if err != nil {
		t.Fatalf("configurar fiscal: %v", err)
	}
	if !resp.TieneCertificados {
		t.Fatal("la config fiscal quedó sin certificados: el facturador ni la va a mirar")
	}
}

// cerrarCompromiso sella cerrado_en: el cierre del día agrupa por esa columna.
func cerrarCompromiso(t *testing.T, db *gorm.DB, id string, estado model.EstadoCompromiso, cuando time.Time) {
	t.Helper()
	err := db.Model(&model.Compromiso{}).
		Where("id = ?", id).
		Updates(map[string]any{"estado": estado, "cerrado_en": cuando}).Error
	if err != nil {
		t.Fatalf("cerrar compromiso %s: %v", id, err)
	}
}

// setOrigen cambia por dónde entró el compromiso: el fixture del harness los
// crea todos por el panel y el corte del cierre necesita la mezcla real.
func setOrigen(t *testing.T, db *gorm.DB, id string, origen model.OrigenCompromiso) {
	t.Helper()
	if err := db.Model(&model.Compromiso{}).Where("id = ?", id).Update("origen", origen).Error; err != nil {
		t.Fatalf("poner origen %s en %s: %v", origen, id, err)
	}
}

func setEstadoCompromiso(t *testing.T, db *gorm.DB, id string, estado model.EstadoCompromiso) {
	t.Helper()
	if err := db.Model(&model.Compromiso{}).Where("id = ?", id).Update("estado", estado).Error; err != nil {
		t.Fatalf("poner %s en %s: %v", id, estado, err)
	}
}

func setDocumento(t *testing.T, db *gorm.DB, clienteID, documento string) {
	t.Helper()
	if err := db.Model(&model.Cliente{}).Where("id = ?", clienteID).Update("documento", documento).Error; err != nil {
		t.Fatalf("poner documento en %s: %v", clienteID, err)
	}
}

func contarCobros(t *testing.T, db *gorm.DB, negocioID string) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&model.Cobro{}).Where("negocio_id = ?", negocioID).Count(&n).Error; err != nil {
		t.Fatalf("contar cobros: %v", err)
	}
	return n
}

func comprobanteDe(t *testing.T, db *gorm.DB, cobroID string) model.Comprobante {
	t.Helper()
	var cb model.Comprobante
	if err := db.Where("cobro_id = ?", cobroID).First(&cb).Error; err != nil {
		t.Fatalf("releer comprobante del cobro %s: %v", cobroID, err)
	}
	return cb
}

// cobrar es el atajo del caso normal: cobra y corta el test si falla.
func cobrar(t *testing.T, ctx context.Context, svc service.CobroService, negocioID, compromisoID string, medio model.MedioPago) *dto.CobroResponse {
	t.Helper()
	resp, err := svc.Cobrar(ctx, negocioID, nil, dto.CobrarInput{
		CompromisoID: compromisoID,
		MedioPago:    string(medio),
	})
	if err != nil {
		t.Fatalf("cobrar %s: %v", compromisoID, err)
	}
	return resp
}

// ── El sidecar de ARCA, falso ───────────────────────────────────────────────

// pedidoFacturar es el cuerpo que el core le manda al sidecar (espejo de
// worker.solicitudFactura, que es privada). Es un contrato entre dos procesos
// que nadie compila junto (W4-A ↔ W4-B): un campo renombrado rompe la factura
// en producción y en silencio, así que el test lo declara entero.
type pedidoFacturar struct {
	CUITEmisor    string `json:"cuit_emisor"`
	PuntoVenta    int    `json:"punto_venta"`
	Modo          string `json:"modo"`
	CertPEM       string `json:"cert_pem"`
	KeyPEM        string `json:"key_pem"`
	TipoCbte      int    `json:"tipo_cbte"`
	Concepto      int    `json:"concepto"`
	DocTipo       int    `json:"doc_tipo"`
	DocNro        string `json:"doc_nro"`
	ImporteTotal  string `json:"importe_total"`
	Fecha         string `json:"fecha"`
	ServicioDesde string `json:"servicio_desde"`
	ServicioHasta string `json:"servicio_hasta"`

	token string // header X-Internal-Token
	ruta  string
}

// respuestaFacturar es lo que contesta el sidecar (W4-B).
type respuestaFacturar struct {
	OK             bool   `json:"ok"`
	Numero         int64  `json:"numero,omitempty"`
	CAE            string `json:"cae,omitempty"`
	CAEVencimiento string `json:"cae_vencimiento,omitempty"`
	Error          string `json:"error,omitempty"`
}

type sidecarFalso struct {
	*httptest.Server

	mu       sync.Mutex
	pedidos  []pedidoFacturar
	responde func(nro int) (int, respuestaFacturar)
}

func nuevoSidecar(t *testing.T, responde func(nro int) (int, respuestaFacturar)) *sidecarFalso {
	t.Helper()
	s := &sidecarFalso{responde: responde}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		crudo, _ := io.ReadAll(r.Body)
		var p pedidoFacturar
		if err := json.Unmarshal(crudo, &p); err != nil {
			t.Errorf("el sidecar recibió un cuerpo que no es JSON (%v): %s", err, crudo)
		}
		p.token = r.Header.Get("X-Internal-Token")
		p.ruta = r.URL.Path

		s.mu.Lock()
		s.pedidos = append(s.pedidos, p)
		nro := len(s.pedidos)
		s.mu.Unlock()

		estado, resp := s.responde(nro)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(estado)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *sidecarFalso) recibidos() []pedidoFacturar {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]pedidoFacturar(nil), s.pedidos...)
}

// siempreOK es el sidecar contento: devuelve CAE y número.
func siempreOK(nro int) (int, respuestaFacturar) {
	return http.StatusOK, respuestaFacturar{
		OK:             true,
		Numero:         int64(100 + nro),
		CAE:            "75123456789012",
		CAEVencimiento: "2026-09-05",
	}
}

// siempreFalla es ARCA rechazando: HTTP 200 con ok=false, que es como contesta
// de verdad. Mirar sólo el status daría por emitida una factura que no existe.
func siempreFalla(int) (int, respuestaFacturar) {
	return http.StatusOK, respuestaFacturar{OK: false, Error: "ARCA no responde (WSFEv1 timeout)"}
}

// facturador arma el worker con el reloj apuntando a *reloj: los tests mueven
// el tiempo en vez de esperarlo.
func facturador(t *testing.T, db *gorm.DB, c *cola, s *sidecarFalso, reloj *time.Time) *worker.Facturador {
	t.Helper()
	w := worker.NewFacturador(worker.FacturadorConfig{
		Repo:          repository.NewCobroRepository(db),
		Pub:           c.pub,
		Cifrador:      cifradorTest(t),
		SidecarURL:    s.URL,
		InternalToken: tokenInterno,
		HTTP:          s.Client(),
		Ahora:         func() time.Time { return *reloj },
	})
	if w == nil {
		t.Fatal("NewFacturador devolvió nil: le falta alguna dependencia")
	}
	return w
}

// ── Cobrar ──────────────────────────────────────────────────────────────────

// TestCobrarUnTurnoCompletado es el caso feliz: se atendió, se cobró, y quedó
// un comprobante esperando su CAE. El monto NO viaja en el request: sale del
// total del compromiso, que a su vez tiene los precios congelados.
func TestCobrarUnTurnoCompletado(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)
	setDocumento(t, e.db, e.cliente.ID, "30111222")

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")

	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	if cobro.CompromisoID != turno.ID {
		t.Errorf("compromiso del cobro: esperaba %s, obtuvo %s", turno.ID, cobro.CompromisoID)
	}
	if cobro.MedioPago != string(model.MedioEfectivo) {
		t.Errorf("medio de pago: esperaba efectivo, obtuvo %q", cobro.MedioPago)
	}
	igualDecimal(t, cobro.Monto, "18500.00", "monto del cobro")

	if n := contarCobros(t, e.db, e.negocio.ID); n != 1 {
		t.Fatalf("quedaron %d cobros, esperaba 1", n)
	}

	if cobro.Comprobante == nil {
		t.Fatal("con config fiscal cargada, el cobro tiene que dejar su comprobante")
	}
	if cobro.Comprobante.Estado != string(model.ComprobantePendiente) {
		t.Errorf("el comprobante nace pendiente, no %q", cobro.Comprobante.Estado)
	}

	cb := comprobanteDe(t, e.db, cobro.ID)
	if cb.TipoCbte != model.TipoCbteFacturaC {
		t.Errorf("tipo de comprobante: esperaba 11 (Factura C), obtuvo %d", cb.TipoCbte)
	}
	if cb.PuntoVenta != 3 {
		t.Errorf("punto de venta: esperaba el de la config fiscal (3), obtuvo %d", cb.PuntoVenta)
	}
	igualDecimal(t, cb.Importe, "18500.00", "importe del comprobante")
	if cb.Numero != nil || cb.CAE != nil {
		t.Errorf("un comprobante recién creado no tiene número ni CAE: %v / %v", cb.Numero, cb.CAE)
	}
	// El paciente dejó su DNI: la factura sale a su nombre y no a consumidor final.
	if cb.ReceptorDocTipo != model.DocTipoDNI {
		t.Errorf("doc_tipo del receptor: esperaba 96 (DNI), obtuvo %d", cb.ReceptorDocTipo)
	}
	if cb.ReceptorDocNro == nil || *cb.ReceptorDocNro != "30111222" {
		t.Errorf("doc_nro del receptor: esperaba 30111222, obtuvo %v", cb.ReceptorDocNro)
	}
}

// TestCobrarSinDocumentoVaAConsumidorFinal: la mayoría de los pacientes no deja
// el DNI y la factura tiene que salir igual.
func TestCobrarSinDocumentoVaAConsumidorFinal(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "9000.00")

	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioQR)

	cb := comprobanteDe(t, e.db, cobro.ID)
	if cb.ReceptorDocTipo != model.DocTipoConsumidorFinal {
		t.Errorf("doc_tipo del receptor: esperaba 99 (consumidor final), obtuvo %d", cb.ReceptorDocTipo)
	}
	if cb.ReceptorDocNro != nil {
		t.Errorf("consumidor final no lleva número de documento: %v", *cb.ReceptorDocNro)
	}
}

// TestCobrarSinConfigFiscalNoRompeElCobro: un consultorio que todavía no cargó
// su CUIT igual necesita cobrar. Se guarda el cobro y el response lo aclara, en
// vez de fallar y dejar la plata sin registrar.
func TestCobrarSinConfigFiscalNoRompeElCobro(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "5000.00")

	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	if cobro.Comprobante != nil {
		t.Errorf("se creó un comprobante sin config fiscal: %+v", cobro.Comprobante)
	}
	if cobro.Facturacion == "" {
		t.Error("el response tiene que explicar por qué no hay factura")
	}
	if n := contarCobros(t, e.db, e.negocio.ID); n != 1 {
		t.Errorf("el cobro tiene que quedar registrado igual (hay %d)", n)
	}
}

// TestDobleCobroRebota: el turno se cobra una vez. El árbitro es el UNIQUE de
// la base, que es lo único que resuelve dos toques simultáneos del panel.
func TestDobleCobroRebota(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")

	cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	_, err := svc.Cobrar(ctx, e.negocio.ID, nil, dto.CobrarInput{
		CompromisoID: turno.ID,
		MedioPago:    string(model.MedioTransferencia),
	})
	if !errors.Is(err, service.ErrYaCobrado) {
		t.Fatalf("el segundo cobro tenía que dar ErrYaCobrado, dio: %v", err)
	}

	if n := contarCobros(t, e.db, e.negocio.ID); n != 1 {
		t.Errorf("quedaron %d cobros del mismo turno", n)
	}
	var comprobantes int64
	e.db.Model(&model.Comprobante{}).Count(&comprobantes)
	if comprobantes != 1 {
		t.Errorf("quedaron %d comprobantes: el doble cobro emitiría dos facturas", comprobantes)
	}
}

// TestDobleCobroSimultaneoLoResuelveLaBase: dos clicks a la vez sobre el mismo
// turno. El chequeo previo del service no alcanza (los dos leen "sin cobro"),
// así que el que decide es el UNIQUE: uno entra, el otro recibe ErrYaCobrado.
func TestDobleCobroSimultaneoLoResuelveLaBase(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")

	const intentos = 4
	var wg sync.WaitGroup
	errs := make([]error, intentos)
	arranque := make(chan struct{})

	for i := 0; i < intentos; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-arranque
			_, err := svc.Cobrar(ctx, e.negocio.ID, nil, dto.CobrarInput{
				CompromisoID: turno.ID,
				MedioPago:    string(model.MedioEfectivo),
			})
			errs[i] = err
		}(i)
	}
	close(arranque)
	wg.Wait()

	exitosos := 0
	for _, err := range errs {
		switch {
		case err == nil:
			exitosos++
		case errors.Is(err, service.ErrYaCobrado):
		default:
			t.Errorf("un cobro perdedor falló con algo que el panel no sabe leer: %v", err)
		}
	}
	if exitosos != 1 {
		t.Fatalf("%d cobros simultáneos entraron; tiene que entrar exactamente 1", exitosos)
	}
	if n := contarCobros(t, e.db, e.negocio.ID); n != 1 {
		t.Fatalf("quedaron %d cobros del mismo turno", n)
	}
}

// TestSoloSeCobraLoQueSeAtendio: cobrar es el final del recorrido. Un turno que
// todavía no pasó, o que se canceló, no se cobra: si se pudiera, la plata del
// cierre no coincidiría con lo que de verdad se hizo.
func TestSoloSeCobraLoQueSeAtendio(t *testing.T) {
	casos := []struct {
		estado model.EstadoCompromiso
		cobra  bool
	}{
		{model.EstadoPendiente, false},
		{model.EstadoConfirmado, false},
		{model.EstadoEnCurso, false},
		{model.EstadoListo, false},
		{model.EstadoCancelado, false},
		{model.EstadoRechazado, false},
		{model.EstadoAusente, false},
		{model.EstadoCompletado, true},
	}

	for _, caso := range casos {
		t.Run(string(caso.estado), func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud)
			svc := cobroService(t, e.db)
			configFiscal(t, ctx, svc, e.negocio.ID)

			cmp := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
				nil, nil, nil, model.CompromisoTurno, model.EstadoPendiente, "18500.00")
			setEstadoCompromiso(t, e.db, cmp.ID, caso.estado)

			_, err := svc.Cobrar(ctx, e.negocio.ID, nil, dto.CobrarInput{
				CompromisoID: cmp.ID,
				MedioPago:    string(model.MedioEfectivo),
			})

			if caso.cobra {
				if err != nil {
					t.Fatalf("un turno %s se cobra: %v", caso.estado, err)
				}
				return
			}

			if !errors.Is(err, service.ErrNoCobrable) {
				t.Fatalf("cobrar un turno %s tenía que dar ErrNoCobrable, dio: %v", caso.estado, err)
			}
			if n := contarCobros(t, e.db, e.negocio.ID); n != 0 {
				t.Errorf("quedó un cobro de un turno %s", caso.estado)
			}
		})
	}
}

// TestMedioDePagoFueraDeLaListaSeRechaza: el CHECK de la base y el service
// dicen lo mismo. Un medio inventado no puede llegar a crear la fila.
func TestMedioDePagoFueraDeLaListaSeRechaza(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")

	_, err := svc.Cobrar(ctx, e.negocio.ID, nil, dto.CobrarInput{
		CompromisoID: turno.ID,
		MedioPago:    "cripto",
	})
	if !errors.Is(err, service.ErrMedioPagoInvalido) {
		t.Fatalf("esperaba ErrMedioPagoInvalido, obtuvo: %v", err)
	}
	if n := contarCobros(t, e.db, e.negocio.ID); n != 0 {
		t.Error("se registró un cobro con un medio que no existe")
	}
}

// TestElCobroEsDelTenant: EL test del producto, otra vez. La plata de un
// consultorio no existe para el otro: ni se cobra, ni se lee, ni aparece en su
// cierre del día.
func TestElCobroEsDelTenant(t *testing.T) {
	ctx, db := nuevoCaso(t)
	svc := cobroService(t, db)

	negA := crearNegocio(t, db, "Consultorio A", model.VerticalSalud)
	negB := crearNegocio(t, db, "Consultorio B", model.VerticalSalud)
	cliA := crearCliente(t, db, negA.ID, "5492611000060", "Ana", nil)
	srvA := crearServicio(t, db, negA.ID, "Consulta A", "12000.00")

	configFiscal(t, ctx, svc, negA.ID)
	configFiscal(t, ctx, svc, negB.ID)

	turnoA := crearCompromisoDirecto(t, db, negA.ID, cliA.ID, srvA.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "12000.00")
	cerrarCompromiso(t, db, turnoA.ID, model.EstadoCompletado, time.Now())

	// B no puede cobrar el turno de A ni con el id correcto en la mano.
	if _, err := svc.Cobrar(ctx, negB.ID, nil, dto.CobrarInput{
		CompromisoID: turnoA.ID,
		MedioPago:    string(model.MedioEfectivo),
	}); !errors.Is(err, service.ErrNoEncontrado) {
		t.Fatalf("B cobró (o casi) un turno de A: %v", err)
	}
	if n := contarCobros(t, db, negB.ID); n != 0 {
		t.Fatalf("B se quedó con %d cobros ajenos", n)
	}

	cobroA := cobrar(t, ctx, svc, negA.ID, turnoA.ID, model.MedioEfectivo)

	if _, err := svc.PorCompromiso(ctx, negB.ID, turnoA.ID); !errors.Is(err, service.ErrNoEncontrado) {
		t.Errorf("B leyó el cobro de A (err %v)", err)
	}
	leido, err := svc.PorCompromiso(ctx, negA.ID, turnoA.ID)
	if err != nil || leido == nil || leido.ID != cobroA.ID {
		t.Errorf("A no lee su propio cobro: %+v (err %v)", leido, err)
	}

	// Y el cierre del día tampoco cruza tenants.
	hoy := time.Now().In(zonaDelNegocio(t))
	cierreB, err := svc.CierreDelDia(ctx, negB.ID, hoy)
	if err != nil {
		t.Fatalf("cierre de B: %v", err)
	}
	if cierreB.Cobros != 0 || !cierreB.TotalCobrado.IsZero() || cierreB.Compromisos != 0 {
		t.Errorf("el cierre de B trae el día de A: %+v", cierreB)
	}

	cierreA, err := svc.CierreDelDia(ctx, negA.ID, hoy)
	if err != nil {
		t.Fatalf("cierre de A: %v", err)
	}
	if cierreA.Cobros != 1 {
		t.Errorf("el cierre de A tenía que traer su único cobro: %+v", cierreA)
	}
}

// ── El facturador ───────────────────────────────────────────────────────────

// TestFacturadorSellaElCAEYAvisaAlCliente: el circuito completo del comprobante
// contra la base real. Lo que se prueba es el contrato con el sidecar (Factura
// C, concepto 2 con sus fechas de servicio, el token interno, los certificados
// descifrados) y que el CAE quede sellado con el aviso al paciente encolado.
func TestFacturadorSellaElCAEYAvisaAlCliente(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-cobro")

	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	inicio := time.Now().Add(-2 * time.Hour)
	fin := inicio.Add(30 * time.Minute)
	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &inicio, &fin, model.CompromisoTurno, model.EstadoCompletado, "18500.00")
	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	sidecar := nuevoSidecar(t, siempreOK)
	reloj := time.Now().Truncate(time.Second)
	w := facturador(t, e.db, c, sidecar, &reloj)

	n, err := w.Tick(ctx)
	if err != nil {
		t.Fatalf("primer tick del facturador: %v", err)
	}
	if n != 1 {
		t.Fatalf("el tick facturó %d comprobantes, esperaba 1", n)
	}

	pedidos := sidecar.recibidos()
	if len(pedidos) != 1 {
		t.Fatalf("el sidecar recibió %d pedidos, esperaba 1", len(pedidos))
	}
	p := pedidos[0]
	if p.token != tokenInterno {
		t.Errorf("X-Internal-Token: esperaba %q, obtuvo %q", tokenInterno, p.token)
	}
	if p.ruta != "/facturar" {
		t.Errorf("ruta del sidecar: esperaba /facturar, obtuvo %q", p.ruta)
	}
	if p.CUITEmisor != cuitDePrueba {
		t.Errorf("cuit_emisor: esperaba %s, obtuvo %q", cuitDePrueba, p.CUITEmisor)
	}
	if p.PuntoVenta != 3 {
		t.Errorf("punto_venta: esperaba 3, obtuvo %d", p.PuntoVenta)
	}
	if p.Modo != model.ModoHomologacion {
		t.Errorf("modo: esperaba homologacion, obtuvo %q", p.Modo)
	}
	if p.TipoCbte != model.TipoCbteFacturaC {
		t.Errorf("tipo_cbte: esperaba 11 (Factura C), obtuvo %d", p.TipoCbte)
	}
	if p.Concepto != worker.ConceptoServicios {
		t.Errorf("concepto: esperaba 2 (servicios), obtuvo %d", p.Concepto)
	}
	// Concepto 2 exige el período prestado: sin esas fechas ARCA rechaza.
	if p.ServicioDesde == "" || p.ServicioHasta == "" {
		t.Errorf("concepto 2 va con servicio_desde/servicio_hasta: %+v", p)
	}
	if p.ImporteTotal != "18500.00" {
		t.Errorf("importe_total: esperaba 18500.00, obtuvo %q", p.ImporteTotal)
	}
	if p.DocTipo != model.DocTipoConsumidorFinal || p.DocNro != "0" {
		t.Errorf("receptor sin DNI: esperaba doc_tipo 99 y doc_nro 0, obtuvo %d / %q", p.DocTipo, p.DocNro)
	}
	// Los PEM viven cifrados en la base y llegan al sidecar en claro. Este es
	// el único punto del sistema donde el certificado existe en texto plano.
	if p.CertPEM != certDePrueba || p.KeyPEM != claveDePrueba {
		t.Errorf("los certificados no llegaron descifrados:\ncert=%q\nkey=%q", p.CertPEM, p.KeyPEM)
	}

	cb := comprobanteDe(t, e.db, cobro.ID)
	if cb.Estado != model.ComprobanteEmitido {
		t.Fatalf("el comprobante quedó en %q después de un CAE válido", cb.Estado)
	}
	if cb.Numero == nil || *cb.Numero != 101 {
		t.Errorf("número del comprobante: esperaba 101, obtuvo %v", cb.Numero)
	}
	if cb.CAE == nil || *cb.CAE != "75123456789012" {
		t.Errorf("CAE: esperaba 75123456789012, obtuvo %v", cb.CAE)
	}
	if cb.CAEVence == nil {
		t.Error("el vencimiento del CAE se guarda: es lo que hace válida a la factura")
	}
	if cb.EmitidoEn == nil {
		t.Error("un comprobante emitido lleva emitido_en")
	}

	// Y el panel lo ve emitido, con el número como sale impreso.
	leido, err := svc.PorCompromiso(ctx, e.negocio.ID, turno.ID)
	if err != nil {
		t.Fatalf("releer el cobro: %v", err)
	}
	if leido.Comprobante == nil || leido.Comprobante.NumeroFormateado == nil {
		t.Fatalf("el cobro leído no trae el número de la factura: %+v", leido.Comprobante)
	}
	if *leido.Comprobante.NumeroFormateado != "0003-00000101" {
		t.Errorf("número formateado: esperaba 0003-00000101, obtuvo %q", *leido.Comprobante.NumeroFormateado)
	}

	// El paciente se entera por el mismo WhatsApp donde sacó el turno.
	msgs := c.mensajes(t, ctx)
	if len(msgs) != 1 {
		t.Fatalf("la cola quedó con %d mensajes, esperaba 1: %+v", len(msgs), msgs)
	}
	m := msgs[0]
	if m.Tipo != worker.TipoTexto {
		t.Errorf("el aviso de la factura es texto libre, no plantilla: %q", m.Tipo)
	}
	if m.Telefono != e.cliente.Telefono {
		t.Errorf("el aviso fue a %s, esperaba %s", m.Telefono, e.cliente.Telefono)
	}
	if m.WaPhoneID != "wa-phone-cobro" {
		t.Errorf("wa_phone_id del aviso: %q", m.WaPhoneID)
	}
	for _, pedazo := range []string{"0003-00000101", "75123456789012"} {
		if !strings.Contains(m.Texto, pedazo) {
			t.Errorf("el aviso no menciona %q: %q", pedazo, m.Texto)
		}
	}
}

// TestDosTicksUnaSolaFactura: la toma del comprobante es un UPDATE condicional
// con lease. Dos ticks seguidos (o dos réplicas del core) no pueden facturar
// dos veces el mismo cobro: eso serían dos Facturas C por el mismo turno ante
// ARCA, y eso no se deshace.
func TestDosTicksUnaSolaFactura(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-doble")

	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")
	cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	sidecar := nuevoSidecar(t, siempreOK)
	reloj := time.Now().Truncate(time.Second)
	w := facturador(t, e.db, c, sidecar, &reloj)

	if _, err := w.Tick(ctx); err != nil {
		t.Fatalf("primer tick: %v", err)
	}
	n, err := w.Tick(ctx)
	if err != nil {
		t.Fatalf("segundo tick: %v", err)
	}
	if n != 0 {
		t.Errorf("el segundo tick facturó %d comprobantes ya emitidos", n)
	}

	if pedidos := sidecar.recibidos(); len(pedidos) != 1 {
		t.Fatalf("el sidecar recibió %d pedidos: la factura salió dos veces", len(pedidos))
	}
	if msgs := c.mensajes(t, ctx); len(msgs) != 1 {
		t.Errorf("el paciente recibió %d avisos de la misma factura", len(msgs))
	}
}

// TestElLeaseFrenaAOtraReplica: dos facturadores mirando la misma base al mismo
// tiempo. El que toma la fila la reserva por el lease; el otro no la ve.
func TestElLeaseFrenaAOtraReplica(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-lease")

	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")
	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	repo := repository.NewCobroRepository(e.db)
	cb := comprobanteDe(t, e.db, cobro.ID)
	ahora := time.Now().Truncate(time.Second)

	// La réplica A toma la fila.
	gano, err := repo.TomarComprobante(ctx, cb.ID, ahora, 2*time.Minute)
	if err != nil || !gano {
		t.Fatalf("la primera toma tenía que ganar (gano=%v, err=%v)", gano, err)
	}
	// La réplica B, en el mismo instante, no.
	gano, err = repo.TomarComprobante(ctx, cb.ID, ahora, 2*time.Minute)
	if err != nil {
		t.Fatalf("segunda toma: %v", err)
	}
	if gano {
		t.Fatal("dos réplicas tomaron el mismo comprobante: la factura saldría dos veces")
	}

	// Y el barrido tampoco lo ofrece mientras el lease esté vigente.
	sidecar := nuevoSidecar(t, siempreOK)
	reloj := ahora.Add(time.Minute)
	w := facturador(t, e.db, c, sidecar, &reloj)
	if n, err := w.Tick(ctx); err != nil || n != 0 {
		t.Errorf("el barrido tomó un comprobante con lease vigente (n=%d, err=%v)", n, err)
	}
	if len(sidecar.recibidos()) != 0 {
		t.Error("se llamó al sidecar por un comprobante reservado por otra réplica")
	}

	// Vencido el lease, el trabajo se recupera solo: una réplica que se murió a
	// mitad de camino no deja la factura colgada para siempre.
	reloj = ahora.Add(3 * time.Minute)
	if n, err := w.Tick(ctx); err != nil || n != 1 {
		t.Fatalf("vencido el lease, el comprobante se retoma (n=%d, err=%v)", n, err)
	}
}

// TestFacturadorReintentaConBackoff: ARCA se cae seguido y eso no puede
// significar ni una factura perdida ni un bombardeo de reintentos. Backoff
// exponencial 1m, 5m, 25m… con tope de 6h, y a los 10 intentos el comprobante
// queda en error para que lo mire un humano.
func TestFacturadorReintentaConBackoff(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-backoff")

	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")
	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	sidecar := nuevoSidecar(t, siempreFalla)
	reloj := time.Now().Truncate(time.Second)
	w := facturador(t, e.db, c, sidecar, &reloj)

	if _, err := w.Tick(ctx); err != nil {
		t.Fatalf("tick con ARCA caído: %v", err)
	}

	cb := comprobanteDe(t, e.db, cobro.ID)
	if cb.Estado != model.ComprobantePendiente {
		t.Fatalf("un fallo de ARCA deja el comprobante pendiente, no %q", cb.Estado)
	}
	if cb.RetryCount != 1 {
		t.Errorf("retry_count: esperaba 1, obtuvo %d", cb.RetryCount)
	}
	if cb.LastError == nil || *cb.LastError == "" {
		t.Error("el error de ARCA se guarda: sin eso nadie sabe por qué no salió")
	}
	if cb.NextRetryAt == nil {
		t.Fatal("un comprobante que falló necesita next_retry_at")
	}
	if espera := cb.NextRetryAt.Sub(reloj); espera < 55*time.Second || espera > 65*time.Second {
		t.Errorf("primer backoff: esperaba ~1 minuto, obtuvo %s", espera)
	}

	// Antes de la hora del reintento nadie lo toca.
	if n, err := w.Tick(ctx); err != nil || n != 0 {
		t.Errorf("se reintentó antes de tiempo (n=%d, err=%v)", n, err)
	}
	if pedidos := sidecar.recibidos(); len(pedidos) != 1 {
		t.Errorf("el sidecar recibió %d pedidos: el backoff no frenó nada", len(pedidos))
	}

	// Pasada la espera sale el segundo intento, y la próxima espera crece.
	reloj = reloj.Add(2 * time.Minute)
	if _, err := w.Tick(ctx); err != nil {
		t.Fatalf("segundo intento: %v", err)
	}
	cb = comprobanteDe(t, e.db, cobro.ID)
	if cb.RetryCount != 2 {
		t.Fatalf("retry_count tras el segundo intento: %d", cb.RetryCount)
	}
	if espera := cb.NextRetryAt.Sub(reloj); espera < 4*time.Minute+30*time.Second || espera > 5*time.Minute+30*time.Second {
		t.Errorf("segundo backoff: esperaba ~5 minutos, obtuvo %s", espera)
	}

	// Y a fuerza de fallar termina en error, sin que la espera pase de 6 horas.
	for i := 3; i <= worker.FacturadorMaxIntentos; i++ {
		reloj = reloj.Add(7 * time.Hour)
		if _, err := w.Tick(ctx); err != nil {
			t.Fatalf("intento %d: %v", i, err)
		}
		cb = comprobanteDe(t, e.db, cobro.ID)
		if cb.RetryCount != i {
			t.Fatalf("intento %d: retry_count quedó en %d", i, cb.RetryCount)
		}
		if cb.Estado == model.ComprobantePendiente && cb.NextRetryAt != nil {
			if espera := cb.NextRetryAt.Sub(reloj); espera > 6*time.Hour+time.Minute {
				t.Errorf("intento %d: el backoff se pasó del tope de 6h (%s)", i, espera)
			}
		}
	}

	if cb.Estado != model.ComprobanteError {
		t.Fatalf("a los %d intentos el comprobante queda en error, quedó en %q",
			worker.FacturadorMaxIntentos, cb.Estado)
	}

	// Un comprobante en error no se vuelve a tomar solo.
	reloj = reloj.Add(24 * time.Hour)
	antes := len(sidecar.recibidos())
	if _, err := w.Tick(ctx); err != nil {
		t.Fatalf("tick después del error: %v", err)
	}
	if despues := len(sidecar.recibidos()); despues != antes {
		t.Errorf("un comprobante en error se siguió reintentando (%d → %d)", antes, despues)
	}
	if msgs := c.mensajes(t, ctx); len(msgs) != 0 {
		t.Errorf("se le avisó al paciente de una factura que nunca salió: %+v", msgs)
	}
}

// TestSinCertificadosElComprobanteEspera: el consultorio cobró antes de subir
// su certificado. Esa factura NO puede gastar los diez intentos mientras tanto:
// tiene que esperar quieta y salir sola cuando el par se cargue.
func TestSinCertificadosElComprobanteEspera(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-sin-certs")

	svc := cobroService(t, e.db)
	// CUIT cargado pero sin el par de PEM: alcanza para crear el comprobante.
	if _, err := svc.ConfigurarFiscal(ctx, e.negocio.ID, dto.ConfigFiscalInput{
		CUIT: cuitDePrueba,
	}); err != nil {
		t.Fatalf("configurar fiscal sin certificados: %v", err)
	}

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")
	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)
	if cobro.Comprobante == nil {
		t.Fatal("con CUIT cargado el cobro tiene que dejar su comprobante")
	}

	sidecar := nuevoSidecar(t, siempreOK)
	reloj := time.Now().Truncate(time.Second)
	w := facturador(t, e.db, c, sidecar, &reloj)

	if n, err := w.Tick(ctx); err != nil || n != 0 {
		t.Fatalf("se intentó facturar sin certificados (n=%d, err=%v)", n, err)
	}
	cb := comprobanteDe(t, e.db, cobro.ID)
	if cb.RetryCount != 0 || cb.Estado != model.ComprobantePendiente {
		t.Fatalf("el comprobante gastó intentos esperando el certificado: %d intentos, estado %q",
			cb.RetryCount, cb.Estado)
	}

	// Cargado el par, el circuito arranca solo.
	configFiscal(t, ctx, svc, e.negocio.ID)
	if n, err := w.Tick(ctx); err != nil || n != 1 {
		t.Fatalf("con los certificados cargados tenía que facturar (n=%d, err=%v)", n, err)
	}
	if comprobanteDe(t, e.db, cobro.ID).Estado != model.ComprobanteEmitido {
		t.Error("la factura no quedó emitida después de cargar el certificado")
	}
}

// TestUnRechazoPermanenteNoGastaDiezIntentos: un 422 del sidecar es "así como
// está no va a andar nunca" (un CUIT mal cargado, un documento con letras).
// Insistir diez veces sólo demora el momento en que alguien lo arregla.
func TestUnRechazoPermanenteNoGastaDiezIntentos(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-422")

	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "18500.00")
	cobro := cobrar(t, ctx, svc, e.negocio.ID, turno.ID, model.MedioEfectivo)

	sidecar := nuevoSidecar(t, func(int) (int, respuestaFacturar) {
		return http.StatusUnprocessableEntity, respuestaFacturar{
			OK:    false,
			Error: "el documento del receptor no es numerico",
		}
	})
	reloj := time.Now().Truncate(time.Second)
	w := facturador(t, e.db, c, sidecar, &reloj)

	if _, err := w.Tick(ctx); err != nil {
		t.Fatalf("tick con rechazo permanente: %v", err)
	}

	cb := comprobanteDe(t, e.db, cobro.ID)
	if cb.Estado != model.ComprobanteError {
		t.Fatalf("un 422 del sidecar va derecho a error, quedó en %q con %d intentos",
			cb.Estado, cb.RetryCount)
	}
	if cb.RetryCount != 1 {
		t.Errorf("un rechazo permanente corta la serie de una: %d intentos", cb.RetryCount)
	}
	if cb.LastError == nil || *cb.LastError == "" {
		t.Error("el motivo del rechazo se guarda para que alguien lo pueda arreglar")
	}
}

// ── Cierre del día ──────────────────────────────────────────────────────────

func zonaDelNegocio(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Argentina/Mendoza")
	if err != nil {
		t.Fatalf("cargar timezone: %v", err)
	}
	return loc
}

// TestCierreDelDiaAgregaEnLaZonaDelNegocio: el día del consultorio termina a
// medianoche de Mendoza, no de UTC. Un turno cerrado a las 22:40 de un viernes
// es de ese viernes aunque en UTC ya sea sábado; agregando en UTC, el cierre de
// la noche mostraría plata del día siguiente.
func TestCierreDelDiaAgregaEnLaZonaDelNegocio(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)
	configFiscal(t, ctx, svc, e.negocio.ID)

	loc := zonaDelNegocio(t)
	dia := time.Date(2026, 8, 21, 0, 0, 0, 0, loc)
	alas := func(hora, min int) time.Time {
		return time.Date(2026, 8, 21, hora, min, 0, 0, loc)
	}

	otroServicio := crearServicio(t, e.db, e.negocio.ID, "Control", "8000.00")
	pedro := crearCliente(t, e.db, e.negocio.ID, "5492611000070", "Pedro", nil)
	lucia := crearCliente(t, e.db, e.negocio.ID, "5492611000071", "Lucía", nil)

	// Tres atendidos del día: dos entraron por WhatsApp, uno se cargó a mano.
	uno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "10000.00")
	setOrigen(t, e.db, uno.ID, model.OrigenWhatsApp)
	cerrarCompromiso(t, e.db, uno.ID, model.EstadoCompletado, alas(9, 30))

	dos := crearCompromisoDirecto(t, e.db, e.negocio.ID, pedro.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "20000.00")
	setOrigen(t, e.db, dos.ID, model.OrigenWhatsApp)
	cerrarCompromiso(t, e.db, dos.ID, model.EstadoCompletado, alas(22, 40)) // en UTC ya es el 22

	tres := crearCompromisoDirecto(t, e.db, e.negocio.ID, lucia.ID, otroServicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "6000.00")
	cerrarCompromiso(t, e.db, tres.ID, model.EstadoCompletado, alas(11, 0))

	// Uno cerrado pasada la medianoche: ese ya es del día siguiente.
	deManana := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoCompletado, "99999.00")
	cerrarCompromiso(t, e.db, deManana.ID, model.EstadoCompletado, alas(9, 30).AddDate(0, 0, 1))

	// Y los que no salieron.
	cancelado := crearCompromisoDirecto(t, e.db, e.negocio.ID, pedro.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoPendiente, "10000.00")
	cerrarCompromiso(t, e.db, cancelado.ID, model.EstadoCancelado, alas(8, 0))
	ausente := crearCompromisoDirecto(t, e.db, e.negocio.ID, lucia.ID, e.servicio.ID,
		nil, nil, nil, model.CompromisoTurno, model.EstadoPendiente, "10000.00")
	cerrarCompromiso(t, e.db, ausente.ID, model.EstadoAusente, alas(15, 0))

	cobrar(t, ctx, svc, e.negocio.ID, uno.ID, model.MedioEfectivo)
	cobrar(t, ctx, svc, e.negocio.ID, dos.ID, model.MedioTransferencia)
	cobrar(t, ctx, svc, e.negocio.ID, tres.ID, model.MedioEfectivo)

	// Los cobros se sellan con now(); acá se los alinea al día que se prueba.
	if err := e.db.Model(&model.Cobro{}).Where("negocio_id = ?", e.negocio.ID).
		Update("cobrado_en", alas(19, 0)).Error; err != nil {
		t.Fatalf("alinear cobrado_en: %v", err)
	}

	cierre, err := svc.CierreDelDia(ctx, e.negocio.ID, dia)
	if err != nil {
		t.Fatalf("cierre del día: %v", err)
	}

	if cierre.Fecha != "2026-08-21" {
		t.Errorf("fecha del cierre: esperaba 2026-08-21, obtuvo %s", cierre.Fecha)
	}
	if cierre.Timezone != "America/Argentina/Mendoza" {
		t.Errorf("timezone del cierre: %q", cierre.Timezone)
	}
	if cierre.Compromisos != 5 {
		t.Errorf("compromisos cerrados en el día: esperaba 5, obtuvo %d", cierre.Compromisos)
	}
	if cierre.Completados != 3 {
		t.Errorf("atendidos del día: esperaba 3, obtuvo %d (¿se coló el de mañana?)", cierre.Completados)
	}
	if cierre.Cancelados != 1 {
		t.Errorf("cancelados: esperaba 1, obtuvo %d", cierre.Cancelados)
	}
	if cierre.Ausentes != 1 {
		t.Errorf("ausentes: esperaba 1, obtuvo %d", cierre.Ausentes)
	}
	if cierre.Cobros != 3 {
		t.Errorf("cobros del día: esperaba 3, obtuvo %d", cierre.Cobros)
	}
	igualDecimal(t, cierre.TotalCobrado, "36000.00", "total cobrado del día")
	igualDecimal(t, cierre.TicketPromedio, "12000.00", "ticket promedio")

	igualDecimal(t, cierre.PorMedioPago[string(model.MedioEfectivo)], "16000.00", "plata en efectivo")
	igualDecimal(t, cierre.PorMedioPago[string(model.MedioTransferencia)], "20000.00", "plata por transferencia")
	if _, hay := cierre.PorMedioPago[string(model.MedioQR)]; hay {
		t.Error("el cierre lista medios de pago que nadie usó")
	}

	// El corte por origen cuenta TODO lo cerrado en el día, no sólo lo cobrado:
	// los dos de WhatsApp, y el que se cargó a mano más el cancelado y el que
	// no vino, que también entraron por el panel.
	if cierre.PorOrigen[string(model.OrigenWhatsApp)] != 2 {
		t.Errorf("por WhatsApp: esperaba 2 compromisos cerrados, obtuvo %d",
			cierre.PorOrigen[string(model.OrigenWhatsApp)])
	}
	if cierre.PorOrigen[string(model.OrigenPanel)] != 3 {
		t.Errorf("cargados a mano: esperaba 3, obtuvo %d", cierre.PorOrigen[string(model.OrigenPanel)])
	}

	if cierre.Comprobantes.Pendientes != 3 {
		t.Errorf("comprobantes pendientes: esperaba 3, obtuvo %+v", cierre.Comprobantes)
	}
	if cierre.Comprobantes.Emitidos != 0 || cierre.Comprobantes.ConError != 0 {
		t.Errorf("todavía no facturó nadie: %+v", cierre.Comprobantes)
	}
}

// TestCierreDeUnDiaVacio: un lunes sin atender no es un error, es un cierre en
// cero. El panel lo dibuja con su propia frase.
func TestCierreDeUnDiaVacio(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	svc := cobroService(t, e.db)

	cierre, err := svc.CierreDelDia(ctx, e.negocio.ID, time.Date(2026, 8, 24, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("cierre de un día sin nada: %v", err)
	}
	if cierre.Compromisos != 0 || cierre.Cobros != 0 || !cierre.TotalCobrado.IsZero() {
		t.Errorf("un día vacío tiene que dar todo en cero: %+v", cierre)
	}
	if !cierre.TicketPromedio.IsZero() {
		t.Errorf("ticket promedio de un día sin cobros: %s (no se divide por cero)", cierre.TicketPromedio)
	}
	if len(cierre.PorMedioPago) != 0 || len(cierre.PorOrigen) != 0 {
		t.Errorf("un día sin movimiento no inventa cortes: %+v / %+v", cierre.PorMedioPago, cierre.PorOrigen)
	}
}
