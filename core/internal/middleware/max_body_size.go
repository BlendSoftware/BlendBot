package middleware

import (
	"net/http"

	"copiloto/core/internal/apierror"

	"github.com/gin-gonic/gin"
)

// MaxBodySize limits the size of incoming request bodies.
// When the limit is exceeded, reading the body returns an error and
// the middleware responds with HTTP 413 Request Entity Too Large.
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()

		for _, e := range c.Errors {
			if e.Err != nil && e.Err.Error() == "http: request body too large" {
				c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge,
					apierror.New("El tamaño del request excede el limite permitido"))
				return
			}
		}
	}
}
