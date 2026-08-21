package handler

import (
	"net/http"

	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// JornadaHandler es la caja del día: abrirla, ver cuál está abierta, cerrarla.
// Todo tenant-scoped: el negocio sale del token, jamás del body.
type JornadaHandler struct{ svc service.JornadaService }

func NewJornadaHandler(svc service.JornadaService) *JornadaHandler {
	return &JornadaHandler{svc: svc}
}

// Register cuelga las rutas del grupo /api ya autenticado y con tenant.
func (h *JornadaHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/jornada/actual", h.Actual)
	rg.POST("/jornada/abrir", h.Abrir)
	rg.POST("/jornada/cerrar", h.Cerrar)
}

func (h *JornadaHandler) Actual(c *gin.Context) {
	resp, err := h.svc.Actual(c.Request.Context(), middleware.NegocioID(c))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *JornadaHandler) Abrir(c *gin.Context) {
	resp, err := h.svc.Abrir(c.Request.Context(), middleware.NegocioID(c), usuarioDelPanel(c))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *JornadaHandler) Cerrar(c *gin.Context) {
	resp, err := h.svc.Cerrar(c.Request.Context(), middleware.NegocioID(c), usuarioDelPanel(c))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// usuarioDelPanel devuelve el id del usuario que operó, o nil cuando la caja la
// movió algo sin usuario del panel (mismo criterio que el cobro).
func usuarioDelPanel(c *gin.Context) *string {
	if claims := middleware.GetClaims(c); claims != nil && claims.UserID != "" {
		u := claims.UserID
		return &u
	}
	return nil
}
