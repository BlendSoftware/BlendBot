// Copiloto Comercios — Core
//
// El motor de compromisos: determinístico, testeable, sin un LLM en el medio.
// El agente y el panel hablan con este servicio por HTTP; el agente jamás
// toca la base de datos.
package main

import (
	"context"
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

	r := router.New(router.Deps{
		Cfg:         cfg,
		DB:          db,
		RDB:         rdb,
		AuthSvc:     service.NewAuthService(usuarioRepo, cfg, rdb),
		NegocioSvc:  service.NewNegocioService(db, negocioRepo, usuarioRepo),
		CatalogoSvc: service.NewCatalogoService(categoriaRepo, recursoRepo, servicioRepo, coberturaRepo),
		ClienteSvc:  service.NewClienteService(clienteRepo, coberturaRepo),
		AuditSvc:    service.NewAuditService(auditRepo),
		MotorSvc:    service.NewMotorService(compromisoRepo, holdRepo),
		HoldSvc:     service.NewHoldService(holdRepo, compromisoRepo),
		HorarioH:    handler.NewHorariosHandler(horarioRepo),
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
