/**
 * Cómo se ve el arnés en una terminal, a las once de la noche, antes de un
 * release.
 *
 * Dos reglas que no se negocian y que están acá arriba para que no se pierdan:
 *
 * 1. **Sin TTY no hay colores ni barras de progreso**, y todo sale por stdout.
 *    Es lo único que hace falta para que el día que exista un CI esto se
 *    enchufe sin tocar una línea (tarea 4.5). Los emojis dependen de otra cosa
 *    —del charset— y por eso se detectan aparte: una terminal sin color puede
 *    dibujar 🤖 perfecto, y un `LANG=C` con color pinta 🤖 como basura.
 *
 * 2. **PRODUCTO y ARNÉS ROTO se distinguen de un vistazo, no por el exit code.**
 *    Nadie mira `$?`. Se distinguen por un cartel de ancho completo, con
 *    palabras distintas, color distinto y una frase que dice qué significa. Un
 *    arnés que dice rojo cuando en realidad se quedó sin una dependencia
 *    entrena a desconfiar del rojo, y el día que alguien aprende a ignorar el
 *    rojo el arnés murió y nadie se enteró.
 */

import process from 'node:process';

import { ACTORES, NIVELES } from './bitacora.js';

// ── De qué es capaz esta terminal ────────────────────────────────────────────

const salida = process.stdout;

/** Color: sólo con TTY, y respetando `NO_COLOR` (que es un estándar de hecho). */
export const HAY_COLOR = Boolean(
  salida.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb',
);

/**
 * Emoji: depende del charset, NO del TTY. Un `docker compose logs` redirigido a
 * un archivo UTF-8 muestra los emojis bien; una terminal con `LC_ALL=C` los
 * escupe rotos aunque sea interactiva. `ARNES_SIN_EMOJI=1` lo apaga a mano.
 */
export const HAY_EMOJI = (() => {
  if (process.env.ARNES_SIN_EMOJI) return false;
  if (process.env.TERM === 'dumb') return false;
  const local = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '';
  return /utf-?8/i.test(local);
})();

const c = (codigo) => (HAY_COLOR ? `\x1b[${codigo}m` : '');
export const ROJO = c(31);
export const VERDE = c(32);
export const AMARILLO = c(33);
export const GRIS = c(90);
export const NEGRITA = c(1);
export const FIN = c(0);

/** 👤 cliente · 🤖 bot · 🧑‍🍳 dueño · ⚙️ sistema — o su versión en ASCII. */
export function etiquetaActor(clave) {
  const a = ACTORES[clave] || ACTORES.sistema;
  return HAY_EMOJI ? `${a.emoji} ${a.nombre}` : a.plano;
}

/**
 * Los signos de la salida, con respaldo en ASCII para la terminal que no los
 * dibuja. Un `🔧` roto en la línea de la tool es ruido justo donde hay que
 * leer rápido.
 */
export const TILDE = HAY_EMOJI ? '✓' : 'OK';
export const CRUZ = HAY_EMOJI ? '✗' : 'X';
export const PAUSA = HAY_EMOJI ? '⏸' : '[..]';
export const FLECHA = HAY_EMOJI ? '▸' : '>';
export const TOOL = HAY_EMOJI ? '🔧' : 'tool';
export const MANO = HAY_EMOJI ? '🖐' : 'gesto';
export const AVISO = HAY_EMOJI ? '⚠' : '!!';

// ── Piezas ───────────────────────────────────────────────────────────────────

export function titulo(texto) {
  console.log(`\n${NEGRITA}── ${texto} ${FIN}`);
}

export function nota(texto) {
  console.log(`  ${GRIS}· ${texto}${FIN}`);
}

/**
 * Un valor de aserción, listo para leer. Los strings van entre comillas para
 * que se vea el espacio de más que rompió la comparación; el resto va en JSON
 * compacto y recortado, porque un `resultado` de tool de 4 KB adentro de una
 * línea de falla tapa la falla.
 */
export function formatearValor(valor, tope = 240) {
  if (valor === undefined) return undefined;
  if (valor === null) return 'null';
  let texto;
  if (typeof valor === 'string') texto = JSON.stringify(valor);
  else if (typeof valor === 'object') {
    try { texto = JSON.stringify(valor); } catch { texto = String(valor); }
  } else texto = String(valor);
  if (texto.length > tope) texto = `${texto.slice(0, tope)}… (completo en crudo.json)`;
  return texto;
}

