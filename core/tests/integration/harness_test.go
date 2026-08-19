package integration

import (
	"testing"

	"copiloto/core/internal/model"
)

// TestHarnessAplicaMigracionesYLimpia guarda el propio harness: si el esquema no
// se migró o el truncado entre tests no corre, el resto de los tests fallaría
// por razones inventadas y perseguiríamos el bug equivocado.
func TestHarnessAplicaMigracionesYLimpia(t *testing.T) {
	_, db := nuevoCaso(t)

	t.Run("el esquema real está migrado", func(t *testing.T) {
		// Un ENUM de la migración: si esto existe, corrió el SQL y no un
		// AutoMigrate improvisado.
		var n int64
		if err := db.Raw(`SELECT COUNT(*) FROM pg_type WHERE typname = 'estado_compromiso'`).Scan(&n).Error; err != nil {
			t.Fatalf("consultar pg_type: %v", err)
		}
		if n != 1 {
			t.Fatalf("el tipo estado_compromiso no existe: las migraciones no se aplicaron")
		}
	})

	t.Run("el truncado deja la base vacía", func(t *testing.T) {
		neg := crearNegocio(t, db, "Consultorio Gómez", model.VerticalSalud)
		crearCliente(t, db, neg.ID, "5492611111111", "Juana", nil)

		env.Limpiar(t)

		var negocios, clientes int64
		db.Model(&model.Negocio{}).Count(&negocios)
		db.Model(&model.Cliente{}).Count(&clientes)
		if negocios != 0 || clientes != 0 {
			t.Fatalf("tras Limpiar quedaron %d negocios y %d clientes", negocios, clientes)
		}
	})
}
