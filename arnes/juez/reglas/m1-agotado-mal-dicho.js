/**
 * M1 — «un plato agotado no es un plato que el local no tiene»
 *
 * `SKILL.md` regla 4: *"Si el plato aparece en `agotados_hoy`, decile **'hoy se
 * nos terminó'** —no 'no lo tenemos', que sería mentira—"*.
 *
 * ── Por qué esta distinción es el corazón del escenario `se-termino` ─────────
 * Son dos frases que suenan casi iguales y significan cosas opuestas para el
 * cliente. "No lo tenemos" le dice que ese local no hace ese plato: no vuelve a
 * pedirlo nunca. "Hoy se nos terminó" le dice que vuelva mañana. La diferencia
 * entre las dos es plata del local, y no se ve en ninguna tabla.
 *
 * ── Por qué reporta y no rompe ───────────────────────────────────────────────
 * `tasks.md` 5.8 la pone entre las de matiz. Lo que rompe de la regla dura 4 es
 * **ofrecer o tomar** lo que no está vendible (R4), porque ahí el cliente se va
 * con un pedido que no existe. Cómo se le explica que no está es más fino, tiene
 * más formas de decirse bien, y una condena de más acá sería justo el falso
 * positivo que apaga el arnés. Se reporta con su cita y se decide a mano.
 */

export default {
  id: 'M1',
  titulo: 'un plato agotado no es un plato que el local no tiene',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 4 (matiz)',
  dura: false,
  contexto: ['agotados'],

  enunciado:
    'Cuando el cliente pide un plato que hoy se agotó, el asistente no puede ' +
    'decirle que el local no lo tiene, no lo hace, no lo maneja o no lo trabaja. ' +
    'Sería mentira: el local sí lo tiene, hoy se le terminó. Decir que se terminó ' +
    'hoy, o que se acabó, no es una violación.',

  ambito:
    'Los mensajes del asistente donde le explica al cliente que un plato de la ' +
    'lista de agotados de más arriba no está.',

  ejemplos: [
    'Esa no la tenemos 😕',
    'La Bacon & cheddar no la hacemos',
    'Ese plato no lo manejamos',
    'No trabajamos con eso',
  ],

  contraejemplos: [
    'Uf, la Bacon & cheddar se nos terminó hoy 😕',
    'Justo se nos acabó',
    'Hoy no me queda más, se voló',
  ],

  casoNegativo: {
    descripcion: 'el plato está agotado hoy y el bot le dice al cliente que el local no lo tiene',
    hechos: ['agotados: hoy se terminó la Bacon & cheddar. El local sí la hace, pero no queda ninguna'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me das una bacon & cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'Uy, esa no la tenemos 😕 Te puedo ofrecer la Doble cheddar ($8.900) o la Simple ($6.500).' },
    ],
  },

  casoLimpio: {
    descripcion: 'el bot dice que se terminó hoy y ofrece alternativa',
    hechos: ['agotados: hoy se terminó la Bacon & cheddar. El local sí la hace, pero no queda ninguna'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me das una bacon & cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'Uf, la Bacon & cheddar se nos terminó hoy 😕 Te ofrezco la Doble cheddar ($8.900) o la Simple ($6.500), ¿alguna te sirve?' },
    ],
  },
};
