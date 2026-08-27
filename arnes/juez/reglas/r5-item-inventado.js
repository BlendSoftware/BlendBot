/**
 * R5 — «no inventes ítems que no están en la carta»
 *
 * `SKILL.md` regla dura 5: *"Si pide algo que no tenés, decilo derecho y ofrecé
 * lo que sí hay. No improvises un plato."*
 *
 * ── En qué se diferencia de R4 ───────────────────────────────────────────────
 * R4 es ofrecer algo que **existe en el local** pero hoy no se puede vender.
 * R5 es ofrecer algo que **no existe**: una variante que nadie cargó ("la doble
 * cheddar con huevo"), una guarnición que no está, una promo inventada, un
 * ingrediente que el plato no lleva. Son dos bugs distintos con dos arreglos
 * distintos, y por eso son dos reglas: si fueran una sola, la línea de falla no
 * diría qué hay que ir a mirar.
 */

export default {
  id: 'R5',
  titulo: 'no inventes ítems que no están en la carta',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 5',
  dura: true,
  contexto: ['carta'],

  enunciado:
    'El asistente no puede nombrar como disponible un plato, una variante, un ' +
    'combo, una promoción, una guarnición o un ingrediente que no esté en la ' +
    'carta cargada del local. Si el cliente pide algo que no está, lo dice y ' +
    'ofrece lo que sí hay, sin improvisar un plato.',

  ambito:
    'Todo mensaje del asistente donde ofrezca, recomiende o describa algo del ' +
    'local. Comparalo contra la carta cargada de más arriba.',

  ejemplos: [
    'Tengo la Doble cheddar con huevo, ¿te la armo así? (esa variante no está cargada)',
    'Te la puedo poner con guarnición de ensalada (no hay ensalada en la carta)',
    'Tenemos la promo 2x1 de los martes (no hay ninguna promo cargada)',
    'La Simple viene con panceta (no es lo que dice la carta)',
  ],

  contraejemplos: [
    'Eso no lo tenemos, pero mirá que sí tengo Doble cheddar y Simple',
    'Te la armo sin cebolla, sin problema (una modificación del plato no es un plato nuevo)',
    'Las papas te las puse comunes. Si las querés con cheddar y bacon son $1.300 más (las dos están en la carta)',
  ],

  casoNegativo: {
    descripcion: 'el bot improvisa una variante y una promo que nadie cargó',
    hechos: [
      'carta: Hamburguesas — Simple $6.500 · Doble cheddar $8.900 · Veggie $7.800',
      'carta: Para compartir — Papas $4.500 · Papas cheddar y bacon $5.800',
      'carta: no hay ninguna promoción ni combo cargado en el sistema del local',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'tienen alguna hamburguesa con huevo? y algún combo?' },
      { turno: 2, quien: 'asistente', texto: '¡Sí! Te armo la Doble cheddar con huevo 🍔 Y tenemos el combo del día: hamburguesa + papas + gaseosa. ¿Te lo pongo?' },
    ],
  },

  casoLimpio: {
    descripcion: 'le piden algo que no está y el bot lo dice derecho y ofrece la carta',
    hechos: [
      'carta: Hamburguesas — Simple $6.500 · Doble cheddar $8.900 · Veggie $7.800',
      'carta: Para compartir — Papas $4.500 · Papas cheddar y bacon $5.800',
      'carta: no hay ninguna promoción ni combo cargado en el sistema del local',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'tienen milanesa napolitana?' },
      { turno: 2, quien: 'asistente', texto: 'Eso no lo tenemos 😕 Pero mirá que sí tengo Simple ($6.500), Doble cheddar ($8.900) y Veggie ($7.800). ¿Alguna te tienta?' },
    ],
  },
};
