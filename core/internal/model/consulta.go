package model

import "time"

// Estados de una consulta.
const (
	ConsultaPendiente  = "pendiente"
	ConsultaRespondida = "respondida"
)

// Consulta es una pregunta que el agente no pudo verificar con sus tools y, en
// vez de inventar, dejó registrada para que el dueño la conteste. cliente_id
// puede ser nil (el que preguntó no está en la ficha), pero telefono se guarda
// siempre: es por donde vuelve la respuesta.
type Consulta struct {
	ID           string     `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID    string     `gorm:"type:uuid;not null" json:"negocio_id"`
	ClienteID    *string    `gorm:"type:uuid" json:"cliente_id"`
	Telefono     string     `gorm:"not null;default:''" json:"telefono"`
	Pregunta     string     `gorm:"not null" json:"pregunta"`
	Respuesta    *string    `json:"respuesta"`
	Estado       string     `gorm:"not null;default:pendiente" json:"estado"`
	CreadoEn     time.Time  `gorm:"autoCreateTime" json:"creado_en"`
	RespondidaEn *time.Time `json:"respondida_en"`
}

func (Consulta) TableName() string { return "consulta" }
