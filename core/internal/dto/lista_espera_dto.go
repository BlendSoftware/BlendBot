package dto

import (
	"time"

	"copiloto/core/internal/model"
)

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

// ListaEsperaResponse es un anotado de la cola.
type ListaEsperaResponse struct {
	ID                   string     `json:"id"`
	NegocioID            string     `json:"negocio_id"`
	ClienteID            string     `json:"cliente_id"`
	ServicioID           string     `json:"servicio_id"`
	Nota                 *string    `json:"nota"`
	CreadoEn             time.Time  `json:"creado_en"`
	NotificadoEn         *time.Time `json:"notificado_en"`
	CompromisoOfrecidoID *string    `json:"compromiso_ofrecido_id"`
}

// ListaEsperaDesdeModel arma la respuesta a partir del modelo.
func ListaEsperaDesdeModel(le *model.ListaEspera) *ListaEsperaResponse {
	if le == nil {
		return nil
	}
	return &ListaEsperaResponse{
		ID:                   le.ID,
		NegocioID:            le.NegocioID,
		ClienteID:            le.ClienteID,
		ServicioID:           le.ServicioID,
		Nota:                 le.Nota,
		CreadoEn:             le.CreadoEn,
		NotificadoEn:         le.NotificadoEn,
		CompromisoOfrecidoID: le.CompromisoOfrecidoID,
	}
}

// ListaEsperaDesdeModelos mapea la cola completa.
func ListaEsperaDesdeModelos(les []model.ListaEspera) []ListaEsperaResponse {
	out := make([]ListaEsperaResponse, 0, len(les))
	for i := range les {
		out = append(out, *ListaEsperaDesdeModel(&les[i]))
	}
	return out
}
