package e2e

import (
	"net/http"
	"strings"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// abrirCaja abre la jornada del negocio del token. Sin caja abierta no hay día
// al que cargarle cupo, así que todo lo de stock arranca acá.
func abrirCaja(t *testing.T, token string) string {
	t.Helper()
	var j dto.JornadaResponse
	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).
		exigir(http.StatusCreated).en(&j)
	return j.ID
}

// cargarCupo pone cuántas porciones hay hoy de un plato, por el mismo endpoint
// que usa la pantalla de stock del panel.
func cargarCupo(t *testing.T, token, servicioID string, asignado int) dto.CupoResponse {
	t.Helper()
	var c dto.CupoResponse
	hacer(t, http.MethodPut, "/api/stock/cupos", map[string]any{
		"servicio_id": servicioID,
		"asignado":    asignado,
	}, token).exigir(http.StatusOK).en(&c)
	return c
}

// pedido crea un pedido para retirar con un solo plato y lo devuelve PENDIENTE.
func pedido(t *testing.T, token, clienteID, servicioID string) dto.CompromisoResponse {
	t.Helper()
	var p dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": clienteID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas":     []map[string]any{{"servicio_id": servicioID, "cantidad": 1}},
	}, token).exigir(http.StatusCreated).en(&p)
	return p
}

// clienteNuevo da de alta una ficha con ese teléfono.
func clienteNuevo(t *testing.T, token, telefono, nombre string) model.Cliente {
	t.Helper()
	var c model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": telefono,
		"nombre":   nombre,
	}, token).exigir(http.StatusCreated).en(&c)
	return c
}

// catalogo lee GET /api/servicios como lo lee el agente, y devuelve además el
// cuerpo crudo: la diferencia entre `restante: null` y `restante: 0` sólo se
// puede verificar mirando el JSON, no la struct ya deserializada.
func catalogo(t *testing.T, token string, soloDisponibles bool) ([]model.Servicio, string) {
	t.Helper()
	ruta := "/api/servicios"
	if soloDisponibles {
		ruta += "?solo_disponibles=true"
	}
	var servicios []model.Servicio
	r := hacer(t, http.MethodGet, ruta, nil, token).exigir(http.StatusOK)
	r.en(&servicios)
	return servicios, string(r.Cuerpo)
}

func delCatalogo(t *testing.T, servicios []model.Servicio, nombre string) model.Servicio {
	t.Helper()
	for _, s := range servicios {
		if s.Nombre == nombre {
			return s
		}
	}
	t.Fatalf("%q no salió en el catálogo (%d servicios)", nombre, len(servicios))
	return model.Servicio{}
}

