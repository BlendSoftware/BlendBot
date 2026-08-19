package model

import "time"

// Usuario del panel. NegocioID nil sólo para rol admin (panel de la plataforma).
type Usuario struct {
	ID                 string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID          *string   `gorm:"type:uuid" json:"negocio_id"`
	Username           string    `gorm:"not null;unique" json:"username"`
	PasswordHash       string    `gorm:"not null" json:"-"`
	Rol                string    `gorm:"not null" json:"rol"` // admin | dueno | operador
	Activo             bool      `gorm:"not null;default:true" json:"activo"`
	MustChangePassword bool      `gorm:"not null;default:false" json:"must_change_password"`
	CreadoEn           time.Time `gorm:"autoCreateTime" json:"creado_en"`
}

func (Usuario) TableName() string { return "usuario" }
