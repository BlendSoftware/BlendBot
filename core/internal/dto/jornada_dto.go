package dto

import (
	"time"

	"copiloto/core/internal/model"
)

// JornadaResponse es la caja del día tal como la ve el panel. Abierta resume el
// estado (CerradaEn nil) para que el panel no tenga que compararlo.
type JornadaResponse struct {
	ID         string     `json:"id"`
	NegocioID  string     `json:"negocio_id"`
	Abierta    bool       `json:"abierta"`
	AbiertaEn  time.Time  `json:"abierta_en"`
	CerradaEn  *time.Time `json:"cerrada_en"`
	AbiertaPor *string    `json:"abierta_por"`
	CerradaPor *string    `json:"cerrada_por"`
}

// JornadaDesdeModel mapea la jornada; nil devuelve nil.
func JornadaDesdeModel(j *model.Jornada) *JornadaResponse {
	if j == nil {
		return nil
	}
	return &JornadaResponse{
		ID:         j.ID,
		NegocioID:  j.NegocioID,
		Abierta:    j.Abierta(),
		AbiertaEn:  j.AbiertaEn,
		CerradaEn:  j.CerradaEn,
		AbiertaPor: j.AbiertaPor,
		CerradaPor: j.CerradaPor,
	}
}

// JornadaActualResponse es GET /api/jornada/actual: Abierta es lo primero que
// mira el panel para decidir si muestra "Cerrar día" o "Abrir día". Jornada es
// nil cuando la caja está cerrada.
type JornadaActualResponse struct {
	Abierta bool             `json:"abierta"`
	Jornada *JornadaResponse `json:"jornada"`
}
