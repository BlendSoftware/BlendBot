// Los tests del repositorio de cobro corren contra PostgreSQL de verdad
// (testcontainers, el mismo harness de tests/integration). Es el único modo de
// probar lo que importa acá: el UNIQUE que impide el doble cobro, la toma
// condicional del comprobante y las proyecciones con JOIN, que en un doble en
// memoria pasarían siempre.
package repository_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	_ "time/tzdata"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/tests/testutil"

	"github.com/shopspring/decimal"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var env *testutil.Entorno

func TestMain(m *testing.M) {
	e, cerrar, err := testutil.Arrancar(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "entorno de tests no disponible: %v\n", err)
		os.Exit(1)
	}
	env = e
	code := m.Run()
	cerrar()
	os.Exit(code)
}

// ── Fixtures ──────────────────────────────────────────────────────────────

type escenario struct {
	db        *gorm.DB
	negocioID string
	clienteID string
	servicio  string
}

func nuevoEscenario(t *testing.T, telefono, documento string) escenario {
	t.Helper()
	db := env.DB

	n := &model.Negocio{
		Nombre: "Consultorio " + telefono, Vertical: model.VerticalSalud,
		Timezone: "America/Argentina/Mendoza", Config: datatypes.JSON([]byte(`{}`)), Activo: true,
	}
	if err := db.Create(n).Error; err != nil {
		t.Fatalf("negocio: %v", err)
	}

	nombre := "Ana"
	cl := &model.Cliente{NegocioID: n.ID, Telefono: telefono, Nombre: &nombre}
	if documento != "" {
		cl.Documento = &documento
	}
	if err := db.Create(cl).Error; err != nil {
		t.Fatalf("cliente: %v", err)
	}

	dur := 30
	s := &model.Servicio{
		NegocioID: n.ID, Nombre: "Consulta", DuracionMin: &dur,
		PrecioBase: decimal.NewFromInt(10000), Disponible: true, Activo: true,
	}
	if err := db.Create(s).Error; err != nil {
		t.Fatalf("servicio: %v", err)
	}

	return escenario{db: db, negocioID: n.ID, clienteID: cl.ID, servicio: s.ID}
}

// compromisoCompletado crea un compromiso ya cerrado, que es el único estado
// desde el que se cobra.
func (e escenario) compromisoCompletado(t *testing.T, total string, inicio *time.Time) string {
	t.Helper()
	c := &model.Compromiso{
		NegocioID: e.negocioID, ClienteID: e.clienteID, Tipo: model.CompromisoTurno,
		Estado: model.EstadoPendiente, Origen: model.OrigenWhatsApp,
		Total: decimal.RequireFromString(total), Inicio: inicio,
	}
	if inicio != nil {
		fin := inicio.Add(30 * time.Minute)
		c.Fin = &fin
	}
	if err := e.db.Create(c).Error; err != nil {
		t.Fatalf("compromiso: %v", err)
	}
	err := e.db.Model(&model.Compromiso{}).Where("id = ?", c.ID).
		Updates(map[string]any{"estado": model.EstadoCompletado, "cerrado_en": time.Now()}).Error
	if err != nil {
		t.Fatalf("completar: %v", err)
	}
	return c.ID
}

func (e escenario) configFiscal(t *testing.T, repo repository.CobroRepository, conCerts bool) {
	t.Helper()
	cf := &model.ConfigFiscal{
		NegocioID: e.negocioID, CUIT: "20123456780", Condicion: "monotributo",
		PuntoVenta: 3, Modo: model.ModoHomologacion, ActualizadoEn: time.Now(),
	}
	if conCerts {
		cert, key := "CERT-CIFRADO", "KEY-CIFRADO"
		cf.CertPEMCifrado, cf.KeyPEMCifrado = &cert, &key
	}
	if err := repo.GuardarConfigFiscal(context.Background(), cf); err != nil {
		t.Fatalf("config fiscal: %v", err)
	}
}

