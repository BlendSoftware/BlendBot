package handler

import (
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// AdminNegociosHandler es el panel de la plataforma: alta y baja de tenants.
// El grupo tiene que venir con RequireRole(middleware.RolAdmin) puesto por el
// router — este handler asume que ya se validó el rol.
type AdminNegociosHandler struct {
	svc   service.NegocioService
	audit service.AuditService
}

func NewAdminNegociosHandler(svc service.NegocioService, audit service.AuditService) *AdminNegociosHandler {
	return &AdminNegociosHandler{svc: svc, audit: audit}
}

func (h *AdminNegociosHandler) Register(rg *gin.RouterGroup) {
	rg.GET("", h.Listar)
	rg.POST("", h.Alta)
	rg.PATCH("/:id", h.Actualizar)
	rg.DELETE("/:id", h.Baja)
}

func (h *AdminNegociosHandler) Listar(c *gin.Context) {
	negocios, err := h.svc.List(c.Request.Context())
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, negocios)
}

func (h *AdminNegociosHandler) Alta(c *gin.Context) {
	var req dto.AltaNegocioRequest
	if !bindJSON(c, &req) {
		return
	}
	resp, err := h.svc.Alta(c.Request.Context(), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: resp.NegocioID,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionNegocioAlta,
		Entidad:   "negocio",
		EntidadID: resp.NegocioID,
		Detalle:   map[string]any{"nombre": resp.Nombre, "vertical": resp.Vertical},
	})

	c.JSON(http.StatusCreated, resp)
}

func (h *AdminNegociosHandler) Actualizar(c *gin.Context) {
	id := c.Param("id")
	var req dto.ActualizarNegocioRequest
	if !bindJSON(c, &req) {
		return
	}
	n, err := h.svc.Update(c.Request.Context(), id, req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: n.ID,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionNegocioActualizar,
		Entidad:   "negocio",
		EntidadID: n.ID,
	})

	c.JSON(http.StatusOK, n)
}

func (h *AdminNegociosHandler) Baja(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.Baja(c.Request.Context(), id); err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: id,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionNegocioBaja,
		Entidad:   "negocio",
		EntidadID: id,
	})

	c.Status(http.StatusNoContent)
}
