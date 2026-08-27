/**
 * cuarentena.js — una regla ruidosa se **aísla**, no se borra.
 *
 * La muerte típica de un arnés conversacional: una regla grita en falso un
 * viernes a las siete, alguien la borra para poder mergear, y con ella se va la
 * única protección de una regla real del producto. Nadie la extraña porque no
 * queda rastro de que existió (design §8).
 *
 * Una regla en cuarentena:
 *   · **se sigue evaluando** — los tres veredictos se piden igual;
 *   · **se sigue reportando** — con su cita y con la nota de cuarentena;
 *   · **no rompe la corrida**, aunque sea de las duras.
 *
 * Entrar y salir es **una acción explícita de una persona**, con su motivo, su
 * fecha y su nombre. NADA se auto-silencia: que una regla se apague sola porque
 * falló dos veces es exactamente cómo se apagan las que sí encontraban algo
 * (spec "Nada se auto-silencia").
 *
 * Salir de cuarentena **también deja rastro**: el motivo por el que se la
 * considera arreglada queda escrito al lado del motivo por el que entró. Sin
 * eso, dentro de tres meses nadie sabe si se arregló el bot o si alguien se
 * cansó.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node arnes/juez/cuarentena.js
 *   node arnes/juez/cuarentena.js poner M4 "condena confirmaciones legítimas" --quien=juani
 *   node arnes/juez/cuarentena.js sacar M4 "se angostó el enunciado" --quien=juani
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** El registro de verdad, versionado en el repo. */
export const RUTA = path.join(AQUI, 'cuarentena.json');

/**
 * Dónde se lee y se escribe.
 *
 * `ARNES_CUARENTENA` la pisa, y existe por una sola razón: la autoprueba del
 * arnés necesita meter y sacar reglas de cuarentena para verificar que una
 * regla aislada no rompe, y **un chequeo que ensucia un archivo versionado no
 * es un chequeo, es un efecto secundario**. Con la variable apuntando a un
 * temp, la autoprueba corre sin tocar el registro real.
 *
 * No la uses para nada más: una cuarentena que vive en otro lado es una
 * cuarentena que nadie va a revisar.
 */
function rutaActual() {
  return process.env.ARNES_CUARENTENA || RUTA;
}

/**
 * @typedef {object} Entrada
 * @property {string} regla
 * @property {string} motivo   por qué se la aisló. Obligatorio
 * @property {string} desde    fecha ISO corta
 * @property {string} quien    quién la aisló. Obligatorio: una cuarentena sin
 *                             dueño es una regla huérfana que no sale nunca
 * @property {{hasta: string, motivo: string, quien: string}} [salida]
 *                             si volvió a estar activa, por qué
 */

/** @returns {{version: number, entradas: Entrada[]}} */
export function leer() {
  try {
    const crudo = fs.readFileSync(rutaActual(), 'utf8');
    const j = JSON.parse(crudo);
    return {
      version: j.version ?? 1,
      // Se conserva la nota del archivo: es lo que explica, al que lo abre por
      // primera vez, que acá adentro nada se auto-silencia.
      _lea_esto: j._lea_esto,
      entradas: Array.isArray(j.entradas) ? j.entradas : [],
    };
  } catch {
    // Sin archivo no hay nada en cuarentena. Es el estado inicial y el sano.
    return { version: 1, entradas: [] };
  }
}

function escribir(registro) {
  fs.writeFileSync(rutaActual(), `${JSON.stringify(registro, null, 2)}\n`, 'utf8');
}

/**
 * La entrada VIGENTE de una regla, si la hay. Una entrada con `salida` ya no
 * está en cuarentena: queda en el archivo como historia, que es el punto.
 *
 * @param {string} reglaId
 * @returns {Entrada|null}
 */
export function enCuarentena(reglaId) {
  const { entradas } = leer();
  // La última gana: una regla puede haber entrado y salido varias veces.
  for (let i = entradas.length - 1; i >= 0; i -= 1) {
    if (entradas[i].regla === reglaId) {
      return entradas[i].salida ? null : entradas[i];
    }
  }
  return null;
}

/** Todas las que están aisladas ahora mismo. Lo imprime el resumen de la corrida. */
export function vigentes() {
  const { entradas } = leer();
  const ultima = new Map();
  for (const e of entradas) ultima.set(e.regla, e);
  return [...ultima.values()].filter((e) => !e.salida);
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Aísla una regla. Falla si falta el motivo o el nombre: son lo único que hace
 * que una cuarentena se pueda revisar dentro de tres meses.
 */
export function poner({ regla, motivo, quien }) {
  if (!regla) throw new Error('poner en cuarentena: falta la regla');
  if (!motivo) throw new Error('poner en cuarentena: falta el motivo. Una cuarentena sin motivo no se revisa nunca');
  if (!quien) throw new Error('poner en cuarentena: falta quién. Una cuarentena sin dueño no sale nunca');
  if (enCuarentena(regla)) throw new Error(`la regla ${regla} ya está en cuarentena`);

  const registro = leer();
  registro.entradas.push({ regla, motivo, desde: hoy(), quien });
  escribir(registro);
  return registro;
}

/** Devuelve una regla a la actividad, dejando escrito por qué se la considera arreglada. */
export function sacar({ regla, motivo, quien }) {
  if (!motivo) throw new Error('sacar de cuarentena: falta el motivo por el que se la considera arreglada');
  if (!quien) throw new Error('sacar de cuarentena: falta quién');

  const registro = leer();
  for (let i = registro.entradas.length - 1; i >= 0; i -= 1) {
    const e = registro.entradas[i];
    if (e.regla === regla && !e.salida) {
      e.salida = { hasta: hoy(), motivo, quien };
      escribir(registro);
      return registro;
    }
  }
  throw new Error(`la regla ${regla} no está en cuarentena`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function esteArchivoSeEjecuto() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (esteArchivoSeEjecuto()) {
  const [accion, regla, motivo] = process.argv.slice(2);
  const quien = (process.argv.find((a) => a.startsWith('--quien=')) || '').slice('--quien='.length);

  try {
    if (!accion || accion === 'ver') {
      const activas = vigentes();
      if (!activas.length) {
        console.log('No hay ninguna regla en cuarentena. Todas rompen o reportan según su tipo.');
      } else {
        console.log('Reglas en cuarentena — se evalúan y se reportan, pero no rompen:\n');
        for (const e of activas) {
          console.log(`  ${e.regla}  desde ${e.desde} · ${e.quien}`);
          console.log(`      ${e.motivo}\n`);
        }
      }
    } else if (accion === 'poner') {
      poner({ regla, motivo, quien });
      console.log(`${regla} queda en cuarentena. Se sigue evaluando y reportando; no rompe.`);
    } else if (accion === 'sacar') {
      sacar({ regla, motivo, quien });
      console.log(`${regla} vuelve a estar activa. Queda escrito por qué.`);
    } else {
      console.error('acciones: ver | poner <regla> "<motivo>" --quien=<nombre> | sacar <regla> "<motivo>" --quien=<nombre>');
      process.exit(2);
    }
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
}
