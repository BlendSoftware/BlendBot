package config

import (
	"fmt"

	"github.com/spf13/viper"
)

// Config holds all runtime configuration loaded from environment variables.
type Config struct {
	// Server
	Port int    `mapstructure:"PORT"`
	Env  string `mapstructure:"APP_ENV"` // development | production

	// Database
	DatabaseURL    string `mapstructure:"DATABASE_URL"`
	MigrationsPath string `mapstructure:"MIGRATIONS_PATH"`

	// Redis
	RedisURL string `mapstructure:"REDIS_URL"`

	// Auth
	JWTSecret          string `mapstructure:"JWT_SECRET"`
	JWTExpirationHours int    `mapstructure:"JWT_EXPIRATION_HOURS"`
	JWTRefreshHours    int    `mapstructure:"JWT_REFRESH_HOURS"`

	// CORS — comma-separated list of allowed origins
	AllowedOrigins string `mapstructure:"ALLOWED_ORIGINS"`

	// Bootstrap: si no existe ningún usuario admin al arrancar y esta variable
	// está seteada, se crea el admin inicial de la plataforma.
	AdminUsername string `mapstructure:"ADMIN_USERNAME"`
	AdminPassword string `mapstructure:"ADMIN_PASSWORD"`

	// Sidecar ARCA
	ARCASidecarURL string `mapstructure:"ARCA_SIDECAR_URL"`
	// InternalAPIToken authenticates core → sidecar calls.
	// Must match INTERNAL_API_TOKEN in the sidecar container.
	InternalAPIToken string `mapstructure:"INTERNAL_API_TOKEN"`
	// FiscalCipherKey (64 hex = 32 bytes) cifra en reposo los certificados de
	// ARCA. Vacía = el módulo fiscal no puede guardar certificados y lo dice;
	// nunca se guarda un PEM en claro. Generar con: openssl rand -hex 32
	FiscalCipherKey string `mapstructure:"FISCAL_CIPHER_KEY"`
}

// Load reads configuration from environment variables (and optional .env file).
// It validates critical security settings and returns an error if they are not met.
func Load() (*Config, error) {
	viper.SetConfigName(".env")
	viper.SetConfigType("env")
	viper.AddConfigPath(".")
	viper.AutomaticEnv()

	viper.SetDefault("PORT", 8080)
	viper.SetDefault("APP_ENV", "development")
	viper.SetDefault("MIGRATIONS_PATH", "migrations")
	viper.SetDefault("JWT_EXPIRATION_HOURS", 8)
	viper.SetDefault("JWT_REFRESH_HOURS", 24)
	viper.SetDefault("ALLOWED_ORIGINS", "http://localhost:5173")
	viper.SetDefault("ADMIN_USERNAME", "admin")
	_ = viper.BindEnv("ADMIN_PASSWORD")
	viper.SetDefault("ARCA_SIDECAR_URL", "http://arca-sidecar:8001")
	viper.SetDefault("INTERNAL_API_TOKEN", "")
	viper.SetDefault("DATABASE_URL", "postgres://copiloto:copiloto@localhost:5433/copiloto?sslmode=disable")
	viper.SetDefault("REDIS_URL", "redis://localhost:6379/0")

	// viper only checks env vars for keys it already knows about; BindEnv is
	// required for keys that have no default value.
	_ = viper.BindEnv("JWT_SECRET")
	_ = viper.BindEnv("DATABASE_URL")
	_ = viper.BindEnv("REDIS_URL")
	_ = viper.BindEnv("INTERNAL_API_TOKEN")
	_ = viper.BindEnv("FISCAL_CIPHER_KEY")

	// Optional .env file for local development — does not fail if missing
	_ = viper.ReadInConfig()

	cfg := &Config{}
	if err := viper.Unmarshal(cfg); err != nil {
		return nil, err
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// validate checks critical security invariants that must hold before the
// server is allowed to start.
func (c *Config) validate() error {
	if len(c.JWTSecret) < 32 {
		return fmt.Errorf("FATAL: JWT_SECRET must be at least 32 characters long (got %d). "+
			"Generate one with: openssl rand -hex 32", len(c.JWTSecret))
	}

	if c.Env == "production" && c.InternalAPIToken == "" {
		fmt.Println("WARNING: INTERNAL_API_TOKEN is not set. ARCA sidecar calls will be unauthenticated.")
	}

	return nil
}
