package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// CategoriaRepository es tenant-scoped.
type CategoriaRepository interface {
	Create(ctx context.Context, negocioID string, c *model.Categoria) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Categoria, error)
	List(ctx context.Context, negocioID string, incluirInactivas bool) ([]model.Categoria, error)
	Update(ctx context.Context, negocioID string, c *model.Categoria) error
	Desactivar(ctx context.Context, negocioID, id string) error
}

type categoriaRepository struct{ db *gorm.DB }

func NewCategoriaRepository(db *gorm.DB) CategoriaRepository {
	return &categoriaRepository{db: db}
}

func (r *categoriaRepository) Create(ctx context.Context, negocioID string, c *model.Categoria) error {
	c.NegocioID = negocioID
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *categoriaRepository) GetByID(ctx context.Context, negocioID, id string) (*model.Categoria, error) {
	var c model.Categoria
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *categoriaRepository) List(ctx context.Context, negocioID string, incluirInactivas bool) ([]model.Categoria, error) {
	q := r.db.WithContext(ctx).Where("negocio_id = ?", negocioID)
	if !incluirInactivas {
		q = q.Where("activo = TRUE")
	}
	var list []model.Categoria
	err := q.Order("orden asc, nombre asc").Find(&list).Error
	return list, err
}

func (r *categoriaRepository) Update(ctx context.Context, negocioID string, c *model.Categoria) error {
	res := r.db.WithContext(ctx).Model(&model.Categoria{}).
		Where("id = ? AND negocio_id = ?", c.ID, negocioID).
		Select("nombre", "orden", "activo").
		Updates(c)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *categoriaRepository) Desactivar(ctx context.Context, negocioID, id string) error {
	res := r.db.WithContext(ctx).Model(&model.Categoria{}).
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
