package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"copiloto/core/internal/apierror"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// PrefijoTokenAgente distingue el token del agente MCP de un JWT del panel.
// Es un prefijo y no un header aparte para que el agente use el mismo
// `Authorization: Bearer …` de siempre.
const PrefijoTokenAgente = "cop_"

// BuscarNegocioPorTokenHash resuelve el tenant desde el sha256 hex del token.
// Devuelve "" sin error si ningún negocio activo tiene ese hash: "no existe" y
// "es de otro" son indistinguibles desde afuera.
type BuscarNegocioPorTokenHash func(ctx context.Context, hashHex string) (string, error)

// HashTokenAgente es el sha256 hex del token COMPLETO, prefijo incluido. Es lo
// único que se persiste: el token en claro se muestra una sola vez, al rotarlo.
func HashTokenAgente(token string) string {
	suma := sha256.Sum256([]byte(token))
	return hex.EncodeToString(suma[:])
}

// AutenticacionDual reemplaza a JWTAuth en el grupo protegido: la misma ruta
// la puede llamar el panel (JWT de usuario) o el agente (token del negocio).
//
// Si el Bearer arranca con `cop_` se valida por hash contra
// negocio.token_agente_hash y se sintetizan claims {Rol: agente, NegocioID}:
// pasa RequireNegocio, y RequireRole(admin) lo rechaza con 403 como cualquier
// no-admin. Si no arranca con el prefijo, es exactamente la validación JWT de
// siempre — la lógica es la de auth.go, no una copia.
func AutenticacionDual(secret string, rdb *redis.Client, buscar BuscarNegocioPorTokenHash) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr, ok := tokenBearer(c)
		if !ok {
			return
		}

		if strings.HasPrefix(tokenStr, PrefijoTokenAgente) {
			if buscar == nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, apierror.New("Token invalido"))
				return
			}
			negocioID, err := buscar(c.Request.Context(), HashTokenAgente(tokenStr))
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, apierror.New("Error interno"))
				return
			}
			if negocioID == "" {
				c.AbortWithStatusJSON(http.StatusUnauthorized, apierror.New("Token invalido"))
				return
			}
			// Sin UserID: el agente no es un usuario del panel y el rastro de
			// auditoría no puede inventar uno (usuario_id referencia usuario).
			c.Set(ClaimsKey, &JWTClaims{
				Rol:       RolAgente,
				NegocioID: negocioID,
				Type:      "access",
			})
			c.Next()
			return
		}

		claims, ok := validarAccessJWT(c, tokenStr, secret, rdb)
		if !ok {
			return
		}
		c.Set(ClaimsKey, claims)
		c.Next()
	}
}
