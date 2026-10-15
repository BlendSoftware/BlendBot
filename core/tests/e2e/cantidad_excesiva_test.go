package e2e

import (
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// TestPedidoWhatsAppCantidadExcesivaPorLinea reproduce el bug de producción
// ("100 napolitanas" sin ninguna alerta) por HTTP: una línea que pide más del
// tope se rechaza con 422, y la misma línea dentro del tope entra normal.
func TestPedidoWhatsAppCantidadExcesivaPorLinea(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "Lo de Marta Cantidad", "lodemartacantidad",
		`{"confirmacion":{"pedido":"humana"}}`)

	servicio := crearServicio(t, token, "Napolitana", 20, 7500)
	cliente := clienteNuevo(t, token, "5492611444557", "Cris")

	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).exigir(http.StatusCreated)

	// 100 unidades en una línea: el caso real que motivó el tope.
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 100},
		},
	}, token).exigir(http.StatusUnprocessableEntity)

	// El default (model.CantidadMaximaPorLineaDefault) sí entra.
	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": model.CantidadMaximaPorLineaDefault},
		},
	}, token).exigir(http.StatusCreated).en(&pedido)
	noVacio(t, pedido.ID, "id del pedido dentro del límite")
}

// TestPedidoWhatsAppCantidadExcesivaConLimitePropioDelNegocio: el negocio
// puede bajar el tope por config (cantidad_maxima_por_linea); el gate usa ESE
// número y no el default.
func TestPedidoWhatsAppCantidadExcesivaConLimitePropioDelNegocio(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "Lo de Marta Tope Propio", "lodemartatopepropio",
		`{"confirmacion":{"pedido":"humana"},"cantidad_maxima_por_linea":5}`)

	servicio := crearServicio(t, token, "Napolitana", 20, 7500)
	cliente := clienteNuevo(t, token, "5492611444558", "Nico")

	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).exigir(http.StatusCreated)

	// 10 está bajo el default global pero supera el tope propio (5) → 422.
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 10},
		},
	}, token).exigir(http.StatusUnprocessableEntity)

	// 5 (el tope exacto) entra.
	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 5},
		},
	}, token).exigir(http.StatusCreated).en(&pedido)
	noVacio(t, pedido.ID, "id del pedido en el tope propio del negocio")
}

// TestPedidoPanelCantidadExcesivaNoSeBloqueaPorHTTP: aislamiento por ORIGEN
// sobre el camino HTTP completo.
func TestPedidoPanelCantidadExcesivaNoSeBloqueaPorHTTP(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "Lo de Marta Panel Cantidad", "lodemartapanelcantidad",
		`{"confirmacion":{"pedido":"humana"}}`)

	servicio := crearServicio(t, token, "Napolitana", 20, 7500)
	cliente := clienteNuevo(t, token, "5492611444559", "Pato")

	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "panel",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 100},
		},
	}, token).exigir(http.StatusCreated).en(&pedido)
	noVacio(t, pedido.ID, "id del pedido de panel con cantidad alta")
}
