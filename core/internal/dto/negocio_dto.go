package dto

import "encoding/json"

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
