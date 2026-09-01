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
	ConsultaSvc  service.ConsultaService
	CobroSvc     service.CobroService
	JornadaSvc   service.JornadaService
	CupoSvc      service.CupoService
	InsumoSvc    service.InsumoService
	RecetaSvc    service.RecetaService
	ReporteSvc   service.ReporteService
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
	//
	// HusoDePlataforma fija UTC para estas rutas: son cross-tenant y no tienen
	// una timezone única de la cual tomar la hora (ver la capability
	// `hora-local`). Va acá, al lado de lo que define qué es una ruta de
	// plataforma, y no repartido por los constructores de DTO.
	admin := priv.Group("/admin/negocios",
		middleware.RequireRole(middleware.RolAdmin),
		middleware.HusoDePlataforma(),
	)
	handler.NewAdminNegociosHandler(d.NegocioSvc, d.AuditSvc).Register(admin)
	handler.NewAdminTokenHandler(d.TokenSvc, d.AuditSvc).Register(admin)
	handler.NewAdminFiscalHandler(d.CobroSvc, d.AuditSvc).Register(admin)

	// Rutas del negocio: el tenant sale del token, jamás del request.
	// RestringirAgente aplica la allowlist de RolAgente (el token cop_): el
	// agente sólo alcanza lo que necesita para atender WhatsApp; para los demás
	// roles es transparente y el control lo llevan RequireNegocio/RequireRole.
	//
	// TimezoneDelNegocio va DESPUÉS de RequireNegocio —que es quien garantiza
	// que hay tenant— y resuelve el huso una vez para todo el request. Cuelga
	// acá y no en `priv` a propósito: `admin` no tiene un negocio único del cual
	// tomar la hora y sus responses usan dto.HoraUTC (ver la capability
	// `hora-local`).
	tenant := priv.Group("",
		middleware.RequireNegocio(),
		middleware.RestringirAgente(),
		middleware.TimezoneDelNegocio(d.NegDatosRepo),
	)

	// Operación del mostrador: la ve el operador (y el dueño, y el agente en su
	// allowlist). Nada de plata acá.
	handler.NewCatalogoHandler(d.CatalogoSvc, d.AuditSvc).Register(tenant)
	handler.NewClientesHandler(d.ClienteSvc, d.AuditSvc).Register(tenant)
	handler.NewCompromisosHandler(d.MotorSvc).Register(tenant)
	handler.NewHoldsHandler(d.HoldSvc).Register(tenant)
	handler.NewDisponibilidadHandler(d.DispoSvc).Register(tenant)
	handler.NewNegocioDatosHandler(d.NegDatosRepo).Register(tenant)
	handler.NewListaEsperaHandler(d.ListaEspSvc).Register(tenant)
	// El cupo del día lo toca quien cocina, así que va en el mostrador y no en
	// el grupo de plata. El agente no lo alcanza: no está en su allowlist.
	handler.NewStockHandler(d.CupoSvc).Register(tenant)
	// La Capa 2 (insumos y recetas) va al lado de la Capa 1 y por el mismo
	// motivo: la materia prima la carga quien cocina. Adentro, cada ruta pone
	// su rol —el dueño escribe, el operador lee— porque cargar mal un insumo
	// apaga platos. El agente no llega: su allowlist es cerrada.
	handler.NewInsumosHandler(d.InsumoSvc, d.RecetaSvc).Register(tenant)
	handler.NewConsultasHandler(d.ConsultaSvc).Register(tenant)
	d.HorarioH.Register(tenant)

	// La plata: cobros, cierre, jornada y reportes. Sólo el dueño (el admin de
	// plataforma ya queda afuera por RequireNegocio; se lista por explícito).
	// El operador ve el mostrador pero no la caja; el agente ni la toca (no
	// está en su allowlist).
	plata := tenant.Group("", middleware.RequireRole(middleware.RolDueno, middleware.RolAdmin))
	handler.NewCobrosHandler(d.CobroSvc).Register(plata)
	handler.NewJornadaHandler(d.JornadaSvc).Register(plata)
	handler.NewReportesHandler(d.ReporteSvc).Register(plata)

	return r
}
