package handler

import (
	"net/http"
	"strings"
	"time"

	"copiloto/core/internal/apierror"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// CobrosHandler expone el cobro del compromiso y el cierre del día. Todo
// tenant-scoped: el negocio sale del token, jamás del body.
type CobrosHandler struct{ svc service.CobroService }

func NewCobrosHandler(svc service.CobroService) *CobrosHandler {
	return &CobrosHandler{svc: svc}
}

// Register cuelga las rutas del grupo /api ya autenticado y con tenant.
func (h *CobrosHandler) Register(rg *gin.RouterGroup) {
	rg.POST("/cobros", h.Cobrar)
	rg.GET("/cobros/:compromiso_id", h.PorCompromiso)
	rg.GET("/cierre", h.Cierre)
}

func (h *CobrosHandler) Cobrar(c *gin.Context) {
	var in dto.CobrarInput
	if !bindMotorJSON(c, &in) {
		return
	}

	// El agente cobra sin usuario del panel: claims.UserID viene vacío y el
	// cobro queda sin usuario_id, que es exactamente lo que pasó.
	var usuarioID *string
	if claims := middleware.GetClaims(c); claims != nil && claims.UserID != "" {
		u := claims.UserID
		usuarioID = &u
	}

	resp, err := h.svc.Cobrar(c.Request.Context(), middleware.NegocioID(c), usuarioID, in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *CobrosHandler) PorCompromiso(c *gin.Context) {
	resp, err := h.svc.PorCompromiso(c.Request.Context(), middleware.NegocioID(c), c.Param("compromiso_id"))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// Cierre acepta ?fecha=YYYY-MM-DD. Sin fecha, hoy: el día se resuelve en la
// timezone del negocio dentro del service.
func (h *CobrosHandler) Cierre(c *gin.Context) {
	fecha := time.Now()
	if raw := strings.TrimSpace(c.Query("fecha")); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, apierror.New("Fecha invalida: se espera YYYY-MM-DD"))
			return
		}
		fecha = t
	}

	resp, err := h.svc.CierreDelDia(c.Request.Context(), middleware.NegocioID(c), fecha)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}
