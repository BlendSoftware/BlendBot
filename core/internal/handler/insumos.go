package handler

import (
	"net/http"
	"strconv"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// InsumosHandler es la Capa 2 del control de stock: la materia prima del
// negocio y de qué está hecho cada plato.
//
// Va en el grupo del mostrador y no en el de plata, igual que el cupo: cargar
// que entraron 20 kg de carne es trabajo de quien cocina, no de quien mira la
// caja. Los permisos van por ruta — el dueño escribe, el dueño y el operador
// leen— porque cargar mal un insumo apaga platos, y eso es una decisión del
// que se hace cargo del negocio.
//
// El agente no llega acá: no está en su allowlist (middleware.rutasAgente), y
// como la allowlist es cerrada, agregar rutas nuevas no le abre nada.
//
// Tenant-scoped como todo el grupo: el negocio sale del token, nunca de la URL.
type InsumosHandler struct {
	insumos service.InsumoService
	recetas service.RecetaService
}

func NewInsumosHandler(insumos service.InsumoService, recetas service.RecetaService) *InsumosHandler {
	return &InsumosHandler{insumos: insumos, recetas: recetas}
}

func (h *InsumosHandler) Register(rg *gin.RouterGroup) {
	dueno := middleware.RequireRole(middleware.RolDueno, middleware.RolAdmin)

	rg.GET("/insumos", h.Listar)
	rg.POST("/insumos", dueno, h.Crear)
	rg.PATCH("/insumos/:id", dueno, h.Actualizar)
	// La compra y el ajuste son POST y no PATCH del stock a propósito: no son
	// "poné el stock en X", son HECHOS que además dejan un movimiento. Un PATCH
	// sobre insumo.stock invitaría a escribir el saldo sin explicación, que es
	// justo lo que movimiento_insumo existe para impedir.
	rg.POST("/insumos/:id/compras", dueno, h.RegistrarCompra)
	rg.POST("/insumos/:id/ajustes", dueno, h.Ajustar)
	rg.GET("/insumos/:id/movimientos", h.Movimientos)

	// La receta cuelga del PLATO y no del insumo porque es donde el dueño la
	// piensa ("¿de qué está hecha la hamburguesa?"). Es PUT y no POST porque
	// reemplaza la receta entera: mandar la lista completa deja una sola verdad
	// del lado del servidor.
	rg.GET("/servicios/:id/receta", h.Receta)
	rg.PUT("/servicios/:id/receta", dueno, h.GuardarReceta)
}

func (h *InsumosHandler) Listar(c *gin.Context) {
	resp, err := h.insumos.Listar(c.Request.Context(), middleware.NegocioID(c))
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *InsumosHandler) Crear(c *gin.Context) {
	var in dto.CrearInsumoInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.insumos.Crear(c.Request.Context(), middleware.NegocioID(c), in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *InsumosHandler) Actualizar(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	var in dto.ActualizarInsumoInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.insumos.Actualizar(c.Request.Context(), middleware.NegocioID(c), id, in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *InsumosHandler) RegistrarCompra(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	var in dto.RegistrarCompraInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.insumos.RegistrarCompra(c.Request.Context(), middleware.NegocioID(c), id, in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *InsumosHandler) Ajustar(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	var in dto.AjustarStockInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.insumos.Ajustar(c.Request.Context(), middleware.NegocioID(c), id, in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// Movimientos acepta ?limite=N. El default de 50 alcanza para contestar "¿por
// qué me quedan 3?" sin traer la historia entera de un insumo que se mueve en
// cada pedido.
func (h *InsumosHandler) Movimientos(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	limite := 0
	if raw := c.Query("limite"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limite = n
		}
	}
	resp, err := h.insumos.Movimientos(c.Request.Context(), middleware.NegocioID(c), id, limite)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *InsumosHandler) Receta(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	resp, err := h.recetas.DeServicio(c.Request.Context(), middleware.NegocioID(c), id)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *InsumosHandler) GuardarReceta(c *gin.Context) {
	id, ok := idDeRuta(c, "id")
	if !ok {
		return
	}
	var in dto.GuardarRecetaInput
	if !bindMotorJSON(c, &in) {
		return
	}
	resp, err := h.recetas.Guardar(c.Request.Context(), middleware.NegocioID(c), id, in)
	if err != nil {
		responderErrorMotor(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}
