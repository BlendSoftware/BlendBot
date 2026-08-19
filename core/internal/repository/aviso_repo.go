package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// TurnoParaRecordatorio es la proyección que necesita el worker para armar el
// mensaje. No es un modelo: los datos salen de compromiso + negocio + cliente,
// y el worker no tiene por qué hacer tres viajes a la base por cada turno.
type TurnoParaRecordatorio struct {
	CompromisoID  string
	NegocioID     string
	NegocioNombre string
	WaPhoneID     string
	Timezone      string
	ConfigNegocio datatypes.JSON
	ClienteNombre string
	Telefono      string
	Inicio        time.Time
}

// DatosOferta es lo que se necesita para ofrecerle un hueco liberado a alguien
// de la lista de espera.
type DatosOferta struct {
	NegocioNombre  string
	WaPhoneID      string
	Timezone       string
	ClienteNombre  string
	Telefono       string
	ServicioNombre string
}

// AvisoRepository alimenta al anti-ausentismo. Todo sale acotado al tenant: la
// proyección del recordatorio trae el negocio_id de cada fila y el marcado
// vuelve a filtrar por él.
type AvisoRepository interface {
	// TurnosSinRecordatorio son los turnos CONFIRMADOS que empiezan dentro del
	// rango y a los que todavía no se les mandó el aviso. El filtro fino de la
	// ventana (que depende de la config de cada negocio) lo hace el worker.
	TurnosSinRecordatorio(ctx context.Context, desde, hasta time.Time, limite int) ([]TurnoParaRecordatorio, error)
	// MarcarRecordatorioEnviado es EL candado: condicional sobre
	// recordatorio_enviado_en IS NULL. Devuelve false si otro tick o otra
	// réplica llegó primero, y entonces nadie encola nada.
	MarcarRecordatorioEnviado(ctx context.Context, negocioID, compromisoID string, cuando time.Time) (bool, error)
	// DatosParaOferta devuelve nil (sin error) si el negocio no está activo, no
	// tiene WhatsApp configurado, o el cliente/servicio no son de ese tenant.
	DatosParaOferta(ctx context.Context, negocioID, clienteID, servicioID string) (*DatosOferta, error)
}

type avisoRepo struct{ db *gorm.DB }

func NewAvisoRepository(db *gorm.DB) AvisoRepository { return &avisoRepo{db: db} }

func (r *avisoRepo) TurnosSinRecordatorio(ctx context.Context, desde, hasta time.Time, limite int) ([]TurnoParaRecordatorio, error) {
	if limite <= 0 || limite > 500 {
		limite = 200
	}
	var out []TurnoParaRecordatorio
	// Un negocio sin wa_phone_id no puede recibir el aviso: el gateway no
	// tendría por dónde mandarlo. Se lo saltea sin marcar nada, así que cuando
	// configure WhatsApp el circuito arranca solo.
	err := r.db.WithContext(ctx).Raw(`
		SELECT c.id                    AS compromiso_id,
		       c.negocio_id            AS negocio_id,
		       c.inicio                AS inicio,
		       n.nombre                AS negocio_nombre,
		       n.wa_phone_id           AS wa_phone_id,
		       n.timezone              AS timezone,
		       n.config                AS config_negocio,
		       COALESCE(cl.nombre, '') AS cliente_nombre,
		       cl.telefono             AS telefono
		FROM compromiso c
		JOIN negocio n  ON n.id  = c.negocio_id
		JOIN cliente cl ON cl.id = c.cliente_id
		WHERE c.tipo   = 'turno'
		  AND c.estado = 'confirmado'
		  AND c.recordatorio_enviado_en IS NULL
		  AND c.inicio IS NOT NULL
		  AND c.inicio >= ? AND c.inicio <= ?
		  AND n.activo = TRUE
		  AND n.wa_phone_id IS NOT NULL
		ORDER BY c.inicio ASC
		LIMIT ?
	`, desde, hasta, limite).Scan(&out).Error
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *avisoRepo) MarcarRecordatorioEnviado(ctx context.Context, negocioID, compromisoID string, cuando time.Time) (bool, error) {
	// El estado vuelve a la condición a propósito: entre el barrido y el marcado
	// el turno pudo cancelarse, y no se recuerda un turno que ya no existe.
	res := r.db.WithContext(ctx).
		Model(&model.Compromiso{}).
		Where("negocio_id = ? AND id = ? AND estado = ? AND recordatorio_enviado_en IS NULL",
			negocioID, compromisoID, model.EstadoConfirmado).
		Update("recordatorio_enviado_en", cuando)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *avisoRepo) DatosParaOferta(ctx context.Context, negocioID, clienteID, servicioID string) (*DatosOferta, error) {
	var d DatosOferta
	// Los JOIN anclan cliente y servicio al mismo negocio: un id de otro tenant
	// no devuelve fila.
	err := r.db.WithContext(ctx).Raw(`
		SELECT n.nombre                AS negocio_nombre,
		       n.wa_phone_id           AS wa_phone_id,
		       n.timezone              AS timezone,
		       COALESCE(cl.nombre, '') AS cliente_nombre,
		       cl.telefono             AS telefono,
		       s.nombre                AS servicio_nombre
		FROM negocio n
		JOIN cliente  cl ON cl.id = ? AND cl.negocio_id = n.id
		JOIN servicio s  ON s.id  = ? AND s.negocio_id  = n.id
		WHERE n.id = ? AND n.activo = TRUE AND n.wa_phone_id IS NOT NULL
	`, clienteID, servicioID, negocioID).Take(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}
