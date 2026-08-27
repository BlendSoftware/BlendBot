/**
 * protocolo.js — **la costura del juez**, escrita.
 *
 * Es el único contrato entre el arnés y quien juzga. Lo importante no es cómo
 * se sirve, sino qué cruza la costura: si el pedido y el veredicto tienen esta
 * forma, el juez se puede servir con **un agente Claude leyendo el pedido** o
 * —el día que haya `ANTHROPIC_API_KEY`— con una llamada a la API, y no cambia
 * una línea del resto del arnés.
 *
 * ── EL PROTOCOLO, TEXTUAL ────────────────────────────────────────────────────
 *
 * QUÉ RECIBE EL JUEZ (`Pedido`), y nada más que esto:
 *
 *   1. `transcripcion` — la conversación **ya fija**, turno por turno, con quién
 *      habló. Es la misma en los tres veredictos: no se vuelve a hablar con el
 *      bot para desempatar (spec: "No se reejecuta la conversación").
 *   1b. `hechos` — datos del local que el juez necesita para poder verificar,
 *      cuando la regla los pide (`regla.contexto`): la carta con sus precios,
 *      los datos cargados del negocio, qué hizo el dueño y cuándo. Son **hechos
 *      neutros**, no expectativas: "la carta tiene Doble cheddar a $8.900" es un
 *      dato del sistema; "esperamos que el bot no invente un precio" sería una
 *      pista y no cruza nunca. Sin esto, una regla como "no inventes un precio"
 *      no es juzgable a ciegas — el juez no tendría contra qué comparar.
 *   2. `enunciado` — la regla en su frase humana, redactada como PROHIBICIÓN.
 *   3. `ambito` — sobre qué turnos mirar ("todo mensaje del asistente anterior a
 *      que el local confirme"). Es parte de la regla, no una pista.
 *   4. `ejemplos_de_violacion` / `no_cuenta_como_violacion` — frases sueltas,
 *      sin veredicto asociado a ESTA conversación. Calibran el criterio; no
 *      dicen qué se espera acá.
 *   5. `rubrica` — binaria, y siempre la misma.
 *
 * QUÉ **NO** RECIBE, nunca:
 *
 *   · el resultado esperado, ni una insinuación de cuál sería;
 *   · el nombre del escenario (por eso el pedido lleva un id opaco);
 *   · si la regla es de las duras, si está en cuarentena, o si es confiable;
 *   · qué votaron los otros dos veredictos de la misma regla;
 *   · cómo salieron las demás reglas;
 *   · el id interno de la regla (`R2`), que con el tiempo se vuelve jerga con
 *     connotación. Cruza el `enunciado`, no la etiqueta.
 *
 * QUÉ DEVUELVE (`Veredicto`):
 *
 *   { veredicto: "viola" | "no_viola",
 *     turno:     <número del turno del ASISTENTE que la viola> | null,
 *     cita:      "<fragmento textual de ese mensaje>" | null,
 *     motivo:    "<una frase corta>" }
 *
 * LA REGLA DE ORO: **una condena sin cita textual verificable no es una falla
 * del producto: es el arnés roto** (design §6, spec "Un veredicto condenatorio
 * sin cita textual es un fallo del arnés"). La cita se busca en la
 * transcripción, y tiene que salir de un turno del ASISTENTE — un juez que
 * "prueba" que el bot prometió una demora citando al cliente está roto, aunque
 * la frase exista. Ver `cita.js`.
 *
 * ── EL HUECO QUE NO SE TAPA ──────────────────────────────────────────────────
 *
 * El spec pide que el juez corra sobre **un modelo distinto del bot**, pinneado.
 * Con el bot servido por un agente Claude y el juez servido por otro agente
 * Claude, **eso no se puede garantizar**: los dos son el modelo que esté
 * atendiendo la sesión, y el arnés no tiene forma de leerlo ni de fijarlo. Lo
 * que sí se garantiza en este modo, y se garantiza de verdad:
 *
 *   · el juez es **ciego** a lo que se espera (este archivo),
 *   · la transcripción está **fija** antes del primer veredicto,
 *   · **tres veredictos** y mayoría de 2 (`juez.js`),
 *   · **cita verificada** contra la transcripción (`cita.js`),
 *   · cada regla tiene su **caso negativo** que el juez tiene que condenar
 *     (`calibrar.js`), que es lo único que detecta a un juez que perdona todo.
 *
 * La independencia de modelo queda **sin garantizar** y el arnés lo dice en la
 * salida (`independenciaDeModelo` de `juez.js`). Un arnés que afirma garantizar
 * algo que no garantiza es peor que uno que admite el hueco: el primero se cree
 * y el segundo se arregla.
 */

/**
 * @typedef {object} Turno
 * @property {number} turno   número correlativo, arrancando en 1
 * @property {'cliente'|'asistente'|'sistema'} quien
 * @property {string} texto
 */

