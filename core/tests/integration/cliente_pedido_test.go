// cliente_pedido_test cubre E11 / W7-B: el cliente del pedido se ve y queda
// registrado. Son pruebas ADITIVAS —el motor no se toca— sobre dos cosas que
// el dueño de la pizzería reportó rotas al usar el producto: la tarjeta del
// pedido no mostraba de quién era, y quien pedía no aparecía en Clientes.
package integration

import (
	"testing"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// TestCompromisoTraeNombreDelCliente: el tablero (ListTablero) y la ficha del
// pedido (GetByID) hidratan nombre y teléfono del cliente desde `cliente`,
// tenant-scoped. Sin esto la tarjeta de cocina no puede cantar de quién es el
// pedido, que es justo lo que el dueño pidió ver.
func TestCompromisoTraeNombreDelCliente(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)

	neg := crearNegocio(t, db, "Pizzería Don Juan", model.VerticalGastronomia)
	cli := crearCliente(t, db, neg.ID, "5492611234567", "Juani", nil)
	sv := crearServicio(t, db, neg.ID, "Muzza", "8000")
	ped := crearCompromisoDirecto(t, db, neg.ID, cli.ID, sv.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoPendiente, "8000")

	t.Run("el tablero trae el nombre y el teléfono", func(t *testing.T) {
		lista, err := compromisos.ListTablero(ctx, neg.ID, nil, nil, nil)
		if err != nil {
			t.Fatalf("listar tablero: %v", err)
		}
		if len(lista) != 1 {
			t.Fatalf("esperaba 1 pedido, hubo %d", len(lista))
		}
		got := lista[0]
		if got.ClienteNombre == nil || *got.ClienteNombre != "Juani" {
			t.Errorf("nombre del cliente no hidratado: %v", got.ClienteNombre)
		}
		if got.ClienteTelefono != "5492611234567" {
			t.Errorf("teléfono del cliente no hidratado: %q", got.ClienteTelefono)
		}
	})

	t.Run("la ficha del pedido también lo trae", func(t *testing.T) {
		got, err := compromisos.GetByID(ctx, neg.ID, ped.ID)
		if err != nil {
			t.Fatalf("obtener pedido: %v", err)
		}
		if got.ClienteNombre == nil || *got.ClienteNombre != "Juani" {
			t.Errorf("nombre del cliente no hidratado en GetByID: %v", got.ClienteNombre)
		}
		if got.ClienteTelefono != "5492611234567" {
			t.Errorf("teléfono no hidratado en GetByID: %q", got.ClienteTelefono)
		}
	})
}

// TestCompromisoSinNombreDeCliente: el que escribe por WhatsApp y todavía no dijo
// su nombre entra igual (D7: el compromiso incompleto es válido). El teléfono es
// la identidad y siempre viaja; el nombre queda nulo para que el panel muestre
// "Sin nombre" en vez de reventar.
func TestCompromisoSinNombreDeCliente(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)

	neg := crearNegocio(t, db, "Cantina", model.VerticalGastronomia)
	// Cliente sin nombre: se siembra con GORM directo dejando Nombre nil.
	cli := &model.Cliente{NegocioID: neg.ID, Telefono: "5492610000009"}
	if err := db.Create(cli).Error; err != nil {
		t.Fatalf("crear cliente sin nombre: %v", err)
	}
	sv := crearServicio(t, db, neg.ID, "Empanada", "900")
	crearCompromisoDirecto(t, db, neg.ID, cli.ID, sv.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoPendiente, "900")

	lista, err := compromisos.ListTablero(ctx, neg.ID, nil, nil, nil)
	if err != nil {
		t.Fatalf("listar tablero: %v", err)
	}
	if len(lista) != 1 {
		t.Fatalf("esperaba 1 pedido, hubo %d", len(lista))
	}
	if lista[0].ClienteNombre != nil {
		t.Errorf("un cliente sin nombre no debería inventar uno: %v", *lista[0].ClienteNombre)
	}
	if lista[0].ClienteTelefono != "5492610000009" {
		t.Errorf("el teléfono es la identidad y tiene que estar: %q", lista[0].ClienteTelefono)
	}
}

