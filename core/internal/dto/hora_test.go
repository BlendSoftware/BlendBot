package dto

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	// La tzdata embebida: los tests corren fuera del contenedor y no pueden
	// depender de que la máquina tenga la base de zonas instalada.
	_ "time/tzdata"
)

// instante fijo para todos los tests: 2026-08-31 23:22:38 UTC, que en
// Buenos_Aires es el mismo día 20:22:38. La diferencia de día es la que hacía
// que una consulta de la noche apareciera fechada al día siguiente.
var instante = time.Date(2026, 8, 31, 23, 22, 38, 933379000, time.UTC)

func loc(t *testing.T, nombre string) *time.Location {
	t.Helper()
	l, err := time.LoadLocation(nombre)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", nombre, err)
	}
	return l
}

// TestMarshalSinTimezoneFalla es EL test del cambio.
//
// Si algún día alguien hace que esto devuelva un JSON en vez de un error, el
// tipo entero deja de tener sentido: vuelve a ser un time.Time con pasos extra,
// y el bug de las seis horas en UTC puede volver sin que nada se ponga rojo.
func TestMarshalSinTimezoneFalla(t *testing.T) {
	casos := map[string]Hora{
		"valor cero":         {},
		"construida con nil": NuevaHora(instante, nil),
	}
	for nombre, h := range casos {
		t.Run(nombre, func(t *testing.T) {
			_, err := json.Marshal(h)
			if err == nil {
				t.Fatal("se serializó sin timezone; tenía que fallar")
			}
			// El error tiene que decir qué hacer, no sólo que algo salió mal:
			// lo va a leer alguien que agregó un campo y no sabe de este tipo.
			for _, esperado := range []string{"NuevaHora", "HoraUTC"} {
				if !strings.Contains(err.Error(), esperado) {
					t.Errorf("el error no menciona %q, no orienta a quien lo lea: %v", esperado, err)
				}
			}
		})
	}
}

func TestMarshalUsaLaTimezoneDada(t *testing.T) {
	casos := []struct {
		zona     string
		esperado string
	}{
		{"America/Argentina/Buenos_Aires", `"2026-08-31T20:22:38.933379-03:00"`},
		{"UTC", `"2026-08-31T23:22:38.933379Z"`},
		// Offset no entero: atrapa el bug de asumir husos de horas redondas.
		{"Asia/Kolkata", `"2026-09-01T04:52:38.933379+05:30"`},
	}
	for _, c := range casos {
		t.Run(c.zona, func(t *testing.T) {
			b, err := json.Marshal(NuevaHora(instante, loc(t, c.zona)))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(b) != c.esperado {
				t.Errorf("\n  obtuvo:   %s\n  esperaba: %s", b, c.esperado)
			}
		})
	}
}

// TestMarshalNoDependeDeLaTZDelProceso es la razón por la que el bug existía:
// el core dejaba la hora en la TZ del proceso, que en el contenedor es UTC.
// Ahora el proceso no tiene que ver.
func TestMarshalNoDependeDeLaTZDelProceso(t *testing.T) {
	ba := loc(t, "America/Argentina/Buenos_Aires")
	esperado := `"2026-08-31T20:22:38.933379-03:00"`

	for _, zonaProceso := range []string{"UTC", "Europe/Madrid", "Asia/Kolkata"} {
		t.Run("proceso en "+zonaProceso, func(t *testing.T) {
			original := time.Local
			time.Local = loc(t, zonaProceso)
			t.Cleanup(func() { time.Local = original })

			b, err := json.Marshal(NuevaHora(instante, ba))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(b) != esperado {
				t.Errorf("la TZ del proceso se filtró\n  obtuvo:   %s\n  esperaba: %s", b, esperado)
			}
		})
	}
}

func TestHoraUTCEsExplicita(t *testing.T) {
	b, err := json.Marshal(HoraUTC(instante))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `"2026-08-31T23:22:38.933379Z"` {
		t.Errorf("obtuvo %s", b)
	}
	if HoraUTC(instante).Location() != time.UTC {
		t.Error("HoraUTC tiene que dejar location puesta, no nil: si no, no se distingue de un olvido")
	}
}

// Los punteros son para los campos opcionales: un confirmado_en que todavía no
// pasó tiene que salir `null`, no una fecha cero disfrazada.
func TestPunterosNilEntraNilSale(t *testing.T) {
	ba := loc(t, "America/Argentina/Buenos_Aires")

	if NuevaHoraPtr(nil, ba) != nil {
		t.Error("NuevaHoraPtr(nil, loc) tenía que devolver nil")
	}
	if HoraUTCPtr(nil) != nil {
		t.Error("HoraUTCPtr(nil) tenía que devolver nil")
	}

	tipo := struct {
		Cuando *Hora `json:"cuando"`
	}{Cuando: NuevaHoraPtr(nil, ba)}
	b, err := json.Marshal(tipo)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `{"cuando":null}` {
		t.Errorf("un opcional vacío tiene que ser null, obtuvo %s", b)
	}

	tipo.Cuando = NuevaHoraPtr(&instante, ba)
	b, err = json.Marshal(tipo)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `{"cuando":"2026-08-31T20:22:38.933379-03:00"}` {
		t.Errorf("obtuvo %s", b)
	}
}

// Un *Hora nil dentro de un struct no rompe, pero un Hora VALOR sin construir sí:
// es el descuido que el tipo tiene que atrapar cuando alguien agrega un campo y
// se olvida de setearlo en el constructor del DTO.
func TestCampoValorSinConstruirRompeElResponse(t *testing.T) {
	resp := struct {
		ID     string `json:"id"`
		Creado Hora   `json:"creado_en"`
	}{ID: "abc"} // Creado quedó en cero: nadie lo construyó.

	if _, err := json.Marshal(resp); err == nil {
		t.Fatal("un response con una Hora sin construir tenía que fallar")
	}
}

// UnmarshalJSON existe para los tests. Tiene que conservar el offset: sin eso,
// un test no puede afirmar "esto salió en -03:00".
func TestUnmarshalConservaElOffset(t *testing.T) {
	var h Hora
	if err := json.Unmarshal([]byte(`"2026-08-31T20:22:38.933379-03:00"`), &h); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !h.Time().Equal(instante) {
		t.Errorf("instante distinto: %v vs %v", h.Time(), instante)
	}
	if _, offset := h.Time().Zone(); offset != -3*3600 {
		t.Errorf("se perdió el offset: %d", offset)
	}
	// Ida y vuelta sin pérdida.
	b, err := json.Marshal(h)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `"2026-08-31T20:22:38.933379-03:00"` {
		t.Errorf("el round-trip cambió el valor: %s", b)
	}
}

func TestUnmarshalRechazaBasura(t *testing.T) {
	var h Hora
	if err := json.Unmarshal([]byte(`"ayer a la tarde"`), &h); err == nil {
		t.Fatal("tenía que rechazar un string que no es RFC3339")
	}
}
