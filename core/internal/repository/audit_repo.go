package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// AuditRepository persiste el rastro de acciones sensibles. En el vertical
// salud no es opcional (Ley 25.326): quién leyó qué ficha queda asentado.
type AuditRepository interface {
	Registrar(ctx context.Context, e *model.AuditLog) error
	List(ctx context.Context, negocioID string, limite int) ([]model.AuditLog, error)
}

type auditRepository struct{ db *gorm.DB }

func NewAuditRepository(db *gorm.DB) AuditRepository {
	return &auditRepository{db: db}
}

func (r *auditRepository) Registrar(ctx context.Context, e *model.AuditLog) error {
	return r.db.WithContext(ctx).Create(e).Error
}

func (r *auditRepository) List(ctx context.Context, negocioID string, limite int) ([]model.AuditLog, error) {
	if limite <= 0 || limite > 500 {
		limite = 100
	}
	var list []model.AuditLog
	err := r.db.WithContext(ctx).
		Where("negocio_id = ?", negocioID).
		Order("creado_en desc").
		Limit(limite).
		Find(&list).Error
	return list, err
}
