package worker

import (
	"context"
	"fmt"
	"strings"

	"copiloto/core/internal/service"

	"github.com/shopspring/decimal"
)

// avisadorPedido implementa service.AvisadorPedido publicando a la cola de
// salidas de WhatsApp. Es el "el panel actúa, no sólo muestra" del lado del
// pedido: cuando el local confirma con una demora, el cliente se entera.
type avisadorPedido struct {
	pub Publicador
}

// NewAvisadorPedido arma el avisador sobre el mismo publicador de Redis que usa
// el resto de las salidas.
func NewAvisadorPedido(pub Publicador) service.AvisadorPedido {
	return &avisadorPedido{pub: pub}
}

func (a *avisadorPedido) PedidoConfirmado(ctx context.Context, av service.AvisoPedidoConfirmado) error {
	saludo := "¡Listo!"
	if av.ClienteNombre != "" {
		saludo = "¡Listo, " + av.ClienteNombre + "!"
	}
	texto := fmt.Sprintf(
		"%s Confirmamos tu pedido ✅ Sale en ~%d min. Total %s. Cualquier cosa te avisamos por acá.",
		saludo, av.DemoraMin, plataAR(av.Total),
	)
	return a.pub.Publicar(ctx, MensajeSalida{
		NegocioID:    av.NegocioID,
		WaPhoneID:    av.WaPhoneID,
		Telefono:     av.ClienteTelefono,
		Tipo:         "texto",
		Texto:        texto,
		CompromisoID: av.CompromisoID,
	})
}

// PedidoListo avisa que el pedido está pronto.
//
// El texto cambia según cómo se entrega, porque lo que el cliente tiene que
// hacer es distinto: retira → moverse; delivery → esperar en la puerta. Mandar
// la misma frase para los dos sería mandar una frase que a la mitad no le sirve.
//
// `en_local` no llega acá (el vertical lo filtra antes) y si llegara igual se
// devuelve nil sin publicar: avisarle por WhatsApp a alguien sentado en la mesa
// que su comida está lista es ruido, y el mozo se la está llevando.
func (a *avisadorPedido) PedidoListo(ctx context.Context, av service.AvisoPedidoListo) error {
	saludo := "¡Tu pedido está listo!"
	if av.ClienteNombre != "" {
		saludo = av.ClienteNombre + ", tu pedido está listo"
	}

	var texto string
	switch av.Entrega {
	case "retira":
		texto = saludo + " 🙌 Ya podés pasar a buscarlo por el local."
	case "delivery":
		texto = saludo + " 🛵 Ya salió para tu dirección."
	default:
		// en_local, o cualquier cosa que no conozcamos: no se inventa una frase.
		return nil
	}

	return a.pub.Publicar(ctx, MensajeSalida{
		NegocioID:    av.NegocioID,
		WaPhoneID:    av.WaPhoneID,
		Telefono:     av.ClienteTelefono,
		Tipo:         "texto",
		Texto:        texto,
		CompromisoID: av.CompromisoID,
	})
}

// PedidoRechazado avisa que el local no pudo tomar el pedido: lo rechazó, o lo
// canceló después de confirmado. Un solo método para los dos casos (ver
// service.AvisoPedidoRechazado) porque el texto que recibe el cliente es el
// mismo — no hay nada que el cliente necesite distinguir entre ambos caminos.
func (a *avisadorPedido) PedidoRechazado(ctx context.Context, av service.AvisoPedidoRechazado) error {
	texto := "El local no pudo tomar tu pedido 😕 Si querés, escribinos y vemos otra opción."
	if av.ClienteNombre != "" {
		texto = av.ClienteNombre + ", el local no pudo tomar tu pedido 😕 Si querés, escribinos y vemos otra opción."
	}
	return a.pub.Publicar(ctx, MensajeSalida{
		NegocioID:    av.NegocioID,
		WaPhoneID:    av.WaPhoneID,
		Telefono:     av.ClienteTelefono,
		Tipo:         "texto",
		Texto:        texto,
		CompromisoID: av.CompromisoID,
	})
}

// plataAR formatea un decimal como plata argentina: "$26.300" (punto de miles,
// sin decimales para montos redondos de comida).
func plataAR(d decimal.Decimal) string {
	entero := d.Round(0).String()
	neg := strings.HasPrefix(entero, "-")
	entero = strings.TrimPrefix(entero, "-")
	var grupos []string
	for len(entero) > 3 {
		grupos = append([]string{entero[len(entero)-3:]}, grupos...)
		entero = entero[:len(entero)-3]
	}
	grupos = append([]string{entero}, grupos...)
	out := "$" + strings.Join(grupos, ".")
	if neg {
		out = "-" + out
	}
	return out
}
