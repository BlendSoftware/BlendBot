package infra

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/rs/zerolog/log"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// NewDatabase establishes a GORM connection backed by pgx.
//
// Schema is managed EXCLUSIVELY by SQL migrations (RunMigrations). GORM
// AutoMigrate is never used: mixing both already cost hundreds of lines of
// reconciliation patches in BlendPos.
//
// Retries up to 10 times with linear backoff (2s, 4s, …, 20s) to tolerate
// PostgreSQL starting slower than the backend (common in Docker).
func NewDatabase(dsn string) (*gorm.DB, error) {
	var db *gorm.DB
	var err error

	const maxRetries = 10

	for i := 0; i < maxRetries; i++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err == nil {
			sqlDB, sqlErr := db.DB()
			if sqlErr == nil {
				if pingErr := sqlDB.Ping(); pingErr == nil {
					log.Info().Int("attempt", i+1).Msg("database connected")
					sqlDB.SetMaxOpenConns(50)
					sqlDB.SetMaxIdleConns(10)
					sqlDB.SetConnMaxLifetime(5 * time.Minute)
					sqlDB.SetConnMaxIdleTime(5 * time.Minute)
					return db, nil
				}
			}
		}

		wait := time.Duration(i+1) * 2 * time.Second
		log.Warn().Int("attempt", i+1).Dur("retry_in", wait).Err(err).Msg("database not ready, retrying…")
		time.Sleep(wait)
	}

	return nil, fmt.Errorf("failed to connect to database after %d attempts: %w", maxRetries, err)
}

// RunMigrations applies every pending SQL migration from migrationsPath.
// Runs at startup so the binary is self-contained (no migrate CLI needed).
func RunMigrations(databaseURL, migrationsPath string) error {
	m, err := migrate.New("file://"+migrationsPath, databaseURL)
	if err != nil {
		return fmt.Errorf("open migrations: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}

	version, dirty, _ := m.Version()
	log.Info().Uint("version", version).Bool("dirty", dirty).Msg("migrations up to date")
	return nil
}
