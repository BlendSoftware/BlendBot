package integration

import (
	"testing"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// TestClienteTelefonoUnicoPorNegocio: el teléfono es la identidad del cliente en
// WhatsApp. Duplicarlo dentro de un negocio partiría el historial del paciente
// en dos fichas; pero el MISMO número tiene que poder ser cliente de la
// pizzería y del consultorio, que es el caso normal y no una excepción.
func TestClienteTelefonoUnicoPorNegocio(t *testing.T) {
	ctx, db := nuevoCaso(t)

	clientes := repository.NewClienteRepository(db)
	unNegocio := crearNegocio(t, db, "Consultorio Gómez", model.VerticalSalud)
	otroNegocio := crearNegocio(t, db, "Pizzería Don Juan", model.VerticalGastronomia)

	const telefono = "5492611234567"

	primero := &model.Cliente{NegocioID: unNegocio.ID, Telefono: telefono, Nombre: ptr("Juana")}
	if err := clientes.Create(ctx, unNegocio.ID, primero); err != nil {
		t.Fatalf("primer cliente: %v", err)
	}

	t.Run("el mismo teléfono en el mismo negocio falla", func(t *testing.T) {
		repetido := &model.Cliente{NegocioID: unNegocio.ID, Telefono: telefono, Nombre: ptr("Juana otra vez")}
		err := clientes.Create(ctx, unNegocio.ID, repetido)
		exigirError(t, err, nil, "segundo cliente con el mismo teléfono")

		var cuantos int64
		db.Model(&model.Cliente{}).Where("negocio_id = ? AND telefono = ?", unNegocio.ID, telefono).Count(&cuantos)
		if cuantos != 1 {
			t.Errorf("quedaron %d fichas para el mismo teléfono", cuantos)
		}
	})

	t.Run("el mismo teléfono en otro negocio entra", func(t *testing.T) {
		enOtro := &model.Cliente{NegocioID: otroNegocio.ID, Telefono: telefono, Nombre: ptr("Juana en la pizzería")}
		if err := clientes.Create(ctx, otroNegocio.ID, enOtro); err != nil {
			t.Fatalf("el mismo número es cliente de dos negocios distintos: %v", err)
		}
		if enOtro.ID == primero.ID {
			t.Error("son dos fichas distintas, no la misma")
		}
	})

	t.Run("cada negocio resuelve el teléfono a su propia ficha", func(t *testing.T) {
		aca, err := clientes.GetByTelefono(ctx, unNegocio.ID, telefono)
		if err != nil || aca == nil {
			t.Fatalf("buscar en el consultorio: %v", err)
		}
		alla, err := clientes.GetByTelefono(ctx, otroNegocio.ID, telefono)
		if err != nil || alla == nil {
			t.Fatalf("buscar en la pizzería: %v", err)
		}
		if aca.ID == alla.ID {
			t.Error("el mismo teléfono resolvió a la misma ficha en dos negocios")
		}
		if aca.ID != primero.ID {
			t.Errorf("el consultorio resolvió a una ficha ajena: %s", aca.ID)
		}
	})
}

// TestClienteNoEncontradoPorTelefono: el número que escribe por primera vez no
// tiene ficha, y eso no es un error del sistema — es el alta.
func TestClienteNoEncontradoPorTelefono(t *testing.T) {
	ctx, db := nuevoCaso(t)

	clientes := repository.NewClienteRepository(db)
	neg := crearNegocio(t, db, "Consultorio Gómez", model.VerticalSalud)

	c, err := clientes.GetByTelefono(ctx, neg.ID, "5492610000000")
	if err == nil && c != nil {
		t.Error("apareció una ficha para un teléfono que nunca escribió")
	}
}