/*
TestDosClientesContraElUltimoPlato es el escenario que este cambio NO cierra y
que el diseño admite que no cierra: dos clientes ven el último bife al mismo
tiempo y los dos piden. El catálogo achica la ventana; la sobreventa la sigue
impidiendo la base.

Lo que tiene que pasar, por HTTP y contra el router real:
  - el primero confirma;
  - el segundo se come el 409 de ErrSinCupo, que es la última línea de defensa;
  - `consumido` nunca supera a `asignado`;
  - y el catálogo, después, dice `restante: 0` / `agotado: true` — incluso con
    `solo_disponibles=true`, porque agotado no es lo mismo que apagado.
*/
func TestDosClientesContraElUltimoPlato(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla-stock",
		`{"confirmacion":{"pedido":"humana"},"acepta_delivery":false}`)

	bife := crearServicio(t, token, "Bife de chorizo", 30, 14500)
	// Un plato sin cupo cargado: es el control de que "ilimitado" sigue siendo
	// el default y no se contagia de la carta con cuenta.
	crearServicio(t, token, "Empanadas", 30, 4500)

	abrirCaja(t, token)
	cupo := cargarCupo(t, token, bife.ID, 1)
	igual(t, cupo.Restante, 1, "queda una porción cargada")
	igual(t, cupo.Agotado, false, "con una porción todavía no está agotado")

	t.Run("los dos ven el último plato", func(t *testing.T) {
		servicios, crudo := catalogo(t, token, true)
		exigirRestanteHTTP(t, delCatalogo(t, servicios, "Bife de chorizo"), 1, false)

		// `restante: null` es "no lleva cuenta" y `restante: 0` es "no queda".
		// Sin `omitempty` el null llega; con él, el campo desaparece y el que
		// consume no puede distinguir "no sé" de "no hay".
		sinCuenta := delCatalogo(t, servicios, "Empanadas")
		if sinCuenta.Restante != nil {
			t.Errorf("Empanadas viajó con restante %d: un plato sin cupo es ilimitado", *sinCuenta.Restante)
		}
		if !strings.Contains(crudo, `"restante":null`) {
			t.Errorf("el JSON no trae `restante: null` para el plato sin cuenta: %s", crudo)
		}
	})

	// Los dos pedidos se arman ANTES de confirmar ninguno: así es como pasa en
	// el mostrador, los dos clientes vieron el mismo último plato.
	juana := clienteNuevo(t, token, "5492611000501", "Juana")
	pedro := clienteNuevo(t, token, "5492611000502", "Pedro")
	primero := pedido(t, token, juana.ID, bife.ID)
	segundo := pedido(t, token, pedro.ID, bife.ID)

	// El local confirma el primero: ahí se compromete la cocina y baja el cupo.
	var confirmado dto.CompromisoResponse
	hacer(t, http.MethodPatch, "/api/compromisos/"+primero.ID+"/estado", map[string]any{
		"estado": "confirmado", "demora_min": 25,
	}, token).exigir(http.StatusOK).en(&confirmado)
	igual(t, confirmado.Estado, model.EstadoConfirmado, "el primero confirma")

	// El segundo llega tarde: 409, y el mensaje habla de cupo, no de un body malo.
	r := hacer(t, http.MethodPatch, "/api/compromisos/"+segundo.ID+"/estado", map[string]any{
		"estado": "confirmado", "demora_min": 25,
	}, token).exigir(http.StatusConflict)
	if !strings.Contains(strings.ToLower(r.detalle()), "cupo") {
		t.Errorf("el 409 del segundo tiene que explicar que no queda cupo, dijo: %q", r.detalle())
	}

	// Y sigue pendiente: la transición no se aplicó a medias.
	var relectura dto.CompromisoResponse
	hacer(t, http.MethodGet, "/api/compromisos/"+segundo.ID, nil, token).
		exigir(http.StatusOK).en(&relectura)
	igual(t, relectura.Estado, model.EstadoPendiente, "el pedido rechazado no cambió de estado")

	t.Run("el cupo nunca queda con consumido mayor a asignado", func(t *testing.T) {
		var stock []dto.CupoResponse
		hacer(t, http.MethodGet, "/api/stock", nil, token).exigir(http.StatusOK).en(&stock)
		if len(stock) != 1 {
			t.Fatalf("esperaba una fila de stock, obtuve %+v", stock)
		}
		if stock[0].Consumido > stock[0].Asignado {
			t.Errorf("se vendió de más: consumido=%d asignado=%d", stock[0].Consumido, stock[0].Asignado)
		}
		igual(t, stock[0].Consumido, 1, "se vendió exactamente una porción")
		igual(t, stock[0].Agotado, true, "y el plato quedó agotado")
	})

	t.Run("el catálogo filtrado sigue trayendo el agotado, marcado", func(t *testing.T) {
		servicios, crudo := catalogo(t, token, true)
		exigirRestanteHTTP(t, delCatalogo(t, servicios, "Bife de chorizo"), 0, true)
		if !strings.Contains(crudo, `"restante":0`) {
			t.Errorf("el JSON del agotado tiene que decir restante 0: %s", crudo)
		}
		// El sin-cuenta no se contagió.
		if sinCuenta := delCatalogo(t, servicios, "Empanadas"); sinCuenta.Agotado {
			t.Error("un plato sin cupo no puede agotarse porque se agotó otro")
		}
	})
}

// exigirRestanteHTTP: el servicio lleva cuenta y quedan `n`.
func exigirRestanteHTTP(t *testing.T, s model.Servicio, n int, agotado bool) {
	t.Helper()
	if s.Restante == nil {
		t.Fatalf("%s: esperaba restante %d, vino null — ¿el catálogo tiene el cupo cableado?", s.Nombre, n)
	}
	igual(t, *s.Restante, n, s.Nombre+": porciones que quedan")
	igual(t, s.Agotado, agotado, s.Nombre+": agotado")
}
