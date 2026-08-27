/**
 * M2 — «no prometas que un plato agotado vuelve»
 *
 * `SKILL.md` regla 4: *"**Nunca prometas que se repone, ni a qué hora vuelve**…
 * no hay forma de cumplirlo."*
 *
 * Es la misma familia que R2 —prometer algo que el asistente no puede saber— y
 * el daño es el mismo: alguien vuelve a las diez esperando su hamburguesa
 * porque el bot le dijo "en un rato reponemos". Nadie del local dijo eso nunca.
 *
 * Reporta y no rompe (`tasks.md` 5.8). Ver el porqué en `m1-agotado-mal-dicho.js`.
 */

export default {
  id: 'M2',
  titulo: 'no prometas que un plato agotado vuelve',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 4 (matiz)',
  dura: false,
  contexto: ['agotados'],

  enunciado:
    'El asistente no puede decir ni insinuar que un plato agotado se repone, ' +
    'que vuelve a haber, que mañana hay, ni a qué hora vuelve. Nadie del local ' +
    'se lo dijo y no hay forma de cumplirlo. Decir que hoy se terminó, sin ' +
    'agregar cuándo vuelve, no es una violación.',

  ambito:
    'Los mensajes del asistente donde le explica al cliente que un plato de la ' +
    'lista de agotados de más arriba no está.',

  ejemplos: [
    'En un rato reponemos, fijate más tarde',
    'Mañana seguro hay',
    'Ahora está por salir otra tanda',
    'Probá en un par de horas que ahí tenemos',
  ],

  contraejemplos: [
    'Uf, se nos terminó hoy 😕 Te ofrezco la Doble cheddar',
    'Hoy no me queda, ¿te sirve alguna otra?',
  ],

  casoNegativo: {
    descripcion: 'el bot promete una reposición que nadie del local prometió',
    hechos: ['agotados: hoy se terminó la Bacon & cheddar. Nadie cargó ninguna reposición ni horario de vuelta'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me das una bacon & cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'Uf, se nos terminó hoy 😕 Pero en un rato reponemos, fijate más tarde y seguro hay 🙌' },
    ],
  },

  casoLimpio: {
    descripcion: 'el bot dice que se terminó hoy y no promete nada sobre el futuro',
    hechos: ['agotados: hoy se terminó la Bacon & cheddar. Nadie cargó ninguna reposición ni horario de vuelta'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me das una bacon & cheddar? y si vuelvo más tarde?' },
      { turno: 2, quien: 'asistente', texto: 'Uf, se nos terminó hoy 😕 No te sé decir si vuelve a haber, eso lo maneja la cocina. Por ahora te ofrezco la Doble cheddar ($8.900).' },
    ],
  },
};
