package model

import "time"

// Jornada es la caja del día: se abre, se trabaja, se cierra. Mientras
// CerradaEn es nil la caja está abierta. No guarda plata: los totales se
// calculan sobre compromisos y cobros (el cierre del día). La jornada es
// sólo el ciclo abrir → cerrar y el rastro de quién lo movió.
type Jornada struct {
	ID         string     `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID  string     `gorm:"type:uuid;not null" json:"negocio_id"`
	AbiertaEn  time.Time  `gorm:"not null;default:now()" json:"abierta_en"`
	CerradaEn  *time.Time `json:"cerrada_en"`
	AbiertaPor *string    `gorm:"type:uuid" json:"abierta_por"`
	CerradaPor *string    `gorm:"type:uuid" json:"cerrada_por"`
	CreadoEn   time.Time  `gorm:"autoCreateTime" json:"creado_en"`
}

func (Jornada) TableName() string { return "jornada" }

// Abierta responde si la caja sigue abierta.
func (j *Jornada) Abierta() bool { return j != nil && j.CerradaEn == nil }
