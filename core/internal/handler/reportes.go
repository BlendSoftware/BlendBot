package handler

import (
	"net/http"
	"strings"

	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// ReportesHandler devuelve los informes por día (vendido y cobrado) que el
// panel dibuja debajo del cierre. Tenant-scoped.
type ReportesHandler struct{ svc service.ReporteService }

func NewReportesHandler(svc service.ReporteService) *ReportesHandler {
	return &ReportesHandler{svc: svc}
}

// Register cuelga la ruta del grupo /api ya autenticado y con tenant.
func (h *ReportesHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/reportes", h.Reportes)
}

// Reportes exige ?rango=semanal|mensual. El service valida el rango y devuelve
// ErrRangoInvalido (422) si no es ninguno de los dos.
func (h *ReportesHandler) Reportes(c *gin.Context) {
	rango := strings.TrimSpace(c.Query("rango"))
	resp, err := h.svc.PorRango(c.Request.Context(), middleware.NegocioID(c), rango)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}
