package repository

import (
	"context"
	"time"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// HorarioRepository maneja la disponibilidad declarada de un recurso: la
// agenda semanal (horario) y los bloqueos puntuales (excepcion). Ninguna de
// las dos tablas tiene negocio_id: el tenant se valida contra recurso.
type HorarioRepository interface {
	RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error)

	ListHorarios(ctx context.Context, negocioID, recursoID string) ([]model.Horario, error)
	CreateHorario(ctx context.Context, negocioID string, h *model.Horario) error
	DeleteHorario(ctx context.Context, negocioID, recursoID, id string) (bool, error)

	ListExcepciones(ctx context.Context, negocioID, recursoID string, desde, hasta *time.Time) ([]model.Excepcion, error)
	CreateExcepcion(ctx context.Context, negocioID string, e *model.Excepcion) error
	DeleteExcepcion(ctx context.Context, negocioID, recursoID, id string) (bool, error)
}

type horarioRepo struct{ db *gorm.DB }

func NewHorarioRepository(db *gorm.DB) HorarioRepository { return &horarioRepo{db: db} }

func (r *horarioRepo) RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error) {
	return recursoDelNegocio(ctx, r.db, negocioID, recursoID)
}

// recursosDelNegocio es la subconsulta que acota cualquier query a los recursos
// del tenant.
func (r *horarioRepo) recursosDelNegocio(negocioID string) *gorm.DB {
	return r.db.Model(&model.Recurso{}).Select("id").Where("negocio_id = ?", negocioID)
}

func (r *horarioRepo) ListHorarios(ctx context.Context, negocioID, recursoID string) ([]model.Horario, error) {
	var hs []model.Horario
	err := r.db.WithContext(ctx).
		Where("recurso_id = ?", recursoID).
		Where("recurso_id IN (?)", r.recursosDelNegocio(negocioID)).
		Order("dia_semana ASC, desde ASC").
		Find(&hs).Error
	if err != nil {
		return nil, err
	}
	return hs, nil
}

func (r *horarioRepo) CreateHorario(ctx context.Context, negocioID string, h *model.Horario) error {
	ok, err := recursoDelNegocio(ctx, r.db, negocioID, h.RecursoID)
	if err != nil {
		return err
	}
	if !ok {
		return gorm.ErrRecordNotFound
	}
	return r.db.WithContext(ctx).Create(h).Error
}

func (r *horarioRepo) DeleteHorario(ctx context.Context, negocioID, recursoID, id string) (bool, error) {
	res := r.db.WithContext(ctx).
		Where("id = ? AND recurso_id = ?", id, recursoID).
		Where("recurso_id IN (?)", r.recursosDelNegocio(negocioID)).
		Delete(&model.Horario{})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *horarioRepo) ListExcepciones(ctx context.Context, negocioID, recursoID string, desde, hasta *time.Time) ([]model.Excepcion, error) {
	q := r.db.WithContext(ctx).
		Where("recurso_id = ?", recursoID).
		Where("recurso_id IN (?)", r.recursosDelNegocio(negocioID))
	if desde != nil {
		q = q.Where("hasta > ?", *desde)
	}
	if hasta != nil {
		q = q.Where("desde < ?", *hasta)
	}
	var es []model.Excepcion
	if err := q.Order("desde ASC").Find(&es).Error; err != nil {
		return nil, err
	}
	return es, nil
}

func (r *horarioRepo) CreateExcepcion(ctx context.Context, negocioID string, e *model.Excepcion) error {
	ok, err := recursoDelNegocio(ctx, r.db, negocioID, e.RecursoID)
	if err != nil {
		return err
	}
	if !ok {
		return gorm.ErrRecordNotFound
	}
	return r.db.WithContext(ctx).Create(e).Error
}

func (r *horarioRepo) DeleteExcepcion(ctx context.Context, negocioID, recursoID, id string) (bool, error) {
	res := r.db.WithContext(ctx).
		Where("id = ? AND recurso_id = ?", id, recursoID).
		Where("recurso_id IN (?)", r.recursosDelNegocio(negocioID)).
		Delete(&model.Excepcion{})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}
