package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"copiloto/core/internal/apierror"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// CompromisosHandler expone el motor: crear, ver el tablero y transicionar.
type CompromisosHandler struct{ svc service.MotorService }

func NewCompromisosHandler(svc service.MotorService) *CompromisosHandler {
	return &CompromisosHandler{svc: svc}
}

// Register cuelga las rutas del motor del grupo /api ya autenticado.
func (h *CompromisosHandler) Register(rg *gin.RouterGroup) {
	rg.POST("/compromisos", h.Crear)
	rg.GET("/compromisos", h.Listar)
	rg.GET("/compromisos/:id", h.Obtener)
	rg.PATCH("/compromisos/:id/estado", h.Transicionar)
}

func (h *CompromisosHandler) Crear(c *gin.Context) {
	var in dto.CrearCompromisoInput
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

func (h *CompromisosHandler) Listar(c *gin.Context) {
	filtro := dto.FiltroCompromisos{}

	for _, raw := range c.QueryArray("estado") {
		for _, e := range strings.Split(raw, ",") {
			e = strings.TrimSpace(e)
			if e == "" {
				continue
			}
			estado, ok := estadoValido(e)
			if !ok {
				c.JSON(http.StatusBadRequest, apierror.New("Estado invalido: "+e))
				return
			}
			filtro.Estados = append(filtro.Estados, estado)
		}
	}

	desde, ok := parseFechaQuery(c, "desde")
	if !ok {
		return
	}
	hasta, ok := parseFechaQuery(c, "hasta")
	if !ok {
		return
	}
	filtro.Desde, filtro.Hasta = desde, hasta

	resp, err := h.svc.Listar(c.Request.Context(), middleware.NegocioID(c), filtro)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *CompromisosHandler) Obtener(c *gin.Context) {
	resp, err := h.svc.Obtener(c.Request.Context(), middleware.NegocioID(c), c.Param("id"))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *CompromisosHandler) Transicionar(c *gin.Context) {
	var in dto.TransicionarInput
	if !bindMotorJSON(c, &in) {
		return
	}
	estado, ok := estadoValido(string(in.Estado))
	if !ok {
		c.JSON(http.StatusBadRequest, apierror.New("Estado invalido: "+string(in.Estado)))
		return
	}

	resp, err := h.svc.Transicionar(
		c.Request.Context(),
		middleware.NegocioID(c),
		c.Param("id"),
		estado,
		service.OpcionesTransicion{DemoraMin: in.DemoraMin, RecursoID: in.RecursoID},
	)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// ── helpers del motor ─────────────────────────────────────────────────────

// bindMotorJSON parsea y valida el cuerpo; responde 400 y devuelve false si no.
func bindMotorJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		c.JSON(http.StatusBadRequest, apierror.New("Cuerpo invalido: "+err.Error()))
		return false
	}
	return true
}

// responderErrorMotor traduce los sentinel del service a HTTP. Cualquier otro
// error es un 400 con el mensaje del dominio: los internos no llegan acá.
func responderErrorMotor(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNoEncontrado):
		c.JSON(http.StatusNotFound, apierror.New(err.Error()))
	case errors.Is(err, service.ErrTransicionInvalida):
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrSolapado):
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrNoDisponible):
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	default:
		c.JSON(http.StatusBadRequest, apierror.New(err.Error()))
	}
}

func estadoValido(s string) (model.EstadoCompromiso, bool) {
	for _, e := range model.EstadosValidos() {
		if string(e) == s {
			return e, true
		}
	}
	return "", false
}

// parseFechaQuery lee un parámetro de fecha en RFC3339 (o YYYY-MM-DD).
func parseFechaQuery(c *gin.Context, nombre string) (*time.Time, bool) {
	raw := strings.TrimSpace(c.Query(nombre))
	if raw == "" {
		return nil, true
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return &t, true
		}
	}
	c.JSON(http.StatusBadRequest, apierror.New("Fecha invalida en "+nombre))
	return nil, false
}
