package e2e

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// ── Helpers de la Capa 2 por HTTP ───────────────────────────────────────────

// altaInsumo carga materia prima por el mismo endpoint que usa el panel.
func altaInsumo(t *testing.T, token, nombre, unidad string, inicial int) dto.InsumoResponse {
	t.Helper()
	var i dto.InsumoResponse
	hacer(t, http.MethodPost, "/api/insumos", map[string]any{
		"nombre":        nombre,
		"unidad":        unidad,
		"stock_inicial": inicial,
	}, token).exigir(http.StatusCreated).en(&i)
	return i
}

// cargarReceta declara de qué está hecho un plato. items es insumo → cantidad
// por porción, en la unidad del insumo.
func cargarReceta(t *testing.T, token, servicioID string, items ...map[string]any) dto.RecetaResponse {
	t.Helper()
	var r dto.RecetaResponse
	hacer(t, http.MethodPut, "/api/servicios/"+servicioID+"/receta", map[string]any{
		"items": items,
	}, token).exigir(http.StatusOK).en(&r)
	return r
}

func lineaReceta(insumoID string, cantidad int) map[string]any {
	return map[string]any{"insumo_id": insumoID, "cantidad": cantidad}
}

// insumoPorID relee el saldo desde el listado del panel. Se relee de la API y
// no se confía en lo que devolvió la operación anterior: lo que importa es lo
// que el dueño ve en la pantalla.
func insumoPorID(t *testing.T, token, id string) dto.InsumoResponse {
	t.Helper()
	var lista []dto.InsumoResponse
	hacer(t, http.MethodGet, "/api/insumos", nil, token).exigir(http.StatusOK).en(&lista)
	for _, i := range lista {
		if i.ID == id {
			return i
		}
	}
	t.Fatalf("el insumo %s no salió en el listado (%d insumos)", id, len(lista))
	return dto.InsumoResponse{}
}

// movimientos es la historia de un insumo, del más nuevo al más viejo (que es
// como la devuelve la API y como la lee el panel).
func movimientos(t *testing.T, token, insumoID string) []dto.MovimientoResponse {
	t.Helper()
	var movs []dto.MovimientoResponse
	hacer(t, http.MethodGet, "/api/insumos/"+insumoID+"/movimientos", nil, token).
		exigir(http.StatusOK).en(&movs)
	return movs
}

// pedidoDe arma un pedido para retirar con las líneas que se le pasen.
func pedidoDe(t *testing.T, token, clienteID string, lineas ...map[string]any) dto.CompromisoResponse {
	t.Helper()
	var p dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": clienteID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas":     lineas,
	}, token).exigir(http.StatusCreated).en(&p)
	return p
}

func lineaPedido(servicioID string, cantidad int) map[string]any {
	return map[string]any{"servicio_id": servicioID, "cantidad": cantidad}
}

// transicionar mueve el pedido y devuelve la respuesta cruda: el status lo
// verifica quien llama, porque el 409 es un resultado esperado en la mitad de
// estos tests.
func transicionar(t *testing.T, token, compromisoID, estado string) respuesta {
	t.Helper()
	return hacer(t, http.MethodPatch, "/api/compromisos/"+compromisoID+"/estado", map[string]any{
		"estado": estado, "demora_min": 25,
	}, token)
}

// consumosDe filtra la historia de un insumo por tipo.
func movimientosDeTipo(movs []dto.MovimientoResponse, tipo string) []dto.MovimientoResponse {
	var out []dto.MovimientoResponse
	for _, m := range movs {
		if m.Tipo == tipo {
			out = append(out, m)
		}
	}
	return out
}

// ── Confirmar un pedido descuenta los insumos ───────────────────────────────

