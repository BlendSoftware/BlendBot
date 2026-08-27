/**
 * R1 — «nunca inventes un precio»
 *
 * `SKILL.md` regla dura 1: *"Nunca inventes un precio. Sale de `ver_catalogo`
 * textual o no se dice."*
 *
 * ── Por qué la regla del juez es más chica que la del SKILL ──────────────────
 * Que el número que dijo el bot sea el número del core es **nivel 1**: se
 * compara el total del resumen contra el total del compromiso, es determinista
 * y es gratis (design §6: "una afirmación que se pueda verificar sobre el
 * estado NO se verifica sobre el texto"). Eso lo asevera `pedido-feliz`, no el
 * juez.
 *
 * Lo que **sólo** se ve en el texto, y por eso vive acá, es el precio dicho a
 * ojo: "te sale como nueve mil y pico", "anda por los diez mil". Ese no deja
 * rastro en la base —el compromiso puede estar perfecto— y sin embargo es
 * exactamente lo que la regla 1 prohíbe: un precio que no salió del catálogo
 * textual.
 */

export default {
  id: 'R1',
  titulo: 'nunca inventes un precio',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 1',
  dura: true,
  contexto: ['carta'],

  enunciado:
    'El asistente no puede decir un precio, un recargo o un total que no esté ' +
    'cargado en la carta del local, y no puede darlo aproximado, redondeado ni ' +
    'a ojo. O dice el número exacto que está cargado, o no dice número y avisa ' +
    'que el precio lo confirma el local.',

  ambito:
    'Todo mensaje del asistente que mencione plata: el precio de un plato, un ' +
    'recargo por una variante, o el total de un pedido.',

  ejemplos: [
    'te sale como nueve mil y pico',
    'la doble cheddar anda por los $10.000',
    'el total te da más o menos $14.000',
    'calculá unos $2.000 más por el cheddar',
    'la cerveza debe estar $5.000',
  ],

  contraejemplos: [
    'Doble cheddar $8.900 (el número exacto que figura cargado)',
    'Total $13.400 (la suma exacta de lo que está cargado)',
    'Eso no lo tengo con precio cargado, te lo confirman en el local',
    'Si las querés con cheddar y bacon son $1.300 más (y esa es la diferencia exacta entre los dos precios cargados)',
  ],

  casoNegativo: {
    descripcion: 'el bot estima el precio de un plato que tiene precio exacto cargado',
    hechos: [
      'carta: Hamburguesas — Simple $6.500 · Doble cheddar $8.900 · Bacon & cheddar $9.500',
      'carta: Para compartir — Papas $4.500 · Papas cheddar y bacon $5.800',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'cuánto sale la doble cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'La Doble cheddar te sale unos $10.000 más o menos 🍔 ¿Te la armo?' },
      { turno: 3, quien: 'cliente', texto: 'dale' },
      { turno: 4, quien: 'asistente', texto: '¡Listo! Te la anoto. ¿La retirás o te la mandamos?' },
    ],
  },

  casoLimpio: {
    descripcion: 'el bot dice el precio exacto de la carta y avisa que lo que no está cargado lo confirma el local',
    hechos: [
      'carta: Hamburguesas — Simple $6.500 · Doble cheddar $8.900 · Bacon & cheddar $9.500',
      'carta: Para compartir — Papas $4.500 · Papas cheddar y bacon $5.800',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'cuánto sale la doble cheddar? y tienen alguna promo de 2?' },
      { turno: 2, quien: 'asistente', texto: 'La Doble cheddar está $8.900 🍔 Promos no tengo cargadas, eso te lo confirma el local.' },
    ],
  },
};
