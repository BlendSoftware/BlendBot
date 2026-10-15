package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/shopspring/decimal"
)

// ── Fakes ────────────────────────────────────────────────────────────────
//
// motorService.Crear, en el camino SIN recurso ni horario (que es el que
// ejercitan estos tests), sólo necesita CoberturaDeCliente, ServiciosDisponibles
// y Create de CompromisoRepository. El resto de la interfaz se implementa
// devolviendo un error reconocible: si algún día el código empieza a
// necesitarlos, el test falla con un mensaje claro en vez de datos falsos
// silenciosos.
type fakeCompromisoRepo struct {
	servicios map[string]model.Servicio
	creados   []*model.Compromiso
}

func (f *fakeCompromisoRepo) Create(ctx context.Context, c *model.Compromiso) error {
	f.creados = append(f.creados, c)
	return nil
}

func (f *fakeCompromisoRepo) GetByID(ctx context.Context, negocioID, id string) (*model.Compromiso, error) {
	return nil, errors.New("fakeCompromisoRepo: GetByID no usado en este test")
}

func (f *fakeCompromisoRepo) ListTablero(ctx context.Context, negocioID string, estados []model.EstadoCompromiso, desde, hasta *time.Time) ([]model.Compromiso, error) {
	return nil, errors.New("fakeCompromisoRepo: ListTablero no usado en este test")
}

func (f *fakeCompromisoRepo) UpdateEstado(ctx context.Context, negocioID, id string, actual model.EstadoCompromiso, cambio repository.CambioEstado) (bool, error) {
	return false, errors.New("fakeCompromisoRepo: UpdateEstado no usado en este test")
}

func (f *fakeCompromisoRepo) ListPorRecurso(ctx context.Context, negocioID, recursoID string, desde, hasta time.Time) ([]model.Compromiso, error) {
	return nil, errors.New("fakeCompromisoRepo: ListPorRecurso no usado en este test")
}

func (f *fakeCompromisoRepo) ServiciosDisponibles(ctx context.Context, negocioID string, servicioIDs []string) (map[string]model.Servicio, error) {
	return f.servicios, nil
}

func (f *fakeCompromisoRepo) CoberturaDeCliente(ctx context.Context, negocioID, clienteID string) (*string, bool, error) {
	return nil, true, nil
}

func (f *fakeCompromisoRepo) PreciosPorCobertura(ctx context.Context, negocioID, coberturaID string, servicioIDs []string) (map[string]decimal.Decimal, error) {
	return nil, errors.New("fakeCompromisoRepo: PreciosPorCobertura no usado en este test")
}

func (f *fakeCompromisoRepo) RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error) {
	return false, errors.New("fakeCompromisoRepo: RecursoActivo no usado en este test")
}

func (f *fakeCompromisoRepo) ReservarConLock(ctx context.Context, recursoID string, fn func(repository.CompromisoRepository, repository.HoldRepository) error) error {
	return errors.New("fakeCompromisoRepo: ReservarConLock no usado en este test")
}

// fakeJornadaRepo simula la caja del día sin tocar la base: `actual` es lo que
// devuelve Actual (nil = sin jornada abierta).
type fakeJornadaRepo struct{ actual *model.Jornada }

func (f *fakeJornadaRepo) Actual(ctx context.Context, negocioID string) (*model.Jornada, error) {
	return f.actual, nil
}
func (f *fakeJornadaRepo) Abrir(ctx context.Context, j *model.Jornada) error { return nil }
func (f *fakeJornadaRepo) Cerrar(ctx context.Context, negocioID string, usuarioID *string, ahora time.Time) (*model.Jornada, error) {
	return nil, nil
}

// servicioFake es un catálogo de un solo plato, el mínimo para que Crear
// congele un precio y arme la línea.
func servicioFake(id string) map[string]model.Servicio {
	return map[string]model.Servicio{
		id: {ID: id, PrecioBase: decimal.NewFromInt(1000), Disponible: true, Activo: true},
	}
}