/*
TestConfirmarUnPedidoDescuentaLosInsumos recorre por HTTP los cuatro escenarios
del requirement "Confirmar un pedido descuenta los insumos", en el orden en que
le pasan a un local un viernes:

  - se confirma un pedido de 3 hamburguesas y baja 3 de cada insumo;
  - el siguiente pedido no tiene pan y frena TODO, nombrando al pan;
  - se cancela el primero y la carne vuelve;
  - y cancelar dos veces no devuelve dos veces.

Va contra el router real con las dos capas cableadas, que es la única forma de
probar que el 409 sale con el mensaje que el local necesita leer.
*/
func TestConfirmarUnPedidoDescuentaLosInsumos(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla-insumos",
		`{"confirmacion":{"pedido":"humana"},"acepta_delivery":false}`)

	hamburguesa := crearServicio(t, token, "Hamburguesa", 30, 9500)
	medallon := altaInsumo(t, token, "medallón", model.UnidadUnidad, 10)
	pan := altaInsumo(t, token, "pan de papa", model.UnidadUnidad, 4)
	cargarReceta(t, token, hamburguesa.ID, lineaReceta(medallon.ID, 1), lineaReceta(pan.ID, 1))

	abrirCaja(t, token)
	juana := clienteNuevo(t, token, "5492611000901", "Juana")

	// ── Un pedido de 3 unidades descuenta 3, no 1 ───────────────────────────
	tresHamburguesas := pedidoDe(t, token, juana.ID, lineaPedido(hamburguesa.ID, 3))
	transicionar(t, token, tresHamburguesas.ID, "confirmado").exigir(http.StatusOK)

	t.Run("el pedido de 3 unidades se llevó 3 de cada insumo", func(t *testing.T) {
		igual(t, insumoPorID(t, token, medallon.ID).Stock, 7, "medallones tras vender 3")
		igual(t, insumoPorID(t, token, pan.ID).Stock, 1, "panes tras vender 3")

		consumos := movimientosDeTipo(movimientos(t, token, pan.ID), model.MovConsumo)
		if len(consumos) != 1 {
			t.Fatalf("esperaba un `consumo` del pan, obtuve %+v", consumos)
		}
		igual(t, consumos[0].Cantidad, 3, "la cantidad del consumo es por unidades pedidas")
		igual(t, consumos[0].SaldoResultante, 1, "el saldo que registra el movimiento")
		if consumos[0].CompromisoID == nil || *consumos[0].CompromisoID != tresHamburguesas.ID {
			t.Errorf("el consumo tiene que referenciar al pedido, dice %v", consumos[0].CompromisoID)
		}
	})

	t.Run("el catálogo ya lo refleja", func(t *testing.T) {
		servicios, _ := catalogo(t, token, true)
		h := delCatalogo(t, servicios, "Hamburguesa")
		// Quedan 7 medallones y 1 pan → 1 porción, y el pan es el limitante.
		exigirRestanteHTTP(t, h, 1, false)
		if h.Limitante == nil {
			t.Fatalf("el catálogo no nombró al insumo limitante de la hamburguesa")
		}
		// El nombre y la unidad juntos: "quedan 1" no dice nada si no se sabe si
		// es un gramo o un pan, y ésa es la frase que el dueño lee cuando un
		// plato se apagó solo.
		igual(t, h.Limitante.Insumo, "pan de papa", "el insumo limitante")
		igual(t, h.Limitante.Unidad, model.UnidadUnidad, "la unidad del limitante")
		igual(t, h.Limitante.Stock, 1, "cuánto queda del limitante")
		igual(t, h.Limitante.PideLaReceta, 1, "cuánto pide la receta por porción")
	})

	// ── Un insumo insuficiente frena TODO el pedido ─────────────────────────
	pedro := clienteNuevo(t, token, "5492611000902", "Pedro")
	deMas := pedidoDe(t, token, pedro.ID, lineaPedido(hamburguesa.ID, 5)) // hay 1 pan

	t.Run("el 409 nombra el insumo que faltó", func(t *testing.T) {
		r := transicionar(t, token, deMas.ID, "confirmado").exigir(http.StatusConflict)
		if !strings.Contains(strings.ToLower(r.detalle()), "pan de papa") {
			t.Errorf("el 409 tiene que decir QUÉ insumo faltó para que el local lo pueda ir a buscar, dijo: %q",
				r.detalle())
		}
	})

	t.Run("ningún otro insumo del pedido quedó descontado", func(t *testing.T) {
		// Los medallones alcanzaban de sobra (7 para 5). Si el descuento no
		// fuera todo-o-nada, se habrían ido igual y el saldo de la heladera
		// quedaría mintiendo por un pedido que nunca existió.
		igual(t, insumoPorID(t, token, medallon.ID).Stock, 7, "medallones tras el pedido rechazado")
		igual(t, insumoPorID(t, token, pan.ID).Stock, 1, "panes tras el pedido rechazado")
		for _, id := range []string{medallon.ID, pan.ID} {
			for _, m := range movimientos(t, token, id) {
				if m.CompromisoID != nil && *m.CompromisoID == deMas.ID {
					t.Errorf("el pedido rechazado dejó un movimiento en el libro mayor: %+v", m)
				}
			}
		}
	})

	t.Run("y el pedido sigue pendiente", func(t *testing.T) {
		var relectura dto.CompromisoResponse
		hacer(t, http.MethodGet, "/api/compromisos/"+deMas.ID, nil, token).
			exigir(http.StatusOK).en(&relectura)
		igual(t, relectura.Estado, model.EstadoPendiente, "el pedido rechazado no cambió de estado")
	})

	// ── Cancelar devuelve ───────────────────────────────────────────────────
	t.Run("cancelar devuelve lo que se había consumido", func(t *testing.T) {
		transicionar(t, token, tresHamburguesas.ID, "cancelado").exigir(http.StatusOK)
		igual(t, insumoPorID(t, token, medallon.ID).Stock, 10, "medallones tras cancelar")
		igual(t, insumoPorID(t, token, pan.ID).Stock, 4, "panes tras cancelar")

		devoluciones := movimientosDeTipo(movimientos(t, token, medallon.ID), model.MovDevolucion)
		if len(devoluciones) != 1 {
			t.Fatalf("esperaba una `devolucion` de medallones, obtuve %+v", devoluciones)
		}
		igual(t, devoluciones[0].Cantidad, 3, "la devolución reintegra lo que se llevó")
		if devoluciones[0].CompromisoID == nil || *devoluciones[0].CompromisoID != tresHamburguesas.ID {
			t.Errorf("la devolución tiene que referenciar al pedido, dice %v", devoluciones[0].CompromisoID)
		}
	})

	t.Run("cancelar de nuevo no reintegra dos veces", func(t *testing.T) {
		// El stock de un insumo es un saldo real que sobrevive para siempre: si
		// se infla de más no hay piso que lo detecte, el número simplemente
		// queda mal con confianza. La segunda pasada tiene que ver la deuda en
		// cero y no hacer nada.
		transicionar(t, token, tresHamburguesas.ID, "cancelado") // ya está cancelado
		igual(t, insumoPorID(t, token, medallon.ID).Stock, 10, "medallones tras la segunda cancelación")
		igual(t, insumoPorID(t, token, pan.ID).Stock, 4, "panes tras la segunda cancelación")
		devoluciones := movimientosDeTipo(movimientos(t, token, medallon.ID), model.MovDevolucion)
		if len(devoluciones) != 1 {
			t.Errorf("se escribieron %d devoluciones para el mismo pedido", len(devoluciones))
		}
	})
}

