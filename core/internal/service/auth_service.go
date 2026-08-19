package service

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/config"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

// clavesRevocadas es el prefijo de la blocklist en Redis: jwt:revoked:<jti>.
// El middleware JWTAuth lee exactamente estas claves.
const clavesRevocadas = "jwt:revoked:"

const costoBcrypt = 12

var (
	ErrCredencialesInvalidas = errors.New("credenciales invalidas")
	ErrTokenInvalido         = errors.New("token invalido o expirado")
)

type AuthService interface {
	Login(ctx context.Context, username, password string) (*dto.TokensDTO, error)
	Refresh(ctx context.Context, refreshToken string) (*dto.TokensDTO, error)
	// Logout marca el jti en Redis por lo que le quede de vida al token.
	Logout(ctx context.Context, jti string, restante time.Duration) error
	CambiarPassword(ctx context.Context, usuarioID, passwordNueva string) error
}

type authService struct {
	usuarios repository.UsuarioRepository
	cfg      *config.Config
	rdb      *redis.Client
}

func NewAuthService(usuarios repository.UsuarioRepository, cfg *config.Config, rdb *redis.Client) AuthService {
	return &authService{usuarios: usuarios, cfg: cfg, rdb: rdb}
}

func (s *authService) Login(ctx context.Context, username, password string) (*dto.TokensDTO, error) {
	u, err := s.usuarios.GetByUsername(ctx, username)
	if err != nil {
		// Comparar igual sería lo ideal contra timing attacks, pero bcrypt ya
		// domina el tiempo de respuesta: no se filtra si el usuario existe.
		return nil, ErrCredencialesInvalidas
	}
	if !u.Activo {
		return nil, ErrCredencialesInvalidas
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return nil, ErrCredencialesInvalidas
	}
	return s.emitirTokens(u)
}

func (s *authService) Refresh(ctx context.Context, refreshToken string) (*dto.TokensDTO, error) {
	claims := &middleware.JWTClaims{}
	token, err := jwt.ParseWithClaims(refreshToken, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, ErrTokenInvalido
	}
	if claims.Type != "refresh" {
		return nil, ErrTokenInvalido
	}

	// Un refresh revocado no vuelve a servir.
	if s.rdb != nil && claims.ID != "" {
		n, errR := s.rdb.Exists(ctx, clavesRevocadas+claims.ID).Result()
		if errR == nil && n > 0 {
			return nil, ErrTokenInvalido
		}
	}

	u, err := s.usuarios.GetByID(ctx, claims.UserID)
	if err != nil || !u.Activo {
		return nil, ErrTokenInvalido
	}

	// Rotación: el refresh usado se quema antes de emitir el par nuevo, así un
	// token robado sirve una sola vez.
	if s.rdb != nil && claims.ID != "" {
		var restante time.Duration
		if claims.ExpiresAt != nil {
			restante = time.Until(claims.ExpiresAt.Time)
		}
		if restante > 0 {
			if err := s.rdb.Set(ctx, clavesRevocadas+claims.ID, "1", restante).Err(); err != nil {
				return nil, err
			}
		}
	}

	return s.emitirTokens(u)
}

func (s *authService) Logout(ctx context.Context, jti string, restante time.Duration) error {
	if s.rdb == nil {
		return errors.New("redis no disponible: no se puede revocar el token")
	}
	if jti == "" || restante <= 0 {
		return nil // ya expirado o sin jti: nada que revocar
	}
	return s.rdb.Set(ctx, clavesRevocadas+jti, "1", restante).Err()
}

func (s *authService) CambiarPassword(ctx context.Context, usuarioID, passwordNueva string) error {
	u, err := s.usuarios.GetByID(ctx, usuarioID)
	if err != nil {
		return ErrCredencialesInvalidas
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(passwordNueva), costoBcrypt)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hash)
	u.MustChangePassword = false
	return s.usuarios.Update(ctx, u)
}

func (s *authService) emitirTokens(u *model.Usuario) (*dto.TokensDTO, error) {
	access, err := s.firmar(u, time.Duration(s.cfg.JWTExpirationHours)*time.Hour, "access")
	if err != nil {
		return nil, err
	}
	refresh, err := s.firmar(u, time.Duration(s.cfg.JWTRefreshHours)*time.Hour, "refresh")
	if err != nil {
		return nil, err
	}
	return &dto.TokensDTO{
		AccessToken:  access,
		RefreshToken: refresh,
		TokenType:    "bearer",
		ExpiresIn:    s.cfg.JWTExpirationHours * 3600,
		Usuario: dto.UsuarioDTO{
			ID:                 u.ID,
			Username:           u.Username,
			Rol:                u.Rol,
			NegocioID:          u.NegocioID,
			MustChangePassword: u.MustChangePassword,
		},
	}, nil
}

// firmar arma el token con los claims que lee el middleware. El negocio viaja
// en el token: es lo que impide que un caller opere sobre otro tenant.
func (s *authService) firmar(u *model.Usuario, duracion time.Duration, tipo string) (string, error) {
	negocioID := ""
	if u.NegocioID != nil {
		negocioID = *u.NegocioID
	}
	ahora := time.Now()
	claims := middleware.JWTClaims{
		UserID:    u.ID,
		Username:  u.Username,
		Rol:       u.Rol,
		NegocioID: negocioID,
		Type:      tipo,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.NewString(),
			IssuedAt:  jwt.NewNumericDate(ahora),
			ExpiresAt: jwt.NewNumericDate(ahora.Add(duracion)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
}
