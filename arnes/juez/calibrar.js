/**
 * calibrar.js — probar que el juez **condena** lo que tiene que condenar.
 *
 * Es la tarea 9.4 y la mitigación del riesgo espejo del design:
 *
 *   > *"El juez perdona de más y un escenario queda verde con el bot diciendo
 *   > cualquier cosa → es el riesgo espejo y es peor, porque es silencioso."*
 *
 * Un juez que condena de más se nota: alguien mira la línea de falla, ve la
 * cita, dice "esto está bien" y la regla va a cuarentena. Un juez que perdona
 * todo **no se nota nunca**: da verde para siempre y nadie se entera. La única
 * forma de detectarlo es probarlo contra una violación conocida, y por eso cada
 * regla trae su caso negativo (`reglas/*.js`).
 *
 * Una regla cuyo caso negativo el juez perdona queda **no confiable**: no rompe
 * la corrida aunque condene, y un escenario que la tenía en verde no la cuenta
 * como verificada. Un verde que salió de un juez que nunca condena es peor que
 * no tener juez, porque además tranquiliza.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node arnes/juez/calibrar.js                 # con el juez por buzón
 *   ARNES_JUEZ=api node arnes/juez/calibrar.js  # el día que haya key
 *
 * Y opcional, para ver también el otro lado:
 *   node arnes/juez/calibrar.js --limpios       # corre también los casos limpios
 *
 * El caso limpio no lo pide el spec. Es el control de un juez que condena de
 * más: la misma conversación sin la violación adentro, que el juez tiene que
 * absolver. **No marca nada como no confiable** —una regla que condena de más
 * se maneja con cuarentena, a mano— pero verlo en la misma corrida ahorra la
 * discusión de si el problema es la regla o el bot.
 *
 * Exit codes, como el resto del arnés (design §15):
 *   0 — todas las reglas confiables
 *   2 — ARNÉS ROTO: alguna regla no confiable, o el juez no contestó. **No hay
 *       veredicto sobre el producto**: acá no se probó el producto, se probó el
 *       juez.
 */

import process from 'node:process';
import path from 'node:path';

import { ErrorArnes, RAIZ, leerEnv } from '../entorno.js';
import { crearJuez } from './juez.js';
import { REGLAS } from './reglas/index.js';
import { servidorPorBuzon } from './servidores/agente.js';

const color = process.stdout.isTTY;
const VERDE = color ? '\x1b[32m' : '';
const ROJO = color ? '\x1b[31m' : '';
const AMARILLO = color ? '\x1b[33m' : '';
const GRIS = color ? '\x1b[90m' : '';
const NEGRITA = color ? '\x1b[1m' : '';
const FIN = color ? '\x1b[0m' : '';

/**
 * Elige con qué se sirve el juez. Es el único lugar del arnés que decide esto,
 * para que un escenario nunca tenga que saberlo.
 *
 * @param {object} [opts]
 * @param {string} [opts.buzon]  dónde deja los pedidos el modo agente
 */
export async function servidorDelEntorno({ buzon } = {}) {
  const modo = (leerEnv('ARNES_JUEZ', 'agente')).toLowerCase();
  if (modo === 'api') {
    const { servidorApi } = await import('./servidores/api.js');
    return servidorApi();
  }
  if (modo === 'agente') {
    // En `arnes/buzon/` y no en un temp del sistema: el que atiende el buzón es
    // una persona (o un agente) que tiene el repo abierto, y hacerle buscar un
    // directorio en /tmp es la clase de fricción que hace que el modo no se use.
    // Está gitignoreado.
    const dir = buzon || path.join(RAIZ, 'arnes', 'buzon', `juez-${process.pid}`);
    return servidorPorBuzon({ dir });
  }
  if (modo === 'ninguno') {
    // Sin juez no hay nivel 3, y **eso hay que decirlo en la salida**, no
    // dejarlo implícito: una corrida sin juez que sale verde está afirmando
    // sobre el estado y las tools, no sobre lo que el bot dijo. Devolver `null`
    // en vez de un juez que absuelve todo es deliberado — un juez de mentira
    // que absuelve es exactamente el modo de falla silencioso que el caso
    // negativo existe para detectar, y no se va a construir uno a propósito.
    return null;
  }
  throw new ErrorArnes(
    `ARNES_JUEZ=${modo} no existe`,
    'Los modos son:',
    '  · `agente` (default) — lo sirve un agente Claude, por un buzón de archivos.',
    '  · `api`              — el día que haya ANTHROPIC_API_KEY y un modelo pinneado.',
    '  · `ninguno`          — sin nivel 3. La corrida lo anuncia como no cubierto.',
  );
}

