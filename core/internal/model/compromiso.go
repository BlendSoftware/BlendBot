package model

import (
	"time"

	"github.com/shopspring/decimal"
)

// TipoCompromiso: el mismo objeto con tres nombres según el vertical.
type TipoCompromiso string

const (
	CompromisoPedido  TipoCompromiso = "pedido"
	CompromisoReserva TipoCompromiso = "reserva"
	CompromisoTurno   TipoCompromiso = "turno"
)

// TipoEntrega para pedidos de gastronomía.
type TipoEntrega string

const (
	EntregaRetira   TipoEntrega = "retira"
	EntregaDelivery TipoEntrega = "delivery"
	EntregaEnLocal  TipoEntrega = "en_local"
)

// OrigenCompromiso: por dónde entró.
type OrigenCompromiso string

const (
	OrigenWhatsApp OrigenCompromiso = "whatsapp"
	OrigenPanel    OrigenCompromiso = "panel"
	OrigenTelefono OrigenCompromiso = "telefono"
)

// Compromiso es EL objeto del motor: un cliente pidió un recurso, para un
// momento, y eso pasa por estados hasta cerrarse. Pedido, reserva y turno
// son este mismo registro con distinto tipo.
type Compromiso struct {
	ID           string           `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID    string           `gorm:"type:uuid;not null" json:"negocio_id"`
	ClienteID    string           `gorm:"type:uuid;not null" json:"cliente_id"`
	RecursoID    *string          `gorm:"type:uuid" json:"recurso_id"` // nil mientras no se asignó
	Tipo         TipoCompromiso   `gorm:"type:tipo_compromiso;not null" json:"tipo"`
	Estado       EstadoCompromiso `gorm:"type:estado_compromiso;not null;default:pendiente" json:"estado"`
	Inicio       *time.Time       `json:"inicio"`
	Fin          *time.Time       `json:"fin"`
	DemoraMin    *int             `json:"demora_min"` // lo que puso el local
	Entrega      *TipoEntrega     `gorm:"type:tipo_entrega" json:"entrega"`
	Direccion    *string          `json:"direccion"`
	Total        decimal.Decimal  `gorm:"type:numeric(12,2);not null;default:0" json:"total"`
	Origen       OrigenCompromiso `gorm:"type:origen_compromiso;not null" json:"origen"`
	Nota         *string          `json:"nota"`
	CreadoEn     time.Time        `gorm:"autoCreateTime" json:"creado_en"`
	ConfirmadoEn *time.Time       `json:"confirmado_en"`
	CerradoEn    *time.Time       `json:"cerrado_en"`
	// RecordatorioEnviadoEn es el candado del anti-ausentismo: el worker lo
	// escribe con un UPDATE condicional, así que dos ticks (o dos réplicas)
	// nunca mandan dos recordatorios del mismo turno.
	RecordatorioEnviadoEn *time.Time        `json:"recordatorio_enviado_en"`
	Lineas                []LineaCompromiso `gorm:"foreignKey:CompromisoID" json:"lineas,omitempty"`
}

func (Compromiso) TableName() string { return "compromiso" }

// LineaCompromiso: un ítem del compromiso, con el precio congelado al momento.
type LineaCompromiso struct {
	ID           string          `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	CompromisoID string          `gorm:"type:uuid;not null" json:"compromiso_id"`
	ServicioID   string          `gorm:"type:uuid;not null" json:"servicio_id"`
	Cantidad     int             `gorm:"not null;default:1" json:"cantidad"`
	PrecioUnit   decimal.Decimal `gorm:"type:numeric(12,2);not null" json:"precio_unit"`
	Nota         *string         `json:"nota"` // "sin cebolla"
}

func (LineaCompromiso) TableName() string { return "linea_compromiso" }
