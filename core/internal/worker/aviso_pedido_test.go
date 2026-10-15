package worker

import (
	"context"
	"strings"
	"testing"

	"copiloto/core/internal/service"

	"github.com/shopspring/decimal"
)

// ── El aviso de "no pudimos tomar tu pedido" (rechazo o cancelación) ────────
//
// Bug de producción del 15/10/2026: el cliente no recibía nada si el local
// rechazaba o cancelaba su pedido. Un solo método para los dos casos porque el
// texto que recibe el cliente es el mismo.

func TestPedidoRechazadoTextoConNombre(t *testing.T) {
	pub := &pubFalso{}
	av := NewAvisadorPedido(pub)

	err := av.PedidoRechazado(context.Background(), service.AvisoPedidoRechazado{
		NegocioID:       "neg-1",
		CompromisoID:    "comp-1",
		WaPhoneID:       "wa-1",
		ClienteTelefono: "549260111",
		ClienteNombre:   "Juani",
	})
	if err != nil {
		t.Fatalf("PedidoRechazado: %v", err)
	}
	if len(pub.msgs) != 1 {
		t.Fatalf("esperaba 1 mensaje encolado, hubo %d", len(pub.msgs))
	}

	msg := pub.msgs[0]
	quiero := "Juani, el local no pudo tomar tu pedido 😕 Si querés, escribinos y vemos otra opción."
	if msg.Texto != quiero {
		t.Fatalf("texto = %q, quiero %q", msg.Texto, quiero)
	}
	if msg.NegocioID != "neg-1" || msg.WaPhoneID != "wa-1" || msg.Telefono != "549260111" || msg.CompromisoID != "comp-1" {
		t.Fatalf("el mensaje no llevó los datos del aviso: %+v", msg)
	}
	if msg.Tipo != "texto" {
		t.Fatalf("tipo = %q, quiero %q", msg.Tipo, "texto")
	}
}

// TestPedidoRechazadoTextoSinNombre triangula con un input distinto: sin
// nombre, la frase no lleva ni el nombre ni la coma inicial, y arranca con
// mayúscula.
// ── Bug 2: emojis hardcodeados que no correspondían ─────────────────────────
//
// Bug de producción del 15/10/2026: PedidoConfirmado y el caso "retira" de
// PedidoListo usaban 🍔 (comida), que no describe "confirmado" ni "listo para
// retirar". PedidoConfirmado pasa a ✅; PedidoListo/retira pasa a 🙌. El caso
// "delivery" (🛵) no cambia: ya describe correctamente la entrega en moto.

func TestPedidoConfirmadoUsaCheckNoHamburguesa(t *testing.T) {
	pub := &pubFalso{}
	av := NewAvisadorPedido(pub)

	err := av.PedidoConfirmado(context.Background(), service.AvisoPedidoConfirmado{
		NegocioID: "neg-1", CompromisoID: "comp-1", WaPhoneID: "wa-1",
		ClienteTelefono: "549260111", ClienteNombre: "Juani",
		DemoraMin: 30, Total: decimal.NewFromInt(1000),
	})
	if err != nil {
		t.Fatalf("PedidoConfirmado: %v", err)
	}
	texto := pub.msgs[0].Texto
	if strings.Contains(texto, "🍔") {
		t.Fatalf("el texto todavía usa 🍔: %q", texto)
	}
	if !strings.Contains(texto, "✅") {
		t.Fatalf("el texto no usa ✅: %q", texto)
	}
}

func TestPedidoListoRetiraUsaManosNoHamburguesa(t *testing.T) {
	pub := &pubFalso{}
	av := NewAvisadorPedido(pub)

	err := av.PedidoListo(context.Background(), service.AvisoPedidoListo{
		NegocioID: "neg-1", CompromisoID: "comp-1", WaPhoneID: "wa-1",
		ClienteTelefono: "549260111", ClienteNombre: "Juani",
		Entrega: "retira",
	})
	if err != nil {
		t.Fatalf("PedidoListo: %v", err)
	}
	texto := pub.msgs[0].Texto
	if strings.Contains(texto, "🍔") {
		t.Fatalf("el texto todavía usa 🍔: %q", texto)
	}
	if !strings.Contains(texto, "🙌") {
		t.Fatalf("el texto no usa 🙌: %q", texto)
	}
}

// TestPedidoListoDeliveryNoCambia triangula: el caso "delivery" (🛵) no es
// parte de este bug y no se toca.
func TestPedidoListoDeliveryNoCambia(t *testing.T) {
	pub := &pubFalso{}
	av := NewAvisadorPedido(pub)

	err := av.PedidoListo(context.Background(), service.AvisoPedidoListo{
		NegocioID: "neg-1", CompromisoID: "comp-1", WaPhoneID: "wa-1",
		ClienteTelefono: "549260111", ClienteNombre: "Juani",
		Entrega: "delivery",
	})
	if err != nil {
		t.Fatalf("PedidoListo: %v", err)
	}
	texto := pub.msgs[0].Texto
	if !strings.Contains(texto, "🛵") {
		t.Fatalf("el caso delivery no debía cambiar, pero perdió 🛵: %q", texto)
	}
}

func TestPedidoRechazadoTextoSinNombre(t *testing.T) {
	pub := &pubFalso{}
	av := NewAvisadorPedido(pub)

	err := av.PedidoRechazado(context.Background(), service.AvisoPedidoRechazado{
		NegocioID:       "neg-1",
		CompromisoID:    "comp-1",
		WaPhoneID:       "wa-1",
		ClienteTelefono: "549260111",
		ClienteNombre:   "",
	})
	if err != nil {
		t.Fatalf("PedidoRechazado: %v", err)
	}

	quiero := "El local no pudo tomar tu pedido 😕 Si querés, escribinos y vemos otra opción."
	if got := pub.msgs[0].Texto; got != quiero {
		t.Fatalf("texto = %q, quiero %q", got, quiero)
	}
}
