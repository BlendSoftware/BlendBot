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

	minutos, err := s.holdMinutos(ctx, negocioID)
	if err != nil {
		return nil, err
	}

	ahora := time.Now()
	h := &model.Hold{
		RecursoID: recursoID,
		Inicio:    inicio,
		Fin:       fin,
		ExpiraEn:  ahora.Add(time.Duration(minutos) * time.Minute),
		Sesion:    sesion,
	}

	// Verificación e inserción bajo un lock del recurso: dos holds simultáneos
	// sobre la misma franja se serializan y el segundo ve el del primero (H3).
	err = s.compromisos.ReservarConLock(ctx, recursoID, func(comps repository.CompromisoRepository, holds repository.HoldRepository) error {
		// Limpieza lazy: los expirados no bloquean, así que se van antes de mirar.
		if _, err := holds.DeleteExpirados(ctx, ahora); err != nil {
			return err
		}

		vigentes, err := holds.ListVigentes(ctx, recursoID, inicio, fin, ahora)
		if err != nil {
			return err
		}
		for _, hv := range vigentes {
			if hv.Sesion == sesion {
				continue // renovar el propio hold no es solapar
			}
			return ErrSolapado
		}

		ocupados, err := comps.ListPorRecurso(ctx, negocioID, recursoID, inicio, fin)
		if err != nil {
			return err
		}
		if len(ocupados) > 0 {
			return ErrSolapado
		}

		return holds.Create(ctx, h)
	})
	if err != nil {
		return nil, err
	}
	return dto.HoldDesdeModel(ctx, h), nil
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
