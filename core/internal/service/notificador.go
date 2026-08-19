package service

import (
	"context"
	"time"
)

// TurnoCancelado es el evento del anti-ausentismo: un turno con hora futura se
// cayó, o sea que quedó un hueco que alguien puede aprovechar. Sólo se emite
// para turnos (un pedido cancelado no libera nada) y con inicio futuro (un
// turno de ayer no le sirve a nadie).
type TurnoCancelado struct {
	NegocioID    string
	CompromisoID string
	ClienteID    string
	// ServicioID es el de la primera línea del compromiso: es la cola de espera
	// a la que se le ofrece el hueco.
	ServicioID string
	Inicio     time.Time
	Fin        *time.Time
}

// Notificador es el hook que el motor usa para avisar hacia afuera. La interfaz
// es chica y opcional a propósito: un motor sin notificador (el default, y el
// de todos los tests que no prueban esto) no avisa nada y no se entera de que
// existe una cola de WhatsApp.
type Notificador interface {
	TurnoCancelado(ctx context.Context, ev TurnoCancelado) error
}
