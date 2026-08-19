package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// RecursoRepository es tenant-scoped: todo método recibe negocioID y filtra por
// negocio_id en la query. El negocioID sale del JWT, nunca del request.
type RecursoRepository interface {
	Create(ctx context.Context, negocioID string, r *model.Recurso) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Recurso, error)
	List(ctx context.Context, negocioID string, incluirInactivos bool) ([]model.Recurso, error)
	Update(ctx context.Context, negocioID string, r *model.Recurso) error
	Desactivar(ctx context.Context, negocioID, id string) error
}

type recursoRepository struct{ db *gorm.DB }

func NewRecursoRepository(db *gorm.DB) RecursoRepository {
	return &recursoRepository{db: db}
}

func (r *recursoRepository) Create(ctx context.Context, negocioID string, rec *model.Recurso) error {
	rec.NegocioID = negocioID // el tenant lo pone el repositorio, no el caller
	return r.db.WithContext(ctx).Create(rec).Error
}

func (r *recursoRepository) GetByID(ctx context.Context, negocioID, id string) (*model.Recurso, error) {
	var rec model.Recurso
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *recursoRepository) List(ctx context.Context, negocioID string, incluirInactivos bool) ([]model.Recurso, error) {
	q := r.db.WithContext(ctx).Where("negocio_id = ?", negocioID)
	if !incluirInactivos {
		q = q.Where("activo = TRUE")
	}
	var list []model.Recurso
	err := q.Order("nombre asc").Find(&list).Error
	return list, err
}

func (r *recursoRepository) Update(ctx context.Context, negocioID string, rec *model.Recurso) error {
	res := r.db.WithContext(ctx).Model(&model.Recurso{}).
		Where("id = ? AND negocio_id = ?", rec.ID, negocioID).
		Select("tipo", "nombre", "capacidad", "activo").
		Updates(rec)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *recursoRepository) Desactivar(ctx context.Context, negocioID, id string) error {
	res := r.db.WithContext(ctx).Model(&model.Recurso{}).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		Update("activo", false)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
