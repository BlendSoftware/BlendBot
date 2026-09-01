package dto

import (
	"encoding/json"
	"fmt"
	"time"
)

// Hora es un instante que NO se puede serializar sin decir en qué huso se lee.
//
// El problema que resuelve no es de formato: es que localizar era opcional.
// `CompromisoResponse.EnTimezone` existía hace meses y se llamaba desde dos
// lugares; los otros seis endpoints con timestamps salían en la TZ del proceso
// —UTC en el contenedor— y nadie se enteraba hasta que un dueño leía en la
// pantalla una consulta hecha a las 22:48 fechada 01:48 del día siguiente.
//
// Un `time.Time` desnudo en un response siempre tiene una respuesta razonable
// para dar: la TZ del proceso. Por eso el olvido es silencioso. `Hora` no
// tiene ninguna: sin location falla, y falla en el primer test que serialice
// ese endpoint.
//
// Es el mismo criterio que el `CHECK (consumido <= asignado)` de cupo_jornada,
// que no documenta que no se sobrevenda sino que lo impide, y que la unidad
// del insumo, que se elige una vez y no se convierte nunca para que el error
// de conversión no exista. Acá igual: documentar que hay que localizar ya se
// probó y no alcanzó.
//
// Los campos son privados a propósito. Exponer `T` invitaría a leerlo y hacer
// aritmética sobre un valor cuyo huso depende de quién lo construyó, que es
// justamente el error que este tipo existe para hacer imposible.
type Hora struct {
	t   time.Time
	loc *time.Location
}

// NuevaHora es el constructor normal: el instante y el huso del negocio.
//
// `loc` sale del contexto del request (ver middleware.TimezoneDelNegocio), no
// se resuelve acá: preguntar la TZ una vez por response es la consulta extra
// por listado que este cambio vino a sacar.
func NuevaHora(t time.Time, loc *time.Location) Hora {
	return Hora{t: t, loc: loc}
}

// NuevaHoraPtr es lo mismo para los campos opcionales. nil entra, nil sale:
// un `confirmado_en` que todavía no pasó tiene que viajar como `null`, no como
// una fecha cero disfrazada.
func NuevaHoraPtr(t *time.Time, loc *time.Location) *Hora {
	if t == nil {
		return nil
	}
	h := NuevaHora(*t, loc)
	return &h
}

// HoraUTC es para los responses de PLATAFORMA (`/api/admin/*`), y sólo para
// ésos.
//
// Esas rutas listan negocios de husos distintos y no tienen una TZ única de la
// cual tomar la hora. Rendir cada fila en su propio huso rompería la lectura de
// la lista: un negocio dado de alta después podría mostrar una hora de pared
// anterior al de arriba, y una lista ordenada por fecha que se ve desordenada
// es peor que una en un huso ajeno. UTC es el único huso neutral entre tenants.
//
// Que exista este constructor y no se escriba `NuevaHora(t, time.UTC)` es el
// punto: en el sitio de construcción tiene que leerse la decisión, no una
// location cualquiera que resulta ser UTC. La propiedad del tipo se mantiene
// intacta — no se puede *olvidar* el huso, sólo *elegirlo*.
func HoraUTC(t time.Time) Hora {
	return Hora{t: t, loc: time.UTC}
}

// HoraUTCPtr es HoraUTC para campos opcionales.
func HoraUTCPtr(t *time.Time) *Hora {
	if t == nil {
		return nil
	}
	h := HoraUTC(*t)
	return &h
}

// MarshalJSON escribe el instante en la location que la Hora trae.
//
// El receptor es por valor para que sirva igual en un campo `Hora` y en uno
// `*Hora`. Sin location devuelve error: NO cae a UTC ni a la TZ del proceso.
// Un fallback silencioso acá reintroduce exactamente el bug que este tipo
// elimina, y lo reintroduce en el único lugar donde ya nadie va a mirar.
func (h Hora) MarshalJSON() ([]byte, error) {
	if h.loc == nil {
		return nil, fmt.Errorf(
			"dto.Hora sin timezone: se construyó con NuevaHora(t, nil) o es el valor cero. "+
				"Usá NuevaHora(t, loc) con la location del request, o HoraUTC(t) si es una "+
				"ruta de plataforma. Instante involucrado: %s", h.t.UTC().Format(time.RFC3339))
	}
	return json.Marshal(h.t.In(h.loc).Format(time.RFC3339Nano))
}

// UnmarshalJSON existe para los tests, que leen los responses que el core
// escribe. En producción no se deserializa ningún response.
//
// Conserva el offset que venía en el string en vez de normalizar a UTC: un test
// que afirma "esto salió en -03:00" tiene que poder verlo. Perder el offset acá
// haría que el test más importante del cambio no pudiera escribirse.
func (h *Hora) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return fmt.Errorf("dto.Hora: %q no es RFC3339: %w", s, err)
	}
	h.t = t
	h.loc = t.Location()
	return nil
}

// Time devuelve el instante. Para tests y para el código que necesite comparar
// dos horas; el huso no cambia qué instante es.
func (h Hora) Time() time.Time { return h.t }

// Location devuelve el huso en el que se va a serializar, o nil si no tiene.
func (h Hora) Location() *time.Location { return h.loc }