func (e escenario) cobrar(t *testing.T, repo repository.CobroRepository, compromisoID, medio, monto string, conComprobante bool) (*model.Cobro, *model.Comprobante) {
	t.Helper()
	c := &model.Cobro{
		NegocioID: e.negocioID, CompromisoID: compromisoID,
		MedioPago: model.MedioPago(medio), Monto: decimal.RequireFromString(monto),
	}
	var comp *model.Comprobante
	if conComprobante {
		comp = &model.Comprobante{
			TipoCbte: model.TipoCbteFacturaC, PuntoVenta: 3,
			Estado: model.ComprobantePendiente, ReceptorDocTipo: model.DocTipoConsumidorFinal,
			Importe: decimal.RequireFromString(monto),
		}
	}
	if err := repo.CrearCobro(context.Background(), c, comp); err != nil {
		t.Fatalf("crear cobro: %v", err)
	}
	return c, comp
}

// ── Tests ─────────────────────────────────────────────────────────────────

// El UNIQUE de la base es el único árbitro confiable con dos clicks
// simultáneos en "Cobrar": el chequeo previo del service puede perder la carrera.
func TestUnCompromisoSeCobraUnaSolaVez(t *testing.T) {
	env.Limpiar(t)
	e := nuevoEscenario(t, "5492610000001", "")
	repo := repository.NewCobroRepository(env.DB)
	comp := e.compromisoCompletado(t, "10000", nil)

	e.cobrar(t, repo, comp, "efectivo", "10000", false)

	segundo := &model.Cobro{
		NegocioID: e.negocioID, CompromisoID: comp,
		MedioPago: model.MedioEfectivo, Monto: decimal.NewFromInt(10000),
	}
	err := repo.CrearCobro(context.Background(), segundo, nil)
	if err != repository.ErrCobroDuplicado {
		t.Fatalf("esperaba ErrCobroDuplicado, obtuvo %v", err)
	}
}

func TestCompromisoACobrarEsTenantScoped(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	a := nuevoEscenario(t, "5492610000001", "12.345.678")
	b := nuevoEscenario(t, "5492610000002", "")
	comp := a.compromisoCompletado(t, "10000", nil)

	propio, err := repo.CompromisoACobrar(context.Background(), a.negocioID, comp)
	if err != nil {
		t.Fatal(err)
	}
	if propio == nil || propio.Estado != model.EstadoCompletado || propio.Documento != "12.345.678" {
		t.Fatalf("el negocio no ve su propio compromiso: %+v", propio)
	}

	ajeno, err := repo.CompromisoACobrar(context.Background(), b.negocioID, comp)
	if err != nil {
		t.Fatal(err)
	}
	if ajeno != nil {
		t.Fatal("un negocio pudo leer el compromiso de otro")
	}
}

func TestPorCompromisoNoCruzaTenants(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	a := nuevoEscenario(t, "5492610000001", "")
	b := nuevoEscenario(t, "5492610000002", "")
	comp := a.compromisoCompletado(t, "10000", nil)
	a.cobrar(t, repo, comp, "qr", "10000", false)

	cobro, _, err := repo.PorCompromiso(context.Background(), b.negocioID, comp)
	if err != nil {
		t.Fatal(err)
	}
	if cobro != nil {
		t.Fatal("un negocio pudo leer el cobro de otro")
	}
}

