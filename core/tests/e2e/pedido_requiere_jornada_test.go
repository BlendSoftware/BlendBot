package e2e

import (
	"net/http"
	"strings"
	"testing"

	"copiloto/core/internal/dto"
)

// TestPedidoWhatsAppRequiereJornadaAbierta es el bug de producción (15/10/2026)
// convertido en test: un pedido de WhatsApp sin la caja del día abierta tiene
// que rechazarse con 409 y un mensaje que distinga este caso del otro 409 de
// jornada (cerrar sin nada abierto). Con la caja abierta, el mismo pedido entra.
func TestPedidoWhatsAppRequiereJornadaAbierta(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "Lo de Marta", "lodemarta",
		`{"confirmacion":{"pedido":"humana"}}`)

	servicio := crearServicio(t, token, "Milanesa napolitana", 20, 7500)
	cliente := clienteNuevo(t, token, "5492611444555", "Beto")

	cuerpo := map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "whatsapp",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 2},
		},
	}

	// Sin abrir la jornada: 409, y el mensaje tiene que hablar de "jornada" y
	// "cerrada" — nunca el mismo texto que ErrSinJornadaAbierta (ese es para
	// CERRAR la caja, un contexto distinto).
	var errBody struct {
		Detail string `json:"detail"`
	}
	hacer(t, http.MethodPost, "/api/compromisos", cuerpo, token).
		exigir(http.StatusConflict).en(&errBody)
	msg := strings.ToLower(errBody.Detail)
	if !strings.Contains(msg, "jornada") || !strings.Contains(msg, "cerrad") {
		t.Fatalf("el mensaje del 409 tiene que hablar de jornada cerrada: %q", errBody.Detail)
	}
	if strings.Contains(msg, "para cerrar") {
		t.Fatalf("el mensaje no puede confundirse con el de ErrSinJornadaAbierta (cerrar la caja): %q", errBody.Detail)
	}

	// Abro la jornada: el MISMO pedido ahora entra.
	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).exigir(http.StatusCreated)

	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", cuerpo, token).
		exigir(http.StatusCreated).en(&pedido)
	noVacio(t, pedido.ID, "id del pedido creado con la caja abierta")
}

// TestPedidoPanelNoRequiereJornadaAbierta: aislamiento por ORIGEN sobre el
// camino HTTP completo — un pedido cargado desde el panel (origen=panel) entra
// aunque la caja esté cerrada.
func TestPedidoPanelNoRequiereJornadaAbierta(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := altaGastro(t, admin.AccessToken, "Lo de Marta Panel", "lodemartapanel",
		`{"confirmacion":{"pedido":"humana"}}`)

	servicio := crearServicio(t, token, "Milanesa napolitana", 20, 7500)
	cliente := clienteNuevo(t, token, "5492611444556", "Beto Panel")

	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "pedido",
		"origen":     "panel",
		"entrega":    "retira",
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 2},
		},
	}, token).exigir(http.StatusCreated).en(&pedido)
	noVacio(t, pedido.ID, "id del pedido de panel sin jornada abierta")
}

// TestNegocioInformaAbiertoAhora: GET /api/negocio es la única puerta que el
// agente (token cop_...) tiene para saber si la caja está abierta — no puede
// pegarle a GET /api/jornada/actual (es sólo de dueño/admin). abierto_ahora
// tiene que reflejar el estado real antes y después de abrir.
func TestNegocioInformaAbiertoAhora(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := negocioListo(t, admin.AccessToken, "Consultorio Abierto Ahora", "abiertoahora")

	var antes dto.NegocioDatosResponse
	hacer(t, http.MethodGet, "/api/negocio", nil, token).exigir(http.StatusOK).en(&antes)
	igual(t, antes.AbiertoAhora, false, "recién dado de alta, sin jornada abierta")

	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).exigir(http.StatusCreated)

	var despues dto.NegocioDatosResponse
	hacer(t, http.MethodGet, "/api/negocio", nil, token).exigir(http.StatusOK).en(&despues)
	igual(t, despues.AbiertoAhora, true, "tras abrir la jornada")
}
