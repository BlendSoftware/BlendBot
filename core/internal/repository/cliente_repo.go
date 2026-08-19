package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// ClienteRepository es tenant-scoped. La unicidad real vive en la base:
// UNIQUE (negocio_id, telefono).
type ClienteRepository interface {
	Create(ctx context.Context, negocioID string, c *model.Cliente) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Cliente, error)
	GetByTelefono(ctx context.Context, negocioID, telefono string) (*model.Cliente, error)
	List(ctx context.Context, negocioID string, limite int) ([]model.Cliente, error)
	Update(ctx context.Context, negocioID string, c *model.Cliente) error
}

type clienteRepository struct{ db *gorm.DB }

func NewClienteRepository(db *gorm.DB) ClienteRepository {
	return &clienteRepository{db: db}
}

func (r *clienteRepository) Create(ctx context.Context, negocioID string, c *model.Cliente) error {
	c.NegocioID = negocioID
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *clienteRepository) GetByID(ctx context.Context, negocioID, id string) (*model.Cliente, error) {
	var c model.Cliente
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *clienteRepository) GetByTelefono(ctx context.Context, negocioID, telefono string) (*model.Cliente, error) {
	var c model.Cliente
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND telefono = ?", negocioID, telefono).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *clienteRepository) List(ctx context.Context, negocioID string, limite int) ([]model.Cliente, error) {
	if limite <= 0 || limite > 200 {
		limite = 50
	}
	var list []model.Cliente
	err := r.db.WithContext(ctx).
		Where("negocio_id = ?", negocioID).
		Order("creado_en desc").
		Limit(limite).
		Find(&list).Error
	return list, err
}

func (r *clienteRepository) Update(ctx context.Context, negocioID string, c *model.Cliente) error {
	res := r.db.WithContext(ctx).Model(&model.Cliente{}).
		Where("id = ? AND negocio_id = ?", c.ID, negocioID).
		Select("nombre", "documento", "cobertura_id", "notas").
		Updates(c)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
