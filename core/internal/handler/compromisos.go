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
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// idDeRuta devuelve el :param de la ruta si es un uuid, y corta con 404 si no.
//
// Sin esto el id viajaba crudo hasta Postgres, que lo rechazaba con
// `invalid input syntax for type uuid (SQLSTATE 22P02)` — un 400 con el error
// de la base adentro. Un id que no es un id es, desde afuera, indistinguible
// de uno que no existe: 404 y listo.
func idDeRuta(c *gin.Context, param string) (string, bool) {
	v := c.Param(param)
	if _, err := uuid.Parse(v); err != nil {
		c.JSON(http.StatusNotFound, apierror.New("no encontrado"))
		return "", false
	}
	return v, true
}

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
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	resp, err := h.svc.Obtener(c.Request.Context(), middleware.NegocioID(c), id)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *CompromisosHandler) Transicionar(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	var in dto.TransicionarInput
	if !bindMotorJSON(c, &in) {
		return
	}
	estado, valido := estadoValido(string(in.Estado))
	if !valido {
		c.JSON(http.StatusBadRequest, apierror.New("Estado invalido: "+string(in.Estado)))
		return
	}

	resp, err := h.svc.Transicionar(
		c.Request.Context(),
		middleware.NegocioID(c),
		id,
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
	case errors.Is(err, service.ErrDeliveryNoAceptado):
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	case errors.Is(err, service.ErrCantidadExcesivaPorLinea):
		// 422, mismo criterio que ErrNoDisponible y ErrDeliveryNoAceptado: lo
		// que está mal es el INPUT (pidió de más), no el estado del compromiso.
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	case errors.Is(err, service.ErrYaCobrado), errors.Is(err, service.ErrNoCobrable):
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrSinCupo):
		// 409: el pedido es válido, lo que pasó es que otro se llevó la última
		// porción. Es una carrera perdida, no un body mal armado.
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrSinStock):
		// Mismo caso que ErrSinCupo pero por la Capa 2: no alcanza la materia
		// prima de algún plato. El mensaje viaja tal cual porque NOMBRA el
		// insumo que faltó, y ese nombre es toda la diferencia entre "no se
		// pudo" y "andá a comprar pan".
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrCupoMenorAlConsumido):
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	case errors.Is(err, service.ErrPlatoConCupo),
		errors.Is(err, service.ErrPlatoConReceta),
		errors.Is(err, service.ErrInsumoConRecetas),
		errors.Is(err, service.ErrInsumoRepetido):
		// 409: el estado actual del plato o del insumo es incompatible con lo
		// que se pidió. El mensaje viaja tal cual porque dice CUÁL de los dos
		// hay que sacar — un "no se puede" pelado deja al dueño adivinando.
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrUnidadInvalida):
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	case errors.Is(err, service.ErrJornadaYaAbierta), errors.Is(err, service.ErrSinJornadaAbierta),
		errors.Is(err, service.ErrPedidoRequiereJornadaAbierta):
		// Los tres son 409: el estado de la jornada no es compatible con lo que
		// se pidió. ErrPedidoRequiereJornadaAbierta es el único de alta de
		// pedido, por eso tiene su propio texto (ver el comentario del sentinel).
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrMedioPagoInvalido),
		errors.Is(err, service.ErrCUITInvalido),
		errors.Is(err, service.ErrPuntoVentaInvalido),
		errors.Is(err, service.ErrModoFiscalInvalido),
		errors.Is(err, service.ErrRangoInvalido),
		errors.Is(err, service.ErrTimezoneInvalida):
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	case errors.Is(err, service.ErrCifradoNoConfigurado):
		// Es una falta de configuración del servidor, no del que llamó: 503
		// para que se note en el monitoreo y no se confunda con un body malo.
		c.JSON(http.StatusServiceUnavailable, apierror.New(err.Error()))
	default:
		// Lo que no está mapeado es una falla nuestra, no del que llamó: 500 y
		// un mensaje genérico. Antes salía 400 con el err.Error() adentro, y
		// por ahí se escapaban los errores de Postgres (SQLSTATE incluido) —
		// justo lo que apierror dice existir para evitar. El detalle va al log.
		log.Error().Err(err).Str("ruta", c.FullPath()).Msg("error no mapeado")
		c.JSON(http.StatusInternalServerError, apierror.New("Error interno"))
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
