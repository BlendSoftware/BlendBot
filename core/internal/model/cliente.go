package model

import (
	"time"

	"github.com/shopspring/decimal"
)

// Cobertura: obra social o prepaga. "Particular" es una cobertura más.
type Cobertura struct {
	ID        string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID string `gorm:"type:uuid;not null" json:"negocio_id"`
	Nombre    string `gorm:"not null" json:"nombre"`
}

func (Cobertura) TableName() string { return "cobertura" }

// Cliente del negocio, identificado por su teléfono de WhatsApp.
// Mínimo dato necesario (Ley 25.326): Documento y Notas se cifran a nivel
// campo en el service antes de tocar la base.
type Cliente struct {
	ID          string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID   string    `gorm:"type:uuid;not null" json:"negocio_id"`
	Telefono    string    `gorm:"not null" json:"telefono"`
	Nombre      *string   `json:"nombre"`
	Documento   *string   `json:"-"`
	CoberturaID *string   `gorm:"type:uuid" json:"cobertura_id"`
	Notas       *string   `json:"-"`
	CreadoEn    time.Time `gorm:"autoCreateTime" json:"creado_en"`
}

func (Cliente) TableName() string { return "cliente" }

// PrecioCobertura: el mismo servicio con precio distinto por cobertura
// (patrón lista_precios de BlendPos).
type PrecioCobertura struct {
	ServicioID  string           `gorm:"type:uuid;primaryKey" json:"servicio_id"`
	CoberturaID string           `gorm:"type:uuid;primaryKey" json:"cobertura_id"`
	Precio      decimal.Decimal  `gorm:"type:numeric(12,2);not null" json:"precio"`
	Coseguro    *decimal.Decimal `gorm:"type:numeric(12,2)" json:"coseguro"`
}

func (PrecioCobertura) TableName() string { return "precio_cobertura" }