/** El informe de calibración, listo para imprimir y para guardar. */
export function imprimirCalibracion(informe, { limpios = null } = {}) {
  console.log(`\n${NEGRITA}Calibración del juez${FIN} ${GRIS}· modo ${informe.modoJuez} · modelo ${informe.modeloJuez}${FIN}`);
  console.log(`${GRIS}Cada regla contra su caso negativo: la transcripción que SÍ la viola.${FIN}\n`);

  for (const e of informe.entradas) {
    const marca = e.confiable ? `${VERDE}✓${FIN}` : `${ROJO}✗${FIN}`;
    const reusada = e.reusada ? `${GRIS} (reusada de una corrida anterior)${FIN}` : '';
    console.log(`  ${marca} ${e.regla} «${e.titulo}» ${GRIS}${e.proporcion}${FIN}${reusada}`);
    if (!e.confiable) {
      console.log(`      ${ROJO}el juez NO condenó la violación de ejemplo${FIN}`);
      for (const v of e.veredictos || []) {
        const cual = v.valido ? v.veredicto : `descartado: ${v.motivoDescarte}`;
        console.log(`      ${GRIS}· veredicto ${v.n}: ${cual}${v.motivo ? ` — ${v.motivo}` : ''}${FIN}`);
      }
      console.log(`      ${GRIS}Mientras siga así, esta regla no rompe nada y un escenario en verde no la cuenta como verificada.${FIN}`);
    }
  }

  if (limpios) {
    console.log(`\n${NEGRITA}Control del otro lado${FIN} ${GRIS}· el caso limpio, que el juez tiene que absolver${FIN}`);
    console.log(`${GRIS}No marca nada como no confiable: una regla que condena de más se maneja con cuarentena, a mano.${FIN}\n`);
    for (const c of limpios) {
      if (c.absolvio) {
        console.log(`  ${VERDE}✓${FIN} ${c.regla} ${GRIS}absolvió la conversación limpia (${c.proporcion})${FIN}`);
      } else {
        console.log(`  ${AMARILLO}!${FIN} ${c.regla} ${AMARILLO}condenó una conversación donde la regla NO se viola${FIN} ${GRIS}(${c.proporcion})${FIN}`);
        if (c.cita) console.log(`      citó: "${c.cita.textual}"`);
        console.log(`      ${GRIS}Candidata a cuarentena: node arnes/juez/cuarentena.js poner ${c.regla} "condena de más" --quien=<vos>${FIN}`);
      }
    }
  }
}

/**
 * Corre los casos limpios de las reglas que los tienen. Devuelve el informe, no
 * toca la confiabilidad de nadie.
 */
export async function correrCasosLimpios(juez, reglas = REGLAS) {
  const salida = [];
  for (const r of reglas) {
    if (!r.casoLimpio) continue;
    const [res] = await juez.evaluar({
      reglas: [r],
      transcripcion: r.casoLimpio.transcripcion,
      hechos: r.casoLimpio.hechos || [],
    });
    salida.push({
      regla: r.id,
      descripcion: r.casoLimpio.descripcion,
      absolvio: res.resultado === 'no_viola',
      proporcion: res.proporcion,
      cita: res.cita,
    });
  }
  return salida;
}

// ── Entrada ──────────────────────────────────────────────────────────────────

async function main() {
  const conLimpios = process.argv.includes('--limpios');

  const servidor = await servidorDelEntorno();
  if (!servidor) {
    // Calibrar sin juez no es "calibrar rápido": es no calibrar. Se dice y se
    // sale con 2, porque el que corrió esto quería una respuesta sobre el juez
    // y no la tiene.
    throw new ErrorArnes(
      'ARNES_JUEZ=ninguno: no hay juez que calibrar',
      'La calibración existe para probar que el juez condena lo que tiene que condenar.',
      'Sin juez no hay nada que probar. Poné ARNES_JUEZ=agente (o api) y volvé a correr.',
    );
  }
  const juez = crearJuez({ servidor, exigirCalibracion: false });

  console.log(`${NEGRITA}Arnés · calibración del juez${FIN}`);
  console.log(`${GRIS}Un juez que perdona todo se ve verde y es peor que no tener juez.${FIN}`);
  if (!servidor.independenciaDeModelo.garantizada) {
    console.log(`\n${AMARILLO}⚠ independencia de modelo: SIN GARANTÍA${FIN}`);
    console.log(`  ${GRIS}${servidor.independenciaDeModelo.motivo}${FIN}`);
  }

  const informe = await juez.calibrar({ avisar: (l) => console.log(`  ${GRIS}· ${l}${FIN}`) });
  const limpios = conLimpios ? await correrCasosLimpios(juez) : null;
  imprimirCalibracion(informe, { limpios });

  const noConfiables = informe.entradas.filter((e) => !e.confiable);
  if (noConfiables.length) {
    console.log(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${noConfiables.length} de ${informe.entradas.length} reglas no son confiables`);
    console.log(`    ${noConfiables.map((e) => e.regla).join(', ')}`);
    console.log('\n  No hay veredicto sobre el producto: acá no se probó el producto, se probó el juez.');
    console.log('  O el enunciado de la regla está mal escrito, o el juez es un colador. Las dos se arreglan.');
    process.exit(2);
  }

  console.log(`\n${VERDE}${NEGRITA}✓ EL JUEZ CONDENA${FIN} — las ${informe.entradas.length} reglas condenan su caso negativo`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('calibrar.js')) {
  main().catch((err) => {
    if (err instanceof ErrorArnes || err?.arnesRoto) {
      console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${err.message}`);
      for (const p of err.pistas || []) console.error(`    ${p}`);
      process.exit(2);
    }
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — se cayó la calibración: ${err?.stack || err}`);
    process.exit(2);
  });
}
