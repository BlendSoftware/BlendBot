package dto

import (
	"context"
	"encoding/json"

	"copiloto/core/internal/model"
)

// AltaNegocioRequest da de alta un tenant y su usuario dueño en un solo paso.
// Sólo el rol admin de la plataforma llega acá.
type AltaNegocioRequest struct {
	Nombre       string          `json:"nombre" binding:"required"`
	Vertical     string          `json:"vertical" binding:"required,oneof=gastronomia salud"`
	Timezone     string          `json:"timezone"`
	WaPhoneID    *string         `json:"wa_phone_id"`
	WaWabaID     *string         `json:"wa_waba_id"`
	Config       json.RawMessage `json:"config"`
	UsuarioDueno string          `json:"usuario_dueno" binding:"required,min=3"` // username
}

type ActualizarNegocioRequest struct {
	Nombre    *string         `json:"nombre"`
	Timezone  *string         `json:"timezone"`
	WaPhoneID *string         `json:"wa_phone_id"`
	WaWabaID  *string         `json:"wa_waba_id"`
	Config    json.RawMessage `json:"config"`
	Activo    *bool           `json:"activo"`
}

// AltaNegocioResponse: PasswordTemporal viaja UNA sola vez, en esta respuesta.
// No se guarda en claro ni se vuelve a mostrar.
type AltaNegocioResponse struct {
	NegocioID        string     `json:"negocio_id"`
	Nombre           string     `json:"nombre"`
	Vertical         string     `json:"vertical"`
	UsuarioDueno     UsuarioDTO `json:"usuario_dueno"`
	PasswordTemporal string     `json:"password_temporal"`
}

// NegocioResponse es el negocio tal como lo ve el panel de PLATAFORMA.
//
// Existe para que las rutas de admin no serialicen `model.Negocio` directo. El
// motivo es concreto: `creado_en` tiene que salir como `dto.Hora` (capability
// `hora-local`), y meter un tipo de `dto` adentro de `model` invertiría la
// dependencia —hoy `dto` importa `model`— y haría ciclo.
//
// El huso lo trae el contexto, que en `/api/admin/*` es UTC porque esas rutas
// listan negocios de husos distintos (ver middleware.HusoDePlataforma).
type NegocioResponse struct {
	ID        string          `json:"id"`
	Nombre    string          `json:"nombre"`
	Vertical  string          `json:"vertical"`
	Timezone  string          `json:"timezone"`
	WaPhoneID *string         `json:"wa_phone_id"`
	WaWabaID  *string         `json:"wa_waba_id"`
	Config    json.RawMessage `json:"config"`
	Activo    bool            `json:"activo"`
	CreadoEn  Hora            `json:"creado_en"`
}

// NegocioDesdeModel arma la respuesta de plataforma. nil devuelve nil.
func NegocioDesdeModel(ctx context.Context, n *model.Negocio) *NegocioResponse {
	if n == nil {
		return nil
	}
	return &NegocioResponse{
		ID:        n.ID,
		Nombre:    n.Nombre,
		Vertical:  string(n.Vertical),
		Timezone:  n.Timezone,
		WaPhoneID: n.WaPhoneID,
		WaWabaID:  n.WaWabaID,
		Config:    json.RawMessage(n.Config),
		Activo:    n.Activo,
		CreadoEn:  HoraDe(ctx, n.CreadoEn),
	}
}

// NegociosDesdeModelos mapea el listado de plataforma.
func NegociosDesdeModelos(ctx context.Context, ns []model.Negocio) []NegocioResponse {
	out := make([]NegocioResponse, 0, len(ns))
	for i := range ns {
		out = append(out, *NegocioDesdeModel(ctx, &ns[i]))
	}
	return out
}
