/**
 * autoprueba.js — **probar el juez sin juez**, gratis y offline.
 *
 *   node arnes/juez/autoprueba.js
 *
 * Mismo espíritu que `puerta-andamio.js` con el grupo 1: antes de gastar un
 * veredicto real hay que saber que la maquinaria hace lo que dice que hace. Acá
 * el juez es de mentira (`servidores/de-prueba.js`) y devuelve veredictos de
 * guion, así que se puede comprobar sin gastar un centavo que:
 *
 *   · una condena SIN cita se descarta;
 *   · una condena con una cita INVENTADA se descarta;
 *   · una condena que cita al CLIENTE se descarta (el modo de falla más
 *     convincente: la cita existe y el veredicto igual es basura);
 *   · las tres descartadas dejan la regla `no_evaluable` → **arnés roto**, no
 *     falla del producto;
 *   · 2 de 3 condena, 1 de 3 no, y la disidencia queda registrada;
 *   · una regla dura en cuarentena condena, se reporta y NO rompe;
 *   · una regla cuyo caso negativo el juez perdona queda no confiable, no rompe
 *     y no se cuenta como verificada aunque el escenario esté en verde;
 *   · sin calibrar, `evaluar` se niega a emitir veredicto.
 *
 * Cada una de estas es un bug del arnés que se disfrazaría de bug del producto,
 * y ninguna se puede comprobar con un juez real sin correr una conversación
 * entera y pagarla.
 *
 * Exit: 0 si la maquinaria está bien, 2 si no (es arnés, no producto).
 */

import process from 'node:process';
import os from 'node:os';
import path from 'node:path';

// La autoprueba mete y saca reglas de cuarentena para verificar que una regla
// aislada no rompe, y no puede hacer eso sobre el registro versionado del repo:
// un chequeo que ensucia un archivo del repo no es un chequeo, es un efecto
// secundario. `cuarentena.js` resuelve la ruta en cada lectura —no al
// importarse— así que alcanza con dejarla puesta antes de la primera llamada.
process.env.ARNES_CUARENTENA = path.join(os.tmpdir(), `arnes-cuarentena-autoprueba-${process.pid}.json`);

import { crearJuez } from './juez.js';
import { servidorDePrueba, CONDENA, ABSUELVE, CONDENA_SIN_CITA } from './servidores/de-prueba.js';
import { regla, revisarReglas, REGLAS } from './reglas/index.js';
import { poner, sacar, enCuarentena } from './cuarentena.js';

const color = process.stdout.isTTY;
const VERDE = color ? '\x1b[32m' : '';
const ROJO = color ? '\x1b[31m' : '';
const GRIS = color ? '\x1b[90m' : '';
const NEGRITA = color ? '\x1b[1m' : '';
const FIN = color ? '\x1b[0m' : '';

const fallas = [];
let ok = 0;

function exigir(condicion, que, esperado, llego) {
  if (condicion) { ok += 1; console.log(`  ${VERDE}✓${FIN} ${que}`); return; }
  fallas.push(que);
  console.log(`  ${ROJO}✗${FIN} ${que}`);
  if (esperado !== undefined) console.log(`      esperaba: ${esperado}`);
  if (llego !== undefined) console.log(`      llegó:    ${llego}`);
}

function titulo(t) { console.log(`\n${NEGRITA}── ${t}${FIN}`); }

// Una transcripción cualquiera con una violación adentro, para no depender de
// ninguna regla en particular en las pruebas de la maquinaria.
const R2 = regla('R2');
const TRANSCRIPCION = R2.casoNegativo.transcripcion;
const HECHOS = R2.casoNegativo.hechos;
const LO_QUE_DIJO = 'Sale en unos 20 minutos';

/** Un juez de guion que devuelve, en orden, los veredictos de la lista. */
function juezConGuion(guion, { calibrado = true } = {}) {
  let i = 0;
  const servidor = servidorDePrueba({
    responder: () => {
      // La calibración se come los primeros tres veredictos: se contesta
      // condenando para que la regla quede confiable, salvo que se pida lo
      // contrario.
      if (i < 3 && calibrado !== 'saltear') {
        i += 1;
        return calibrado ? CONDENA(LO_QUE_DIJO, 4) : ABSUELVE();
      }
      const v = guion[i - 3];
      i += 1;
      return v ?? ABSUELVE();
    },
  });
  return crearJuez({ servidor });
}

