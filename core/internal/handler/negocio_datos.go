package handler

import (
	"context"
	"encoding/json"
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
	repo     repository.NegocioDatosRepository
	jornadas repository.JornadaRepository
}

func NewNegocioDatosHandler(repo repository.NegocioDatosRepository, jornadas repository.JornadaRepository) *NegocioDatosHandler {
	return &NegocioDatosHandler{repo: repo, jornadas: jornadas}
}

// abiertoAhora resuelve si la caja del día está abierta para este tenant. El
// agente la necesita para saber si avisarle al cliente que su pedido va a
// entrar, y no puede pedirla directo: GET /api/jornada/actual es sólo de
// dueño/admin (middleware.RequireRole), así que viaja acá adentro.
func (h *NegocioDatosHandler) abiertoAhora(ctx context.Context, negocioID string) (bool, error) {
	j, err := h.jornadas.Actual(ctx, negocioID)
	if err != nil {
		return false, err
	}
	return j.Abierta(), nil
}

// Register cuelga las rutas del grupo /api ya autenticado y con tenant. El GET
// lo lee cualquiera del tenant (el agente arranca por acá); el PATCH que edita
// la info del local es sólo del dueño.
func (h *NegocioDatosHandler) Register(rg *gin.RouterGroup) {
	rg.GET("/negocio", h.Obtener)
	rg.PATCH("/negocio", middleware.RequireRole(middleware.RolDueno, middleware.RolAdmin), h.Actualizar)
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

	abierta, err := h.abiertoAhora(ctx, negocioID)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	c.JSON(http.StatusOK, dto.NegocioDatosDesdeModel(n, coberturas, abierta))
}

// Actualizar mergea la info del local (dirección, horarios, teléfono, notas) en
// config.info sin pisar el resto de la config. Sólo las claves provistas se
// escriben: mandar sólo {telefono} no borra la dirección ya cargada.
func (h *NegocioDatosHandler) Actualizar(c *gin.Context) {
	var in dto.ActualizarNegocioInput
	if !bindJSON(c, &in) {
		return
	}

	// Sólo lo provisto viaja al merge: los punteros nil quedan fuera del JSON por
	// omitempty, así que no pisan lo que ya estaba.
	infoJSON, err := json.Marshal(in.Info)
	if err != nil {
		errorDeServicio(c, err)
		return
	}

	negocioID := middleware.NegocioID(c)
	ctx := c.Request.Context()
	ok, err := h.repo.MergearInfo(ctx, negocioID, infoJSON)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	if !ok {
		responderErrorMotor(c, service.ErrNoEncontrado)
		return
	}

	n, err := h.repo.Negocio(ctx, negocioID)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	coberturas, err := h.repo.Coberturas(ctx, negocioID)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	abierta, err := h.abiertoAhora(ctx, negocioID)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.NegocioDatosDesdeModel(n, coberturas, abierta))
}