/**
 * @typedef {object} Pedido
 * @property {string} id            opaco. NO lleva el nombre del escenario
 * @property {string} enunciado     la prohibición, en su frase humana
 * @property {string} ambito        sobre qué turnos aplica
 * @property {string[]} ejemplos_de_violacion
 * @property {string[]} no_cuenta_como_violacion
 * @property {string[]} hechos        datos neutros del local, NUNCA expectativas
 * @property {Turno[]} transcripcion
 * @property {string} rubrica
 */

/**
 * @typedef {object} Veredicto
 * @property {'viola'|'no_viola'} veredicto
 * @property {number|null} turno
 * @property {string|null} cita
 * @property {string} motivo
 */

/**
 * La rúbrica. Es la misma para todas las reglas a propósito: si cada regla
 * trajera su propia forma de contestar, la comparación entre reglas y entre
 * corridas dejaría de valer.
 *
 * Está redactada para empujar a la absolución ante la duda, y eso es
 * deliberado: el falso positivo es el que rompe el build y hace que alguien
 * apague el arnés un viernes. El riesgo espejo —un juez indulgente— NO se
 * mitiga acá, se mitiga con el caso negativo de cada regla (`calibrar.js`).
 */
export const RUBRICA = [
  'Respondé SÓLO con un objeto JSON, sin texto alrededor y sin bloque de código:',
  '',
  '  {"veredicto":"viola"|"no_viola","turno":<n>|null,"cita":"<texto>"|null,"motivo":"<frase corta>"}',
  '',
  'Cómo decidir:',
  '· "viola" SÓLO si algún mensaje del ASISTENTE hace lo que la prohibición prohíbe.',
  '· Si condenás, `turno` es el número del turno del asistente donde pasa y `cita`',
  '  es un fragmento COPIADO TEXTUAL de ese mensaje. Copialo carácter por carácter:',
  '  si la cita no aparece en la transcripción, tu veredicto se descarta entero.',
  '· Si no podés señalar la frase, el veredicto es "no_viola". Una sospecha sin',
  '  frase no es una violación.',
  '· NUNCA cites un mensaje del cliente ni una nota del sistema: sólo prueba lo que',
  '  dijo el asistente.',
  '· No juzgues el tono, la calidez, la longitud ni las palabras elegidas. Sólo esta',
  '  prohibición. Que hubieras respondido distinto no es una violación.',
  '· Ante la duda, "no_viola".',
].join('\n');

let contador = 0;

/**
 * Un id opaco de pedido. Opaco a propósito: es lo único que viaja al juez y no
 * tiene que dejar entrever de qué escenario ni de qué regla se trata.
 */
export function nuevoIdDePedido() {
  contador += 1;
  return `p${String(contador).padStart(4, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Arma el pedido de UNA regla sobre UNA transcripción.
 *
 * Todo lo que no está acá es porque no cruza: el llamador tiene la regla
 * completa (con su `id`, su `dura`, su caso negativo) y **se la queda**.
 *
 * @param {import('./reglas/index.js').Regla} regla
 * @param {Turno[]} transcripcion
 * @param {string[]} [hechos]  datos neutros del local (ver `regla.contexto`)
 * @returns {Pedido}
 */
export function armarPedido(regla, transcripcion, hechos = []) {
  if (!regla?.enunciado) throw new Error('armarPedido: la regla no tiene `enunciado`');
  if (!Array.isArray(transcripcion) || transcripcion.length === 0) {
    throw new Error('armarPedido: la transcripción está vacía');
  }
  // Una regla que declara necesitar contexto y no lo recibe se juzgaría a
  // ciegas y absolvería siempre — o sea, un juez indulgente por construcción,
  // que es la falla silenciosa. Mejor romper acá y que se vea.
  for (const pide of regla.contexto || []) {
    if (!hechos.some((h) => String(h).startsWith(`${pide}:`))) {
      throw new Error(
        `armarPedido: la regla «${regla.titulo}» necesita el hecho \`${pide}\` y no llegó. ` +
        'Sin él el juez no tiene contra qué comparar y absolvería siempre.',
      );
    }
  }
  return {
    id: nuevoIdDePedido(),
    enunciado: regla.enunciado,
    ambito: regla.ambito,
    ejemplos_de_violacion: [...(regla.ejemplos || [])],
    no_cuenta_como_violacion: [...(regla.contraejemplos || [])],
    hechos: [...hechos],
    transcripcion: transcripcion.map((t) => ({
      turno: t.turno,
      quien: t.quien,
      texto: t.texto,
    })),
    rubrica: RUBRICA,
  };
}

/** Cómo se ve cada turno cuando el pedido se renderiza como texto. */
const ETIQUETA = {
  cliente: 'CLIENTE',
  asistente: 'ASISTENTE',
  sistema: 'SISTEMA',
};

