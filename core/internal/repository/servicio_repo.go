package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// FiltroServicios acota el listado del catálogo.
type FiltroServicios struct {
	CategoriaID      string
	SoloDisponibles  bool
	IncluirInactivos bool
}

// ServicioRepository es tenant-scoped.
//
// ListDisponibles es activo + disponible. El interruptor `disponible` excluye
// el servicio de todo listado no-admin.
//
// No resuelve el cupo del día: quien llame directo a este método no se entera
// de qué se terminó. La vista del agente pasa por CatalogoService, que sí lo
// informa.
type ServicioRepository interface {
	Create(ctx context.Context, negocioID string, s *model.Servicio) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Servicio, error)
	List(ctx context.Context, negocioID string, f FiltroServicios) ([]model.Servicio, error)
	ListDisponibles(ctx context.Context, negocioID string) ([]model.Servicio, error)
	Update(ctx context.Context, negocioID string, s *model.Servicio) error
	SetDisponible(ctx context.Context, negocioID, id string, disponible bool) error
	Desactivar(ctx context.Context, negocioID, id string) error
}

type servicioRepository struct{ db *gorm.DB }

func NewServicioRepository(db *gorm.DB) ServicioRepository {
	return &servicioRepository{db: db}
}

func (r *servicioRepository) Create(ctx context.Context, negocioID string, s *model.Servicio) error {
	s.NegocioID = negocioID
	return r.db.WithContext(ctx).Create(s).Error
}

func (r *servicioRepository) GetByID(ctx context.Context, negocioID, id string) (*model.Servicio, error) {
	var s model.Servicio
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *servicioRepository) List(ctx context.Context, negocioID string, f FiltroServicios) ([]model.Servicio, error) {
	q := r.db.WithContext(ctx).Where("negocio_id = ?", negocioID)
	if !f.IncluirInactivos {
		q = q.Where("activo = TRUE")
	}
	if f.SoloDisponibles {
		q = q.Where("disponible = TRUE")
	}
	if f.CategoriaID != "" {
		q = q.Where("categoria_id = ?", f.CategoriaID)
	}
	var list []model.Servicio
	err := q.Order("nombre asc").Find(&list).Error
	return list, err
}

func (r *servicioRepository) ListDisponibles(ctx context.Context, negocioID string) ([]model.Servicio, error) {
	return r.List(ctx, negocioID, FiltroServicios{SoloDisponibles: true})
}

func (r *servicioRepository) Update(ctx context.Context, negocioID string, s *model.Servicio) error {
	res := r.db.WithContext(ctx).Model(&model.Servicio{}).
		Where("id = ? AND negocio_id = ?", s.ID, negocioID).
		Select("categoria_id", "nombre", "descripcion", "duracion_min", "precio_base", "disponible", "activo").
		Updates(s)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *servicioRepository) SetDisponible(ctx context.Context, negocioID, id string, disponible bool) error {
	res := r.db.WithContext(ctx).Model(&model.Servicio{}).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		Update("disponible", disponible)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *servicioRepository) Desactivar(ctx context.Context, negocioID, id string) error {
	res := r.db.WithContext(ctx).Model(&model.Servicio{}).
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
