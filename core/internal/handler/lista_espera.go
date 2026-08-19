package handler

import (
	"net/http"
	"strings"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// ListaEsperaHandler expone la cola del anti-ausentismo: quién quiere ese
// servicio si se libera un hueco.
type ListaEsperaHandler struct{ svc service.ListaEsperaService }

func NewListaEsperaHandler(svc service.ListaEsperaService) *ListaEsperaHandler {
	return &ListaEsperaHandler{svc: svc}
}

// Register cuelga las rutas del grupo /api ya autenticado y con tenant.
func (h *ListaEsperaHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/lista-espera", h.Listar)
	rg.POST("/lista-espera", h.Anotar)
	rg.DELETE("/lista-espera/:id", h.Borrar)
}

// Listar acepta ?servicio_id= y ?pendientes=true (los que todavía no
// recibieron una oferta).
func (h *ListaEsperaHandler) Listar(c *gin.Context) {
	f := dto.FiltroListaEspera{
		ServicioID:     strings.TrimSpace(c.Query("servicio_id")),
		SoloPendientes: c.Query("pendientes") == "true",
	}
	resp, err := h.svc.Listar(c.Request.Context(), middleware.NegocioID(c), f)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *ListaEsperaHandler) Anotar(c *gin.Context) {
	var in dto.AnotarEnListaEsperaInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.svc.Anotar(c.Request.Context(), middleware.NegocioID(c), in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *ListaEsperaHandler) Borrar(c *gin.Context) {
	if err := h.svc.Borrar(c.Request.Context(), middleware.NegocioID(c), c.Param("id")); err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
