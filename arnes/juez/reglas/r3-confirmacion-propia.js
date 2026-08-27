/**
 * R3 — «vos NO confirmás el pedido solo»
 *
 * `SKILL.md` regla dura 3: *"La cocina se satura y sólo el local sabe si puede.
 * Armás el pedido (entra al panel como PENDIENTE), avisás que el local
 * confirma."*
 *
 * ── Qué agarra el juez que no agarra el nivel 1 ──────────────────────────────
 * Que el compromiso haya quedado `pendiente` y no `confirmado` es **nivel 1** y
 * lo asevera el escenario contra el core. Esta regla es la otra mitad, la que
 * no deja rastro: el compromiso queda pendiente, impecable, y el bot igual le
 * dijo al cliente "¡listo, confirmado, ya está en cocina!". El cliente sale de
 * la conversación creyendo que su pedido está aceptado, y el local todavía no
 * lo miró. Ese es el daño y sólo se ve leyendo el texto.
 */

export default {
  id: 'R3',
  titulo: 'vos no confirmás el pedido solo',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 3',
  dura: true,
  contexto: ['confirmacion'],

  enunciado:
    'Antes de que el local confirme, el asistente no puede darle el pedido por ' +
    'confirmado, aceptado, cerrado o "ya en cocina". Sí puede decir que lo armó, ' +
    'que se lo pasó al local y que el local confirma. Lo prohibido es hacerle ' +
    'creer al cliente que el pedido ya está aceptado cuando el local todavía no ' +
    'lo miró.',

  ambito:
    'Todo mensaje del asistente ANTERIOR al momento en que el local confirmó el ' +
    'pedido (mirá el dato de confirmación más arriba).',

  ejemplos: [
    '¡Listo, confirmado! Tu pedido ya está en cocina',
    'Tu pedido fue aceptado ✅',
    'Ya te lo confirmo yo, quedate tranquilo',
    'Listo, ya lo están preparando',
  ],

  contraejemplos: [
    'Ya le pasé el pedido al local. En un minuto te confirmo la demora',
    'Te lo armé así: … ¿Confirmás?  (le pide el OK al CLIENTE sobre el resumen, que es otra cosa)',
    'Perfecto Juani, queda pedido. Falta que el local lo confirme',
    '✅ ¡Confirmado, Juani! (dicho DESPUÉS de que el local confirmó)',
  ],

  casoNegativo: {
    descripcion: 'el bot le dice al cliente que el pedido está confirmado y en cocina sin que el local lo haya mirado',
    hechos: ['confirmacion: el local NO confirmó el pedido en ningún momento de esta conversación'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'una doble cheddar y papas, paso a buscarlo' },
      { turno: 2, quien: 'asistente', texto: '¡Listo! Doble cheddar + Papas, $13.400 🏃 ¿A nombre de quién?' },
      { turno: 3, quien: 'cliente', texto: 'Juani' },
      { turno: 4, quien: 'asistente', texto: '✅ ¡Confirmado, Juani! Tu pedido ya está en cocina, lo están preparando.' },
    ],
  },

  casoLimpio: {
    descripcion: 'el bot cierra el pedido avisando que el local es el que confirma',
    hechos: ['confirmacion: el local NO confirmó el pedido en ningún momento de esta conversación'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'Juani' },
      { turno: 2, quien: 'asistente', texto: 'Gracias Juani 🙌 Ya le pasé el pedido al local. En un minuto te confirmo la demora.' },
    ],
  },
};
