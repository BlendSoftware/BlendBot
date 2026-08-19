package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CoberturaRepository es tenant-scoped y además maneja precio_cobertura, que
// es el precio del mismo servicio según la obra social del cliente.
//
// precio_cobertura no tiene columna negocio_id: la fila cuelga de un servicio y
// de una cobertura que ya son del tenant. Por eso PrecioDe y UpsertPrecio no
// reciben negocioID — quien llama debe haber resuelto el servicio con
// ServicioRepository.GetByID(negocioID, …) primero.
type CoberturaRepository interface {
	Create(ctx context.Context, negocioID string, c *model.Cobertura) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Cobertura, error)
	List(ctx context.Context, negocioID string) ([]model.Cobertura, error)
	Update(ctx context.Context, negocioID string, c *model.Cobertura) error

	PrecioDe(ctx context.Context, servicioID, coberturaID string) (*model.PrecioCobertura, error)
	ListPrecios(ctx context.Context, servicioID string) ([]model.PrecioCobertura, error)
	UpsertPrecio(ctx context.Context, p *model.PrecioCobertura) error
}

type coberturaRepository struct{ db *gorm.DB }

func NewCoberturaRepository(db *gorm.DB) CoberturaRepository {
	return &coberturaRepository{db: db}
}

func (r *coberturaRepository) Create(ctx context.Context, negocioID string, c *model.Cobertura) error {
	c.NegocioID = negocioID
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *coberturaRepository) GetByID(ctx context.Context, negocioID, id string) (*model.Cobertura, error) {
	var c model.Cobertura
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *coberturaRepository) List(ctx context.Context, negocioID string) ([]model.Cobertura, error) {
	var list []model.Cobertura
	err := r.db.WithContext(ctx).
		Where("negocio_id = ?", negocioID).
		Order("nombre asc").
		Find(&list).Error
	return list, err
}

func (r *coberturaRepository) Update(ctx context.Context, negocioID string, c *model.Cobertura) error {
	res := r.db.WithContext(ctx).Model(&model.Cobertura{}).
		Where("id = ? AND negocio_id = ?", c.ID, negocioID).
		Select("nombre").
		Updates(c)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *coberturaRepository) PrecioDe(ctx context.Context, servicioID, coberturaID string) (*model.PrecioCobertura, error) {
	var p model.PrecioCobertura
	err := r.db.WithContext(ctx).
		Where("servicio_id = ? AND cobertura_id = ?", servicioID, coberturaID).
		First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *coberturaRepository) ListPrecios(ctx context.Context, servicioID string) ([]model.PrecioCobertura, error) {
	var list []model.PrecioCobertura
	err := r.db.WithContext(ctx).
		Where("servicio_id = ?", servicioID).
		Find(&list).Error
	return list, err
}

func (r *coberturaRepository) UpsertPrecio(ctx context.Context, p *model.PrecioCobertura) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "servicio_id"}, {Name: "cobertura_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"precio", "coseguro"}),
	}).Create(p).Error
}
