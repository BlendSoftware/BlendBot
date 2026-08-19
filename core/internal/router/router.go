package router

import (
	"net/http"
	"strings"
	"time"

	"copiloto/core/internal/config"
	"copiloto/core/internal/handler"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

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

	AuthSvc      service.AuthService
	NegocioSvc   service.NegocioService
	CatalogoSvc  service.CatalogoService
	ClienteSvc   service.ClienteService
	AuditSvc     service.AuditService
	MotorSvc     service.MotorService
	HoldSvc      service.HoldService
	DispoSvc     service.DisponibilidadService
	TokenSvc     service.NegocioTokenService
	ListaEspSvc  service.ListaEsperaService
	NegDatosRepo repository.NegocioDatosRepository
	HorarioH     *handler.HorariosHandler
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

	authH := handler.NewAuthHandler(d.AuthSvc)

	// Públicas: login y refresh.
	api := r.Group("/api")
	authH.Register(api.Group("/auth"))

	// Todo lo demás exige token: JWT del panel o token de agente (cop_...).
	priv := api.Group("", middleware.AutenticacionDual(d.Cfg.JWTSecret, d.RDB, d.NegDatosRepo.NegocioPorTokenHash))
	authH.RegisterProtegidas(priv.Group("/auth"))

	// Panel admin de la plataforma: alta/baja de negocios (D20).
	admin := priv.Group("/admin/negocios", middleware.RequireRole(middleware.RolAdmin))
	handler.NewAdminNegociosHandler(d.NegocioSvc, d.AuditSvc).Register(admin)
	handler.NewAdminTokenHandler(d.TokenSvc, d.AuditSvc).Register(admin)

	// Rutas del negocio: el tenant sale del token, jamás del request.
	tenant := priv.Group("", middleware.RequireNegocio())
	handler.NewCatalogoHandler(d.CatalogoSvc, d.AuditSvc).Register(tenant)
	handler.NewClientesHandler(d.ClienteSvc, d.AuditSvc).Register(tenant)
	handler.NewCompromisosHandler(d.MotorSvc).Register(tenant)
	handler.NewHoldsHandler(d.HoldSvc).Register(tenant)
	handler.NewDisponibilidadHandler(d.DispoSvc).Register(tenant)
	handler.NewNegocioDatosHandler(d.NegDatosRepo).Register(tenant)
	handler.NewListaEsperaHandler(d.ListaEspSvc).Register(tenant)
	d.HorarioH.Register(tenant)

	return r
}
