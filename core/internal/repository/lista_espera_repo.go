package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// FiltroListaEspera acota la cola que se lista en el panel.
type FiltroListaEspera struct {
	ServicioID     string // vacío = todos
	SoloPendientes bool   // sólo los que todavía no recibieron oferta
}

// ListaEsperaRepository es tenant-scoped: todo método recibe negocioID y filtra
// por él. El anotado de otro consultorio no existe para este.
type ListaEsperaRepository interface {
	Create(ctx context.Context, negocioID string, le *model.ListaEspera) error
	List(ctx context.Context, negocioID string, f FiltroListaEspera) ([]model.ListaEspera, error)
	Delete(ctx context.Context, negocioID, id string) (bool, error)
	// PrimeroSinNotificar devuelve el más antiguo de la cola de ese servicio que
	// todavía no recibió una oferta. nil (sin error) si la cola está vacía.
	PrimeroSinNotificar(ctx context.Context, negocioID, servicioID string) (*model.ListaEspera, error)
	// MarcarNotificado es condicional (WHERE notificado_en IS NULL): si dos
	// cancelaciones simultáneas apuntan al mismo anotado, sólo una gana y sólo
	// esa manda la oferta.
	MarcarNotificado(ctx context.Context, negocioID, id string, cuando time.Time, compromisoOfrecidoID string) (bool, error)
	// ServicioDelNegocio valida que el servicio exista y sea del tenant antes de
	// anotar a alguien en su cola.
	ServicioDelNegocio(ctx context.Context, negocioID, servicioID string) (bool, error)
	// ClienteDelNegocio hace lo mismo con el cliente.
	ClienteDelNegocio(ctx context.Context, negocioID, clienteID string) (bool, error)
}

type listaEsperaRepo struct{ db *gorm.DB }

func NewListaEsperaRepository(db *gorm.DB) ListaEsperaRepository {
	return &listaEsperaRepo{db: db}
}

func (r *listaEsperaRepo) Create(ctx context.Context, negocioID string, le *model.ListaEspera) error {
	le.NegocioID = negocioID
	return r.db.WithContext(ctx).Create(le).Error
}

func (r *listaEsperaRepo) List(ctx context.Context, negocioID string, f FiltroListaEspera) ([]model.ListaEspera, error) {
	q := r.db.WithContext(ctx).Where("negocio_id = ?", negocioID)
	if f.ServicioID != "" {
		q = q.Where("servicio_id = ?", f.ServicioID)
	}
	if f.SoloPendientes {
		q = q.Where("notificado_en IS NULL")
	}
	var out []model.ListaEspera
	if err := q.Order("creado_en ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *listaEsperaRepo) Delete(ctx context.Context, negocioID, id string) (bool, error) {
	res := r.db.WithContext(ctx).
		Where("negocio_id = ? AND id = ?", negocioID, id).
		Delete(&model.ListaEspera{})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *listaEsperaRepo) PrimeroSinNotificar(ctx context.Context, negocioID, servicioID string) (*model.ListaEspera, error) {
	var le model.ListaEspera
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND servicio_id = ? AND notificado_en IS NULL", negocioID, servicioID).
		Order("creado_en ASC").
		First(&le).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &le, nil
}

func (r *listaEsperaRepo) MarcarNotificado(ctx context.Context, negocioID, id string, cuando time.Time, compromisoOfrecidoID string) (bool, error) {
	campos := map[string]any{"notificado_en": cuando}
	if compromisoOfrecidoID != "" {
		campos["compromiso_ofrecido_id"] = compromisoOfrecidoID
	}
	res := r.db.WithContext(ctx).
		Model(&model.ListaEspera{}).
		Where("negocio_id = ? AND id = ? AND notificado_en IS NULL", negocioID, id).
		Updates(campos)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *listaEsperaRepo) ServicioDelNegocio(ctx context.Context, negocioID, servicioID string) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&model.Servicio{}).
		Where("negocio_id = ? AND id = ? AND activo = TRUE", negocioID, servicioID).
		Count(&n).Error
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r *listaEsperaRepo) ClienteDelNegocio(ctx context.Context, negocioID, clienteID string) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&model.Cliente{}).
		Where("negocio_id = ? AND id = ?", negocioID, clienteID).
		Count(&n).Error
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
