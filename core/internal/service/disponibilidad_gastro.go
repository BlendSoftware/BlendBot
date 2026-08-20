package service

import (
	"time"

	"copiloto/core/internal/model"
)

// Disponibilidad del vertical gastronomía. Todo acá es ADITIVO sobre el cálculo
// de huecos: bifurca por el TIPO del recurso sin tocar el camino de
// `profesional`, que sigue resolviéndose exactamente como antes.
//
// La regla de cada tipo:
//
//   - profesional: atiende 1 compromiso por franja. Cualquier intervalo que
//     pise el slot lo ocupa. (Camino histórico, salud.)
//   - mesa: capacidad = cubiertos, pero una reserva la toma por su duración
//     completa. Los cubiertos no habilitan dos reservas en paralelo: a los
//     efectos de la agenda, una mesa es 1 por franja, igual que un profesional.
//   - cocina: capacidad = unidades/hora. Admite varios pedidos en paralelo
//     mientras los que pisan la franja no superen la capacidad.

// cupoDeSlot decide si un slot está disponible para el recurso y, cuando aplica,
// cuánto cupo queda. El segundo retorno sólo es significativo para cocina; para
// el resto es nil y el DTO lo omite, así que la salida de profesional/mesa no
// cambia ni un byte.
func cupoDeSlot(rec model.Recurso, ocupados []intervalo, desde, hasta time.Time) (bool, *int) {
	if rec.Tipo == model.RecursoCocina {
		capacidad := rec.Capacidad
		if capacidad < 1 {
			capacidad = 1
		}
		restante := capacidad - cuentaSolapes(ocupados, desde, hasta)
		if restante <= 0 {
			return false, nil
		}
		return true, &restante
	}
	// profesional y mesa: 1 por franja, comportamiento idéntico al histórico.
	return !pisaAlguno(ocupados, desde, hasta), nil
}

// cuentaSolapes cuenta cuántos intervalos ocupados pisan la franja. Para cocina
// cada compromiso vivo de la franja consume una unidad de capacidad.
func cuentaSolapes(ocupados []intervalo, desde, hasta time.Time) int {
	n := 0
	for _, o := range ocupados {
		if o.pisa(desde, hasta) {
			n++
		}
	}
	return n
}
