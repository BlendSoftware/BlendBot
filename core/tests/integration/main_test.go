// Package integration prueba el core contra un PostgreSQL real: mismo motor,
// mismo esquema y mismas restricciones que producción. Los tests están escritos
// contra el CONTRATO de EPICS.md (E1, workstreams A y B), no contra una
// implementación puntual.
package integration

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"
	"copiloto/core/tests/testutil"

	"github.com/shopspring/decimal"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// env es el postgres del paquete: un contenedor para todos los tests, truncado
// entre uno y otro. Levantarlo por test multiplicaría los minutos de CI por 20.
var env *testutil.Entorno

func TestMain(m *testing.M) {
	ctx := context.Background()

	e, cerrar, err := testutil.Arrancar(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "entorno de tests no disponible: %v\n", err)
		os.Exit(1)
	}
	env = e

	code := m.Run()
	cerrar()
	os.Exit(code)
}

// nuevoCaso deja la base limpia y entrega ctx + conexión. Todo test arranca acá.
func nuevoCaso(t *testing.T) (context.Context, *gorm.DB) {
	t.Helper()
	env.Limpiar(t)
	return context.Background(), env.DB
}

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Se siembran con GORM directo y no con los repositorios de A/B a propósito:
// el sujeto del test es el repositorio, y sembrar con él taparía justo el bug
// que se busca (si Create no filtra por tenant, el fixture tampoco lo haría).

func crearNegocio(t *testing.T, db *gorm.DB, nombre string, vertical model.Vertical) *model.Negocio {
	t.Helper()
	n := &model.Negocio{
		Nombre:   nombre,
		Vertical: vertical,
		Timezone: "America/Argentina/Mendoza",
		Config:   datatypes.JSON([]byte(`{"hold_minutos":10}`)),
		Activo:   true,
	}
	if err := db.Create(n).Error; err != nil {
		t.Fatalf("crear negocio %q: %v", nombre, err)
	}
	return n
}

// setTimezone mueve un negocio de huso. Sirve para probar que el día
// calendario se resuelve con la zona del local y no con la del proceso.
func setTimezone(t *testing.T, db *gorm.DB, negocioID, tz string) {
	t.Helper()
	if err := db.Model(&model.Negocio{}).Where("id = ?", negocioID).
		Update("timezone", tz).Error; err != nil {
		t.Fatalf("setTimezone %s: %v", tz, err)
	}
}

func crearRecurso(t *testing.T, db *gorm.DB, negocioID, nombre string, tipo model.TipoRecurso) *model.Recurso {
	t.Helper()
	r := &model.Recurso{
		NegocioID: negocioID,
		Tipo:      tipo,
		Nombre:    nombre,
		Capacidad: 1,
		Activo:    true,
	}
	if err := db.Create(r).Error; err != nil {
		t.Fatalf("crear recurso %q: %v", nombre, err)
	}
	return r
}

func crearCategoria(t *testing.T, db *gorm.DB, negocioID, nombre string) *model.Categoria {
	t.Helper()
	c := &model.Categoria{NegocioID: negocioID, Nombre: nombre, Activo: true}
	if err := db.Create(c).Error; err != nil {
		t.Fatalf("crear categoría %q: %v", nombre, err)
	}
	return c
}

func crearCobertura(t *testing.T, db *gorm.DB, negocioID, nombre string) *model.Cobertura {
	t.Helper()
	c := &model.Cobertura{NegocioID: negocioID, Nombre: nombre}
	if err := db.Create(c).Error; err != nil {
		t.Fatalf("crear cobertura %q: %v", nombre, err)
	}
	return c
}

func crearCliente(t *testing.T, db *gorm.DB, negocioID, telefono, nombre string, coberturaID *string) *model.Cliente {
	t.Helper()
	c := &model.Cliente{
		NegocioID:   negocioID,
		Telefono:    telefono,
		Nombre:      &nombre,
		CoberturaID: coberturaID,
	}
	if err := db.Create(c).Error; err != nil {
		t.Fatalf("crear cliente %q: %v", telefono, err)
	}
	return c
}

func crearServicio(t *testing.T, db *gorm.DB, negocioID, nombre, precioBase string) *model.Servicio {
	t.Helper()
	dur := 30
	s := &model.Servicio{
		NegocioID:   negocioID,
		Nombre:      nombre,
		DuracionMin: &dur,
		PrecioBase:  decimal.RequireFromString(precioBase),
		Disponible:  true,
		Activo:      true,
	}
	if err := db.Create(s).Error; err != nil {
		t.Fatalf("crear servicio %q: %v", nombre, err)
	}
	return s
}

// setDisponible apaga o prende el interruptor por UPDATE y no por Create.
// GORM omite del INSERT los campos en su valor cero cuando la columna tiene
// `default:true`, así que un Servicio{Disponible: false} recién creado entraría
// a la base en TRUE: el fixture mentiría y el test del interruptor pasaría solo.
func setDisponible(t *testing.T, db *gorm.DB, servicioID string, disponible bool) {
	t.Helper()
	err := db.Model(&model.Servicio{}).
		Where("id = ?", servicioID).
		Update("disponible", disponible).Error
	if err != nil {
		t.Fatalf("set disponible=%v en %s: %v", disponible, servicioID, err)
	}
}

