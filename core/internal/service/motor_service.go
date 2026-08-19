package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// OpcionesTransicion son los datos opcionales que puede traer un cambio de
// estado: la demora que puso el local y el recurso que finalmente se asignó.
type OpcionesTransicion struct {
	DemoraMin *int
	RecursoID *string
}

// MotorService es el corazón del producto: crea compromisos con precio
// congelado y hace cumplir la máquina de estados. Un pedido, una reserva y un
// turno pasan todos por acá.
type MotorService interface {
	Crear(ctx context.Context, negocioID string, in dto.CrearCompromisoInput) (*dto.CompromisoResponse, error)
	Obtener(ctx context.Context, negocioID, id string) (*dto.CompromisoResponse, error)
	Listar(ctx context.Context, negocioID string, f dto.FiltroCompromisos) ([]dto.CompromisoResponse, error)
	Transicionar(ctx context.Context, negocioID, id string, nuevo model.EstadoCompromiso, opts OpcionesTransicion) (*dto.CompromisoResponse, error)
}

type motorService struct {
	repo        repository.CompromisoRepository
	holds       repository.HoldRepository
	notificador Notificador // opcional: nil = el motor no avisa nada
}

// OpcionMotor configura el motor sin tocarle la firma al constructor: los
// llamadores que no saben del anti-ausentismo siguen compilando igual.
type OpcionMotor func(*motorService)

// ConNotificador engancha el anti-ausentismo: cuando se cancela un turno
// futuro, alguien se entera y le ofrece el hueco a la lista de espera.
func ConNotificador(n Notificador) OpcionMotor {
	return func(s *motorService) { s.notificador = n }
}

func NewMotorService(repo repository.CompromisoRepository, holds repository.HoldRepository, opts ...OpcionMotor) MotorService {
	s := &motorService{repo: repo, holds: holds}
	for _, o := range opts {
		o(s)
	}
	return s
}

// ── Crear ─────────────────────────────────────────────────────────────────
//
//  1. el cliente tiene que ser del tenant (y de ahí sale la cobertura)
//  2. cada servicio tiene que existir, ser del tenant y estar disponible
//  3. el precio se congela: precio por cobertura si existe, si no precio_base
//  4. si viene recurso + rango, el hueco tiene que estar libre
//
// Un compromiso sin recurso ni horario es válido: entra incompleto al panel
// para que alguien lo termine (D7).
func (s *motorService) Crear(ctx context.Context, negocioID string, in dto.CrearCompromisoInput) (*dto.CompromisoResponse, error) {
	if len(in.Lineas) == 0 {
		return nil, fmt.Errorf("un compromiso necesita al menos una linea")
	}
	if (in.Inicio == nil) != (in.Fin == nil) {
		return nil, fmt.Errorf("inicio y fin van juntos o no van")
	}
	if in.Inicio != nil && !in.Fin.After(*in.Inicio) {
		return nil, fmt.Errorf("fin tiene que ser posterior a inicio")
	}

	coberturaID, ok, err := s.repo.CoberturaDeCliente(ctx, negocioID, in.ClienteID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoEncontrado
	}

	if in.RecursoID != nil {
		activo, err := s.repo.RecursoActivo(ctx, negocioID, *in.RecursoID)
		if err != nil {
			return nil, err
		}
		if !activo {
			return nil, ErrNoEncontrado
		}
	}

	servicioIDs := make([]string, 0, len(in.Lineas))
	for _, l := range in.Lineas {
		servicioIDs = append(servicioIDs, l.ServicioID)
	}

	servicios, err := s.repo.ServiciosDisponibles(ctx, negocioID, servicioIDs)
	if err != nil {
		return nil, err
	}
	for _, l := range in.Lineas {
		if _, existe := servicios[l.ServicioID]; !existe {
			return nil, fmt.Errorf("%w: %s", ErrNoDisponible, l.ServicioID)
		}
	}

	precios := map[string]decimal.Decimal{}
	if coberturaID != nil && *coberturaID != "" {
		precios, err = s.repo.PreciosPorCobertura(ctx, negocioID, *coberturaID, servicioIDs)
		if err != nil {
			return nil, err
		}
	}

	lineas := make([]model.LineaCompromiso, 0, len(in.Lineas))
	total := decimal.Zero
	for _, l := range in.Lineas {
		precio := servicios[l.ServicioID].PrecioBase
		if p, hay := precios[l.ServicioID]; hay {
			precio = p
		}
		total = total.Add(precio.Mul(decimal.NewFromInt(int64(l.Cantidad))))
		lineas = append(lineas, model.LineaCompromiso{
			ServicioID: l.ServicioID,
			Cantidad:   l.Cantidad,
			PrecioUnit: precio,
			Nota:       l.Nota,
		})
	}

	if in.RecursoID != nil && in.Inicio != nil {
		sesion := ""
		if in.Sesion != nil {
			sesion = *in.Sesion
		}
		if err := s.verificarHueco(ctx, negocioID, *in.RecursoID, *in.Inicio, *in.Fin, sesion); err != nil {
			return nil, err
		}
	}

	c := &model.Compromiso{
		NegocioID: negocioID,
		ClienteID: in.ClienteID,
		RecursoID: in.RecursoID,
		Tipo:      in.Tipo,
		Estado:    model.EstadoPendiente,
		Inicio:    in.Inicio,
		Fin:       in.Fin,
		Entrega:   in.Entrega,
		Direccion: in.Direccion,
		Total:     total,
		Origen:    in.Origen,
		Nota:      in.Nota,
		Lineas:    lineas,
	}
	if err := s.repo.Create(ctx, c); err != nil {
		return nil, err
	}
	return dto.CompromisoDesdeModel(c), nil
}

