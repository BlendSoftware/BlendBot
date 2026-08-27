// Copiloto Comercios — Core
//
// El motor de compromisos: determinístico, testeable, sin un LLM en el medio.
// El agente y el panel hablan con este servicio por HTTP; el agente jamás
// toca la base de datos.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"copiloto/core/internal/config"
	"copiloto/core/internal/handler"
	"copiloto/core/internal/infra"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/router"
	"copiloto/core/internal/service"
	"copiloto/core/internal/worker"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// bootstrapAdmin crea el admin inicial de la plataforma si no existe ninguno.
// Resuelve el huevo-y-gallina: el alta de negocios exige rol admin, pero nadie
// puede crear al primer admin por API.
func bootstrapAdmin(cfg *config.Config, db *gorm.DB) error {
	var n int64
	if err := db.Model(&model.Usuario{}).Where("rol = ?", middleware.RolAdmin).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if cfg.AdminPassword == "" {
		log.Warn().Msg("no admin user exists and ADMIN_PASSWORD is not set — admin panel unusable until one is created")
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	admin := &model.Usuario{
		Username:           cfg.AdminUsername,
		PasswordHash:       string(hash),
		Rol:                middleware.RolAdmin,
		MustChangePassword: true,
	}
	if err := db.Create(admin).Error; err != nil {
		return err
	}
	log.Info().Str("username", cfg.AdminUsername).Msg("bootstrap: admin user created")
	return nil
}

func main() {
	// Preliminary console logger until config is loaded.
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	if cfg.Env == "development" {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
		log.Logger = zerolog.New(zerolog.ConsoleWriter{
			Out:        os.Stderr,
			TimeFormat: time.Kitchen,
		}).With().Timestamp().Caller().Logger()
	} else {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
		log.Logger = zerolog.New(os.Stderr).
			With().
			Timestamp().
			Str("service", "copiloto-core").
			Str("env", cfg.Env).
			Logger()
	}

	db, err := infra.NewDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to postgres")
	}

	if err := infra.RunMigrations(cfg.DatabaseURL, cfg.MigrationsPath); err != nil {
		log.Fatal().Err(err).Msg("failed to run migrations")
	}

	rdb, err := infra.NewRedis(cfg.RedisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to redis")
	}

	if err := bootstrapAdmin(cfg, db); err != nil {
		log.Fatal().Err(err).Msg("failed to bootstrap admin user")
	}

	// ── Composition root ────────────────────────────────────────────
	negocioRepo := repository.NewNegocioRepository(db)
	usuarioRepo := repository.NewUsuarioRepository(db)
	recursoRepo := repository.NewRecursoRepository(db)
	categoriaRepo := repository.NewCategoriaRepository(db)
	servicioRepo := repository.NewServicioRepository(db)
	clienteRepo := repository.NewClienteRepository(db)
	coberturaRepo := repository.NewCoberturaRepository(db)
	auditRepo := repository.NewAuditRepository(db)
	compromisoRepo := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)
	horarioRepo := repository.NewHorarioRepository(db)
	dispoRepo := repository.NewDisponibilidadRepository(db)
	negDatosRepo := repository.NewNegocioDatosRepository(db)
	listaEsperaRepo := repository.NewListaEsperaRepository(db)
	consultaRepo := repository.NewConsultaRepository(db)
	avisoRepo := repository.NewAvisoRepository(db)
	cobroRepo := repository.NewCobroRepository(db)
	jornadaRepo := repository.NewJornadaRepository(db)
	reporteRepo := repository.NewReporteRepository(db)
	cupoRepo := repository.NewCupoRepository(db)
	recetaRepo := repository.NewRecetaRepository(db)
	insumoRepo := repository.NewInsumoRepository(db)

	// ── Cifrado fiscal ──────────────────────────────────────────────
	// Sin FISCAL_CIPHER_KEY el módulo fiscal queda apagado: no se pueden
	// guardar certificados (la API lo rechaza con 503) ni facturar. Lo que no
	// pasa nunca es guardar un certificado en claro.
	var cifrador infra.Cifrador
	if c, err := infra.NewCifrador(cfg.FiscalCipherKey); err != nil {
		if errors.Is(err, infra.ErrCifradoNoConfigurado) {
			log.Warn().Msg("FISCAL_CIPHER_KEY no está seteada: el módulo fiscal (ARCA) queda deshabilitado")
		} else {
			log.Fatal().Err(err).Msg("FISCAL_CIPHER_KEY inválida")
		}
	} else {
		cifrador = c
	}

	// ── Anti-ausentismo ─────────────────────────────────────────────
	// Los workers viven mientras viva el proceso; el ctx se cancela en el
	// shutdown para que el ticker corte antes de que se cierren db y redis.
	ctxWorkers, pararWorkers := context.WithCancel(context.Background())
	defer pararWorkers()

	publicador := worker.NewPublicador(rdb)
	worker.NewRecordatorios(worker.RecordatoriosConfig{
		Repo: avisoRepo,
		Pub:  publicador,
	}).Start(ctxWorkers)
	// El hook de liberación no es un ticker: lo dispara el motor cuando se
	// cancela un turno futuro.
	huecoLiberado := worker.NewListaEsperaNotificador(listaEsperaRepo, avisoRepo, publicador, nil)

	// ── Facturador ARCA ─────────────────────────────────────────────
	// Barrido cross-tenant: es un proceso de fondo, no un request, y por eso
	// es el único lugar del core que mira comprobantes de todos los negocios.
	if fact := worker.NewFacturador(worker.FacturadorConfig{
		Repo:          cobroRepo,
		Pub:           publicador,
		Cifrador:      cifrador,
		SidecarURL:    cfg.ARCASidecarURL,
		InternalToken: cfg.InternalAPIToken,
	}); fact != nil {
		fact.Start(ctxWorkers)
	} else {
		log.Warn().Msg("worker facturador apagado: falta FISCAL_CIPHER_KEY o ARCA_SIDECAR_URL")
	}

	r := router.New(router.Deps{
		Cfg:        cfg,
		DB:         db,
		RDB:        rdb,
		AuthSvc:    service.NewAuthService(usuarioRepo, cfg, rdb),
		NegocioSvc: service.NewNegocioService(db, negocioRepo, usuarioRepo),
		CatalogoSvc: service.NewCatalogoService(categoriaRepo, recursoRepo, servicioRepo, coberturaRepo,
			service.ConCupoEnCatalogo(cupoRepo, jornadaRepo),
			// Las dos fuentes de `restante` se cablean juntas: la receta manda
			// sobre el cupo manual, y un catálogo con una sola de las dos
			// opciones le miente al agente sobre la mitad de la carta.
			service.ConRecetasEnCatalogo(recetaRepo),
		),
		ClienteSvc: service.NewClienteService(clienteRepo, coberturaRepo),
		AuditSvc:   service.NewAuditService(auditRepo),
		MotorSvc: service.NewMotorGastro(
			service.NewMotorService(compromisoRepo, holdRepo, service.ConNotificador(huecoLiberado)),
			negDatosRepo,
			service.ConAvisadorPedido(worker.NewAvisadorPedido(publicador)),
			// Las dos capas del stock en una sola opción: el descontador mira
			// plato por plato si baja insumos (tiene receta) o cupo del día
			// (tiene cupo manual), y el que no tiene ninguno sigue siendo
			// ilimitado. Un negocio sin insumos cargados se comporta
			// exactamente como antes de esta capability.
			service.ConControlDeStock(
				service.NewDescontadorStock(recetaRepo, insumoRepo, cupoRepo),
				jornadaRepo,
			),
		),
		HoldSvc:     service.NewHoldService(holdRepo, compromisoRepo),
		DispoSvc:    service.NewDisponibilidadService(dispoRepo),
		TokenSvc:    service.NewNegocioTokenService(negDatosRepo),
		ListaEspSvc: service.NewListaEsperaService(listaEsperaRepo),
		ConsultaSvc: service.NewConsultaService(consultaRepo, worker.NewAvisadorConsulta(publicador)),
		CobroSvc:    service.NewCobroService(cobroRepo, negDatosRepo, cifrador),
		JornadaSvc:  service.NewJornadaService(jornadaRepo),
		// La exclusión receta ⊕ cupo se cablea en LOS DOS sentidos, acá y en
		// RecetaSvc. Con una sola mitad la regla se puede violar entrando por
		// el lado que quedó suelto, y un plato con dos fuentes para el mismo
		// número obliga a inventar una precedencia que nadie quiere explicar.
		CupoSvc: service.NewCupoService(cupoRepo, jornadaRepo, servicioRepo,
			service.ConExclusionDeReceta(recetaRepo),
		),
		InsumoSvc: service.NewInsumoService(insumoRepo),
		RecetaSvc: service.NewRecetaService(recetaRepo, insumoRepo, servicioRepo,
			service.ConExclusionDeCupo(cupoRepo, jornadaRepo),
		),
		ReporteSvc:   service.NewReporteService(reporteRepo, negDatosRepo),
		NegDatosRepo: negDatosRepo,
		HorarioH:     handler.NewHorariosHandler(horarioRepo),
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown on SIGINT / SIGTERM
	go func() {
		log.Info().Msgf("copiloto-core listening on :%d", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("shutting down…")
	pararWorkers()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatal().Err(err).Msg("forced shutdown")
	}

	sqlDB, _ := db.DB()
	if sqlDB != nil {
		_ = sqlDB.Close()
	}
	_ = rdb.Close()

	log.Info().Msg("server exited")
}
