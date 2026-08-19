package router

import (
	"net/http"
	"strings"
	"time"

	"copiloto/core/internal/config"
	"copiloto/core/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// Deps agrupa todo lo que el router necesita para armar las rutas.
// Es la composition root: main construye, esto conecta.
type Deps struct {
	Cfg *config.Config
	DB  *gorm.DB
	RDB *redis.Client
}

// New arma el engine con la cadena de middlewares y las rutas.
func New(d Deps) *gin.Engine {
	if d.Cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(
		middleware.RequestID(),
		middleware.Logger(),
		middleware.Recovery(),
		middleware.ErrorHandler(),
		middleware.SecurityHeaders(),
		middleware.CORS(strings.Split(d.Cfg.AllowedOrigins, ",")),
		middleware.GlobalTimeout(30*time.Second),
		middleware.MaxBodySize(1<<20), // 1 MiB
	)

	r.GET("/health", func(c *gin.Context) {
		sqlDB, err := d.DB.DB()
		if err != nil || sqlDB.PingContext(c.Request.Context()) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "db unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// api := r.Group("/api", middleware.JWTAuth(d.Cfg.JWTSecret, d.RDB))
	// Acá se cuelgan los handlers a medida que existen:
	//   /api/compromisos · /api/servicios · /api/disponibilidad · /api/holds
	//   /api/clientes · /api/cobros · /api/reportes
	// y el grupo admin (RequireRole(middleware.RolAdmin)) para el alta de negocios.

	return r
}
