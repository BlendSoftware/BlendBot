package middleware

import (
	"net/http"
	"time"

	"copiloto/core/internal/apierror"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// ErrorHandler is a Gin middleware that catches unhandled errors.
// It ensures stack traces are NEVER exposed to clients.
func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) == 0 {
			return
		}

		err := c.Errors.Last()
		log.Error().
			Str("request_id", c.GetString(RequestIDKey)).
			Str("path", c.FullPath()).
			Str("method", c.Request.Method).
			Err(err.Err).
			Msg("unhandled error")

		c.AbortWithStatusJSON(http.StatusInternalServerError, apierror.New("Error interno del servidor"))
	}
}

// Recovery handles panics and converts them into 500 responses.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				log.Error().
					Str("request_id", c.GetString(RequestIDKey)).
					Interface("panic", r).
					Msg("panic recovered")
				c.AbortWithStatusJSON(http.StatusInternalServerError, apierror.New("Error interno del servidor"))
			}
		}()
		c.Next()
	}
}

// Logger logs each request with method, path, status, latency, and request_id.
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info().
			Str("request_id", c.GetString(RequestIDKey)).
			Str("method", c.Request.Method).
			Str("path", c.Request.URL.Path).
			Int("status", c.Writer.Status()).
			Dur("latency", time.Since(start)).
			Msg("request")
	}
}
