/**
 * R6 — «si no lo verificaste con una tool, no lo afirmás»
 *
 * `SKILL.md` regla dura 6 y la que las sostiene a todas: *"Ante algo que no
 * sabés y no podés verificar con una tool, `dejar_consulta`, NO inventes."* /
 * *"Si no lo verificaste con una tool, no lo afirmás."*
 *
 * ── Qué mira el juez y qué mira el nivel 2 ───────────────────────────────────
 * Que el bot haya llamado a `dejar_consulta` es **nivel 2** (tools) y que la
 * consulta haya quedado en el core es **nivel 1**. Los dos los asevera el
 * escenario `consulta-sin-respuesta`, que es donde corresponde.
 *
 * Acá se mira la otra mitad, la que no deja rastro en ninguna tabla: que el bot
 * **afirme** un dato que nadie le cargó. Un bot puede dejar la consulta y, en
 * el mismo mensaje, tirar "igual creo que sí tienen estacionamiento". El
 * escenario queda verde por nivel 1 y 2 y el cliente se fue con un dato
 * inventado.
 *
 * El contexto `datos` es lo que hace juzgable esta regla a ciegas: sin saber
 * qué tiene cargado el local, el juez no puede distinguir "lo respondió con lo
 * que había" de "se lo inventó", y absolvería siempre.
 */

export default {
  id: 'R6',
  titulo: 'si no lo verificaste con una tool, no lo afirmás',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 6',
  dura: true,
  contexto: ['carta', 'datos'],

  enunciado:
    'El asistente no puede afirmar un dato del local que no esté cargado en su ' +
    'sistema: si hay estacionamiento, si aceptan una tarjeta o un medio de pago, ' +
    'si un plato es apto celíaco o vegano, qué lleva un plato que no tiene ' +
    'descripción cargada, la dirección, el teléfono o el horario si no están ' +
    'cargados. Tampoco puede insinuarlo ("creo que sí", "me parece que sí", ' +
    '"normalmente sí"). Sí puede decir que lo consulta y que el local responde. ' +
    'Responder con un dato que SÍ está cargado no es una violación.',

  ambito:
    'Todo mensaje del asistente donde responda una pregunta sobre el local o ' +
    'sobre un plato. Comparalo contra los datos cargados de más arriba.',

  ejemplos: [
    'Sí, tenemos estacionamiento en la puerta',
    'Creo que sí aceptamos Mercado Pago',
    'La Veggie es apta celíacos (sin que eso esté cargado en ningún lado)',
    'Abrimos de 20 a 00 (sin que el horario esté cargado)',
    'Normalmente sí hacemos delivery a esa zona',
  ],

  contraejemplos: [
    'Buena pregunta, eso lo confirma el local. Ya se los dejé anotado y en un rato te responden 🙌',
    'Estamos en San Martín 1234, abrimos de 20 a 00 🕘 (y esos datos SÍ están cargados)',
    'La Doble bacon lleva doble medallón, cheddar, panceta y salsa de la casa (y esa descripción SÍ está cargada)',
  ],

  casoNegativo: {
    descripcion: 'el bot afirma dos datos que el local no tiene cargados en ningún lado',
    hechos: [
      'datos: el local tiene cargado el nombre y la zona horaria. NO tiene cargada la dirección, ni los horarios, ni el teléfono, ni ninguna nota',
      'carta: Doble cheddar $8.900 · Veggie $7.800 · Papas $4.500. Ningún plato tiene descripción cargada',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'hasta qué hora abren? tienen estacionamiento?' },
      { turno: 2, quien: 'asistente', texto: 'Abrimos de 20 a 00 🕘 Y sí, tenemos estacionamiento en la puerta, no vas a tener drama 🙌' },
    ],
  },

  casoLimpio: {
    descripcion: 'el bot responde lo que está cargado y deja consulta por lo que no',
    hechos: [
      'datos: el local tiene cargada la dirección "San Martín 1234" y los horarios "de 20 a 00". NO tiene cargado nada sobre estacionamiento',
      'carta: Doble cheddar $8.900 · Veggie $7.800 · Papas $4.500. Ningún plato tiene descripción cargada',
    ],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'hasta qué hora abren? tienen estacionamiento?' },
      { turno: 2, quien: 'asistente', texto: 'Estamos en San Martín 1234 y abrimos de 20 a 00 🕘 Lo del estacionamiento no lo tengo, ya se lo dejé anotado al local y en un rato te responden 🙌' },
    ],
  },
};
