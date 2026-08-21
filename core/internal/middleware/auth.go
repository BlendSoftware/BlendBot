package middleware

import (
	"net/http"
	"strings"

	"copiloto/core/internal/apierror"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

const (
	ClaimsKey        = "claims"
	revokedKeyPrefix = "jwt:revoked:"
)

// Roles del panel.
const (
	RolAdmin    = "admin"    // panel admin de la plataforma; sin negocio
	RolDueno    = "dueno"    // ve todo su negocio, incluida la plata
	RolOperador = "operador" // tablero, catálogo, clientes; sin facturación
	RolAgente   = "agente"   // el agente MCP: entra con token de negocio, no con JWT
)

// JWTClaims are the custom claims embedded in every access token.
//
// NegocioID is the tenant. It travels in the token (transport), never as a
// request parameter: a caller can only operate on the tenant its token was
// issued for. Empty NegocioID is only valid for RolAdmin.
type JWTClaims struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Rol       string `json:"rol"`
	NegocioID string `json:"negocio_id"`
	Type      string `json:"type"` // "access" or "refresh"
	jwt.RegisteredClaims
}

// JWTAuth validates the Bearer token on every protected route.
// If rdb is non-nil, it also checks whether the token's jti has been
// added to the Redis revocation set (e.g. after an explicit logout).
func JWTAuth(secret string, rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr, ok := tokenBearer(c)
		if !ok {
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

// tokenBearer extrae el token del header Authorization. Aborta con 401 y
// devuelve false si no hay Bearer. Lo comparten JWTAuth y AutenticacionDual.
func tokenBearer(c *gin.Context) (string, bool) {
	header := c.GetHeader("Authorization")
	if header == "" || !strings.HasPrefix(header, "Bearer ") {
		c.AbortWithStatusJSON(http.StatusUnauthorized, apierror.New("Autenticacion requerida"))
		return "", false
	}
	return strings.TrimPrefix(header, "Bearer "), true
}

// validarAccessJWT es LA validación del token del panel: firma, tipo y
// revocación. Aborta con 401 y devuelve false si algo no cierra. Existe como
// función aparte para que AutenticacionDual no duplique la lógica.
func validarAccessJWT(c *gin.Context, tokenStr, secret string, rdb *redis.Client) (*JWTClaims, bool) {
	claims := &JWTClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(secret), nil
	})

	if err != nil || !token.Valid {
		c.AbortWithStatusJSON(http.StatusUnauthorized, apierror.New("Token invalido o expirado"))
		return nil, false
	}

	// Reject refresh tokens used as access tokens.
	if claims.Type != "access" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, apierror.New("Tipo de token invalido"))
		return nil, false
	}

	// Revocation check: if the jti appears in Redis the token was explicitly
	// invalidated (logout). Fail fast without touching the DB.
	if rdb != nil && claims.ID != "" {
		n, redisErr := rdb.Exists(c.Request.Context(), revokedKeyPrefix+claims.ID).Result()
		if redisErr == nil && n > 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, apierror.New("Token revocado"))
			return nil, false
		}
	}

	return claims, true
}

// RequireRole rejects requests whose JWT role is not in the allowed list.
func RequireRole(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(c *gin.Context) {
		claims, ok := c.MustGet(ClaimsKey).(*JWTClaims)
		if !ok || !allowed[claims.Rol] {
			c.AbortWithStatusJSON(http.StatusForbidden, apierror.New("Permisos insuficientes"))
			return
		}
		c.Next()
	}
}

// rutasAgente es la allowlist del token de agente (RolAgente, cop_...): lo
// único que el agente MCP necesita para atender WhatsApp — leer
// negocio/catálogo/disponibilidad, obtener-o-crear cliente, y crear/consultar/
// cancelar compromisos (incluidos los holds del borrador). Todo lo demás
// —cobros, cierre, reportes, jornada, precios, horarios, lista de espera— le
// da 403. La clave es "METODO ruta-patrón" con el patrón de gin (c.FullPath).
var rutasAgente = map[string]bool{
	"GET /api/negocio":                    true,
	"GET /api/servicios":                  true,
	"GET /api/servicios/:id/precios":      true, // leer precio (para cotizar); escribirlo, no
	"GET /api/categorias":                 true,
	"GET /api/recursos":                   true,
	"GET /api/coberturas":                 true,
	"POST /api/disponibilidad/consultar":  true,
	"GET /api/clientes/por-telefono/:tel": true,
	"POST /api/clientes":                  true,
	"PATCH /api/clientes/:id":             true,
	"POST /api/holds":                     true,
	"DELETE /api/holds/:id":               true,
	"POST /api/compromisos":               true,
	"GET /api/compromisos/:id":            true,
	"PATCH /api/compromisos/:id/estado":   true,
}

// RestringirAgente aplica la allowlist de RolAgente sobre el grupo del tenant.
// Para los demás roles (dueno/operador/admin) es transparente: el control de
// esas rutas lo hacen RequireNegocio y RequireRole. Debe correr después de que
// el claim ya esté en el contexto (después de la autenticación) y dentro del
// grupo con rutas, para que c.FullPath ya tenga el patrón resuelto.
func RestringirAgente() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := c.MustGet(ClaimsKey).(*JWTClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, apierror.New("Permisos insuficientes"))
			return
		}
		if claims.Rol != RolAgente {
			c.Next()
			return
		}
		if !rutasAgente[c.Request.Method+" "+c.FullPath()] {
			c.AbortWithStatusJSON(http.StatusForbidden, apierror.New("Permisos insuficientes"))
			return
		}
		c.Next()
	}
}

// RequireNegocio rejects tokens that don't carry a tenant. Tenant-scoped
// routes (everything except the platform admin) must pass through this.
func RequireNegocio() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := c.MustGet(ClaimsKey).(*JWTClaims)
		if !ok || claims.NegocioID == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, apierror.New("Token sin negocio asignado"))
			return
		}
		c.Next()
	}
}

// GetClaims is a helper to retrieve typed claims from the Gin context.
func GetClaims(c *gin.Context) *JWTClaims {
	claims, _ := c.MustGet(ClaimsKey).(*JWTClaims)
	return claims
}

// NegocioID returns the tenant id from the token. Handlers must use this and
// never accept a negocio_id from the request body or query string.
func NegocioID(c *gin.Context) string {
	if claims := GetClaims(c); claims != nil {
		return claims.NegocioID
	}
	return ""
}
