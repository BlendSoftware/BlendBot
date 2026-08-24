package handler

import (
	"errors"
	"net/http"

	"copiloto/core/internal/apierror"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// DisponibilidadHandler expone la agenda: los huecos que el agente ofrece y el
// día que ve el panel. El tenant sale del token — un negocio jamás calcula
// disponibilidad sobre recursos de otro.
type DisponibilidadHandler struct{ svc service.DisponibilidadService }

func NewDisponibilidadHandler(svc service.DisponibilidadService) *DisponibilidadHandler {
	return &DisponibilidadHandler{svc: svc}
}

// Register cuelga las rutas del grupo /api ya autenticado y con tenant.
func (h *DisponibilidadHandler) Register(rg *gin.RouterGroup) {
	rg.POST("/disponibilidad/consultar", h.Consultar)
	rg.GET("/agenda", h.Agenda)
}

func (h *DisponibilidadHandler) Consultar(c *gin.Context) {
	var in dto.ConsultarDisponibilidadInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.svc.Consultar(c.Request.Context(), middleware.NegocioID(c), in)
	if err != nil {
		responderErrorDisponibilidad(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *DisponibilidadHandler) Agenda(c *gin.Context) {
	fecha, ok := parseFechaQuery(c, "fecha")
	if !ok {
		return
	}
	// Sin fecha va nil: el "hoy" lo resuelve el service en la timezone del
	// negocio. Resolverlo acá con time.Now() daba el día del contenedor (H11).
	resp, err := h.svc.AgendaDelDia(c.Request.Context(), middleware.NegocioID(c), fecha)
	if err != nil {
		responderErrorDisponibilidad(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// responderErrorDisponibilidad suma ErrSinDuracion (422: falta cargar la
// duración en el catálogo) al mapeo de errores del motor.
func responderErrorDisponibilidad(c *gin.Context, err error) {
	if errors.Is(err, service.ErrSinDuracion) {
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
		return
	}
	responderErrorMotor(c, err)
}
