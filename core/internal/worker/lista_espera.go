package worker

import (
	"context"
	"time"

	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"github.com/rs/zerolog/log"
)

// ListaEsperaNotificador es la otra mitad del anti-ausentismo: el hueco que se
// liberó no se queda vacío, se le ofrece al primero de la cola de ese servicio.
// Implementa service.Notificador, así que el motor lo ve como una interfaz de
// un método y nada más.
type ListaEsperaNotificador struct {
	lista  repository.ListaEsperaRepository
	avisos repository.AvisoRepository
	pub    Publicador
	ahora  func() time.Time
}

// NewListaEsperaNotificador arma el hook. ahora nil = time.Now.
func NewListaEsperaNotificador(
	lista repository.ListaEsperaRepository,
	avisos repository.AvisoRepository,
	pub Publicador,
	ahora func() time.Time,
) *ListaEsperaNotificador {
	if ahora == nil {
		ahora = time.Now
	}
	return &ListaEsperaNotificador{lista: lista, avisos: avisos, pub: pub, ahora: ahora}
}

// TurnoCancelado ofrece el hueco al primero de la lista de espera del mismo
// servicio y lo marca como notificado.
//
// Igual que el recordatorio: se marca ANTES de encolar, con un UPDATE
// condicional. Dos cancelaciones simultáneas del mismo servicio pelean por el
// mismo anotado y sólo una gana, así que nadie recibe dos ofertas.
func (w *ListaEsperaNotificador) TurnoCancelado(ctx context.Context, ev service.TurnoCancelado) error {
	if ev.NegocioID == "" || ev.ServicioID == "" {
		return nil
	}

	le, err := w.lista.PrimeroSinNotificar(ctx, ev.NegocioID, ev.ServicioID)
	if err != nil {
		return err
	}
	if le == nil {
		return nil // nadie esperando ese servicio
	}

	datos, err := w.avisos.DatosParaOferta(ctx, ev.NegocioID, le.ClienteID, ev.ServicioID)
	if err != nil {
		return err
	}
	if datos == nil {
		// Negocio sin WhatsApp configurado o dado de baja: no se marca nada, el
		// anotado sigue primero en la cola para la próxima.
		return nil
	}

	gano, err := w.lista.MarcarNotificado(ctx, ev.NegocioID, le.ID, w.ahora(), ev.CompromisoID)
	if err != nil {
		return err
	}
	if !gano {
		return nil
	}

	err = w.pub.Publicar(ctx, MensajeSalida{
		NegocioID: ev.NegocioID,
		WaPhoneID: datos.WaPhoneID,
		Telefono:  datos.Telefono,
		Tipo:      TipoPlantilla,
		Plantilla: PlantillaHuecoLiberado,
		Variables: map[string]string{
			"nombre":           nombreOSaludo(datos.ClienteNombre),
			"servicio":         datos.ServicioNombre,
			"fecha_hora_local": fechaHoraLocal(ev.Inicio, datos.Timezone),
			"negocio":          datos.NegocioNombre,
		},
		CompromisoID: ev.CompromisoID,
	})
	if err != nil {
		log.Error().Err(err).Str("lista_espera_id", le.ID).
			Msg("worker lista de espera: marcado pero no encolado")
		return err
	}
	return nil
}
