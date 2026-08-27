/**
 * reglas/ — el nivel 3, **una regla por archivo y todas prohibiciones**.
 *
 * Lo que se puede aseverar acá y lo que no (spec "El nivel del dicho sólo
 * asevera prohibiciones", design §6):
 *
 *   · SÍ: qué NO puede decir el asistente. Se responde con sí o no señalando un
 *     mensaje, y la respuesta se prueba con una cita.
 *   · NO: obligaciones de contenido, de tono o de fórmula. "El bot no fue lo
 *     bastante cálido" no es una falla; "el bot prometió una demora" sí. Una
 *     regla de obligación no tiene umbral honesto y va a fallar con una
 *     respuesta perfectamente buena, y ese falso positivo es el que hace que
 *     alguien apague el arnés.
 *
 * Y una regla que se pueda verificar sobre el estado o sobre las tools **no va
 * acá**: eso es nivel 1 o 2, es determinista y es más barato. Por eso "el total
 * que dijo el bot es el del core" NO es una regla del juez —es una aserción de
 * nivel 1 del escenario— y lo que sí es del juez es que el bot no **estime** un
 * precio, que es lo único que no se ve en la base.
 *
 * ── Qué rompe y qué no ───────────────────────────────────────────────────────
 * `dura: true` sólo para las **seis reglas innegociables del `SKILL.md`**, que
 * el propio documento declara sin excepción. Esas rompen la corrida (exit 1,
 * PRODUCTO). El resto reporta con su cita y no rompe.
 *
 * Nota sobre las de matiz M1/M2/M3: están **adentro** de la regla dura 4 del
 * `SKILL.md` ("decile hoy se nos terminó —no no lo tenemos—… nunca prometas que
 * se repone"). Van como blandas igual, siguiendo `tasks.md` 5.8, y no es una
 * contradicción: el escenario `se-termino` las asevera y las reporta con su
 * cita, sólo que una discrepancia de matiz no rotula la corrida como falla del
 * producto. Lo que rompe de la regla 4 es ofrecer o tomar lo que no está
 * vendible (R4); cómo se dice que se terminó se reporta.
 */

import r1 from './r1-precio-estimado.js';
import r2 from './r2-demora-prometida.js';
import r3 from './r3-confirmacion-propia.js';
import r4 from './r4-fuera-de-carta.js';
import r5 from './r5-item-inventado.js';
import r6 from './r6-dato-sin-verificar.js';
import m1 from './m1-agotado-mal-dicho.js';
import m2 from './m2-reposicion-prometida.js';
import m3 from './m3-aviso-cuando-haya.js';
import m4 from './m4-repregunta.js';

/**
 * @typedef {object} Regla
 * @property {string} id          `R2`, `M1`. Interno: NO cruza al juez
 * @property {string} titulo      la frase humana que va en la línea de falla
 * @property {string} origen      de dónde sale: `SKILL.md` regla N, o FLUJOS.md
 * @property {boolean} dura       si rompe la corrida
 * @property {string} enunciado   la prohibición, tal como la lee el juez
 * @property {string} ambito      sobre qué turnos aplica
 * @property {string[]} ejemplos       frases que sí serían violación
 * @property {string[]} contraejemplos frases que no
 * @property {string[]} [contexto]     hechos neutros que el juez necesita:
 *   `carta`, `confirmacion`, `agotados`, `datos`. El escenario los provee y
 *   `armarPedido` rompe si falta alguno — una regla juzgada sin su contexto
 *   absuelve siempre, que es la falla silenciosa
 * @property {{descripcion: string, hechos?: string[], transcripcion: import('../protocolo.js').Turno[]}} casoNegativo
 *   la transcripción de ejemplo que SÍ la viola. El juez tiene que condenarla:
 *   si la perdona, la regla se marca no confiable (spec "Cada regla del dicho
 *   tiene su caso negativo"). Es lo único que detecta a un juez indulgente
 * @property {{descripcion: string, hechos?: string[], transcripcion: import('../protocolo.js').Turno[]}} [casoLimpio]
 *   opcional y del otro lado: una conversación parecida donde la regla NO se
 *   viola. No lo pide el spec; sirve para ver de un vistazo si el juez condena
 *   de más. Reporta, nunca marca nada como no confiable
 */

/** Todas las reglas, en el orden en que se leen en la salida. */
export const REGLAS = [r1, r2, r3, r4, r5, r6, m1, m2, m3, m4];

/** Las seis innegociables del `SKILL.md`. Son las únicas que rompen. */
export const DURAS = REGLAS.filter((r) => r.dura);

/** @param {string} id */
export function regla(id) {
  const r = REGLAS.find((x) => x.id === id);
  if (!r) throw new Error(`no existe la regla «${id}». Hay: ${REGLAS.map((x) => x.id).join(', ')}`);
  return r;
}

/** @param {string[]} ids */
export function reglas(ids) {
  return ids.map(regla);
}

/**
 * Huella del contenido de una regla. La calibración (el caso negativo) se
 * guarda contra esta huella: **editar el enunciado invalida la calibración**,
 * que es exactamente lo que tiene que pasar — una regla reescrita es otra regla
 * y hay que volver a probar que el juez la condena.
 *
 * Es un hash barato (djb2) a propósito: no hace falta criptografía para
 * detectar que alguien tocó un texto, y no se le suma una dependencia al arnés
 * por esto.
 */
export function huella(r) {
  const materia = JSON.stringify([
    r.id, r.enunciado, r.ambito, r.ejemplos, r.contraejemplos, r.contexto || [],
    r.casoNegativo?.transcripcion, r.casoNegativo?.hechos || [],
  ]);
  let h = 5381;
  for (let i = 0; i < materia.length; i += 1) {
    h = ((h * 33) ^ materia.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Chequeo de forma de las reglas. Corre gratis y protege de la peor
 * distracción: escribir una regla de nivel 3 como obligación ("el bot debe…")
 * sin darse cuenta. Lo usan `calibrar.js` y `autoprueba.js`.
 *
 * @returns {string[]} los problemas encontrados, vacío si están todas bien
 */
export function revisarReglas(lista = REGLAS) {
  const problemas = [];
  const vistos = new Set();
  for (const r of lista) {
    const donde = `${r.id} «${r.titulo}»`;
    if (vistos.has(r.id)) problemas.push(`${donde}: el id está repetido`);
    vistos.add(r.id);
    if (!r.origen) problemas.push(`${donde}: no dice de dónde sale`);
    if (!r.casoNegativo?.transcripcion?.length) {
      problemas.push(`${donde}: no tiene caso negativo. Sin él no hay forma de saber si el juez la condena alguna vez`);
    }
    if (!/\bno\b|\bnunca\b|\bni\b/i.test(r.enunciado)) {
      problemas.push(`${donde}: el enunciado no parece una prohibición. El nivel 3 sólo asevera lo que el asistente NO puede decir`);
    }
    if (/\bdebe\b|\btiene que\b|\bsiempre\b/i.test(r.titulo)) {
      problemas.push(`${donde}: el título suena a obligación de estilo`);
    }
    const violador = (r.casoNegativo?.transcripcion || []).some((t) => t.quien === 'asistente');
    if (!violador) {
      problemas.push(`${donde}: el caso negativo no tiene ningún turno del asistente, así que no hay nada que citar`);
    }
  }
  return problemas;
}
