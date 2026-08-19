// Package testutil levanta la infraestructura real de los tests de integración:
// un PostgreSQL efímero por paquete de test, migrado con golang-migrate contra
// core/migrations. Nada de sqlite ni de GORM AutoMigrate: si el test no corre
// contra el mismo motor y el mismo esquema que producción, no prueba nada
// (los tipos ENUM, el UNIQUE (negocio_id, telefono) y los CHECK sólo existen en
// las migraciones).
package testutil

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	gormpostgres "gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	imagenPostgres = "postgres:16-alpine"
	baseTest       = "copiloto_test"
	usuarioTest    = "copiloto"
	passwordTest   = "copiloto"
)

// Entorno es el postgres efímero de un paquete de test.
type Entorno struct {
	DB  *gorm.DB
	DSN string

	contenedor *tcpostgres.PostgresContainer
	tablas     []string // tablas de dominio, para el truncado entre tests
}

// Arrancar levanta postgres:16-alpine, aplica todas las migraciones y devuelve
// el entorno más su cleanup. Un contenedor por paquete: llamarlo desde TestMain,
// nunca por test (arrancar un contenedor cuesta segundos; truncar cuesta ms).
func Arrancar(ctx context.Context) (*Entorno, func(), error) {
	contenedor, err := tcpostgres.Run(ctx, imagenPostgres,
		tcpostgres.WithDatabase(baseTest),
		tcpostgres.WithUsername(usuarioTest),
		tcpostgres.WithPassword(passwordTest),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("levantar postgres: %w", err)
	}

	cerrar := func() {
		ctxCierre, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = contenedor.Terminate(ctxCierre)
	}

	dsn, err := contenedor.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		cerrar()
		return nil, nil, fmt.Errorf("dsn del contenedor: %w", err)
	}

	if err := aplicarMigraciones(dsn); err != nil {
		cerrar()
		return nil, nil, err
	}

	db, err := gorm.Open(gormpostgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		cerrar()
		return nil, nil, fmt.Errorf("conectar gorm: %w", err)
	}

	env := &Entorno{DB: db, DSN: dsn, contenedor: contenedor}
	if err := env.cargarTablas(); err != nil {
		cerrar()
		return nil, nil, err
	}

	return env, cerrar, nil
}

// RutaMigraciones resuelve core/migrations desde la ubicación de ESTE archivo.
// Con runtime.Caller y no con rutas relativas al cwd: `go test ./tests/...`
// corre cada paquete con su propio directorio como cwd, así que un
// "../../migrations" a secas se rompe apenas alguien mueve un test de carpeta.
func RutaMigraciones() (string, error) {
	_, archivo, _, ok := runtime.Caller(0)
	if !ok {
		return "", errors.New("no se pudo resolver la ruta de testutil/db.go")
	}
	// archivo = <repo>/core/tests/testutil/db.go
	raiz := filepath.Dir(filepath.Dir(filepath.Dir(archivo))) // <repo>/core
	ruta := filepath.Join(raiz, "migrations")
	return ruta, nil
}

func aplicarMigraciones(dsn string) error {
	ruta, err := RutaMigraciones()
	if err != nil {
		return err
	}

	m, err := migrate.New("file://"+ruta, dsn)
	if err != nil {
		return fmt.Errorf("abrir migraciones en %s: %w", ruta, err)
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("aplicar migraciones: %w", err)
	}
	return nil
}

// cargarTablas lee el esquema real en vez de hardcodear la lista: una migración
// nueva que agregue una tabla queda truncada sola y no filtra estado entre tests.
func (e *Entorno) cargarTablas() error {
	var tablas []string
	err := e.DB.Raw(`
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
	`).Scan(&tablas).Error
	if err != nil {
		return fmt.Errorf("listar tablas: %w", err)
	}
	if len(tablas) == 0 {
		return errors.New("el esquema quedó vacío: las migraciones no se aplicaron")
	}
	e.tablas = tablas
	return nil
}

// Limpiar deja la base como recién migrada. Va al principio de cada test:
// los tests comparten contenedor, así que el aislamiento lo da el truncado.
// Un solo TRUNCATE de todas las tablas evita pelear con el orden de las FK.
func (e *Entorno) Limpiar(t *testing.T) {
	t.Helper()
	if len(e.tablas) == 0 {
		t.Fatal("entorno sin tablas: ¿se llamó a Arrancar?")
	}
	sql := fmt.Sprintf(
		"TRUNCATE TABLE %s RESTART IDENTITY CASCADE",
		strings.Join(citar(e.tablas), ", "),
	)
	if err := e.DB.Exec(sql).Error; err != nil {
		t.Fatalf("truncar tablas: %v", err)
	}
}

func citar(tablas []string) []string {
	salida := make([]string, len(tablas))
	for i, t := range tablas {
		salida[i] = `"` + t + `"`
	}
	return salida
}
