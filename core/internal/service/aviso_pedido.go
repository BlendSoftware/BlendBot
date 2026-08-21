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

// AvisadorPedido publica el aviso al cliente. La implementación vive en el
// paquete worker (habla con Redis); el service sólo conoce esta interfaz, así
// no hay ciclo de imports y los tests pueden doblar el avisador.
type AvisadorPedido interface {
	PedidoConfirmado(ctx context.Context, a AvisoPedidoConfirmado) error
}
