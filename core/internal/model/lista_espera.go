package model

import "time"

// ListaEspera es el anotado: un cliente que quiere ese servicio si se libera un
// hueco. Cuando un turno futuro se cancela, el primero sin notificar de la cola
// del mismo servicio recibe la oferta.
//
// notificado_en no se borra: la oferta se hizo una vez y queda registrada, así
// nadie recibe dos veces el mismo aviso.
type ListaEspera struct {
	ID                   string     `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID            string     `gorm:"type:uuid;not null" json:"negocio_id"`
	ClienteID            string     `gorm:"type:uuid;not null" json:"cliente_id"`
	ServicioID           string     `gorm:"type:uuid;not null" json:"servicio_id"`
	Nota                 *string    `json:"nota"`
	CreadoEn             time.Time  `gorm:"autoCreateTime" json:"creado_en"`
	NotificadoEn         *time.Time `json:"notificado_en"`
	CompromisoOfrecidoID *string    `gorm:"type:uuid" json:"compromiso_ofrecido_id"`
}

func (ListaEspera) TableName() string { return "lista_espera" }
