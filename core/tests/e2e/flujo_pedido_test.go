package e2e

import (
	"encoding/json"
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// altaGastro da de alta un negocio gastronómico con una config concreta y
// devuelve id + token del dueño ya operativo. Replica el camino de negocioListo
// pero eligiendo el vertical y la config (que altaNegocio fija en salud).
func altaGastro(t *testing.T, tokenAdmin, nombre, usuarioDueno, configJSON string) (string, string) {
	t.Helper()
	var alta dto.AltaNegocioResponse
	hacer(t, http.MethodPost, "/api/admin/negocios", map[string]any{
		"nombre":        nombre,
		"vertical":      "gastronomia",
		"timezone":      tzNegocio,
		"usuario_dueno": usuarioDueno,
		"config":        json.RawMessage(configJSON),
	}, tokenAdmin).exigir(http.StatusCreated).en(&alta)

	temporal := login(t, usuarioDueno, alta.PasswordTemporal)
	nueva := "clave-nueva-" + usuarioDueno
	hacer(t, http.MethodPost, "/api/auth/cambiar-password", map[string]any{
		"password_nueva": nueva,
	}, temporal.AccessToken).exigir(http.StatusOK)

	definitivo := login(t, usuarioDueno, nueva)
	return alta.NegocioID, definitivo.AccessToken
}

// TestFlujoPedidoGastronomia es el vertical gastronomía por HTTP: un pedido con
// delivery a un negocio que no lo ofrece se rechaza con 422, y un pedido para
// retirar recorre pendiente → confirmado (con la demora que pone el local) →
// en cocina → listo → entregado.
func TestFlujoPedidoGastronomia(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	// Negocio que NO ofrece delivery.
	negID, token := altaGastro(t, admin.AccessToken, "La Parrilla", "parrilla",
		`{"confirmacion":{"pedido":"humana"},"demoras_sugeridas":[15,25,40],"acepta_delivery":false}`)
	_ = negID

	servicio := crearServicio(t, token, "Doble cheddar", 30, 8900)

	var cliente model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": "5492611222333",
		"nombre":   "Juani",
	}, token).exigir(http.StatusCreated).en(&cliente)

	// Delivery a un negocio que no lo acepta → 422.
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "delivery",
		"direccion":  "Av. Siempreviva 742",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 1},
		},
	}, token).exigir(http.StatusUnprocessableEntity)

	// El mismo pedido para retirar entra como PENDIENTE (política humana).
	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 2},
		},
	}, token).exigir(http.StatusCreated).en(&pedido)
	igual(t, pedido.Estado, model.EstadoPendiente, "un pedido nace pendiente")
	igual(t, pedido.Tipo, model.CompromisoPedido, "tipo del pedido")
	if pedido.Entrega == nil || *pedido.Entrega != model.EntregaRetira {
		t.Fatalf("entrega del pedido: %v", pedido.Entrega)
	}

	// El local confirma poniendo la demora.
	var confirmado dto.CompromisoResponse
	hacer(t, http.MethodPatch, "/api/compromisos/"+pedido.ID+"/estado", map[string]any{
		"estado":     "confirmado",
		"demora_min": 30,
	}, token).exigir(http.StatusOK).en(&confirmado)
	igual(t, confirmado.Estado, model.EstadoConfirmado, "estado tras confirmar")
	if confirmado.DemoraMin == nil || *confirmado.DemoraMin != 30 {
		t.Fatalf("la demora del local no se guardó: %v", confirmado.DemoraMin)
	}
	if confirmado.ConfirmadoEn == nil {
		t.Error("confirmar tiene que sellar confirmado_en")
	}

	// El board avanza: en cocina → listo → entregado.
	for _, estado := range []string{"en_curso", "listo", "completado"} {
		hacer(t, http.MethodPatch, "/api/compromisos/"+pedido.ID+"/estado", map[string]any{
			"estado": estado,
		}, token).exigir(http.StatusOK)
	}

	// El board por estado: LISTOS ya no tiene nada, y el pedido cerró.
	var completados []dto.CompromisoResponse
	hacer(t, http.MethodGet, "/api/compromisos?estado=completado", nil, token).
		exigir(http.StatusOK).en(&completados)
	if len(completados) != 1 || completados[0].ID != pedido.ID {
		t.Fatalf("board de completados: esperaba %s, obtuvo %+v", pedido.ID, completados)
	}
}
