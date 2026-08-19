package dto

// ─── Requests ────────────────────────────────────────────────────────────────

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// CambiarPasswordRequest cierra el círculo del alta de negocio: el dueño entra
// con la contraseña temporal (must_change_password=true) y la reemplaza.
type CambiarPasswordRequest struct {
	PasswordNueva string `json:"password_nueva" binding:"required,min=8"`
}

// ─── Responses ───────────────────────────────────────────────────────────────

type UsuarioDTO struct {
	ID                 string  `json:"id"`
	Username           string  `json:"username"`
	Rol                string  `json:"rol"`
	NegocioID          *string `json:"negocio_id"`
	MustChangePassword bool    `json:"must_change_password"`
}

// TokensDTO es lo que devuelve Login y Refresh.
type TokensDTO struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	TokenType    string     `json:"token_type"`
	ExpiresIn    int        `json:"expires_in"` // segundos
	Usuario      UsuarioDTO `json:"usuario"`
}
