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
	"copiloto/core/internal/infra"
	"copiloto/core/internal/router"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

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

	r := router.New(router.Deps{Cfg: cfg, DB: db, RDB: rdb})

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
