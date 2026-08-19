package dto

import "time"

// AnotarEnListaEsperaInput anota a alguien para un servicio. El negocio no
// viaja: sale del token.
type AnotarEnListaEsperaInput struct {
	ClienteID  string  `json:"cliente_id" binding:"required,uuid"`
	ServicioID string  `json:"servicio_id" binding:"required,uuid"`
	Nota       *string `json:"nota"`
}

// FiltroListaEspera es el filtro de GET /api/lista-espera.
type FiltroListaEspera struct {
	ServicioID     string
	SoloPendientes bool
}

// ListaEsperaResponse es un anotado de la cola. El nombre del cliente y el del
// servicio viajan resueltos: quien atiende lee "Juana Pérez · Consulta", no dos
// UUID.
type ListaEsperaResponse struct {
	ID                   string     `json:"id"`
	NegocioID            string     `json:"negocio_id"`
	ClienteID            string     `json:"cliente_id"`
	ClienteNombre        *string    `json:"cliente_nombre"`
	ClienteTelefono      string     `json:"cliente_telefono"`
	ServicioID           string     `json:"servicio_id"`
	ServicioNombre       string     `json:"servicio_nombre"`
	Nota                 *string    `json:"nota"`
	CreadoEn             time.Time  `json:"creado_en"`
	NotificadoEn         *time.Time `json:"notificado_en"`
	CompromisoOfrecidoID *string    `json:"compromiso_ofrecido_id"`
}

// El armado desde la fila de la base vive en el service (igual que la agenda):
// el paquete dto no conoce repository.
