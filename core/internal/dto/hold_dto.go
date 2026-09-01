package dto

import (
	"context"
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
	Inicio    Hora      `json:"inicio"`
	Fin       Hora      `json:"fin"`
	ExpiraEn  Hora      `json:"expira_en"`
	Sesion    string    `json:"sesion"`
}

// HoldDesdeModel arma la respuesta a partir del modelo.
func HoldDesdeModel(ctx context.Context, h *model.Hold) *HoldResponse {
	if h == nil {
		return nil
	}
	return &HoldResponse{
		ID:        h.ID,
		RecursoID: h.RecursoID,
		Inicio:    HoraDe(ctx, h.Inicio),
		Fin:       HoraDe(ctx, h.Fin),
		ExpiraEn:  HoraDe(ctx, h.ExpiraEn),
		Sesion:    h.Sesion,
	}
}