func setPrecioBase(t *testing.T, db *gorm.DB, servicioID, precio string) {
	t.Helper()
	err := db.Model(&model.Servicio{}).
		Where("id = ?", servicioID).
		Update("precio_base", decimal.RequireFromString(precio)).Error
	if err != nil {
		t.Fatalf("set precio_base=%s en %s: %v", precio, servicioID, err)
	}
}

func crearPrecioCobertura(t *testing.T, db *gorm.DB, servicioID, coberturaID, precio string) {
	t.Helper()
	p := &model.PrecioCobertura{
		ServicioID:  servicioID,
		CoberturaID: coberturaID,
		Precio:      decimal.RequireFromString(precio),
	}
	if err := db.Create(p).Error; err != nil {
		t.Fatalf("crear precio_cobertura: %v", err)
	}
}

func crearHold(t *testing.T, db *gorm.DB, recursoID string, inicio, fin, expira time.Time, sesion string) *model.Hold {
	t.Helper()
	h := &model.Hold{
		RecursoID: recursoID,
		Inicio:    inicio,
		Fin:       fin,
		ExpiraEn:  expira,
		Sesion:    sesion,
	}
	if err := db.Create(h).Error; err != nil {
		t.Fatalf("crear hold: %v", err)
	}
	return h
}

func crearCompromisoDirecto(t *testing.T, db *gorm.DB, neg, cliente, servicio string, recurso *string, inicio, fin *time.Time, tipo model.TipoCompromiso, estado model.EstadoCompromiso, precio string) *model.Compromiso {
	t.Helper()
	c := &model.Compromiso{
		NegocioID: neg,
		ClienteID: cliente,
		RecursoID: recurso,
		Tipo:      tipo,
		Estado:    estado,
		Inicio:    inicio,
		Fin:       fin,
		Total:     decimal.RequireFromString(precio),
		Origen:    model.OrigenPanel,
	}
	if err := db.Omit("Lineas").Create(c).Error; err != nil {
		t.Fatalf("crear compromiso: %v", err)
	}
	l := &model.LineaCompromiso{
		CompromisoID: c.ID,
		ServicioID:   servicio,
		Cantidad:     1,
		PrecioUnit:   decimal.RequireFromString(precio),
	}
	if err := db.Create(l).Error; err != nil {
		t.Fatalf("crear línea: %v", err)
	}
	c.Lineas = []model.LineaCompromiso{*l}
	return c
}

// ── Escenario armado ────────────────────────────────────────────────────────

// escenario es un negocio con todo lo mínimo para ejercitar el motor, más los
// repos y services cableados contra la misma conexión.
type escenario struct {
	db          *gorm.DB
	negocio     *model.Negocio
	cliente     *model.Cliente
	recurso     *model.Recurso
	servicio    *model.Servicio
	motor       service.MotorService
	holds       service.HoldService
	compromisos repository.CompromisoRepository
	holdRepo    repository.HoldRepository
	servicios   repository.ServicioRepository
	clientes    repository.ClienteRepository
}

func montar(t *testing.T, vertical model.Vertical) (context.Context, *escenario) {
	t.Helper()
	ctx, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "Consultorio Gómez", vertical)
	cli := crearCliente(t, db, neg.ID, "5492611000001", "Juana Pérez", nil)
	rec := crearRecurso(t, db, neg.ID, "Dra. Gómez", model.RecursoProfesional)
	srv := crearServicio(t, db, neg.ID, "Consulta", "1000.00")

	compromisos := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)

	return ctx, &escenario{
		db:          db,
		negocio:     neg,
		cliente:     cli,
		recurso:     rec,
		servicio:    srv,
		motor:       service.NewMotorService(compromisos, holdRepo),
		holds:       service.NewHoldService(holdRepo, compromisos),
		compromisos: compromisos,
		holdRepo:    holdRepo,
		servicios:   repository.NewServicioRepository(db),
		clientes:    repository.NewClienteRepository(db),
	}
}

// crearInput arma el input mínimo de un compromiso: una línea, sin recurso ni
// horario. Válido a propósito (D7: el compromiso incompleto entra al panel).
func (e *escenario) crearInput(tipo model.TipoCompromiso, cantidad int) dto.CrearCompromisoInput {
	return dto.CrearCompromisoInput{
		ClienteID: e.cliente.ID,
		Tipo:      tipo,
		Origen:    model.OrigenWhatsApp,
		Lineas: []dto.LineaCompromisoInput{
			{ServicioID: e.servicio.ID, Cantidad: cantidad},
		},
	}
}

// ── Helpers de aserción ─────────────────────────────────────────────────────

func ptr[T any](v T) *T { return &v }

// igualDecimal compara plata por valor y no por representación: 1500 y 1500.00
// son el mismo precio, y NUMERIC(12,2) devuelve siempre la segunda forma.
func igualDecimal(t *testing.T, obtenido decimal.Decimal, esperado string, contexto string) {
	t.Helper()
	esp := decimal.RequireFromString(esperado)
	if !obtenido.Equal(esp) {
		t.Errorf("%s: precio esperado %s, obtenido %s", contexto, esp, obtenido)
	}
}
