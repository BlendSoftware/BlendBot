package dto

import (
	"time"

	"copiloto/core/internal/model"
)

// CrearHoldInput bloquea un hueco mientras el cliente completa sus datos.
// La expiración no viaja: la pone el core desde negocio.config.hold_minutos.
type CrearHoldInput struct {
	RecursoID string    `json:"recurso_id" binding:"required,uuid"`
	Inicio    time.Time `json:"inicio" binding:"required"`
	Fin       time.Time `json:"fin" binding:"required"`
	Sesion    string    `json:"sesion" binding:"required"`
}

// HoldResponse es el bloqueo vigente.
type HoldResponse struct {
	ID        string    `json:"id"`
	RecursoID string    `json:"recurso_id"`
	Inicio    time.Time `json:"inicio"`
	Fin       time.Time `json:"fin"`
	ExpiraEn  time.Time `json:"expira_en"`
	Sesion    string    `json:"sesion"`
}

// HoldDesdeModel arma la respuesta a partir del modelo.
func HoldDesdeModel(h *model.Hold) *HoldResponse {
	if h == nil {
		return nil
	}
	return &HoldResponse{
		ID:        h.ID,
		RecursoID: h.RecursoID,
		Inicio:    h.Inicio,
		Fin:       h.Fin,
		ExpiraEn:  h.ExpiraEn,
		Sesion:    h.Sesion,
	}
}
