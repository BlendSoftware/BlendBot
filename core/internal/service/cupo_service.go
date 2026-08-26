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
}

func NewCupoService(
	cupos repository.CupoRepository,
	jornadas repository.JornadaRepository,
	servicios repository.ServicioRepository,
) CupoService {
	return &cupoService{cupos: cupos, jornadas: jornadas, servicios: servicios}
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
