package handler

import (
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// ClientesHandler: la ficha del que escribe. Toda lectura queda auditada
// (Ley 25.326) — en salud, quién leyó qué ficha y cuándo no es opcional.
type ClientesHandler struct {
	svc   service.ClienteService
	audit service.AuditService
}

func NewClientesHandler(svc service.ClienteService, audit service.AuditService) *ClientesHandler {
	return &ClientesHandler{svc: svc, audit: audit}
}

func (h *ClientesHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/clientes/por-telefono/:tel", h.PorTelefono)
	rg.POST("/clientes", h.Crear)
	rg.PATCH("/clientes/:id", h.Actualizar)
}

func (h *ClientesHandler) PorTelefono(c *gin.Context) {
	negocioID := middleware.NegocioID(c)
	cli, err := h.svc.BuscarPorTelefono(c.Request.Context(), negocioID, c.Param("tel"))
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: negocioID,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionClienteLeer,
		Entidad:   "cliente",
		EntidadID: cli.ID,
	})

	c.JSON(http.StatusOK, cli)
}

func (h *ClientesHandler) Crear(c *gin.Context) {
	var req dto.CrearClienteRequest
	if !bindJSON(c, &req) {
		return
	}
	negocioID := middleware.NegocioID(c)
	cli, err := h.svc.Crear(c.Request.Context(), negocioID, req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: negocioID,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionClienteCrear,
		Entidad:   "cliente",
		EntidadID: cli.ID,
	})

	c.JSON(http.StatusCreated, cli)
}

func (h *ClientesHandler) Actualizar(c *gin.Context) {
	var req dto.ActualizarClienteRequest
	if !bindJSON(c, &req) {
		return
	}
	negocioID := middleware.NegocioID(c)
	id := c.Param("id")
	cli, err := h.svc.Actualizar(c.Request.Context(), negocioID, id, req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: negocioID,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionClienteActualizar,
		Entidad:   "cliente",
		EntidadID: id,
	})

	c.JSON(http.StatusOK, cli)
}