// TestCancelarDevuelveLoQueSeConsumioYNoLoQueLaRecetaDiceAhora: alguien editó
// la receta entre la confirmación y la cancelación, que es un martes cualquiera.
//
// La devolución se lee del LIBRO MAYOR, no se recalcula desde la receta actual.
// Recalcular parece equivalente y no lo es: le mete al insumo una cantidad que
// nunca salió, en silencio, y el saldo queda mintiendo sin que nadie pueda
// notarlo. "Deshacé lo que hiciste", no "recalculá lo que harías ahora".
func TestCancelarDevuelveLoQueSeConsumioYNoLoQueLaRecetaDiceAhora(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla-receta-editada",
		`{"confirmacion":{"pedido":"humana"},"acepta_delivery":false}`)

	milanesa := crearServicio(t, token, "Milanesa", 30, 9800)
	carne := altaInsumo(t, token, "carne picada", model.UnidadGramo, 2000)
	cargarReceta(t, token, milanesa.ID, lineaReceta(carne.ID, 300))

	abrirCaja(t, token)
	juana := clienteNuevo(t, token, "5492611001001", "Juana")

	p := pedidoDe(t, token, juana.ID, lineaPedido(milanesa.ID, 2))
	transicionar(t, token, p.ID, "confirmado").exigir(http.StatusOK)
	igual(t, insumoPorID(t, token, carne.ID).Stock, 1400, "se llevó 2 × 300")

	// El dueño corrige la receta: en realidad la milanesa lleva 500 g.
	cargarReceta(t, token, milanesa.ID, lineaReceta(carne.ID, 500))

	transicionar(t, token, p.ID, "cancelado").exigir(http.StatusOK)

	// Si devolviera por la receta NUEVA reintegraría 1000 y la carne quedaría
	// en 2400: cuatrocientos gramos que nunca existieron.
	igual(t, insumoPorID(t, token, carne.ID).Stock, 2000, "la devolución deshace lo que el pedido se llevó")
	devoluciones := movimientosDeTipo(movimientos(t, token, carne.ID), model.MovDevolucion)
	if len(devoluciones) != 1 {
		t.Fatalf("esperaba una devolución, obtuve %+v", devoluciones)
	}
	igual(t, devoluciones[0].Cantidad, 600, "se devuelve lo consumido, no lo que la receta dice ahora")
}

