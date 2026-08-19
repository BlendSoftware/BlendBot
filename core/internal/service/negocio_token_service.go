package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

// avisoTokenAgente acompaña al token: si se pierde, no se recupera, se rota.
const avisoTokenAgente = "Guardalo ahora: es la unica vez que se muestra. Rotar de nuevo invalida este token."

// NegocioTokenService emite la credencial con la que el agente MCP habla con el
// core. Sólo el rol admin de la plataforma llega acá.
type NegocioTokenService interface {
	// RotarTokenAgente genera un token nuevo, guarda su sha256 y devuelve el
	// token en claro UNA sola vez. El token anterior queda invalidado.
	RotarTokenAgente(ctx context.Context, negocioID string) (*dto.TokenAgenteResponse, error)
}

type negocioTokenService struct {
	repo repository.NegocioDatosRepository
}

func NewNegocioTokenService(repo repository.NegocioDatosRepository) NegocioTokenService {
	return &negocioTokenService{repo: repo}
}

func (s *negocioTokenService) RotarTokenAgente(ctx context.Context, negocioID string) (*dto.TokenAgenteResponse, error) {
	token, err := generarTokenAgente()
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetTokenAgenteHash(ctx, negocioID, middleware.HashTokenAgente(token)); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNegocioNoExiste
		}
		return nil, err
	}
	return &dto.TokenAgenteResponse{
		NegocioID: negocioID,
		Token:     token,
		Aviso:     avisoTokenAgente,
	}, nil
}

// generarTokenAgente: prefijo `cop_` + 32 bytes aleatorios en base64 urlsafe.
// El prefijo es lo que le permite al middleware distinguirlo de un JWT sin
// intentar parsearlo.
func generarTokenAgente() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return middleware.PrefijoTokenAgente + base64.RawURLEncoding.EncodeToString(b), nil
}
