package handler

import (
	"net/http"

	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// accionTokenAgenteRotar se audita sí o sí: emitir un token es dar acceso a
// todo el tenant, y el token en claro se muestra una sola vez.
const accionTokenAgenteRotar = "negocio.token_agente.rotar"

// AdminTokenHandler rota la credencial del agente MCP de un negocio.
// Cuelga del grupo admin existente (/api/admin/negocios), que ya trae
// RequireRole(middleware.RolAdmin) puesto por el router.
type AdminTokenHandler struct {
	svc   service.NegocioTokenService
	audit service.AuditService
}

func NewAdminTokenHandler(svc service.NegocioTokenService, audit service.AuditService) *AdminTokenHandler {
	return &AdminTokenHandler{svc: svc, audit: audit}
}

// Register cuelga rutas RELATIVAS al grupo admin de negocios.
func (h *AdminTokenHandler) Register(rg *gin.RouterGroup) {
	rg.POST("/:id/token-agente", h.Rotar)
}

func (h *AdminTokenHandler) Rotar(c *gin.Context) {
	id := c.Param("id")
	resp, err := h.svc.RotarTokenAgente(c.Request.Context(), id)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: id,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    accionTokenAgenteRotar,
		Entidad:   "negocio",
		EntidadID: id,
	})

	c.JSON(http.StatusOK, resp)
}
