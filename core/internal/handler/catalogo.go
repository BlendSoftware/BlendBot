package handler

import (
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
)

// CatalogoHandler expone servicios, categorías, recursos y coberturas.
// El tenant sale siempre de middleware.NegocioID(c) — jamás del body.
type CatalogoHandler struct {
	svc   service.CatalogoService
	audit service.AuditService
}

func NewCatalogoHandler(svc service.CatalogoService, audit service.AuditService) *CatalogoHandler {
	return &CatalogoHandler{svc: svc, audit: audit}
}

// Register cuelga las rutas relativas al grupo que recibe (típicamente /api).
func (h *CatalogoHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/servicios", h.ListarServicios)
	rg.POST("/servicios", h.CrearServicio)
	rg.PATCH("/servicios/:id", h.ActualizarServicio)
	rg.PATCH("/servicios/:id/disponible", h.SetDisponible)
	rg.GET("/servicios/:id/precios", h.ListarPrecios)
	rg.PUT("/servicios/:id/precios", h.FijarPrecio)

	rg.GET("/categorias", h.ListarCategorias)
	rg.POST("/categorias", h.CrearCategoria)
	rg.PATCH("/categorias/:id", h.ActualizarCategoria)

	rg.GET("/recursos", h.ListarRecursos)
	rg.POST("/recursos", h.CrearRecurso)
	rg.PATCH("/recursos/:id", h.ActualizarRecurso)

	rg.GET("/coberturas", h.ListarCoberturas)
	rg.POST("/coberturas", h.CrearCobertura)
	rg.PATCH("/coberturas/:id", h.ActualizarCobertura)
}

// ─── Servicios ───────────────────────────────────────────────────────────────

func (h *CatalogoHandler) ListarServicios(c *gin.Context) {
	f := repository.FiltroServicios{
		CategoriaID:      c.Query("categoria"),
		SoloDisponibles:  c.Query("solo_disponibles") == "true",
		IncluirInactivos: c.Query("incluir_inactivos") == "true",
	}
	servicios, err := h.svc.ListarServicios(c.Request.Context(), middleware.NegocioID(c), f)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, servicios)
}

func (h *CatalogoHandler) CrearServicio(c *gin.Context) {
	var req dto.CrearServicioRequest
	if !bindJSON(c, &req) {
		return
	}
	sv, err := h.svc.CrearServicio(c.Request.Context(), middleware.NegocioID(c), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusCreated, sv)
}

func (h *CatalogoHandler) ActualizarServicio(c *gin.Context) {
	var req dto.ActualizarServicioRequest
	if !bindJSON(c, &req) {
		return
	}
	sv, err := h.svc.ActualizarServicio(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, sv)
}

// SetDisponible es EL interruptor del panel: se audita porque explica por qué
// el agente dejó de ofrecer algo.
func (h *CatalogoHandler) SetDisponible(c *gin.Context) {
	var req dto.SetDisponibleRequest
	if !bindJSON(c, &req) {
		return
	}
	negocioID := middleware.NegocioID(c)
	id := c.Param("id")
	if err := h.svc.SetDisponible(c.Request.Context(), negocioID, id, *req.Disponible); err != nil {
		errorDeServicio(c, err)
		return
	}

	h.audit.Registrar(c.Request.Context(), service.Evento{
		NegocioID: negocioID,
		UsuarioID: middleware.GetClaims(c).UserID,
		Accion:    service.AccionServicioSetDisponible,
		Entidad:   "servicio",
		EntidadID: id,
		Detalle:   map[string]any{"disponible": *req.Disponible},
	})

	c.JSON(http.StatusOK, gin.H{"id": id, "disponible": *req.Disponible})
}

func (h *CatalogoHandler) ListarPrecios(c *gin.Context) {
	precios, err := h.svc.ListarPrecios(c.Request.Context(), middleware.NegocioID(c), c.Param("id"))
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, precios)
}

func (h *CatalogoHandler) FijarPrecio(c *gin.Context) {
	var req dto.PrecioCoberturaRequest
	if !bindJSON(c, &req) {
		return
	}
	p, err := h.svc.FijarPrecio(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ─── Categorías ──────────────────────────────────────────────────────────────

func (h *CatalogoHandler) ListarCategorias(c *gin.Context) {
	cats, err := h.svc.ListarCategorias(c.Request.Context(), middleware.NegocioID(c), c.Query("incluir_inactivos") == "true")
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, cats)
}

func (h *CatalogoHandler) CrearCategoria(c *gin.Context) {
	var req dto.CrearCategoriaRequest
	if !bindJSON(c, &req) {
		return
	}
	cat, err := h.svc.CrearCategoria(c.Request.Context(), middleware.NegocioID(c), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusCreated, cat)
}

func (h *CatalogoHandler) ActualizarCategoria(c *gin.Context) {
	var req dto.ActualizarCategoriaRequest
	if !bindJSON(c, &req) {
		return
	}
	cat, err := h.svc.ActualizarCategoria(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, cat)
}

// ─── Recursos ────────────────────────────────────────────────────────────────

func (h *CatalogoHandler) ListarRecursos(c *gin.Context) {
	recursos, err := h.svc.ListarRecursos(c.Request.Context(), middleware.NegocioID(c), c.Query("incluir_inactivos") == "true")
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, recursos)
}

func (h *CatalogoHandler) CrearRecurso(c *gin.Context) {
	var req dto.CrearRecursoRequest
	if !bindJSON(c, &req) {
		return
	}
	r, err := h.svc.CrearRecurso(c.Request.Context(), middleware.NegocioID(c), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *CatalogoHandler) ActualizarRecurso(c *gin.Context) {
	var req dto.ActualizarRecursoRequest
	if !bindJSON(c, &req) {
		return
	}
	r, err := h.svc.ActualizarRecurso(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// ─── Coberturas ──────────────────────────────────────────────────────────────

func (h *CatalogoHandler) ListarCoberturas(c *gin.Context) {
	cobs, err := h.svc.ListarCoberturas(c.Request.Context(), middleware.NegocioID(c))
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, cobs)
}

func (h *CatalogoHandler) CrearCobertura(c *gin.Context) {
	var req dto.CrearCoberturaRequest
	if !bindJSON(c, &req) {
		return
	}
	cob, err := h.svc.CrearCobertura(c.Request.Context(), middleware.NegocioID(c), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusCreated, cob)
}

func (h *CatalogoHandler) ActualizarCobertura(c *gin.Context) {
	var req dto.ActualizarCoberturaRequest
	if !bindJSON(c, &req) {
		return
	}
	cob, err := h.svc.ActualizarCobertura(c.Request.Context(), middleware.NegocioID(c), c.Param("id"), req)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, cob)
}
