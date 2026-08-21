package worker

import (
	"context"
	"encoding/json"
	"time"

	"copiloto/core/internal/repository"

	"github.com/rs/zerolog/log"
)

const (
	// RecordatorioHorasDefault es el "24h antes" del producto. Cada negocio lo
	// puede mover con config.recordatorio_horas_antes.
	RecordatorioHorasDefault = 24

	// RecordatorioMargen: la ventana es [inicio - H, inicio - H + margen]. Sin
	// margen, un tick que llega tarde se saltea el turno para siempre.
	RecordatorioMargen = 5 * time.Minute

	// recordatorioVentanaMax acota el barrido: nadie configura un recordatorio
	// con más de tres días de anticipación, y sin tope el SELECT arrastraría
	// toda la agenda futura en cada tick.
	recordatorioVentanaMax = 72 * time.Hour

	recordatorioIntervaloDefault = 60 * time.Second
	recordatorioLote             = 200
)

// RecordatoriosConfig son las dependencias del barrido.
type RecordatoriosConfig struct {
	Repo repository.AvisoRepository
	Pub  Publicador
	// Ahora es el reloj inyectable: los tests mueven el tiempo en vez de
	// esperarlo. nil = time.Now.
	Ahora func() time.Time
	// Intervalo entre ticks. 0 = 60s.
	Intervalo time.Duration
}

// Recordatorios manda el aviso del turno del día siguiente. Es lo que baja el
// ausentismo, así que la regla dura es: como mucho uno por turno, nunca dos.
type Recordatorios struct {
	repo      repository.AvisoRepository
	pub       Publicador
	ahora     func() time.Time
	intervalo time.Duration
}

func NewRecordatorios(cfg RecordatoriosConfig) *Recordatorios {
	w := &Recordatorios{
		repo:      cfg.Repo,
		pub:       cfg.Pub,
		ahora:     cfg.Ahora,
		intervalo: cfg.Intervalo,
	}
	if w.ahora == nil {
		w.ahora = time.Now
	}
	if w.intervalo <= 0 {
		w.intervalo = recordatorioIntervaloDefault
	}
	return w
}

// Start lanza el ticker en su propia goroutine y lo corta con el ctx de
// shutdown del proceso.
func (w *Recordatorios) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(w.intervalo)
		defer ticker.Stop()

		log.Info().Dur("intervalo", w.intervalo).Msg("worker recordatorios: arrancó")

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("worker recordatorios: cortando")
				return
			case <-ticker.C:
				if _, err := w.Tick(ctx); err != nil {
					log.Error().Err(err).Msg("worker recordatorios: tick con error")
				}
			}
		}
	}()
}

// Tick hace una pasada y devuelve cuántos recordatorios encoló. Es público
// porque es el sujeto de los tests: el ticker sólo lo llama cada tanto.
//
// El orden importa y no es negociable: primero el UPDATE condicional, y sólo
// si esa fila fue nuestra se encola. Al revés, dos réplicas mandarían el mismo
// recordatorio dos veces y el cliente recibiría dos WhatsApp iguales.
func (w *Recordatorios) Tick(ctx context.Context) (int, error) {
	ahora := w.ahora()

	// La ventana fina (por negocio) se resuelve en SQL; el filtro en memoria de
	// abajo queda como red de seguridad y para exactitud en los bordes.
	candidatos, err := w.repo.TurnosSinRecordatorio(ctx, ahora, RecordatorioMargen, recordatorioLote)
	if err != nil {
		return 0, err
	}

	encolados := 0
	for _, t := range candidatos {
		horas := horasAntes(t.ConfigNegocio)
		desde := ahora.Add(horas - RecordatorioMargen)
		hasta := ahora.Add(horas)
		if t.Inicio.Before(desde) || t.Inicio.After(hasta) {
			continue
		}

		gano, err := w.repo.MarcarRecordatorioEnviado(ctx, t.NegocioID, t.CompromisoID, ahora)
		if err != nil {
			log.Error().Err(err).Str("compromiso_id", t.CompromisoID).
				Msg("worker recordatorios: no se pudo sellar el recordatorio")
			continue
		}
		if !gano {
			// Otro tick, otra réplica, o el turno dejó de estar confirmado.
			continue
		}

		msg := MensajeSalida{
			NegocioID: t.NegocioID,
			WaPhoneID: t.WaPhoneID,
			Telefono:  t.Telefono,
			Tipo:      TipoPlantilla,
			Plantilla: PlantillaRecordatorio,
			// Posicional: {{1}} nombre, {{2}} fecha_hora_local, {{3}} negocio.
			Variables: []string{
				nombreOSaludo(t.ClienteNombre),
				fechaHoraLocal(t.Inicio, t.Timezone),
				t.NegocioNombre,
			},
			CompromisoID: t.CompromisoID,
		}
		if err := w.pub.Publicar(ctx, msg); err != nil {
			// El sello ya está puesto: este aviso se pierde. Es la mitad
			// correcta del error — mandar dos sería peor que no mandar uno.
			log.Error().Err(err).Str("compromiso_id", t.CompromisoID).
				Msg("worker recordatorios: sellado pero no encolado")
			continue
		}
		encolados++
	}

	return encolados, nil
}

// horasAntes lee negocio.config.recordatorio_horas_antes. Config rota, ausente
// o disparatada cae al default: un JSON mal escrito no puede apagar la feature
// que se le vendió al negocio.
func horasAntes(raw []byte) time.Duration {
	def := time.Duration(RecordatorioHorasDefault) * time.Hour
	if len(raw) == 0 {
		return def
	}
	var cfg struct {
		Horas *int `json:"recordatorio_horas_antes"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil || cfg.Horas == nil {
		return def
	}
	h := time.Duration(*cfg.Horas) * time.Hour
	if h <= 0 || h > recordatorioVentanaMax {
		return def
	}
	return h
}