// La proyección del worker es cross-tenant a propósito, pero cada fila tiene
// que traer los datos fiscales de SU negocio: mezclarlos sería facturar con el
// CUIT equivocado.
func TestComprobantesPendientesTraeLoFiscalDeCadaNegocio(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	ctx := context.Background()

	conCerts := nuevoEscenario(t, "5492610000001", "")
	conCerts.configFiscal(t, repo, true)
	inicio := time.Date(2026, 8, 20, 16, 0, 0, 0, time.UTC)
	c1 := conCerts.compromisoCompletado(t, "15000", &inicio)
	_, comp1 := conCerts.cobrar(t, repo, c1, "efectivo", "15000", true)

	// Este negocio cargó el CUIT pero todavía no los certificados: su
	// comprobante espera SIN gastar reintentos.
	sinCerts := nuevoEscenario(t, "5492610000002", "")
	sinCerts.configFiscal(t, repo, false)
	c2 := sinCerts.compromisoCompletado(t, "8000", nil)
	sinCerts.cobrar(t, repo, c2, "efectivo", "8000", true)

	pend, err := repo.ComprobantesPendientes(ctx, time.Now(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(pend) != 1 {
		t.Fatalf("esperaba sólo el del negocio con certificados, obtuvo %d", len(pend))
	}
	p := pend[0]
	if p.ComprobanteID != comp1.ID {
		t.Fatalf("trajo el comprobante equivocado: %s", p.ComprobanteID)
	}
	// EL campo que ya se rompió una vez: GORM no mapea CUIT → cuit sin el tag.
	if p.CUIT != "20123456780" {
		t.Errorf("cuit vacío o mal mapeado: %q", p.CUIT)
	}
	if p.Modo != model.ModoHomologacion || p.PuntoVenta != 3 {
		t.Errorf("datos fiscales mal: modo=%q pv=%d", p.Modo, p.PuntoVenta)
	}
	if p.CertPEMCifrado != "CERT-CIFRADO" || p.KeyPEMCifrado != "KEY-CIFRADO" {
		t.Errorf("los PEM cifrados no llegaron: %q / %q", p.CertPEMCifrado, p.KeyPEMCifrado)
	}
	if p.Telefono != "5492610000001" || p.ClienteNombre != "Ana" {
		t.Errorf("datos del cliente mal: %q %q", p.Telefono, p.ClienteNombre)
	}
	if !p.ServicioDesde.Equal(inicio) {
		t.Errorf("servicio_desde: esperaba el inicio del turno, obtuvo %v", p.ServicioDesde)
	}
	if !p.Importe.Equal(decimal.NewFromInt(15000)) {
		t.Errorf("importe: %v", p.Importe)
	}
}

// EL candado del módulo: dos tomas del mismo comprobante, una sola gana.
func TestTomarComprobanteEsCondicional(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	ctx := context.Background()

	e := nuevoEscenario(t, "5492610000001", "")
	e.configFiscal(t, repo, true)
	c := e.compromisoCompletado(t, "15000", nil)
	_, comp := e.cobrar(t, repo, c, "efectivo", "15000", true)

	ahora := time.Now()
	gano, err := repo.TomarComprobante(ctx, comp.ID, ahora, 2*time.Minute)
	if err != nil || !gano {
		t.Fatalf("la primera toma tenía que ganar: %v %v", err, gano)
	}
	gano, err = repo.TomarComprobante(ctx, comp.ID, ahora, 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if gano {
		t.Fatal("la segunda toma también ganó: se facturaría dos veces el mismo cobro")
	}

	// Y mientras el lease está vigente, el barrido tampoco lo devuelve.
	pend, _ := repo.ComprobantesPendientes(ctx, ahora, 10)
	if len(pend) != 0 {
		t.Fatalf("el lease no lo sacó del barrido: %d filas", len(pend))
	}
	// Vencido el lease, vuelve a estar disponible: un proceso que se murió a
	// mitad de camino no puede dejar el comprobante trabado para siempre.
	pend, _ = repo.ComprobantesPendientes(ctx, ahora.Add(3*time.Minute), 10)
	if len(pend) != 1 {
		t.Fatalf("vencido el lease tenía que volver al barrido: %d filas", len(pend))
	}
}

func TestSellarYReintentar(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	ctx := context.Background()

	e := nuevoEscenario(t, "5492610000001", "")
	e.configFiscal(t, repo, true)
	c := e.compromisoCompletado(t, "15000", nil)
	_, comp := e.cobrar(t, repo, c, "efectivo", "15000", true)

	prox := time.Now().Add(time.Minute)
	if err := repo.ProgramarReintento(ctx, comp.ID, 1, &prox, "ARCA no responde", model.ComprobantePendiente); err != nil {
		t.Fatal(err)
	}
	_, leido, _ := repo.PorCompromiso(ctx, e.negocioID, c)
	if leido.RetryCount != 1 || leido.LastError == nil || *leido.LastError != "ARCA no responde" {
		t.Fatalf("el reintento no quedó anotado: %+v", leido)
	}

	venc := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	rf := repository.ResultadoFactura{Numero: 123, CAE: "71234567891234", CAEVence: &venc}
	if err := repo.SellarComprobante(ctx, comp.ID, rf, time.Now()); err != nil {
		t.Fatal(err)
	}
	_, sellado, _ := repo.PorCompromiso(ctx, e.negocioID, c)
	if sellado.Estado != model.ComprobanteEmitido || *sellado.CAE != "71234567891234" || *sellado.Numero != 123 {
		t.Fatalf("no quedó sellado: %+v", sellado)
	}
	if sellado.NextRetryAt != nil || sellado.LastError != nil {
		t.Error("un comprobante emitido no puede quedar agendado ni con el error viejo")
	}

	// Sellar de nuevo no puede pisar el CAE bueno.
	otro := repository.ResultadoFactura{Numero: 999, CAE: "OTRO-CAE"}
	if err := repo.SellarComprobante(ctx, comp.ID, otro, time.Now()); err != nil {
		t.Fatal(err)
	}
	_, otraVez, _ := repo.PorCompromiso(ctx, e.negocioID, c)
	if *otraVez.CAE != "71234567891234" {
		t.Fatalf("se pisó el CAE emitido: %q", *otraVez.CAE)
	}
}

// El cierre corre sobre el rango que le pasa el service, ya resuelto en la
// timezone del negocio, y no puede sumar plata de otro tenant.
func TestCierreAgregaYNoCruzaTenants(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	ctx := context.Background()

	a := nuevoEscenario(t, "5492610000001", "")
	a.configFiscal(t, repo, true)
	c1 := a.compromisoCompletado(t, "10000", nil)
	c2 := a.compromisoCompletado(t, "15000", nil)
	a.cobrar(t, repo, c1, "efectivo", "10000", false)
	_, comp := a.cobrar(t, repo, c2, "qr", "15000", true)
	if err := repo.SellarComprobante(ctx, comp.ID, repository.ResultadoFactura{Numero: 1, CAE: "X"}, time.Now()); err != nil {
		t.Fatal(err)
	}

	b := nuevoEscenario(t, "5492610000002", "")
	cb := b.compromisoCompletado(t, "99999", nil)
	b.cobrar(t, repo, cb, "efectivo", "99999", false)

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	hoy := time.Now().In(loc)
	desde := time.Date(hoy.Year(), hoy.Month(), hoy.Day(), 0, 0, 0, 0, loc)

	r, err := repo.Cierre(ctx, a.negocioID, desde, desde.AddDate(0, 0, 1))
	if err != nil {
		t.Fatal(err)
	}
	if r.Cobros != 2 || !r.TotalCobrado.Equal(decimal.NewFromInt(25000)) {
		t.Fatalf("agregó mal (o se coló plata del otro negocio): %+v", r)
	}
	if !r.PorMedioPago["efectivo"].Equal(decimal.NewFromInt(10000)) || !r.PorMedioPago["qr"].Equal(decimal.NewFromInt(15000)) {
		t.Fatalf("por medio de pago: %+v", r.PorMedioPago)
	}
	if r.Compromisos != 2 || r.Completados != 2 || r.PorOrigen["whatsapp"] != 2 {
		t.Fatalf("compromisos del día: %+v", r)
	}
	if r.Emitidos != 1 || r.Pendientes != 0 {
		t.Fatalf("comprobantes: emitidos=%d pendientes=%d", r.Emitidos, r.Pendientes)
	}

	// Un día sin actividad no rompe: devuelve todo en cero.
	vacio, err := repo.Cierre(ctx, a.negocioID, desde.AddDate(0, 0, -30), desde.AddDate(0, 0, -29))
	if err != nil {
		t.Fatal(err)
	}
	if vacio.Cobros != 0 || !vacio.TotalCobrado.Equal(decimal.Zero) {
		t.Fatalf("día vacío: %+v", vacio)
	}
}

// El PUT de configuración fiscal no puede borrar los certificados ya cargados
// sólo porque el body no los trajo.
func TestGuardarConfigFiscalNoPisaLosCertificados(t *testing.T) {
	env.Limpiar(t)
	repo := repository.NewCobroRepository(env.DB)
	ctx := context.Background()
	e := nuevoEscenario(t, "5492610000001", "")

	e.configFiscal(t, repo, true)

	sinCerts := &model.ConfigFiscal{
		NegocioID: e.negocioID, CUIT: "20123456780", Condicion: "monotributo",
		PuntoVenta: 7, Modo: model.ModoProduccion, ActualizadoEn: time.Now(),
	}
	if err := repo.GuardarConfigFiscal(ctx, sinCerts); err != nil {
		t.Fatal(err)
	}

	cf, err := repo.ConfigFiscal(ctx, e.negocioID)
	if err != nil {
		t.Fatal(err)
	}
	if !cf.TieneCertificados() {
		t.Fatal("un PUT sin certificados borró los que ya estaban cargados")
	}
	if cf.PuntoVenta != 7 || cf.Modo != model.ModoProduccion {
		t.Fatalf("el resto de los campos no se actualizó: %+v", cf)
	}
}
