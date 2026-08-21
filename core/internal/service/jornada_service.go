package service

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// Errores de la caja del día (E11 / W7-A). El handler los mapea a HTTP:
//
//	ErrJornadaYaAbierta  → 409 (ya hay una caja abierta)
//	ErrSinJornadaAbierta → 409 (no hay caja abierta para cerrar)
var (
	// ErrJornadaYaAbierta: el negocio ya abrió la caja. Lo arbitra el índice
	// único de la base, así que dos clicks en "Abrir día" no abren dos.
	ErrJornadaYaAbierta = errors.New("el negocio ya tiene una jornada abierta")

	// ErrSinJornadaAbierta: cerrar sin nada abierto no es un error del servidor,
	// es un click contra un estado que ya cambió.
	ErrSinJornadaAbierta = errors.New("no hay ninguna jornada abierta para cerrar")
)

// JornadaService es el ciclo de la caja: abrir el día, ver cuál está abierta,
// cerrarlo. Los números del día no viven acá: los da el cierre del día.
type JornadaService interface {
	Actual(ctx context.Context, negocioID string) (*dto.JornadaActualResponse, error)
	Abrir(ctx context.Context, negocioID string, usuarioID *string) (*dto.JornadaResponse, error)
	Cerrar(ctx context.Context, negocioID string, usuarioID *string) (*dto.JornadaResponse, error)
}

type jornadaService struct {
	repo repository.JornadaRepository
}

func NewJornadaService(repo repository.JornadaRepository) JornadaService {
	return &jornadaService{repo: repo}
}

func (s *jornadaService) Actual(ctx context.Context, negocioID string) (*dto.JornadaActualResponse, error) {
	j, err := s.repo.Actual(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	return &dto.JornadaActualResponse{
		Abierta: j != nil,
		Jornada: dto.JornadaDesdeModel(j),
	}, nil
}

func (s *jornadaService) Abrir(ctx context.Context, negocioID string, usuarioID *string) (*dto.JornadaResponse, error) {
	j := &model.Jornada{
		NegocioID:  negocioID,
		AbiertaEn:  time.Now(),
		AbiertaPor: usuarioID,
	}
	if err := s.repo.Abrir(ctx, j); err != nil {
		if errors.Is(err, repository.ErrJornadaYaAbierta) {
			return nil, ErrJornadaYaAbierta
		}
		return nil, err
	}
	return dto.JornadaDesdeModel(j), nil
}

func (s *jornadaService) Cerrar(ctx context.Context, negocioID string, usuarioID *string) (*dto.JornadaResponse, error) {
	j, err := s.repo.Cerrar(ctx, negocioID, usuarioID, time.Now())
	if err != nil {
		return nil, err
	}
	if j == nil {
		return nil, ErrSinJornadaAbierta
	}
	return dto.JornadaDesdeModel(j), nil
}