func (s *motorService) Obtener(ctx context.Context, negocioID, id string) (*dto.CompromisoResponse, error) {
	c, err := s.repo.GetByID(ctx, negocioID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}
	return dto.CompromisoDesdeModel(c), nil
}

func (s *motorService) Listar(ctx context.Context, negocioID string, f dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	cs, err := s.repo.ListTablero(ctx, negocioID, f.Estados, f.Desde, f.Hasta)
	if err != nil {
		return nil, err
	}
	return dto.CompromisosDesdeModelos(cs), nil
}

// ── Transicionar ──────────────────────────────────────────────────────────
//
// La máquina de estados vive en model.EstadoCompromiso; acá se agregan las
// reglas de negocio (ausente sólo en turnos), los timestamps y el update
// condicional que evita pisar una transición concurrente.
func (s *motorService) Transicionar(ctx context.Context, negocioID, id string, nuevo model.EstadoCompromiso, opts OpcionesTransicion) (*dto.CompromisoResponse, error) {
	c, err := s.repo.GetByID(ctx, negocioID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}

	if !c.Estado.PuedeTransicionarA(nuevo) {
		return nil, fmt.Errorf("%w: %s → %s", ErrTransicionInvalida, c.Estado, nuevo)
	}
	// AUSENTE es del vertical salud: un pedido o una reserva no se marcan
	// ausentes, se cancelan.
	if nuevo == model.EstadoAusente && c.Tipo != model.CompromisoTurno {
		return nil, fmt.Errorf("%w: ausente solo aplica a turnos", ErrTransicionInvalida)
	}

	ahora := time.Now()
	cambio := repository.CambioEstado{
		Nuevo:     nuevo,
		DemoraMin: opts.DemoraMin,
	}
	if opts.RecursoID != nil {
		activo, err := s.repo.RecursoActivo(ctx, negocioID, *opts.RecursoID)
		if err != nil {
			return nil, err
		}
		if !activo {
			return nil, ErrNoEncontrado
		}
		cambio.RecursoID = opts.RecursoID
	}
	if nuevo == model.EstadoConfirmado && c.ConfirmadoEn == nil {
		cambio.ConfirmadoEn = &ahora
	}
	if nuevo.EsTerminal() {
		cambio.CerradoEn = &ahora
	}

	aplicado, err := s.repo.UpdateEstado(ctx, negocioID, id, c.Estado, cambio)
	if err != nil {
		return nil, err
	}
	if !aplicado {
		// La fila cambió de estado entre el GET y el UPDATE.
		return nil, fmt.Errorf("%w: el compromiso ya no esta en %s", ErrTransicionInvalida, c.Estado)
	}

	if nuevo == model.EstadoCancelado {
		s.avisarHuecoLiberado(ctx, c, ahora)
	}

	return s.Obtener(ctx, negocioID, id)
}

// avisarHuecoLiberado dispara el hook del anti-ausentismo. Sólo un TURNO con
// hora futura libera algo que se le pueda ofrecer a otro; y el aviso jamás
// puede voltear la transición, que ya está confirmada en la base: un error del
// notificador se loguea y se sigue.
func (s *motorService) avisarHuecoLiberado(ctx context.Context, c *model.Compromiso, ahora time.Time) {
	if s.notificador == nil {
		return
	}
	if c.Tipo != model.CompromisoTurno || c.Inicio == nil || !c.Inicio.After(ahora) {
		return
	}
	if len(c.Lineas) == 0 {
		return
	}

	err := s.notificador.TurnoCancelado(ctx, TurnoCancelado{
		NegocioID:    c.NegocioID,
		CompromisoID: c.ID,
		ClienteID:    c.ClienteID,
		ServicioID:   c.Lineas[0].ServicioID,
		Inicio:       *c.Inicio,
		Fin:          c.Fin,
	})
	if err != nil {
		log.Error().Err(err).Str("compromiso_id", c.ID).
			Msg("motor: no se pudo ofrecer el hueco liberado")
	}
}

// verificarHueco falla si el rango pisa un compromiso activo o un hold vigente
// del recurso. El hold de la propia sesión no cuenta: es el que tomó este
// mismo cliente mientras completaba sus datos.
func (s *motorService) verificarHueco(ctx context.Context, negocioID, recursoID string, inicio, fin time.Time, sesion string) error {
	ocupados, err := s.repo.ListPorRecurso(ctx, negocioID, recursoID, inicio, fin)
	if err != nil {
		return err
	}
	if len(ocupados) > 0 {
		return ErrSolapado
	}

	ahora := time.Now()
	if _, err := s.holds.DeleteExpirados(ctx, ahora); err != nil {
		return err
	}
	vigentes, err := s.holds.ListVigentes(ctx, recursoID, inicio, fin, ahora)
	if err != nil {
		return err
	}
	for _, h := range vigentes {
		if sesion != "" && h.Sesion == sesion {
			continue
		}
		return ErrSolapado
	}
	return nil
}
