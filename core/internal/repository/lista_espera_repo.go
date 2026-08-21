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

// AnotadoEnCola es una fila de la cola con el cliente y el servicio ya
// resueltos. El panel muestra gente, no UUIDs: sin esto la vista de lista de
// espera tendría que pedir una ficha por anotado.
type AnotadoEnCola struct {
	ID                   string     `gorm:"column:id"`
	NegocioID            string     `gorm:"column:negocio_id"`
	ClienteID            string     `gorm:"column:cliente_id"`
	ServicioID           string     `gorm:"column:servicio_id"`
	Nota                 *string    `gorm:"column:nota"`
	CreadoEn             time.Time  `gorm:"column:creado_en"`
	NotificadoEn         *time.Time `gorm:"column:notificado_en"`
	CompromisoOfrecidoID *string    `gorm:"column:compromiso_ofrecido_id"`
	ClienteNombre        *string    `gorm:"column:cliente_nombre"`
	ClienteTelefono      string     `gorm:"column:cliente_telefono"`
	ServicioNombre       string     `gorm:"column:servicio_nombre"`
}

// ListaEsperaRepository es tenant-scoped: todo método recibe negocioID y filtra
// por él. El anotado de otro negocio no existe para este.
type ListaEsperaRepository interface {
	Create(ctx context.Context, negocioID string, le *model.ListaEspera) error
	List(ctx context.Context, negocioID string, f FiltroListaEspera) ([]model.ListaEspera, error)
	// ListConDatos es lo mismo que List pero con el cliente y el servicio
	// resueltos: es lo que lee el panel.
	ListConDatos(ctx context.Context, negocioID string, f FiltroListaEspera) ([]AnotadoEnCola, error)
	// PorID devuelve un anotado del tenant, ya resuelto. nil (sin error) si no
	// existe o es de otro negocio.
	PorID(ctx context.Context, negocioID, id string) (*AnotadoEnCola, error)
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

// conDatos es la consulta base de la cola con cliente y servicio joineados.
// Los dos joins repiten el negocio: el tenant se nombra en cada tabla, no se
// hereda por confianza.
func (r *listaEsperaRepo) conDatos(ctx context.Context, negocioID string) *gorm.DB {
	return r.db.WithContext(ctx).
		Model(&model.ListaEspera{}).
		Select(`lista_espera.id, lista_espera.negocio_id, lista_espera.cliente_id,
			lista_espera.servicio_id, lista_espera.nota, lista_espera.creado_en,
			lista_espera.notificado_en, lista_espera.compromiso_ofrecido_id,
			cliente.nombre AS cliente_nombre, cliente.telefono AS cliente_telefono,
			servicio.nombre AS servicio_nombre`).
		Joins("JOIN cliente ON cliente.id = lista_espera.cliente_id AND cliente.negocio_id = lista_espera.negocio_id").
		Joins("JOIN servicio ON servicio.id = lista_espera.servicio_id AND servicio.negocio_id = lista_espera.negocio_id").
		Where("lista_espera.negocio_id = ?", negocioID)
}

func (r *listaEsperaRepo) ListConDatos(ctx context.Context, negocioID string, f FiltroListaEspera) ([]AnotadoEnCola, error) {
	q := r.conDatos(ctx, negocioID)
	if f.ServicioID != "" {
		q = q.Where("lista_espera.servicio_id = ?", f.ServicioID)
	}
	if f.SoloPendientes {
		q = q.Where("lista_espera.notificado_en IS NULL")
	}
	var out []AnotadoEnCola
	if err := q.Order("lista_espera.creado_en ASC").Scan(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *listaEsperaRepo) PorID(ctx context.Context, negocioID, id string) (*AnotadoEnCola, error) {
	var out []AnotadoEnCola
	err := r.conDatos(ctx, negocioID).
		Where("lista_espera.id = ?", id).
		Limit(1).
		Scan(&out).Error
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	return &out[0], nil
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
