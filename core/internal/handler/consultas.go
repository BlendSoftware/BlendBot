package handler

import (
	"net/http"
	"strings"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// ConsultasHandler expone el inbox de preguntas que el bot no supo responder.
// El agente las deja (POST); el dueño las lista y responde.
type ConsultasHandler struct{ svc service.ConsultaService }

func NewConsultasHandler(svc service.ConsultaService) *ConsultasHandler {
	return &ConsultasHandler{svc: svc}
}

// Register cuelga las rutas del grupo /api ya autenticado y con tenant. Los
// permisos por rol van por ruta: crear lo hacen el agente (por su allowlist) y
// el dueño; listar el dueño y el operador; responder sólo el dueño.
func (h *ConsultasHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/consultas", h.Listar)
	rg.POST("/consultas", middleware.RequireRole(middleware.RolDueno, middleware.RolAdmin, middleware.RolAgente), h.Crear)
	rg.PATCH("/consultas/:id/responder", middleware.RequireRole(middleware.RolDueno, middleware.RolAdmin), h.Responder)
}

// Listar acepta ?estado=pendiente|respondida (vacío = todas).
func (h *ConsultasHandler) Listar(c *gin.Context) {
	f := dto.FiltroConsultas{Estado: strings.TrimSpace(c.Query("estado"))}
	resp, err := h.svc.Listar(c.Request.Context(), middleware.NegocioID(c), f)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *ConsultasHandler) Crear(c *gin.Context) {
	var in dto.CrearConsultaInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.svc.Crear(c.Request.Context(), middleware.NegocioID(c), in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *ConsultasHandler) Responder(c *gin.Context) {
	var in dto.ResponderConsultaInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.svc.Responder(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}
