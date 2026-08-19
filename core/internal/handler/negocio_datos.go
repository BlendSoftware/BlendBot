package handler

import (
	"errors"
	"net/http"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// NegocioDatosHandler es la ficha del propio negocio: nombre, vertical,
// timezone, config y coberturas. Es por donde arranca el agente
// (`datos_del_negocio`) y es sólo lectura del tenant del token.
//
// Va directo al repositorio, como HorariosHandler: no hay regla de negocio que
// mediar, es un SELECT del propio tenant.
type NegocioDatosHandler struct {
	repo repository.NegocioDatosRepository
}

func NewNegocioDatosHandler(repo repository.NegocioDatosRepository) *NegocioDatosHandler {
	return &NegocioDatosHandler{repo: repo}
}

// Register cuelga la ruta del grupo /api ya autenticado y con tenant.
func (h *NegocioDatosHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/negocio", h.Obtener)
}

func (h *NegocioDatosHandler) Obtener(c *gin.Context) {
	negocioID := middleware.NegocioID(c)
	ctx := c.Request.Context()

	n, err := h.repo.Negocio(ctx, negocioID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			responderErrorMotor(c, service.ErrNoEncontrado)
			return
		}
		errorDeServicio(c, err)
		return
	}

	coberturas, err := h.repo.Coberturas(ctx, negocioID)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	c.JSON(http.StatusOK, dto.NegocioDatosDesdeModel(n, coberturas))
}
