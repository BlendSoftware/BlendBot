package service

import (
	"context"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

// ErrSinCupo y ErrCupoMenorAlConsumido se re-exportan desde el repositorio para
// que los handlers no tengan que importar repository (el resto del paquete ya
// hace lo mismo con los errores del motor).
var (
	ErrSinCupo              = repository.ErrSinCupo
	ErrCupoMenorAlConsumido = repository.ErrCupoMenorAlConsumido
)

// CupoService es la Capa 1 del control de stock: cuántas porciones de cada
// plato quedan hoy.
//
// Todo cuelga de la jornada ABIERTA. Sin caja abierta no hay día al que
// asignarle un cupo, así que las operaciones devuelven ErrSinJornadaAbierta en
// vez de inventar una jornada implícita.
type CupoService interface {
	// DelDia son los cupos de la jornada abierta.
	DelDia(ctx context.Context, negocioID string) ([]dto.CupoResponse, error)
	// Set carga o pisa el cupo de un plato en la jornada abierta.
	Set(ctx context.Context, negocioID string, in dto.SetCupoInput) (*dto.CupoResponse, error)
	// Quitar saca el cupo: el plato vuelve a ser ilimitado.
	Quitar(ctx context.Context, negocioID, servicioID string) error
}

type cupoService struct {
	cupos     repository.CupoRepository
	jornadas  repository.JornadaRepository
	servicios repository.ServicioRepository
	// recetas es la mitad "cupo sobre plato con receta" de la exclusión
	// receta ⊕ cupo. Opcional: sin la Capa 2 cableada no hay recetas contra
	// las que chocar y el cupo se comporta como antes de este cambio.
	recetas recetaExistente
}

// recetaExistente es lo único que el cupo necesita saber de la Capa 2: si este
// plato ya se controla por receta. Lo implementa repository.RecetaRepository.
//
// Con cero líneas devuelve false: una receta vacía es un plato sin receta, así
// que vaciarla es la forma de habilitar el cupo manual otra vez.
type recetaExistente interface {
	TieneReceta(ctx context.Context, negocioID, servicioID string) (bool, error)
}

// OpcionCupo configura el service sin romperle la firma al constructor, igual
// que OpcionCatalogo y OpcionGastro. Existe para no obligar a los tres o
// cuatro llamadores de NewCupoService a aprender la Capa 2.
type OpcionCupo func(*cupoService)

// ConExclusionDeReceta hace que poner cupo manual rebote si el plato ya tiene
// receta. Es la mitad de la exclusión que se valida acá; la otra
// (ConExclusionDeCupo, en RecetaService) valida el sentido inverso. Las dos
// tienen que estar cableadas: con una sola, la regla se puede violar entrando
// por el lado que quedó suelto.
func ConExclusionDeReceta(r recetaExistente) OpcionCupo {
	return func(s *cupoService) { s.recetas = r }
}

func NewCupoService(
	cupos repository.CupoRepository,
	jornadas repository.JornadaRepository,
	servicios repository.ServicioRepository,
	opts ...OpcionCupo,
) CupoService {
	s := &cupoService{cupos: cupos, jornadas: jornadas, servicios: servicios}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *cupoService) DelDia(ctx context.Context, negocioID string) ([]dto.CupoResponse, error) {
	j, err := s.jornadaAbierta(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	filas, err := s.cupos.DeJornada(ctx, negocioID, j)
	if err != nil {
		return nil, err
	}
	out := make([]dto.CupoResponse, 0, len(filas))
	for _, f := range filas {
		out = append(out, dto.CupoDesdeRepo(f))
	}
	return out, nil
}

func (s *cupoService) Set(ctx context.Context, negocioID string, in dto.SetCupoInput) (*dto.CupoResponse, error) {
	j, err := s.jornadaAbierta(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	// El servicio tiene que ser de ESTE negocio. Sin esta comprobación se
	// podría cargar cupo sobre el plato de otro restaurante pasando su uuid.
	srv, err := s.servicios.GetByID(ctx, negocioID, in.ServicioID)
	if errors.Is(err, gorm.ErrRecordNotFound) || srv == nil {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}

	// Exclusión receta ⊕ cupo, sentido "cupo sobre plato con receta" (design
	// §2). Rebota ANTES de escribir y diciendo cuál de los dos hay que sacar:
	// un plato con dos fuentes para el mismo número obliga a inventar una regla
	// de precedencia, y esa regla es una pregunta que el dueño se hace en el
	// peor momento posible.
	if s.recetas != nil {
		tiene, err := s.recetas.TieneReceta(ctx, negocioID, in.ServicioID)
		if err != nil {
			return nil, err
		}
		if tiene {
			return nil, ErrPlatoConReceta
		}
	}

	asignado := 0
	if in.Asignado != nil {
		asignado = *in.Asignado
	}
	c, err := s.cupos.Set(ctx, negocioID, j, in.ServicioID, asignado)
	if err != nil {
		return nil, err
	}
	return &dto.CupoResponse{
		ServicioID:     c.ServicioID,
		ServicioNombre: srv.Nombre,
		Asignado:       c.Asignado,
		Consumido:      c.Consumido,
		Restante:       c.Restante(),
		Agotado:        c.Agotado(),
		Disponible:     srv.Disponible,
	}, nil
}

func (s *cupoService) Quitar(ctx context.Context, negocioID, servicioID string) error {
	j, err := s.jornadaAbierta(ctx, negocioID)
	if err != nil {
		return err
	}
	return s.cupos.Quitar(ctx, negocioID, j, servicioID)
}

func (s *cupoService) jornadaAbierta(ctx context.Context, negocioID string) (string, error) {
	j, err := s.jornadas.Actual(ctx, negocioID)
	if errors.Is(err, gorm.ErrRecordNotFound) || j == nil || j.CerradaEn != nil {
		return "", ErrSinJornadaAbierta
	}
	if err != nil {
		return "", err
	}
	return j.ID, nil
}
