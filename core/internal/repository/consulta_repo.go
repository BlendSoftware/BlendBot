package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// FiltroConsultas acota el inbox del panel.
type FiltroConsultas struct {
	Estado string // vacío = todas
}

// ConsultaConDatos es una consulta con el cliente ya resuelto. El panel muestra
// gente, no UUIDs; el cliente puede ser nil (nadie en la ficha con ese teléfono
// al momento de preguntar), por eso el JOIN es LEFT y el nombre es puntero.
type ConsultaConDatos struct {
	ID            string     `gorm:"column:id"`
	NegocioID     string     `gorm:"column:negocio_id"`
	ClienteID     *string    `gorm:"column:cliente_id"`
	ClienteNombre *string    `gorm:"column:cliente_nombre"`
	Telefono      string     `gorm:"column:telefono"`
	Pregunta      string     `gorm:"column:pregunta"`
	Respuesta     *string    `gorm:"column:respuesta"`
	Estado        string     `gorm:"column:estado"`
	CreadoEn      time.Time  `gorm:"column:creado_en"`
	RespondidaEn  *time.Time `gorm:"column:respondida_en"`
}

// DatosAvisoConsulta es lo que hace falta para avisarle al cliente que su
// consulta ya tiene respuesta: el teléfono al que escribir y el wa_phone_id del
// negocio con el que el gateway manda. Sin wa_phone_id no hay a quién avisar.
type DatosAvisoConsulta struct {
	WaPhoneID     string `gorm:"column:wa_phone_id"`
	Telefono      string `gorm:"column:telefono"`
	ClienteNombre string `gorm:"column:cliente_nombre"`
}

// ConsultaRepository es tenant-scoped: todo método recibe negocioID y filtra.
type ConsultaRepository interface {
	Create(ctx context.Context, negocioID string, c *model.Consulta) error
	List(ctx context.Context, negocioID string, f FiltroConsultas) ([]ConsultaConDatos, error)
	PorID(ctx context.Context, negocioID, id string) (*ConsultaConDatos, error)
	// Responder marca la consulta como respondida. false (sin error) si no
	// existe o es de otro negocio.
	Responder(ctx context.Context, negocioID, id, respuesta string, cuando time.Time) (bool, error)
	// ClienteDelNegocio valida que el cliente exista y sea del tenant.
	ClienteDelNegocio(ctx context.Context, negocioID, clienteID string) (bool, error)
	// TelefonoDeCliente devuelve el teléfono del cliente del tenant, o "" si no
	// existe.
	TelefonoDeCliente(ctx context.Context, negocioID, clienteID string) (string, error)
	// DatosAviso resuelve a quién avisarle la respuesta. nil (sin error) si el
	// negocio no tiene wa_phone_id (no se puede avisar) o la consulta no existe.
	DatosAviso(ctx context.Context, negocioID, id string) (*DatosAvisoConsulta, error)
}

type consultaRepo struct{ db *gorm.DB }

func NewConsultaRepository(db *gorm.DB) ConsultaRepository {
	return &consultaRepo{db: db}
}

func (r *consultaRepo) Create(ctx context.Context, negocioID string, c *model.Consulta) error {
	c.NegocioID = negocioID
	return r.db.WithContext(ctx).Create(c).Error
}

// conDatos es la consulta base con el cliente joineado. El LEFT JOIN ancla el
// cliente al mismo negocio: un id de otro tenant no aporta nombre.
func (r *consultaRepo) conDatos(ctx context.Context, negocioID string) *gorm.DB {
	return r.db.WithContext(ctx).
		Model(&model.Consulta{}).
		Select(`consulta.id, consulta.negocio_id, consulta.cliente_id,
			consulta.telefono, consulta.pregunta, consulta.respuesta,
			consulta.estado, consulta.creado_en, consulta.respondida_en,
			cliente.nombre AS cliente_nombre`).
		Joins("LEFT JOIN cliente ON cliente.id = consulta.cliente_id AND cliente.negocio_id = consulta.negocio_id").
		Where("consulta.negocio_id = ?", negocioID)
}

func (r *consultaRepo) List(ctx context.Context, negocioID string, f FiltroConsultas) ([]ConsultaConDatos, error) {
	q := r.conDatos(ctx, negocioID)
	if f.Estado != "" {
		q = q.Where("consulta.estado = ?", f.Estado)
	}
	var out []ConsultaConDatos
	// Por orden de llegada: la más vieja sin responder es la que más espera.
	if err := q.Order("consulta.creado_en ASC").Scan(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *consultaRepo) PorID(ctx context.Context, negocioID, id string) (*ConsultaConDatos, error) {
	var out []ConsultaConDatos
	err := r.conDatos(ctx, negocioID).
		Where("consulta.id = ?", id).
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

func (r *consultaRepo) Responder(ctx context.Context, negocioID, id, respuesta string, cuando time.Time) (bool, error) {
	res := r.db.WithContext(ctx).
		Model(&model.Consulta{}).
		Where("negocio_id = ? AND id = ?", negocioID, id).
		Updates(map[string]any{
			"respuesta":     respuesta,
			"estado":        model.ConsultaRespondida,
			"respondida_en": cuando,
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *consultaRepo) ClienteDelNegocio(ctx context.Context, negocioID, clienteID string) (bool, error) {
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

func (r *consultaRepo) TelefonoDeCliente(ctx context.Context, negocioID, clienteID string) (string, error) {
	var tels []string
	err := r.db.WithContext(ctx).
		Model(&model.Cliente{}).
		Where("negocio_id = ? AND id = ?", negocioID, clienteID).
		Limit(1).
		Pluck("telefono", &tels).Error
	if err != nil {
		return "", err
	}
	if len(tels) == 0 {
		return "", nil
	}
	return tels[0], nil
}

func (r *consultaRepo) DatosAviso(ctx context.Context, negocioID, id string) (*DatosAvisoConsulta, error) {
	var d DatosAvisoConsulta
	err := r.db.WithContext(ctx).Raw(`
		SELECT n.wa_phone_id            AS wa_phone_id,
		       co.telefono              AS telefono,
		       COALESCE(cl.nombre, '')  AS cliente_nombre
		FROM consulta co
		JOIN negocio n ON n.id = co.negocio_id
		LEFT JOIN cliente cl ON cl.id = co.cliente_id AND cl.negocio_id = co.negocio_id
		WHERE co.id = ? AND co.negocio_id = ? AND n.activo = TRUE AND n.wa_phone_id IS NOT NULL
	`, id, negocioID).Take(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}
