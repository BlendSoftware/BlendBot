package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// HoldRepository maneja los bloqueos temporales. El hold cuelga de recurso, así
// que el aislamiento de tenant se resuelve por join contra recurso.negocio_id.
type HoldRepository interface {
	Create(ctx context.Context, h *model.Hold) error
	// Delete borra el hold del tenant. Con sesion vacía no filtra por sesión
	// (el panel puede liberar cualquiera); devuelve false si no había nada.
	Delete(ctx context.Context, negocioID, id, sesion string) (bool, error)
	// ListVigentes son los holds no expirados que pisan el rango pedido.
	ListVigentes(ctx context.Context, recursoID string, desde, hasta, ahora time.Time) ([]model.Hold, error)
	DeleteExpirados(ctx context.Context, ahora time.Time) (int64, error)
	RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error)
	// ConfigNegocio devuelve negocio.config crudo; el service lee hold_minutos.
	ConfigNegocio(ctx context.Context, negocioID string) ([]byte, error)
}

type holdRepo struct{ db *gorm.DB }

func NewHoldRepository(db *gorm.DB) HoldRepository { return &holdRepo{db: db} }

func (r *holdRepo) Create(ctx context.Context, h *model.Hold) error {
	return r.db.WithContext(ctx).Create(h).Error
}

func (r *holdRepo) Delete(ctx context.Context, negocioID, id, sesion string) (bool, error) {
	q := r.db.WithContext(ctx).
		Where("id = ?", id).
		Where("recurso_id IN (?)",
			r.db.Model(&model.Recurso{}).Select("id").Where("negocio_id = ?", negocioID))
	if sesion != "" {
		q = q.Where("sesion = ?", sesion)
	}
	res := q.Delete(&model.Hold{})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *holdRepo) ListVigentes(ctx context.Context, recursoID string, desde, hasta, ahora time.Time) ([]model.Hold, error) {
	var hs []model.Hold
	err := r.db.WithContext(ctx).
		Where("recurso_id = ? AND expira_en > ?", recursoID, ahora).
		Where("inicio < ? AND fin > ?", hasta, desde).
		Order("inicio ASC").
		Find(&hs).Error
	if err != nil {
		return nil, err
	}
	return hs, nil
}

func (r *holdRepo) DeleteExpirados(ctx context.Context, ahora time.Time) (int64, error) {
	res := r.db.WithContext(ctx).Where("expira_en <= ?", ahora).Delete(&model.Hold{})
	return res.RowsAffected, res.Error
}

func (r *holdRepo) RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error) {
	return recursoDelNegocio(ctx, r.db, negocioID, recursoID)
}

func (r *holdRepo) ConfigNegocio(ctx context.Context, negocioID string) ([]byte, error) {
	var n model.Negocio
	err := r.db.WithContext(ctx).
		Select("id", "config").
		Where("id = ?", negocioID).
		First(&n).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []byte(n.Config), nil
}
