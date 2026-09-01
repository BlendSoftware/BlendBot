package dto

import (
	"context"
	"time"

	"copiloto/core/internal/model"
)

// CrearHorarioInput es una franja semanal recurrente de un recurso.
// Desde/Hasta van como "HH:MM" o "HH:MM:SS" (tipo TIME en la base).
type CrearHorarioInput struct {
	DiaSemana int    `json:"dia_semana" binding:"min=0,max=6"`
	Desde     string `json:"desde" binding:"required"`
	Hasta     string `json:"hasta" binding:"required"`
}

// HorarioResponse expone la franja.
type HorarioResponse struct {
	ID        string `json:"id"`
	RecursoID string `json:"recurso_id"`
	DiaSemana int    `json:"dia_semana"`
	Desde     string `json:"desde"`
	Hasta     string `json:"hasta"`
}

// CrearExcepcionInput bloquea un rango puntual: feriado, congreso, vacaciones.
type CrearExcepcionInput struct {
	Desde  time.Time `json:"desde" binding:"required"`
	Hasta  time.Time `json:"hasta" binding:"required"`
	Motivo *string   `json:"motivo"`
}

// ExcepcionResponse expone el bloqueo puntual.
type ExcepcionResponse struct {
	ID        string    `json:"id"`
	RecursoID string    `json:"recurso_id"`
	Desde     Hora      `json:"desde"`
	Hasta     Hora      `json:"hasta"`
	Motivo    *string   `json:"motivo"`
}

// HorarioDesdeModel arma la respuesta a partir del modelo.
func HorarioDesdeModel(h *model.Horario) *HorarioResponse {
	if h == nil {
		return nil
	}
	return &HorarioResponse{
		ID:        h.ID,
		RecursoID: h.RecursoID,
		DiaSemana: h.DiaSemana,
		Desde:     h.Desde,
		Hasta:     h.Hasta,
	}
}

// HorariosDesdeModelos mapea la agenda semanal de un recurso.
func HorariosDesdeModelos(hs []model.Horario) []HorarioResponse {
	out := make([]HorarioResponse, 0, len(hs))
	for i := range hs {
		out = append(out, *HorarioDesdeModel(&hs[i]))
	}
	return out
}

// ExcepcionDesdeModel arma la respuesta a partir del modelo.
func ExcepcionDesdeModel(ctx context.Context, e *model.Excepcion) *ExcepcionResponse {
	if e == nil {
		return nil
	}
	return &ExcepcionResponse{
		ID:        e.ID,
		RecursoID: e.RecursoID,
		Desde:     HoraDe(ctx, e.Desde),
		Hasta:     HoraDe(ctx, e.Hasta),
		Motivo:    e.Motivo,
	}
}

// ExcepcionesDesdeModelos mapea los bloqueos de un recurso.
func ExcepcionesDesdeModelos(ctx context.Context, es []model.Excepcion) []ExcepcionResponse {
	out := make([]ExcepcionResponse, 0, len(es))
	for i := range es {
		out = append(out, *ExcepcionDesdeModel(ctx, &es[i]))
	}
	return out
}
