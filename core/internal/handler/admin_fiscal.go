package handler

import (
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// accionFiscalConfigurar se audita sí o sí: cargar un certificado es habilitar
// a facturar a nombre de un CUIT.
const accionFiscalConfigurar = "negocio.fiscal.configurar"

// AdminFiscalHandler carga la configuración de ARCA de un negocio. Cuelga del
// grupo admin de negocios, que ya trae RequireRole(middleware.RolAdmin).
//
// Los certificados ENTRAN por acá y no salen nunca: se guardan cifrados y el
// GET sólo dice si están cargados.
type AdminFiscalHandler struct {
	svc   service.CobroService
	audit service.AuditService
}

func NewAdminFiscalHandler(svc service.CobroService, audit service.AuditService) *AdminFiscalHandler {
	return &AdminFiscalHandler{svc: svc, audit: audit}
}

// Register cuelga rutas RELATIVAS al grupo admin de negocios.
func (h *AdminFiscalHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/:id/fiscal", h.Obtener)
	rg.PUT("/:id/fiscal", h.Configurar)
}

func (h *AdminFiscalHandler) Obtener(c *gin.Context) {
	resp, err := h.svc.ObtenerFiscal(c.Request.Context(), c.Param("id"))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *AdminFiscalHandler) Configurar(c *gin.Context) {
	id := c.Param("id")
	var in dto.ConfigFiscalInput
	if !bindMotorJSON(c, &in) {
		return
	}

	resp, err := h.svc.ConfigurarFiscal(c.Request.Context(), id, in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}

	// El detalle NO lleva los PEM ni el CUIT completo: la auditoría registra
	// que alguien tocó la configuración fiscal, no su contenido.
	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: id,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    accionFiscalConfigurar,
		Entidad:   "config_fiscal",
		EntidadID: id,
		Detalle: map[string]any{
			"punto_venta":        resp.PuntoVenta,
			"modo":               resp.Modo,
			"tiene_certificados": resp.TieneCertificados,
		},
	})

	c.JSON(http.StatusOK, resp)
}
