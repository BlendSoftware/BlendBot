package handler

import (
	"errors"
	"net/http"
	"time"

	"copiloto/core/internal/apierror"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// errorDeServicio traduce los errores de los services de catálogo, clientes,
// negocios y auth a un status. Lo que no está mapeado sale como 500 sin
// detalle: un error del ORM no se le muestra al cliente.
func errorDeServicio(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNoExisteEnNegocio), errors.Is(err, service.ErrNegocioNoExiste):
		c.JSON(http.StatusNotFound, apierror.New(err.Error()))
	case errors.Is(err, service.ErrCredencialesInvalidas), errors.Is(err, service.ErrTokenInvalido):
		c.JSON(http.StatusUnauthorized, apierror.New(err.Error()))
	case errors.Is(err, service.ErrClienteDuplicado), errors.Is(err, service.ErrUsuarioDuplicado):
		c.JSON(http.StatusConflict, apierror.New(err.Error()))
	case errors.Is(err, service.ErrTimezoneInvalida):
		c.JSON(http.StatusUnprocessableEntity, apierror.New(err.Error()))
	default:
		log.Error().Err(err).Str("ruta", c.FullPath()).Msg("error no mapeado")
		c.JSON(http.StatusInternalServerError, apierror.New("Error interno"))
	}
}

// bindJSON deja escrito el 400 si el body no valida.
func bindJSON(c *gin.Context, req any) bool {
	if err := c.ShouldBindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, apierror.New("JSON invalido: "+err.Error()))
		return false
	}
	return true
}

type AuthHandler struct{ svc service.AuthService }

func NewAuthHandler(svc service.AuthService) *AuthHandler { return &AuthHandler{svc: svc} }

// Register cuelga las rutas públicas (sin JWT): login y refresh.
func (h *AuthHandler) Register(rg *gin.RouterGroup) {
	rg.POST("/login", h.Login)
	rg.POST("/refresh", h.Refresh)
}

// RegisterProtegidas cuelga las rutas que necesitan middleware.JWTAuth: para
// revocar un token hay que haberlo validado antes.
func (h *AuthHandler) RegisterProtegidas(rg *gin.RouterGroup) {
	rg.POST("/logout", h.Logout)
	rg.POST("/cambiar-password", h.CambiarPassword)
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if !bindJSON(c, &req) {
		return
	}
	tokens, err := h.svc.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, tokens)
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req dto.RefreshRequest
	if !bindJSON(c, &req) {
		return
	}
	tokens, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, tokens)
}

func (h *AuthHandler) Logout(c *gin.Context) {
	claims := middleware.GetClaims(c)
	if claims == nil {
		c.JSON(http.StatusUnauthorized, apierror.New("Token invalido"))
		return
	}
	// El TTL de la clave en Redis es exactamente lo que le queda de vida al
	// token: no tiene sentido guardar un revocado ya expirado.
	var restante time.Duration
	if claims.ExpiresAt != nil {
		restante = time.Until(claims.ExpiresAt.Time)
	}
	if err := h.svc.Logout(c.Request.Context(), claims.ID, restante); err != nil {
		log.Error().Err(err).Msg("logout: no se pudo revocar el token")
		c.JSON(http.StatusInternalServerError, apierror.New("No se pudo revocar el token"))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AuthHandler) CambiarPassword(c *gin.Context) {
	claims := middleware.GetClaims(c)
	if claims == nil {
		c.JSON(http.StatusUnauthorized, apierror.New("Token invalido"))
		return
	}
	var req dto.CambiarPasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := h.svc.CambiarPassword(c.Request.Context(), claims.UserID, req.PasswordNueva); err != nil {
		errorDeServicio(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"mensaje": "Contrasena actualizada"})
}
