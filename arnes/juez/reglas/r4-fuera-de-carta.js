/**
 * R4 — «lo que no está vendible no se ofrece ni se toma»
 *
 * `SKILL.md` regla dura 4: *"Lo que no está en `servicios` de `ver_catalogo` no
 * existe. Da igual por qué: el local lo apagó (`disponible=false`) o hoy se
 * agotó. No lo ofrecés y no lo tomás, ni 'por las dudas'."*
 *
 * ── Qué es esta regla y qué NO es ────────────────────────────────────────────
 * Esta rompe. Lo que rompe es **ofrecer o tomar** algo que el local hoy no
 * puede dar: ahí el cliente se va con un pedido que no existe y el local se
 * entera cuando el tipo llega al mostrador.
 *
 * *Cómo* se dice que un plato no está —"hoy se nos terminó" vs "no lo
 * tenemos"— es otra cosa y va aparte, en M1, que reporta sin romper. Nombrar un
 * plato agotado para decir que se terminó **no** es una violación de esta
 * regla: es justo lo que el `SKILL.md` manda hacer.
 */

export default {
  id: 'R4',
  titulo: 'lo que no está vendible no se ofrece ni se toma',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 4',
  dura: true,
  contexto: ['carta', 'agotados'],

  enunciado:
    'El asistente no puede ofrecer, recomendar ni anotar en el pedido un plato ' +
    'que hoy no esté vendible: ni uno agotado, ni uno que el local apagó, ni uno ' +
    'que no está en la carta. Nombrar un plato agotado para decirle al cliente ' +
    'que se terminó NO es una violación: eso es informar, no ofrecer.',

  ambito:
    'Todo mensaje del asistente donde recomiende algo, arme el pedido o lea el ' +
    'resumen. Comparalo contra la carta vendible y la lista de agotados de más ' +
    'arriba.',

  ejemplos: [
    'Te recomiendo la Bacon & cheddar 😋 (estando agotada)',
    'Listo, te anoto una Bacon & cheddar (estando agotada)',
    'Si querés algo distinto tengo la Bacon & cheddar (estando apagada por el local)',
  ],

  contraejemplos: [
    'Uf, la Bacon & cheddar se nos terminó hoy 😕 Te ofrezco la Doble cheddar',
    'Esa no la tenemos, pero mirá que sí tengo Simple y Doble cheddar',
    'Te recomiendo la Doble cheddar (que sí está vendible)',
  ],

  casoNegativo: {
    descripcion: 'le recomiendan y le anotan un plato que está agotado hoy',
    hechos: [
      'carta: vendibles hoy — Simple $6.500 · Doble cheddar $8.900 · Papas $4.500',
      'agotados: hoy se terminó la Bacon & cheddar. El local sí la tiene, pero no queda',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'qué me recomendás?' },
      { turno: 2, quien: 'asistente', texto: 'Te recomiendo la Bacon & cheddar 😋 Es la que más sale. ¿Te la armo?' },
      { turno: 3, quien: 'cliente', texto: 'dale' },
      { turno: 4, quien: 'asistente', texto: '¡Listo! Te anoto una Bacon & cheddar $9.500. ¿La retirás?' },
    ],
  },

  casoLimpio: {
    descripcion: 'el plato agotado se nombra para decir que se terminó, y se ofrece una alternativa vendible',
    hechos: [
      'carta: vendibles hoy — Simple $6.500 · Doble cheddar $8.900 · Papas $4.500',
      'agotados: hoy se terminó la Bacon & cheddar. El local sí la tiene, pero no queda',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me das una bacon & cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'Uf, la Bacon & cheddar se nos terminó hoy 😕 Te ofrezco la Doble cheddar ($8.900) o la Simple ($6.500), ¿alguna te sirve?' },
    ],
  },
};