/**
 * **La línea de falla. Es el entregable de verdad del grupo 4.**
 *
 *   ✗ pedido-feliz · turno 4 · 🤖 bot · R2 «nunca prometas una demora»
 *       dijo: "sale en unos 20 minutos, tipo 21:15"
 *       juez: 3/3 · transcripcion.md:41 · SKILL.md regla 2
 *
 * Nombra los tres datos sin los que la falla es inservible —**qué escenario,
 * qué turno, cuál de los tres actores**— y la regla en la frase humana que la
 * origina, no en un nombre de variable. La tercera línea dice dónde mirar. Si
 * alguien tiene que abrir un JSON o cruzar dos archivos para saber quién rompió
 * qué, esta función está mal escrita.
 *
 * @param {object} f
 * @param {string} f.escenario
 * @param {number|null} f.turno
 * @param {string} f.actor        clave de ACTORES
 * @param {string} f.codigo       `N1`, `N2`, `R2`…
 * @param {string} f.frase        la frase humana de lo que protege
 * @param {string} [f.cita]       lo que el bot dijo, textual (nivel 3)
 * @param {*} [f.esperado]
 * @param {*} [f.llego]
 * @param {string} [f.pie]        la tercera línea: proporción del juez o nivel
 * @param {string} [f.ubicacion]  `transcripcion.md:41`
 * @param {string} [f.origen]     `SKILL.md regla 2`
 * @param {string} [f.extra]      la última pista: un endpoint, un archivo, un comando
 * @returns {string[]} las líneas, sin colores
 */
export function lineasDeFalla(f) {
  const turno = f.turno ? `turno ${f.turno}` : 'sin turno';
  const lineas = [
    `${CRUZ} ${f.escenario} · ${turno} · ${etiquetaActor(f.actor)} · ${f.codigo} «${f.frase}»`,
  ];
  if (f.cita) lineas.push(`    dijo: ${JSON.stringify(f.cita)}`);
  const esperado = formatearValor(f.esperado);
  const llego = formatearValor(f.llego);
  if (esperado !== undefined) lineas.push(`    esperaba: ${esperado}`);
  if (llego !== undefined) lineas.push(`    llegó:    ${llego}`);
  const pie = [f.pie, f.ubicacion, f.origen, f.extra].filter(Boolean).join(' · ');
  if (pie) lineas.push(`    ${pie}`);
  return lineas;
}

/** La misma falla, pintada. La primera línea en rojo; el detalle en gris. */
export function imprimirFalla(f) {
  const [primera, ...resto] = lineasDeFalla(f);
  console.log(`  ${ROJO}${primera}${FIN}`);
  for (const linea of resto) console.log(`  ${GRIS}${linea}${FIN}`);
}

/** El pie de una aserción determinista: `nivel 1 (estado)`. */
export function pieDeNivel(nivel) {
  const n = NIVELES[nivel];
  return n ? `nivel ${nivel} (${n.nombre})` : `nivel ${nivel}`;
}

// ── El cartel del final ──────────────────────────────────────────────────────

const ANCHO = 76;
const REGLA = (HAY_EMOJI ? '═' : '=').repeat(ANCHO);

/**
 * El cartel que separa los tres desenlaces posibles **a simple vista**.
 *
 *   ✓ VERDE · exit 0
 *   ✗ PRODUCTO ROTO · exit 1     ← hay algo que arreglar en el sistema
 *   ✗ ARNÉS ROTO · exit 2        ← no hay veredicto sobre el producto
 *
 * Colores distintos (verde / rojo / amarillo), palabras distintas y una frase
 * que dice qué significa cada uno. Sin color, la palabra y la frase alcanzan:
 * ninguno de los tres se puede confundir leyendo en blanco y negro.
 */
export function cartel({ rotulo, exitCode, explicacion, color }) {
  console.log(`\n${color}${REGLA}${FIN}`);
  console.log(`${color}${NEGRITA}  ${rotulo} · exit ${exitCode}${FIN}`);
  console.log(`${color}  ${explicacion}${FIN}`);
  console.log(`${color}${REGLA}${FIN}`);
}

export const CARTELES = {
  verde: (extra) => cartel({
    rotulo: `${TILDE} VERDE`,
    exitCode: 0,
    explicacion: extra || 'todo lo que esta corrida pudo aseverar, pasó.',
    color: VERDE,
  }),
  producto: (extra) => cartel({
    rotulo: `${CRUZ} PRODUCTO ROTO`,
    exitCode: 1,
    explicacion: extra || 'hay algo que arreglar en el sistema.',
    color: ROJO,
  }),
  arnes: (extra) => cartel({
    rotulo: `${CRUZ} ARNÉS ROTO`,
    exitCode: 2,
    // La frase importa tanto como el código: es la que evita que alguien salga
    // a buscar un bug que no existe.
    explicacion: extra || 'el arnés no pudo emitir veredicto. NO dice nada sobre el producto.',
    color: AMARILLO,
  }),
};