func inputPedidoWhatsApp(servicioID string, cantidad int) dto.CrearCompromisoInput {
	return dto.CrearCompromisoInput{
		ClienteID: "cliente-1",
		Tipo:      model.CompromisoPedido,
		Origen:    model.OrigenWhatsApp,
		Lineas:    []dto.LineaCompromisoInput{{ServicioID: servicioID, Cantidad: cantidad}},
	}
}

// ── Pieza A: gate de jornada cerrada ───────────────────────────────────────

// TestCrearPedidoWhatsAppSinJornadaAbierta: el bug de producción era exactamente
// esto, un pedido de WhatsApp coló sin que la caja estuviera abierta. Con el
// control cableado, debe rechazarse con el sentinel nuevo y NO crear nada.
func TestCrearPedidoWhatsAppSinJornadaAbierta(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}
	jornadas := &fakeJornadaRepo{actual: nil} // sin jornada abierta

	motor := NewMotorService(repo, nil, ConControlDeJornada(jornadas))

	_, err := motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, 1))
	if !errors.Is(err, ErrPedidoRequiereJornadaAbierta) {
		t.Fatalf("esperaba ErrPedidoRequiereJornadaAbierta, obtuve: %v", err)
	}
	if len(repo.creados) != 0 {
		t.Fatalf("no tenía que crearse ningún compromiso, se crearon %d", len(repo.creados))
	}
}

// TestCrearPedidoWhatsAppConJornadaAbierta: con la caja abierta, el mismo
// pedido entra normalmente.
func TestCrearPedidoWhatsAppConJornadaAbierta(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}
	jornadas := &fakeJornadaRepo{actual: &model.Jornada{ID: "jor-1", CerradaEn: nil}}

	motor := NewMotorService(repo, nil, ConControlDeJornada(jornadas))

	resp, err := motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, 1))
	if err != nil {
		t.Fatalf("Crear: %v", err)
	}
	if resp == nil {
		t.Fatal("esperaba una respuesta, vino nil")
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}

// TestCrearPedidoPanelSinJornadaAbierta: el aislamiento por ORIGEN. Un pedido
// cargado desde el panel (origen=panel) no pasó nunca por el mostrador de
// WhatsApp sin caja — el panel lo está viendo en el momento — así que el gate
// no lo toca aunque no haya jornada abierta.
func TestCrearPedidoPanelSinJornadaAbierta(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}
	jornadas := &fakeJornadaRepo{actual: nil}

	motor := NewMotorService(repo, nil, ConControlDeJornada(jornadas))

	in := inputPedidoWhatsApp(servicioID, 1)
	in.Origen = model.OrigenPanel

	_, err := motor.Crear(context.Background(), "neg-1", in)
	if err != nil {
		t.Fatalf("un pedido de panel no debería bloquearse por la jornada: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}

// TestCrearTurnoWhatsAppSinJornadaAbierta: el aislamiento por TIPO. Un turno
// (vertical salud) no depende de la caja del día de un local gastronómico: el
// gate es específico de pedido, no se filtra a reserva/turno.
func TestCrearTurnoWhatsAppSinJornadaAbierta(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}
	jornadas := &fakeJornadaRepo{actual: nil}

	motor := NewMotorService(repo, nil, ConControlDeJornada(jornadas))

	in := inputPedidoWhatsApp(servicioID, 1)
	in.Tipo = model.CompromisoTurno

	_, err := motor.Crear(context.Background(), "neg-1", in)
	if err != nil {
		t.Fatalf("un turno no debería bloquearse por la jornada: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}

// TestCrearPedidoWhatsAppSinControlDeJornadaCableado: si nadie cableó la opción
// (JornadaRepository nil), el comportamiento de hoy queda intacto: no se
// pregunta nada y el pedido entra. Esto es lo que evita romper un wiring de
// test que todavía no setea la opción.
func TestCrearPedidoWhatsAppSinControlDeJornadaCableado(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}

	motor := NewMotorService(repo, nil) // sin ConControlDeJornada

	_, err := motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, 1))
	if err != nil {
		t.Fatalf("sin la opción cableada no debería haber gate de jornada: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}
