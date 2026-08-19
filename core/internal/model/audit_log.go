package model

import (
	"time"

	"gorm.io/datatypes"
)

// AuditLog registra quién hizo qué y cuándo. En el vertical salud no es
// opcional (Ley 25.326): quién leyó qué ficha queda asentado.
type AuditLog struct {
	ID        string         `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID *string        `gorm:"type:uuid" json:"negocio_id"`
	UsuarioID *string        `gorm:"type:uuid" json:"usuario_id"`
	Accion    string         `gorm:"not null" json:"accion"` // ej: cliente.leer, compromiso.confirmar
	Entidad   string         `gorm:"not null" json:"entidad"`
	EntidadID *string        `gorm:"type:uuid" json:"entidad_id"`
	Detalle   datatypes.JSON `json:"detalle"`
	CreadoEn  time.Time      `gorm:"autoCreateTime" json:"creado_en"`
}

func (AuditLog) TableName() string { return "audit_log" }
