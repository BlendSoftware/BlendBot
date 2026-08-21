package repository

import (
	"context"
	"time"

	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// ClienteConResumen es un cliente del negocio con el resumen de su actividad:
// cuántos pedidos hizo, cuánto acumuló y cuándo fue el último. Alimenta la lista
// de clientes de gastronomía, donde el dueño quiere ver de un vistazo a todos
// los que pidieron (no sólo a los de la agenda del día).
type ClienteConResumen struct {
	ID              string
	Telefono        string
	Nombre          *string
	CoberturaID     *string
	CreadoEn        time.Time
	CantidadPedidos int
	TotalAcumulado  decimal.Decimal
	UltimoPedido    *time.Time
}

// ClienteRepository es tenant-scoped. La unicidad real vive en la base:
// UNIQUE (negocio_id, telefono).
type ClienteRepository interface {
	Create(ctx context.Context, negocioID string, c *model.Cliente) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Cliente, error)
	GetByTelefono(ctx context.Context, negocioID, telefono string) (*model.Cliente, error)
	List(ctx context.Context, negocioID string, limite int) ([]model.Cliente, error)
	// ListarConResumen trae TODOS los clientes del negocio con el resumen de su
	// actividad, ordenados por el pedido más reciente primero.
	ListarConResumen(ctx context.Context, negocioID string) ([]ClienteConResumen, error)
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

func (r *clienteRepository) ListarConResumen(ctx context.Context, negocioID string) ([]ClienteConResumen, error) {
	var out []ClienteConResumen
	// LEFT JOIN para que un cliente sin pedidos aún aparezca (cuenta 0). El join
	// lleva el negocio_id: un compromiso de otro tenant no puede sumar acá. El
	// COALESCE evita un NULL en el total cuando todavía no pidió nada.
	err := r.db.WithContext(ctx).
		Table("cliente").
		Select(`cliente.id AS id,
			cliente.telefono AS telefono,
			cliente.nombre AS nombre,
			cliente.cobertura_id AS cobertura_id,
			cliente.creado_en AS creado_en,
			COUNT(compromiso.id) AS cantidad_pedidos,
			COALESCE(SUM(compromiso.total), 0) AS total_acumulado,
			MAX(compromiso.creado_en) AS ultimo_pedido`).
		Joins("LEFT JOIN compromiso ON compromiso.cliente_id = cliente.id AND compromiso.negocio_id = cliente.negocio_id").
		Where("cliente.negocio_id = ?", negocioID).
		Group("cliente.id, cliente.telefono, cliente.nombre, cliente.cobertura_id, cliente.creado_en").
		Order("ultimo_pedido DESC NULLS LAST, cliente.creado_en DESC").
		Scan(&out).Error
	if err != nil {
		return nil, err
	}
	return out, nil
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
