package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// NegocioRepository administra los tenants. Es el único repositorio que no
// recibe negocioID: acá el negocio ES la fila. Sólo lo usa el rol admin de la
// plataforma y el gateway, que resuelve el tenant por wa_phone_id.
type NegocioRepository interface {
	Create(ctx context.Context, n *model.Negocio) error
	GetByID(ctx context.Context, id string) (*model.Negocio, error)
	GetByWaPhoneID(ctx context.Context, waPhoneID string) (*model.Negocio, error)
	List(ctx context.Context) ([]model.Negocio, error)
	Update(ctx context.Context, n *model.Negocio) error
	// WithTx devuelve el mismo repositorio atado a una transacción abierta.
	WithTx(tx *gorm.DB) NegocioRepository
}

type negocioRepository struct{ db *gorm.DB }

func NewNegocioRepository(db *gorm.DB) NegocioRepository {
	return &negocioRepository{db: db}
}

func (r *negocioRepository) WithTx(tx *gorm.DB) NegocioRepository {
	return &negocioRepository{db: tx}
}

func (r *negocioRepository) Create(ctx context.Context, n *model.Negocio) error {
	return r.db.WithContext(ctx).Create(n).Error
}

func (r *negocioRepository) GetByID(ctx context.Context, id string) (*model.Negocio, error) {
	var n model.Negocio
	if err := r.db.WithContext(ctx).First(&n, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func (r *negocioRepository) GetByWaPhoneID(ctx context.Context, waPhoneID string) (*model.Negocio, error) {
	var n model.Negocio
	if err := r.db.WithContext(ctx).First(&n, "wa_phone_id = ?", waPhoneID).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func (r *negocioRepository) List(ctx context.Context) ([]model.Negocio, error) {
	var list []model.Negocio
	err := r.db.WithContext(ctx).Order("creado_en desc").Find(&list).Error
	return list, err
}

func (r *negocioRepository) Update(ctx context.Context, n *model.Negocio) error {
	res := r.db.WithContext(ctx).Model(&model.Negocio{}).
		Where("id = ?", n.ID).
		Select("nombre", "vertical", "timezone", "wa_phone_id", "wa_waba_id", "config", "activo").
		Updates(n)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
