/**
 * M4 — «no repreguntes lo que el cliente ya te dijo»
 *
 * `docs/FLUJOS.md`, principio 3: *"Nunca re-pregunta lo que ya le dijeron. Si el
 * cliente escribió 'lo paso a buscar', no se le pregunta si es delivery."* Y el
 * `SKILL.md` lo repite en "Cómo hablás".
 *
 * ── Por qué esta es la más peligrosa de escribir ─────────────────────────────
 * Es la regla del nivel 3 que más cerca está de ser una obligación de estilo
 * disfrazada de prohibición, y por eso es la que más probable es que termine en
 * cuarentena. Pedir una **confirmación** ("me confirmás que retirás?") no es
 * repreguntar, y volver a preguntar algo que el cliente dijo de forma ambigua
 * tampoco. El enunciado se escribió angosto a propósito: sólo cuenta si el dato
 * está dicho **sin ambigüedad** y el asistente lo pregunta **como si no lo
 * supiera**.
 *
 * Reporta y no rompe (`tasks.md` 5.8). Si empieza a discrepar seguido en los
 * tres veredictos, es señal de que está mal escrita, no de que el bot esté mal:
 * la disidencia queda registrada justamente para poder verlo.
 */

export default {
  id: 'M4',
  titulo: 'no repreguntes lo que el cliente ya te dijo',
  origen: 'docs/FLUJOS.md · principio 3 · SKILL.md "Cómo hablás"',
  dura: false,

  enunciado:
    'El asistente no puede volver a preguntar, como si no lo supiera, un dato ' +
    'que el cliente ya dijo sin ambigüedad en esta conversación: si retira o es ' +
    'delivery, su nombre, su dirección, qué pidió o cuántas unidades. Pedir una ' +
    'confirmación de algo que ya sabe ("me confirmás que retirás?") no es una ' +
    'violación. Volver a preguntar algo que el cliente dijo de forma ambigua o ' +
    'incompleta tampoco.',

  ambito:
    'Todo mensaje del asistente donde haga una pregunta. Fijate si la respuesta ' +
    'ya está en un mensaje anterior del cliente.',

  ejemplos: [
    '¿Es para delivery o lo retirás? (después de que el cliente escribió "lo paso a buscar")',
    '¿A nombre de quién? (después de que el cliente ya dijo su nombre)',
    '¿Cuántas querías? (después de que el cliente dijo "dos")',
  ],

  contraejemplos: [
    'Me confirmás que lo retirás por el local?',
    '¿A qué dirección te la mando? (el cliente pidió delivery pero no dio dirección)',
    'Cuando decís "papas", ¿las comunes o las de cheddar y bacon? (la carta tiene las dos)',
  ],

  casoNegativo: {
    descripcion: 'el cliente dijo "lo paso a buscar" y el bot le pregunta si es delivery — el error corregido el 18/08',
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar' },
      { turno: 2, quien: 'asistente', texto: '¡Listo! Una Doble cheddar y unas Papas 🍔 ¿Es para delivery o lo venís a retirar?' },
    ],
  },

  casoLimpio: {
    descripcion: 'el cliente dijo que retira y el bot lo da por sabido',
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar' },
      { turno: 2, quien: 'asistente', texto: '¡Listo! Doble cheddar $8.900 + Papas $4.500 = $13.400 🏃 Retirás por el local. ¿A nombre de quién?' },
    ],
  },
};
