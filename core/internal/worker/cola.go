// Package worker corre los procesos de fondo del anti-ausentismo: el barrido
// que manda el recordatorio 24h antes y la oferta del hueco que se liberó.
// Todo lo que sale para el cliente termina en la misma cola de Redis; el core
// no habla nunca con Meta, eso es del gateway (E5).
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ColaSalidas es la lista de Redis: el core hace LPUSH, el gateway hace BRPOP.
const ColaSalidas = "salidas_whatsapp"

// Tipos y plantillas del contrato con el gateway.
const (
	TipoTexto     = "texto"
	TipoPlantilla = "plantilla"

	PlantillaRecordatorio  = "recordatorio_turno"
	PlantillaHuecoLiberado = "hueco_liberado"
)

// Orden de las variables por plantilla. Las plantillas de WhatsApp toman
// parámetros POSICIONALES ({{1}}, {{2}}, ...): el gateway los manda en el orden
// exacto en que vienen en la lista, así que este orden ES el contrato. No es un
// map justamente porque Go serializa los maps en orden alfabético y el gateway
// los consumía posicional → salían permutados (H2). El orden acá manda:
//
//	recordatorio_turno → {{1}} nombre, {{2}} fecha_hora_local, {{3}} negocio
//	hueco_liberado     → {{1}} nombre, {{2}} servicio, {{3}} fecha_hora_local, {{4}} negocio

// MensajeSalida es EL contrato con el gateway de WhatsApp (E5). Los nombres de
// los campos son parte del protocolo: renombrar uno rompe el otro lado en
// silencio, porque nadie compila los dos juntos.
type MensajeSalida struct {
	NegocioID    string   `json:"negocio_id"`
	WaPhoneID    string   `json:"wa_phone_id"`
	Telefono     string   `json:"telefono"`
	Tipo         string   `json:"tipo"` // texto | plantilla
	Texto        string   `json:"texto,omitempty"`
	Plantilla    string   `json:"plantilla,omitempty"`
	Variables    []string `json:"variables,omitempty"` // POSICIONAL: {{1}},{{2}},... ver orden por plantilla arriba
	CompromisoID string   `json:"compromiso_id,omitempty"`
}

// Publicador encola mensajes salientes. Es una interfaz para que los tests
// puedan mirar lo que se encoló sin levantar un Redis.
type Publicador interface {
	Publicar(ctx context.Context, m MensajeSalida) error
}

type publicadorRedis struct{ rdb *redis.Client }

// NewPublicador usa el cliente de Redis que ya tiene el proceso.
func NewPublicador(rdb *redis.Client) Publicador { return &publicadorRedis{rdb: rdb} }

func (p *publicadorRedis) Publicar(ctx context.Context, m MensajeSalida) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return p.rdb.LPush(ctx, ColaSalidas, raw).Err()
}

// diasES son los días en castellano: el mensaje lo lee un cliente, no un log.
var diasES = [...]string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}

// fechaHoraLocal formatea el momento en la zona del negocio. Una zona inválida
// no puede tumbar un recordatorio: cae a UTC y se manda igual.
func fechaHoraLocal(t time.Time, tz string) string {
	loc, err := time.LoadLocation(tz)
	if err != nil || loc == nil {
		loc = time.UTC
	}
	l := t.In(loc)
	return fmt.Sprintf("%s %02d/%02d a las %02d:%02d",
		diasES[int(l.Weekday())], l.Day(), int(l.Month()), l.Hour(), l.Minute())
}

// nombreOSaludo evita el "Hola ," de un cliente que sólo dejó el teléfono.
func nombreOSaludo(nombre string) string {
	if nombre == "" {
		return "Hola"
	}
	return nombre
}