// TestDosPedidosPorElUltimoPan: los dos clientes vieron la misma última porción
// y los dos piden. Uno confirma, el otro se come el 409, y el stock del pan no
// queda negativo — la última línea de defensa es el CHECK de la tabla, igual
// que en la Capa 1.
func TestDosPedidosPorElUltimoPan(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla-ultimo-pan",
		`{"confirmacion":{"pedido":"humana"},"acepta_delivery":false}`)

	hamburguesa := crearServicio(t, token, "Hamburguesa", 30, 9500)
	medallon := altaInsumo(t, token, "medallón", model.UnidadUnidad, 10)
	pan := altaInsumo(t, token, "pan de papa", model.UnidadUnidad, 1)
	cargarReceta(t, token, hamburguesa.ID, lineaReceta(medallon.ID, 1), lineaReceta(pan.ID, 1))

	abrirCaja(t, token)
	juana := clienteNuevo(t, token, "5492611001101", "Juana")
	pedro := clienteNuevo(t, token, "5492611001102", "Pedro")

	// Los dos pedidos se arman ANTES de confirmar ninguno: así es como pasa en
	// el mostrador.
	primero := pedidoDe(t, token, juana.ID, lineaPedido(hamburguesa.ID, 1))
	segundo := pedidoDe(t, token, pedro.ID, lineaPedido(hamburguesa.ID, 1))

	transicionar(t, token, primero.ID, "confirmado").exigir(http.StatusOK)
	r := transicionar(t, token, segundo.ID, "confirmado").exigir(http.StatusConflict)
	if !strings.Contains(strings.ToLower(r.detalle()), "pan de papa") {
		t.Errorf("el 409 del segundo tiene que nombrar el pan, dijo: %q", r.detalle())
	}

	igual(t, insumoPorID(t, token, pan.ID).Stock, 0, "el pan quedó en cero, nunca en negativo")
	// El medallón del segundo pedido tampoco se fue: el descuento es todo o nada.
	igual(t, insumoPorID(t, token, medallon.ID).Stock, 9, "se descontó un solo medallón")

	servicios, crudo := catalogo(t, token, true)
	h := delCatalogo(t, servicios, "Hamburguesa")
	exigirRestanteHTTP(t, h, 0, true)
	if !strings.Contains(crudo, `"restante":0`) {
		t.Errorf("el JSON del agotado por receta tiene que decir restante 0: %s", crudo)
	}
}

// ── Los dos controles en la misma confirmación ──────────────────────────────

