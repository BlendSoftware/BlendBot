package middleware

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
)

// GlobalTimeout wraps every incoming request in a context with the given deadline.
// Handlers and downstream calls (DB, Redis, sidecar) that respect ctx.Done()
// will be cancelled automatically if the request takes longer than d.
func GlobalTimeout(d time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()

		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
