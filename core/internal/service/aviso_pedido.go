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

// AvisadorPedido publica el aviso al cliente. La implementación vive en el
// paquete worker (habla con Redis); el service sólo conoce esta interfaz, así
// no hay ciclo de imports y los tests pueden doblar el avisador.
type AvisadorPedido interface {
	PedidoConfirmado(ctx context.Context, a AvisoPedidoConfirmado) error
	PedidoListo(ctx context.Context, a AvisoPedidoListo) error
}
