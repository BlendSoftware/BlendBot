/**
 * cita.js — la prueba de una condena, verificada contra la transcripción.
 *
 * Regla de oro del nivel 3 (design §6, spec "Un veredicto condenatorio sin cita
 * textual es un fallo del arnés"):
 *
 *   **Una condena que no se puede probar contra el texto NO es una falla del
 *   producto: es el arnés roto para esa regla.**
 *
 * Un juez que puede condenar sin pruebas es un generador de falsos positivos
 * con permiso, y el primer falso positivo que le cuesta media hora a alguien es
 * el último día que el arnés se corre.
 *
 * Tres cosas se verifican, y las tres importan:
 *
 *   1. **Que la frase exista** en la transcripción.
 *   2. **Que salga de un turno del ASISTENTE.** Un juez que "prueba" que el bot
 *      prometió una demora citando al cliente que preguntó "¿cuánto tarda?"
 *      está roto, aunque la frase exista textual. Es el modo de falla más
 *      convincente que hay: la cita cierra y el veredicto es basura.
 *   3. **Que no sea trivial.** Una "cita" de dos caracteres aparece siempre.
 *      Ver `MINIMO_CARACTERES`.
 *
 * Sobre la normalización: se afloja lo que un modelo cambia sin querer al
 * copiar (comillas tipográficas, guiones largos, espacios dobles, mayúsculas,
 * tildes) y NO se afloja nada más. Cada aflojada de más es una cita fabricada
 * que pasa; cada aflojada de menos es un arnés roto donde había una condena
 * legítima. El punto medio se elige a favor de la condena legítima porque el
 * caso "el juez copió bien pero con comillas rectas" es cotidiano y el caso "el
 * juez inventó una frase que casualmente coincide salvo tildes" no existe.
 */

/**
 * Debajo de esto, la cita no prueba nada: "ya", "el", "no" aparecen en
 * cualquier conversación. Ocho caracteres es una frase corta de verdad
 * ("ya sale" tiene siete y es justo la que hay que poder citar, así que se
 * cuenta después de normalizar y se deja el umbral bajo a propósito).
 */
export const MINIMO_CARACTERES = 6;

/**
 * Normaliza para comparar. Lo que se toca:
 *   · minúsculas
 *   · tildes y diéresis (NFD + saca los diacríticos)
 *   · comillas tipográficas → rectas, guiones largos → guion, … → ...
 *   · cualquier corrida de espacios/saltos → un espacio
 *   · puntuación de los bordes (un juez cita "…prometo 20 minutos." con el
 *     punto final que el bot no escribió)
 */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?"'¡¿()[\]«»]+/, '')
    .replace(/[\s.,;:!?"'()[\]«»]+$/, '');
}

/**
 * @typedef {object} CitaVerificada
 * @property {boolean} ok            si la cita prueba algo
 * @property {number|null} turno     el turno donde está de verdad
 * @property {string|null} textual   el fragmento como lo dijo el asistente
 * @property {string} [motivo]       por qué no prueba nada, si no prueba nada
 * @property {boolean} [turnoCorregido]  el juez erró el número pero la frase está
 */

/**
 * Busca la cita en la transcripción.
 *
 * Primero en el turno que el juez señaló; si ahí no está, en el resto de los
 * turnos del asistente. Que el juez erre el número de turno pero acierte la
 * frase es un error de contabilidad, no de juicio: la condena vale y se anota
 * el turno corregido. Que acierte el número y erre la frase, no.
 *
 * @param {string} cita
 * @param {number|null} turnoDicho
 * @param {import('./protocolo.js').Turno[]} transcripcion
 * @returns {CitaVerificada}
 */
export function verificarCita(cita, turnoDicho, transcripcion) {
  const aguja = normalizar(cita);
  if (aguja.length < MINIMO_CARACTERES) {
    return {
      ok: false,
      turno: null,
      textual: null,
      motivo: `la cita «${cita}» es demasiado corta para probar algo (mínimo ${MINIMO_CARACTERES} caracteres)`,
    };
  }

  const delAsistente = transcripcion.filter((t) => t.quien === 'asistente');

  const señalado = delAsistente.find((t) => t.turno === turnoDicho);
  if (señalado && normalizar(señalado.texto).includes(aguja)) {
    return { ok: true, turno: señalado.turno, textual: recortar(señalado.texto, cita) };
  }

  const enOtro = delAsistente.find((t) => normalizar(t.texto).includes(aguja));
  if (enOtro) {
    return {
      ok: true,
      turno: enOtro.turno,
      textual: recortar(enOtro.texto, cita),
      turnoCorregido: true,
    };
  }

  // El caso feo y convincente: la frase existe, pero la dijo otro. Se nombra
  // distinto del "no existe" porque el arreglo es distinto — acá el juez está
  // razonando mal, no alucinando.
  const deOtroActor = transcripcion.find(
    (t) => t.quien !== 'asistente' && normalizar(t.texto).includes(aguja),
  );
  if (deOtroActor) {
    return {
      ok: false,
      turno: deOtroActor.turno,
      textual: null,
      motivo: `la cita existe pero la dijo el ${deOtroActor.quien} en el turno ${deOtroActor.turno}, no el asistente`,
    };
  }

  return {
    ok: false,
    turno: null,
    textual: null,
    motivo: `la cita «${recorteCorto(cita)}» no aparece en ningún mensaje del asistente`,
  };
}

/**
 * Devuelve el fragmento **como lo dijo el asistente**, no como lo copió el
 * juez. Es lo que va a la línea de falla: la evidencia tiene que ser el texto
 * del producto, con sus tildes y sus mayúsculas, no la versión del juez.
 */
function recortar(textoOriginal, cita) {
  const aguja = normalizar(cita);
  const normalizado = normalizar(textoOriginal);
  const desde = normalizado.indexOf(aguja);
  if (desde < 0) return textoOriginal.trim();

  // Mapear un índice del texto normalizado al original es imposible sin
  // reconstruirlo carácter por carácter, así que se hace: cada carácter del
  // original aporta 0 o más caracteres al normalizado y se guarda dónde cayó.
  const mapa = [];
  let acumulado = '';
  for (let i = 0; i < textoOriginal.length; i += 1) {
    const antes = acumulado.length;
    acumulado = normalizar(textoOriginal.slice(0, i + 1));
    for (let k = antes; k < acumulado.length; k += 1) mapa[k] = i;
  }
  const iniOriginal = mapa[desde];
  const finOriginal = mapa[desde + aguja.length - 1];
  if (iniOriginal === undefined || finOriginal === undefined) return textoOriginal.trim();
  return textoOriginal.slice(iniOriginal, finOriginal + 1).trim();
}

function recorteCorto(t, largo = 80) {
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length > largo ? `${s.slice(0, largo)}…` : s;
}