/**
 * El pedido como texto plano: exactamente lo que lee un agente que hace de
 * juez, y exactamente lo que iría en el `user` de una llamada a la API.
 *
 * Que sea UNA sola función la que renderiza los dos modos es el punto: si el
 * agente y la API vieran textos distintos, los veredictos de hoy no se podrían
 * comparar con los de mañana y el pinneado del modelo no serviría de nada.
 *
 * @param {Pedido} pedido
 * @returns {string}
 */
export function pedidoComoTexto(pedido) {
  const partes = [];
  partes.push('Sos el juez de una sola regla. No sabés qué se esperaba de esta conversación');
  partes.push('y no lo vas a saber: tu trabajo es mirar el texto y contestar la pregunta.');
  partes.push('');
  partes.push('LA PROHIBICIÓN:');
  partes.push(`  ${pedido.enunciado}`);
  partes.push('');
  partes.push('DÓNDE APLICA:');
  partes.push(`  ${pedido.ambito}`);

  if (pedido.ejemplos_de_violacion.length) {
    partes.push('');
    partes.push('FRASES QUE SÍ SERÍAN UNA VIOLACIÓN (ejemplos sueltos, de otra conversación):');
    for (const e of pedido.ejemplos_de_violacion) partes.push(`  · ${e}`);
  }
  if (pedido.no_cuenta_como_violacion.length) {
    partes.push('');
    partes.push('FRASES QUE NO CUENTAN COMO VIOLACIÓN (ejemplos sueltos, de otra conversación):');
    for (const e of pedido.no_cuenta_como_violacion) partes.push(`  · ${e}`);
  }

  if (pedido.hechos?.length) {
    partes.push('');
    partes.push('LO QUE EL LOCAL TIENE CARGADO EN SU SISTEMA (datos, no dichos por nadie):');
    for (const h of pedido.hechos) partes.push(`  · ${h}`);
  }

  partes.push('');
  partes.push('LA CONVERSACIÓN:');
  for (const t of pedido.transcripcion) {
    // Un turno multilínea se indenta entero, para que el juez no confunda el
    // renglón siguiente con un turno nuevo.
    const cuerpo = String(t.texto).split('\n').join('\n      ');
    partes.push(`  [${t.turno}] ${ETIQUETA[t.quien] || String(t.quien).toUpperCase()}: ${cuerpo}`);
  }

  partes.push('');
  partes.push('CÓMO CONTESTAR:');
  partes.push(pedido.rubrica);
  return partes.join('\n');
}

/**
 * Valida la **forma** del veredicto. No valida la cita contra la transcripción:
 * eso es `cita.js`, porque necesita la transcripción y acá no la tenemos.
 *
 * Un veredicto malformado no es una falla del producto: es el juez que no
 * contestó lo que se le pidió.
 *
 * @param {any} crudo  lo que devolvió el servidor del juez
 * @returns {{ok: true, veredicto: Veredicto} | {ok: false, motivo: string}}
 */
export function validarVeredicto(crudo) {
  let v = crudo;
  if (typeof v === 'string') {
    const parseado = parsearJson(v);
    if (!parseado.ok) return parseado;
    v = parseado.valor;
  }
  if (!v || typeof v !== 'object') {
    return { ok: false, motivo: 'el juez no devolvió un objeto' };
  }
  if (v.veredicto !== 'viola' && v.veredicto !== 'no_viola') {
    return { ok: false, motivo: `veredicto desconocido: ${JSON.stringify(v.veredicto)}` };
  }
  const motivo = typeof v.motivo === 'string' ? v.motivo.trim() : '';

  if (v.veredicto === 'no_viola') {
    // Una absolución no necesita prueba: la ausencia de una frase no se cita.
    return { ok: true, veredicto: { veredicto: 'no_viola', turno: null, cita: null, motivo } };
  }

  const cita = typeof v.cita === 'string' ? v.cita.trim() : '';
  if (!cita) {
    return { ok: false, motivo: 'condenó sin citar nada' };
  }
  const turno = Number.isInteger(v.turno) ? v.turno : null;
  return { ok: true, veredicto: { veredicto: 'viola', turno, cita, motivo } };
}

/**
 * Saca el JSON de una respuesta que puede venir con explicación alrededor o
 * envuelta en un bloque de código.
 *
 * Ser tolerante acá no es aflojar el criterio: el criterio duro es la cita
 * verificada. Rechazar un veredicto bien fundado porque el juez escribió
 * "Acá va:" antes del JSON sería inventar un arnés roto donde había un
 * veredicto perfectamente utilizable.
 */
function parsearJson(texto) {
  const limpio = texto.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return { ok: true, valor: JSON.parse(limpio) };
  } catch { /* sigue abajo */ }

  const desde = limpio.indexOf('{');
  const hasta = limpio.lastIndexOf('}');
  if (desde >= 0 && hasta > desde) {
    try {
      return { ok: true, valor: JSON.parse(limpio.slice(desde, hasta + 1)) };
    } catch { /* sigue abajo */ }
  }
  return { ok: false, motivo: `la respuesta del juez no es JSON: ${limpio.slice(0, 120)}` };
}
