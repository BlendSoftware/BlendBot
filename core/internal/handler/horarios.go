package handler

import (
	"net/http"
	"time"

	"copiloto/core/internal/apierror"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// HorariosHandler expone la disponibilidad declarada de un recurso: la agenda
// semanal y los bloqueos puntuales. Es CRUD plano sobre datos del tenant, así
// que va directo al repositorio: no hay regla de negocio que mediar.
type HorariosHandler struct{ repo repository.HorarioRepository }

func NewHorariosHandler(repo repository.HorarioRepository) *HorariosHandler {
	return &HorariosHandler{repo: repo}
}

// Register cuelga las rutas de disponibilidad del grupo /api ya autenticado.
func (h *HorariosHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/recursos/:id/horarios", h.ListarHorarios)
	rg.POST("/recursos/:id/horarios", h.CrearHorario)
	rg.DELETE("/recursos/:id/horarios/:horario_id", h.BorrarHorario)

	rg.GET("/recursos/:id/excepciones", h.ListarExcepciones)
	rg.POST("/recursos/:id/excepciones", h.CrearExcepcion)
	rg.DELETE("/recursos/:id/excepciones/:excepcion_id", h.BorrarExcepcion)
}

func (h *HorariosHandler) ListarHorarios(c *gin.Context) {
	negocioID, recursoID := middleware.NegocioID(c), c.Param("id")
	if !h.recursoDelTenant(c, negocioID, recursoID) {
		return
	}
	hs, err := h.repo.ListHorarios(c.Request.Context(), negocioID, recursoID)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.HorariosDesdeModelos(hs))
}

func (h *HorariosHandler) CrearHorario(c *gin.Context) {
	var in dto.CrearHorarioInput
	if !bindMotorJSON(c, &in) {
		return
	}
	desde, ok := normalizarHora(c, "desde", in.Desde)
	if !ok {
		return
	}
	hasta, ok := normalizarHora(c, "hasta", in.Hasta)
	if !ok {
		return
	}
	if desde >= hasta {
		c.JSON(http.StatusBadRequest, apierror.New("hasta tiene que ser posterior a desde"))
		return
	}

	negocioID, recursoID := middleware.NegocioID(c), c.Param("id")
	if !h.recursoDelTenant(c, negocioID, recursoID) {
		return
	}

	horario := &model.Horario{
		RecursoID: recursoID,
		DiaSemana: in.DiaSemana,
		Desde:     desde,
		Hasta:     hasta,
	}
	if err := h.repo.CreateHorario(c.Request.Context(), negocioID, horario); err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, dto.HorarioDesdeModel(horario))
}

func (h *HorariosHandler) BorrarHorario(c *gin.Context) {
	negocioID, recursoID := middleware.NegocioID(c), c.Param("id")
	borrado, err := h.repo.DeleteHorario(c.Request.Context(), negocioID, recursoID, c.Param("horario_id"))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	if !borrado {
		responderErrorMotor(c, service.ErrNoEncontrado)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *HorariosHandler) ListarExcepciones(c *gin.Context) {
	negocioID, recursoID := middleware.NegocioID(c), c.Param("id")
	if !h.recursoDelTenant(c, negocioID, recursoID) {
		return
	}
	desde, ok := parseFechaQuery(c, "desde")
	if !ok {
		return
	}
	hasta, ok := parseFechaQuery(c, "hasta")
	if !ok {
		return
	}
	es, err := h.repo.ListExcepciones(c.Request.Context(), negocioID, recursoID, desde, hasta)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ExcepcionesDesdeModelos(c.Request.Context(), es))
}

func (h *HorariosHandler) CrearExcepcion(c *gin.Context) {
	var in dto.CrearExcepcionInput
	if !bindMotorJSON(c, &in) {
		return
	}
	if !in.Hasta.After(in.Desde) {
		c.JSON(http.StatusBadRequest, apierror.New("hasta tiene que ser posterior a desde"))
		return
	}

	negocioID, recursoID := middleware.NegocioID(c), c.Param("id")
	if !h.recursoDelTenant(c, negocioID, recursoID) {
		return
	}

	exc := &model.Excepcion{
		RecursoID: recursoID,
		Desde:     in.Desde,
		Hasta:     in.Hasta,
		Motivo:    in.Motivo,
	}
	if err := h.repo.CreateExcepcion(c.Request.Context(), negocioID, exc); err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, dto.ExcepcionDesdeModel(c.Request.Context(), exc))
}

func (h *HorariosHandler) BorrarExcepcion(c *gin.Context) {
	negocioID, recursoID := middleware.NegocioID(c), c.Param("id")
	borrado, err := h.repo.DeleteExcepcion(c.Request.Context(), negocioID, recursoID, c.Param("excepcion_id"))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	if !borrado {
		responderErrorMotor(c, service.ErrNoEncontrado)
		return
	}
	c.Status(http.StatusNoContent)
}

// recursoDelTenant corta con 404 si el recurso no es de este negocio: desde
// afuera "de otro tenant" y "no existe" tienen que ser indistinguibles.
func (h *HorariosHandler) recursoDelTenant(c *gin.Context, negocioID, recursoID string) bool {
	ok, err := h.repo.RecursoActivo(c.Request.Context(), negocioID, recursoID)
	if err != nil {
		responderErrorMotor(c, err)
		return false
	}
	if !ok {
		responderErrorMotor(c, service.ErrNoEncontrado)
		return false
	}
	return true
}

// normalizarHora acepta "HH:MM" o "HH:MM:SS" y devuelve siempre "HH:MM:SS".
func normalizarHora(c *gin.Context, campo, valor string) (string, bool) {
	for _, layout := range []string{"15:04:05", "15:04"} {
		if t, err := time.Parse(layout, valor); err == nil {
			return t.Format("15:04:05"), true
		}
	}
	c.JSON(http.StatusBadRequest, apierror.New("Hora invalida en "+campo+": se espera HH:MM"))
	return "", false
}
