package service

import (
	"context"

	"github.com/shopspring/decimal"
)

// AvisoPedidoConfirmado son los datos para avisarle al cliente que el local
// confirmó su pedido y con qué demora. Lo arma el vertical gastronomía cuando
// una transición a `confirmado` trae demora, y lo consume un avisador que
// publica a la cola de salidas de WhatsApp.
type AvisoPedidoConfirmado struct {
	NegocioID       string
	CompromisoID    string
	WaPhoneID       string
	ClienteTelefono string
	ClienteNombre   string
	DemoraMin       int
	Total           decimal.Decimal
}

// AvisoPedidoListo son los datos para avisarle al cliente que su pedido está
// pronto. Es el segundo de los dos avisos que el producto manda, y el segundo
// en valor operativo después de la confirmación: es el que evita que el cliente
// llegue temprano y espere parado, o que llegue tarde y coma frío.
//
// NO lleva demora, al revés que el de confirmación: acá ya no hay nada que
// esperar. Por eso el vertical tampoco exige `DemoraMin` para mandarlo — copiar
// esa condición dejaría mudo el aviso justo en los pedidos que se confirmaron
// sin cargar demora.
//
// Entrega decide la frase: "pasá a buscarlo" y "salió para tu casa" no son lo
// mismo, y un pedido `en_local` no recibe nada porque el mozo se lo lleva a la
// mesa.
type AvisoPedidoListo struct {
	NegocioID       string
	CompromisoID    string
	WaPhoneID       string
	ClienteTelefono string
	ClienteNombre   string
	Entrega         string // retira | delivery
}

// AvisoPedidoRechazado son los datos para avisarle al cliente que su pedido no
// se va a cumplir: el local lo rechazó (sólo se llega desde PENDIENTE) o lo
// canceló después de haberlo confirmado (desde PENDIENTE o CONFIRMADO, ver
// model/estado.go). Un solo tipo para los dos casos porque el texto que recibe
// el cliente es el mismo: lo que le importa es que no va a llegar, no la razón
// de estado por la que no llega.
//
// LIMITACIÓN CONOCIDA (no resuelta acá, bug de producción del 15/10/2026): el
// motor no distingue quién pidió la transición. `dto.TransicionarInput` y
// `OpcionesTransicion` no traen un campo de origen, y la tool `cancelar` del
// agente (agente/server.py) transiciona a `cancelado` llamando el mismo PATCH
// /compromisos/:id/estado que usa el panel. Como consecuencia, si el PROPIO
// CLIENTE cancela su pedido por WhatsApp, este aviso sale igual y dice "el
// local no pudo tomar tu pedido", que es la frase equivocada para ese caso
// puntual. Agregar un campo de origen de la transición resolvería esto, pero
// es un cambio de API más grande que el de este fix — se deja documentado,
// no se inventa acá.
type AvisoPedidoRechazado struct {
	NegocioID       string
	CompromisoID    string
	WaPhoneID       string
	ClienteTelefono string
	ClienteNombre   string
}

// AvisadorPedido publica el aviso al cliente. La implementación vive en el
// paquete worker (habla con Redis); el service sólo conoce esta interfaz, así
// no hay ciclo de imports y los tests pueden doblar el avisador.
type AvisadorPedido interface {
	PedidoConfirmado(ctx context.Context, a AvisoPedidoConfirmado) error
	PedidoListo(ctx context.Context, a AvisoPedidoListo) error
	PedidoRechazado(ctx context.Context, a AvisoPedidoRechazado) error
}