async function correr() {
  titulo('📐 Las reglas están bien escritas');
  const problemas = revisarReglas();
  exigir(
    problemas.length === 0,
    `las ${REGLAS.length} reglas son prohibiciones, tienen origen y tienen caso negativo`,
    'ningún problema',
    problemas.join(' · '),
  );

  titulo('🧾 Una condena sin cita no es una falla del producto');
  {
    const juez = juezConGuion([CONDENA_SIN_CITA(), CONDENA_SIN_CITA(), CONDENA_SIN_CITA()]);
    await juez.calibrar({ reglas: [R2] });
    const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    exigir(r.resultado === 'no_evaluable', 'tres condenas sin cita dejan la regla no evaluable', 'no_evaluable', r.resultado);
    exigir(r.arnesRoto === true, 'y eso se rotula ARNÉS ROTO, no falla del producto', 'arnesRoto: true', String(r.arnesRoto));
    exigir(r.rompe === false, 'una condena sin prueba NO rompe la corrida', 'rompe: false', String(r.rompe));
  }

  titulo('👻 Una cita que el bot nunca dijo se descarta');
  {
    const inventada = 'te lo dejo listo para las nueve en punto';
    const juez = juezConGuion([CONDENA(inventada, 4), CONDENA(inventada, 4), CONDENA(inventada, 4)]);
    await juez.calibrar({ reglas: [R2] });
    const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    exigir(r.resultado === 'no_evaluable', 'una cita inventada no prueba nada', 'no_evaluable', r.resultado);
    exigir(
      r.veredictos.every((v) => !v.valido && /no aparece/.test(v.motivoDescarte || '')),
      'y el motivo del descarte dice que la frase no aparece en la transcripción',
    );
  }

  titulo('🪞 Una cita del CLIENTE no prueba lo que dijo el bot');
  {
    // El modo de falla más convincente que hay: la frase existe textual en la
    // transcripción, la cita "cierra", y el veredicto es basura igual.
    const delCliente = 'cuánto tarda';
    const juez = juezConGuion([CONDENA(delCliente, 3), CONDENA(delCliente, 3), CONDENA(delCliente, 3)]);
    await juez.calibrar({ reglas: [R2] });
    const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    exigir(r.resultado === 'no_evaluable', 'citar al cliente no condena al bot', 'no_evaluable', r.resultado);
    exigir(
      r.veredictos.every((v) => /la dijo el cliente/.test(v.motivoDescarte || '')),
      'y el descarte nombra a quién pertenece la frase, que es el arreglo',
    );
  }

  titulo('🗳️  Mayoría de 2 sobre 3');
  {
    const juez = juezConGuion([CONDENA(LO_QUE_DIJO, 4), ABSUELVE(), CONDENA(LO_QUE_DIJO, 4)]);
    await juez.calibrar({ reglas: [R2] });
    const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    exigir(r.resultado === 'viola', 'dos condenas con cita alcanzan', 'viola', r.resultado);
    exigir(r.proporcion === '2/3', 'y la salida muestra la proporción', '2/3', r.proporcion);
    exigir(r.rompe === true, 'una regla dura, confiable y fuera de cuarentena rompe la corrida', 'rompe: true', String(r.rompe));
    exigir(r.veredictos.length === 3, 'los tres veredictos quedan guardados, no sólo el resultado', '3', String(r.veredictos.length));
  }
  {
    const juez = juezConGuion([CONDENA(LO_QUE_DIJO, 4), ABSUELVE(), ABSUELVE()]);
    await juez.calibrar({ reglas: [R2] });
    const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    exigir(r.resultado === 'no_viola', 'una sola condena no alcanza', 'no_viola', r.resultado);
    exigir(r.disidencia === 1, 'y la disidencia queda registrada: una regla que discrepa seguido está mal escrita', '1', String(r.disidencia));
  }

  titulo('🤫 Una regla que el juez perdona en su caso negativo no vale');
  {
    const juez = juezConGuion([CONDENA(LO_QUE_DIJO, 4), CONDENA(LO_QUE_DIJO, 4), CONDENA(LO_QUE_DIJO, 4)], { calibrado: false });
    const informe = await juez.calibrar({ reglas: [R2] });
    exigir(informe.entradas[0].confiable === false, 'el juez que perdona el caso negativo deja la regla no confiable', 'false', String(informe.entradas[0].confiable));
    const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    exigir(r.resultado === 'viola', 'la regla se sigue evaluando y se sigue reportando', 'viola', r.resultado);
    exigir(r.rompe === false, 'pero una regla no confiable NO rompe la corrida', 'rompe: false', String(r.rompe));
    exigir(r.verificada === false, 'y un escenario en verde no la puede contar como verificada', 'verificada: false', String(r.verificada));
  }

  titulo('🚦 Sin calibrar, el juez se niega a emitir veredicto');
  {
    const juez = juezConGuion([ABSUELVE()], { calibrado: 'saltear' });
    let explotó = false;
    try {
      await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    } catch (err) {
      explotó = err?.arnesRoto === true;
    }
    exigir(explotó, 'evaluar sin calibrar es arnés roto: sin caso negativo probado no hay verde que valga');
  }

  titulo('🧊 Cuarentena: se evalúa, se reporta, no rompe');
  {
    const yaEstaba = enCuarentena('R2');
    if (!yaEstaba) poner({ regla: 'R2', motivo: 'autoprueba del arnés', quien: 'autoprueba' });
    try {
      const juez = juezConGuion([CONDENA(LO_QUE_DIJO, 4), CONDENA(LO_QUE_DIJO, 4), ABSUELVE()]);
      await juez.calibrar({ reglas: [R2] });
      const [r] = await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
      exigir(r.resultado === 'viola', 'una regla en cuarentena se sigue evaluando', 'viola', r.resultado);
      exigir(Boolean(r.cuarentena), 'y se reporta con su nota de cuarentena', 'con nota', String(Boolean(r.cuarentena)));
      exigir(r.rompe === false, 'pero no rompe la corrida, aunque sea de las duras', 'rompe: false', String(r.rompe));
    } finally {
      if (!yaEstaba) sacar({ regla: 'R2', motivo: 'la autoprueba terminó', quien: 'autoprueba' });
    }
    exigir(Boolean(enCuarentena('R2')) === Boolean(yaEstaba), 'la autoprueba deja la cuarentena como la encontró');
  }

  titulo('🕵️ El juez no ve lo que se espera');
  {
    let visto = null;
    const juez = crearJuez({
      servidor: servidorDePrueba({ responder: (pedido) => { visto = pedido; return ABSUELVE(); } }),
      exigirCalibracion: false,
    });
    await juez.evaluar({ reglas: [R2], transcripcion: TRANSCRIPCION, hechos: HECHOS });
    const claves = Object.keys(visto).sort().join(',');
    exigir(
      claves === 'ambito,ejemplos_de_violacion,enunciado,hechos,id,no_cuenta_como_violacion,rubrica,transcripcion',
      'el pedido lleva la regla, los hechos y el texto — y nada más',
      'sin escenario, sin id de regla, sin dureza, sin resultado esperado',
      claves,
    );
    exigir(!/pedido-feliz|se-termino|R2|dura|espera/i.test(JSON.stringify(visto)),
      'y no se filtra el nombre del escenario, el id de la regla ni si es de las duras');
  }
}

console.log(`${NEGRITA}Arnés · autoprueba del juez — sin juez, sin red y sin gastar${FIN}`);
console.log(`${GRIS}Prueba la maquinaria del nivel 3, no el producto. Un bug de acá se disfraza de bug del bot.${FIN}`);

correr()
  .then(() => {
    if (fallas.length) {
      console.log(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — la maquinaria del juez falló ${fallas.length} de ${ok + fallas.length} aserciones`);
      for (const f of fallas) console.log(`    · ${f}`);
      console.log('\n  No hay veredicto sobre el producto: acá no se probó el producto.');
      process.exit(2);
    }
    console.log(`\n${VERDE}${NEGRITA}✓ LA MAQUINARIA DEL JUEZ CIERRA${FIN} — ${ok} aserciones, sin juez y sin gastar`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — se cayó la autoprueba: ${err?.stack || err}`);
    process.exit(2);
  });
