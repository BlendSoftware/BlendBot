package handler

import (
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// StockHandler es la Capa 1 del control de stock: el cupo del día por plato.
//
// Tenant-scoped como todo el grupo: el negocio sale del token, nunca de la URL.
// Va en el grupo del mostrador y no en el de plata — poner cuántas milanesas
// quedan es trabajo del que cocina, no de quien mira la caja.
//
// No se audita: la lista de audit_log es corta a propósito (principio de
// mínimo dato) y un cupo no es un dato sensible de nadie.
type StockHandler struct{ svc service.CupoService }

func NewStockHandler(svc service.CupoService) *StockHandler {
	return &StockHandler{svc: svc}
}

func (h *StockHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/stock", h.DelDia)
	rg.PUT("/stock/cupos", h.SetCupo)
	rg.DELETE("/stock/cupos/:servicio_id", h.QuitarCupo)
}

func (h *StockHandler) DelDia(c *gin.Context) {
	resp, err := h.svc.DelDia(c.Request.Context(), middleware.NegocioID(c))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *StockHandler) SetCupo(c *gin.Context) {
	var in dto.SetCupoInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.svc.Set(c.Request.Context(), middleware.NegocioID(c), in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *StockHandler) QuitarCupo(c *gin.Context) {
	servicioID, ok := idDeRuta(c, "servicio_id")
	if !ok {
		return
	}
	if err := h.svc.Quitar(c.Request.Context(), middleware.NegocioID(c), servicioID); err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
