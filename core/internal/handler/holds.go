package handler

import (
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// HoldsHandler expone el bloqueo temporal de un hueco.
type HoldsHandler struct{ svc service.HoldService }

func NewHoldsHandler(svc service.HoldService) *HoldsHandler { return &HoldsHandler{svc: svc} }

// Register cuelga las rutas de holds del grupo /api ya autenticado.
func (h *HoldsHandler) Register(rg *gin.RouterGroup) {
	rg.POST("/holds", h.Crear)
	rg.DELETE("/holds/:id", h.Liberar)
}

func (h *HoldsHandler) Crear(c *gin.Context) {
	var in dto.CrearHoldInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.svc.Crear(
		c.Request.Context(),
		middleware.NegocioID(c),
		in.RecursoID,
		in.Inicio,
		in.Fin,
		in.Sesion,
	)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, resp)
}

// Liberar acepta ?sesion= para que un cliente sólo pueda soltar su propio
// bloqueo. Sin el parámetro libera cualquiera del negocio (uso del panel).
func (h *HoldsHandler) Liberar(c *gin.Context) {
	err := h.svc.Liberar(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), c.Query("sesion"))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
