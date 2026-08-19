package model

import (
	"time"

	"gorm.io/datatypes"
)

// Vertical del negocio: decide el prompt del agente y cómo el panel nombra
// las cosas (Carta/Stock vs Profesionales/Agenda). El motor es el mismo.
type Vertical string

const (
	VerticalGastronomia Vertical = "gastronomia"
	VerticalSalud       Vertical = "salud"
)

// Negocio es el tenant. Toda query de todo repositorio filtra por su id.
type Negocio struct {
	ID        string         `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Nombre    string         `gorm:"not null" json:"nombre"`
	Vertical  Vertical       `gorm:"type:vertical_negocio;not null" json:"vertical"`
	Timezone  string         `gorm:"not null;default:America/Argentina/Mendoza" json:"timezone"`
	WaPhoneID *string        `gorm:"column:wa_phone_id;unique" json:"wa_phone_id"`
	WaWabaID  *string        `gorm:"column:wa_waba_id" json:"wa_waba_id"`
	Config    datatypes.JSON `gorm:"not null;default:'{}'" json:"config"`
	Activo    bool           `gorm:"not null;default:true" json:"activo"`
	CreadoEn  time.Time      `gorm:"autoCreateTime" json:"creado_en"`
}

func (Negocio) TableName() string { return "negocio" }