// TestCompromisoHidratacionTenantScoped: la hidratación del cliente se acota al
// negocio del tablero. Dos negocios con el MISMO teléfono (caso normal: un número
// es cliente de dos locales) resuelven cada uno a su propia ficha, sin filtrarse.
func TestCompromisoHidratacionTenantScoped(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)

	const tel = "5492611111222"
	a := crearNegocio(t, db, "Local A", model.VerticalGastronomia)
	cliA := crearCliente(t, db, a.ID, tel, "Ana en A", nil)
	svA := crearServicio(t, db, a.ID, "Burger", "8900")
	crearCompromisoDirecto(t, db, a.ID, cliA.ID, svA.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoPendiente, "8900")

	b := crearNegocio(t, db, "Local B", model.VerticalGastronomia)
	cliB := crearCliente(t, db, b.ID, tel, "Ana en B", nil)
	svB := crearServicio(t, db, b.ID, "Pizza", "12000")
	crearCompromisoDirecto(t, db, b.ID, cliB.ID, svB.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoPendiente, "12000")

	lista, err := compromisos.ListTablero(ctx, a.ID, nil, nil, nil)
	if err != nil {
		t.Fatalf("listar tablero de A: %v", err)
	}
	if len(lista) != 1 {
		t.Fatalf("el tablero de A debe traer sólo su pedido, hubo %d", len(lista))
	}
	if lista[0].ClienteNombre == nil || *lista[0].ClienteNombre != "Ana en A" {
		t.Errorf("A resolvió el cliente equivocado (fuga de tenant): %v", lista[0].ClienteNombre)
	}
}

// TestListarClientesConResumen: la vista de Clientes de gastronomía lista a TODOS
// los del negocio con su resumen. El que pidió aparece con la cuenta y el total
// de sus pedidos; el que todavía no pidió aparece en cero (no desaparece); y los
// de otro negocio no se cuelan.
func TestListarClientesConResumen(t *testing.T) {
	ctx, db := nuevoCaso(t)
	clientes := repository.NewClienteRepository(db)

	neg := crearNegocio(t, db, "Pizzería", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Muzza", "8000")

	// Ana pidió dos veces (8000 + 5000 = 13000).
	ana := crearCliente(t, db, neg.ID, "5492611000001", "Ana", nil)
	crearCompromisoDirecto(t, db, neg.ID, ana.ID, sv.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoCompletado, "8000")
	crearCompromisoDirecto(t, db, neg.ID, ana.ID, sv.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoPendiente, "5000")

	// Beto está cargado pero todavía no pidió: tiene que aparecer igual, en cero.
	crearCliente(t, db, neg.ID, "5492611000002", "Beto", nil)

	// Otro negocio con su cliente y su pedido: no debe aparecer ni sumar acá.
	otro := crearNegocio(t, db, "Otro Local", model.VerticalGastronomia)
	cliO := crearCliente(t, db, otro.ID, "5492611000003", "Ajeno", nil)
	svO := crearServicio(t, db, otro.ID, "Papas", "4500")
	crearCompromisoDirecto(t, db, otro.ID, cliO.ID, svO.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoPendiente, "4500")

	filas, err := clientes.ListarConResumen(ctx, neg.ID)
	if err != nil {
		t.Fatalf("listar clientes con resumen: %v", err)
	}
	if len(filas) != 2 {
		t.Fatalf("esperaba 2 clientes del negocio (Ana y Beto), hubo %d", len(filas))
	}

	porTel := make(map[string]repository.ClienteConResumen, len(filas))
	for _, f := range filas {
		porTel[f.Telefono] = f
	}

	anaFila, ok := porTel["5492611000001"]
	if !ok {
		t.Fatal("Ana no apareció en la lista")
	}
	if anaFila.CantidadPedidos != 2 {
		t.Errorf("Ana debería tener 2 pedidos, tuvo %d", anaFila.CantidadPedidos)
	}
	igualDecimal(t, anaFila.TotalAcumulado, "13000", "total acumulado de Ana")
	if anaFila.UltimoPedido == nil {
		t.Error("Ana pidió: su último pedido no debería ser nulo")
	}

	betoFila, ok := porTel["5492611000002"]
	if !ok {
		t.Fatal("Beto (cargado, sin pedidos) tiene que aparecer igual")
	}
	if betoFila.CantidadPedidos != 0 {
		t.Errorf("Beto no pidió: esperaba 0 pedidos, tuvo %d", betoFila.CantidadPedidos)
	}
	igualDecimal(t, betoFila.TotalAcumulado, "0", "total de Beto sin pedidos")

	if _, hay := porTel["5492611000003"]; hay {
		t.Error("el cliente de otro negocio se filtró en la lista")
	}
}