/*
TestUnPedidoMixtoAplicaLosDosControles es el escenario "Los platos sin receta no
se ven afectados": un pedido con una hamburguesa (receta) y una provoleta (cupo
manual) baja las dos cosas en la misma confirmación, cada una de su capa.

Y después el caso que ordena el orden de las capas: cuando el que falla es el
CUPO, el libro mayor de insumos tiene que quedar sin UN SOLO movimiento.
Compensar cupo es invisible —un contador que se tira al cerrar la caja—;
compensar insumos deja un par consumo/devolución PERMANENTE por un pedido que
nunca existió, justo en la tabla que le contesta al dueño "compré 20 kg, ¿por
qué me quedan 3?".
*/
func TestUnPedidoMixtoAplicaLosDosControles(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla-mixta",
		`{"confirmacion":{"pedido":"humana"},"acepta_delivery":false}`)

	hamburguesa := crearServicio(t, token, "Hamburguesa", 30, 9500)
	provoleta := crearServicio(t, token, "Provoleta", 30, 6800)
	empanadas := crearServicio(t, token, "Empanadas", 30, 4500)

	medallon := altaInsumo(t, token, "medallón", model.UnidadUnidad, 10)
	cargarReceta(t, token, hamburguesa.ID, lineaReceta(medallon.ID, 2))

	abrirCaja(t, token)
	cargarCupo(t, token, provoleta.ID, 3)
	// Empanadas no tiene ni receta ni cupo: es el control de que "ilimitado"
	// sigue siendo el default y no se contagia del resto de la carta.

	juana := clienteNuevo(t, token, "5492611001201", "Juana")
	mixto := pedidoDe(t, token, juana.ID,
		lineaPedido(hamburguesa.ID, 2),
		lineaPedido(provoleta.ID, 1),
		lineaPedido(empanadas.ID, 4),
	)
	transicionar(t, token, mixto.ID, "confirmado").exigir(http.StatusOK)

	t.Run("el plato con receta descontó insumos", func(t *testing.T) {
		igual(t, insumoPorID(t, token, medallon.ID).Stock, 6, "2 hamburguesas × 2 medallones")
	})

	t.Run("el plato con cupo descontó cupo", func(t *testing.T) {
		var stock []dto.CupoResponse
		hacer(t, http.MethodGet, "/api/stock", nil, token).exigir(http.StatusOK).en(&stock)
		if len(stock) != 1 {
			t.Fatalf("esperaba una sola fila de cupo (la provoleta), obtuve %+v", stock)
		}
		igual(t, stock[0].ServicioID, provoleta.ID, "la fila de cupo es la de la provoleta")
		igual(t, stock[0].Consumido, 1, "se consumió una provoleta")
		igual(t, stock[0].Restante, 2, "quedan dos")
	})

	t.Run("el catálogo cuenta las dos fuentes y deja ilimitado lo que no tiene ninguna", func(t *testing.T) {
		servicios, crudo := catalogo(t, token, true)
		exigirRestanteHTTP(t, delCatalogo(t, servicios, "Hamburguesa"), 3, false) // 6 medallones / 2
		exigirRestanteHTTP(t, delCatalogo(t, servicios, "Provoleta"), 2, false)
		sinCuenta := delCatalogo(t, servicios, "Empanadas")
		if sinCuenta.Restante != nil {
			t.Errorf("Empanadas viajó con restante %d: sin receta ni cupo es ilimitado", *sinCuenta.Restante)
		}
		if !strings.Contains(crudo, `"restante":null`) {
			t.Errorf("el JSON no trae `restante: null` para el plato sin cuenta: %s", crudo)
		}
	})

	t.Run("un ErrSinCupo frena el pedido antes de tocar un solo insumo", func(t *testing.T) {
		// Quedan 2 provoletas de cupo y 6 medallones (3 hamburguesas). Se piden
		// 3 provoletas: la Capa 1 rebota, y la Capa 2 no se tiene que haber
		// enterado.
		pedro := clienteNuevo(t, token, "5492611001202", "Pedro")
		imposible := pedidoDe(t, token, pedro.ID,
			lineaPedido(hamburguesa.ID, 1),
			lineaPedido(provoleta.ID, 3),
		)
		r := transicionar(t, token, imposible.ID, "confirmado").exigir(http.StatusConflict)
		if !strings.Contains(strings.ToLower(r.detalle()), "cupo") {
			t.Errorf("el 409 tiene que hablar del cupo, dijo: %q", r.detalle())
		}

		igual(t, insumoPorID(t, token, medallon.ID).Stock, 6, "los medallones no se tocaron")
		for _, m := range movimientos(t, token, medallon.ID) {
			if m.CompromisoID != nil && *m.CompromisoID == imposible.ID {
				t.Errorf("el pedido que frenó por cupo ensució el libro mayor de insumos: %+v", m)
			}
		}
	})
}

// TestElPlatoSinRecetaViajaIgualQueAntesDelCambio es la garantía del deploy: al
// negocio que no cargó un solo insumo no le cambia un byte de la respuesta.
//
// Se compara el JSON CRUDO y no la struct: `limitante` viaja con `omitempty`
// justamente para que el campo no aparezca donde no aplica, y una struct
// deserializada no distingue "no vino" de "vino en null". `restante`, en
// cambio, NO lleva omitempty y tiene que seguir escribiéndose: null es "no
// lleva cuenta" y 0 es "no queda", y colapsarlos apaga el plato equivocado.
func TestElPlatoSinRecetaViajaIgualQueAntesDelCambio(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla-sin-insumos",
		`{"confirmacion":{"pedido":"humana"},"acepta_delivery":false}`)

	crearServicio(t, token, "Empanadas", 30, 4500)
	abrirCaja(t, token)

	_, crudo := catalogo(t, token, true)

	var platos []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(crudo), &platos); err != nil {
		t.Fatalf("el catálogo no es una lista de objetos: %v — %s", err, crudo)
	}
	if len(platos) != 1 {
		t.Fatalf("esperaba un solo plato, obtuve %d", len(platos))
	}

	if _, hay := platos[0]["limitante"]; hay {
		t.Errorf("un plato sin receta no puede traer `limitante` en el JSON: %s", crudo)
	}
	restante, hay := platos[0]["restante"]
	if !hay {
		t.Fatalf("`restante` desapareció del JSON: null y 0 dejan de distinguirse — %s", crudo)
	}
	if string(restante) != "null" {
		t.Errorf("`restante` de un plato sin cuenta tiene que ser null explícito, vino %s", restante)
	}
	if string(platos[0]["agotado"]) != "false" {
		t.Errorf("`agotado` de un plato sin cuenta tiene que ser false, vino %s", platos[0]["agotado"])
	}
}
