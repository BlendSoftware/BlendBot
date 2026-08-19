package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// holdMinutosDefault es lo que dura un bloqueo si el negocio no configuró otra
// cosa (negocio.config.hold_minutos).
const holdMinutosDefault = 10

// HoldService bloquea un hueco mientras el cliente completa sus datos. Sin
// esto, dos personas sacan el mismo turno a la vez.
type HoldService interface {
	Crear(ctx context.Context, negocioID, recursoID string, inicio, fin time.Time, sesion string) (*dto.HoldResponse, error)
	Liberar(ctx context.Context, negocioID, id, sesion string) error
}

type holdService struct {
	repo         repository.HoldRepository
	compromisos  repository.CompromisoRepository
	holdMinDefec int
}

func NewHoldService(repo repository.HoldRepository, compromisos repository.CompromisoRepository) HoldService {
	return &holdService{repo: repo, compromisos: compromisos, holdMinDefec: holdMinutosDefault}
}

func (s *holdService) Crear(ctx context.Context, negocioID, recursoID string, inicio, fin time.Time, sesion string) (*dto.HoldResponse, error) {
	if !fin.After(inicio) {
		return nil, fmt.Errorf("fin tiene que ser posterior a inicio")
	}
	if sesion == "" {
		return nil, fmt.Errorf("sesion requerida")
	}

	activo, err := s.repo.RecursoActivo(ctx, negocioID, recursoID)
	if err != nil {
		return nil, err
	}
	if !activo {
		return nil, ErrNoEncontrado
	}

	ahora := time.Now()
	// Limpieza lazy: los expirados no bloquean, así que se van antes de mirar.
	if _, err := s.repo.DeleteExpirados(ctx, ahora); err != nil {
		return nil, err
	}

	vigentes, err := s.repo.ListVigentes(ctx, recursoID, inicio, fin, ahora)
	if err != nil {
		return nil, err
	}
	for _, h := range vigentes {
		if h.Sesion == sesion {
			continue // renovar el propio hold no es solapar
		}
		return nil, ErrSolapado
	}

	ocupados, err := s.compromisos.ListPorRecurso(ctx, negocioID, recursoID, inicio, fin)
	if err != nil {
		return nil, err
	}
	if len(ocupados) > 0 {
		return nil, ErrSolapado
	}

	minutos, err := s.holdMinutos(ctx, negocioID)
	if err != nil {
		return nil, err
	}

	h := &model.Hold{
		RecursoID: recursoID,
		Inicio:    inicio,
		Fin:       fin,
		ExpiraEn:  ahora.Add(time.Duration(minutos) * time.Minute),
		Sesion:    sesion,
	}
	if err := s.repo.Create(ctx, h); err != nil {
		return nil, err
	}
	return dto.HoldDesdeModel(h), nil
}

func (s *holdService) Liberar(ctx context.Context, negocioID, id, sesion string) error {
	// Limpieza lazy también acá: liberar es el momento natural para barrer.
	if _, err := s.repo.DeleteExpirados(ctx, time.Now()); err != nil {
		return err
	}
	borrado, err := s.repo.Delete(ctx, negocioID, id, sesion)
	if err != nil {
		return err
	}
	if !borrado {
		return ErrNoEncontrado
	}
	return nil
}

// holdMinutos lee negocio.config.hold_minutos. Config rota o ausente no puede
// romper una reserva: cae al default.
func (s *holdService) holdMinutos(ctx context.Context, negocioID string) (int, error) {
	raw, err := s.repo.ConfigNegocio(ctx, negocioID)
	if err != nil {
		return 0, err
	}
	if len(raw) == 0 {
		return s.holdMinDefec, nil
	}
	var cfg struct {
		HoldMinutos *int `json:"hold_minutos"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return s.holdMinDefec, nil
	}
	if cfg.HoldMinutos == nil || *cfg.HoldMinutos <= 0 {
		return s.holdMinDefec, nil
	}
	return *cfg.HoldMinutos, nil
}
