/**
 * LA ENTRADA del guión del dueño en Chrome. Es lo que corre `make arnes-dueno`.
 *
 *   make arnes-dueno
 *   ARNES_BOT=agente node arnes/guion-del-dueno.js
 *
 * Este archivo **no maneja el navegador y no lo va a manejar nunca** (design
 * §9: nada de Playwright, cero Chromium, cero dependencias de browser). Lo que
 * hace es lo único que un proceso puede hacer por el guión: **montar el
 * escenario y mantenerlo vivo** mientras un agente maneja Chrome de verdad
 * siguiendo `arnes/dueno/guion.md`.
 *
 * ── Por qué hace falta un proceso vivo, y no alcanza con "abrí el panel" ────
 * Los dos pasos que justifican el navegador dependen de que haya una corrida
 * andando del otro lado:
 *
 *  - **paso 5** — *el pedido aparece mientras el cliente todavía escribe*. Para
 *    eso alguien tiene que estar escribiendo **en ese momento**, con el dueño
 *    mirando el tablero. Un pedido sembrado antes de que el dueño entre prueba
 *    otra cosa: prueba que el tablero pinta lo que ya estaba.
 *  - **paso 12** — *el cliente recibe el aviso con la demora que puso el
 *    dueño*. Ese aviso sale por el Graph falso, que **vive dentro de este
 *    proceso**. Si la corrida terminó, no hay dónde leerlo, y leerlo de la
 *    tabla del core sería verificar que el core lo encoló — que no es lo mismo
 *    que el cliente lo recibió, y esa diferencia es la mitad del valor del
 *    producto (design §5).
 *
 * ── El apretón de manos, que son dos archivos ───────────────────────────────
 * Mismo idioma que el resto del arnés (el buzón de `actores/proveedor/`): el
 * proceso deja un `SIGUIENTE.md` y espera un archivo.
 *
 *   1. Arranca, monta todo, imprime los datos de la corrida y **espera**
 *      `<buzon>/ESTOY-EN-EL-TABLERO.txt`.
 *   2. El agente hace los pasos 1 a 4 del guión (entrar, cambiar contraseña,
 *      llegar al tablero, dejar la ventana adelante) y toca ese archivo.
 *   3. El proceso hace escribir al cliente. **Ahí** el agente hace el paso 5
 *      —ver el pedido aparecer solo— y sigue hasta el 11.
 *   4. El agente toca `<buzon>/TERMINE.txt` y el proceso imprime todo lo que
 *      recibió el teléfono del cliente, que es lo que el paso 12 necesita leer.
 *
 * ── Qué NO hace este archivo, y hay que decirlo ─────────────────────────────
 * **No emite veredicto sobre el panel.** El veredicto lo escribe el agente en
 * su reporte, con el formato de `arnes/actores/dueno/reporte.js`, porque el que
 * miró la pantalla es él. Este proceso monta, espera y muestra. Un exit 0 acá
 * quiere decir "la corrida se sostuvo entera", nunca "el panel está bien".
 *
 * Exit codes: 0 la corrida se sostuvo · 2 **ARNÉS ROTO**. No hay exit 1 y su
 * ausencia es la decisión: quien acusa al panel es el reporte del agente.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ErrorArnes, entorno, leerEnv } from './entorno.js';
import { preflight } from './preflight.js';
import { conGatewayDelComposeParado } from './compose.js';
import { crearGraphFalso } from './graph-falso.js';
import { crearCorrida } from './aislamiento.js';
import { cargarCarta } from './carta.js';
import { levantarGateway } from './gateway-en-proceso.js';
import { crearCliente } from './cliente.js';
import { crearTranscripcion } from './transcripcion.js';
import { crearPresupuesto } from './presupuesto.js';
import { crearBot } from './actores/bot.js';
import { crearProveedorGuion } from './actores/proveedor/guion.js';
import { crearProveedorAgente } from './actores/proveedor/agente.js';
import { datosParaElGuion } from './actores/dueno/api.js';
import { SOLO_NAVEGADOR } from './actores/dueno/cobertura.js';

/** La demora del paso 6. NO es ninguno de los presets, y ese es el punto. */
const DEMORA_LIBRE = 33;

/** Cuánto se espera a cada apretón de manos. Del otro lado hay una persona. */
const ESPERA_MS = Number(leerEnv('ARNES_ESPERA_DUENO_MS', '1800000')) || 1_800_000;

/** Cada cuánto se avisa que se sigue esperando. Un proceso mudo parece colgado. */
const LATIDO_MS = 30_000;

/**
 * Lo que escribe el cliente. Una sola línea, la del Flujo A con su tipeada.
 *
 * Es corta a propósito: el guión del dueño no viene a probar la conversación
 * —de eso están los escenarios— sino la pantalla. Lo único que este mensaje
 * tiene que lograr es que **haya un pedido pendiente entrando mientras el
 * dueño mira**, que es el paso 5.
 */
const MENSAJE_DEL_CLIENTE = 'te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar';

/**
 * El guion del bot para `ARNES_BOT=guion`. Las tools se ejecutan **de verdad**
 * contra el core: lo scripteado es la decisión del bot, jamás el sistema. Sin
 * eso no habría compromiso en la base y el tablero no tendría qué mostrar.
 */
const GUION_DEL_BOT = [
  { toolUse: [{ nombre: 'ver_catalogo', argumentos: {} }] },
  {
    toolUse: [{
      nombre: 'armar_compromiso',
      argumentos: {
        lineas: [{ servicio: 'doble cheddar' }, { servicio: 'papas' }],
        entrega: 'retira',
      },
    }],
  },
  {
    texto: '¡Listo! Te lo armo así:\n 1× Doble cheddar\n 1× Papas\n\n🏃 Retirás por el local\n\n' +
      'Ya le pasé el pedido al local. En un minuto te confirmo la demora.',
  },
];

// ── El buzón del apretón de manos ───────────────────────────────────────────

function crearBuzon(registrar) {
  const dir = leerEnv('ARNES_BUZON_DUENO')
    || fs.mkdtempSync(path.join(os.tmpdir(), 'arnes-dueno-'));
  fs.mkdirSync(dir, { recursive: true });

  return {
    dir,
    ruta: (nombre) => path.join(dir, nombre),

    async escribir(nombre, contenido) {
      const destino = path.join(dir, nombre);
      const tmp = `${destino}.tmp`;
      await fsp.writeFile(tmp, contenido, 'utf8');
      await fsp.rename(tmp, destino);
      return destino;
    },

    /**
     * Espera a que aparezca el archivo, avisando cada tanto que sigue vivo.
     *
     * Un timeout es **arnés roto** y no falla del panel: que nadie haya hecho
     * el guión no dice nada del producto. Esa distinción es todo el sentido de
     * separar exit 1 de exit 2 (design §15).
     */
    async esperar(nombre, queEsperaba) {
      const destino = path.join(dir, nombre);
      const hasta = Date.now() + ESPERA_MS;
      let ultimoLatido = Date.now();
      for (;;) {
        if (fs.existsSync(destino)) {
          registrar(`   ✓ llegó ${nombre}`);
          return destino;
        }
        if (Date.now() >= hasta) {
          throw new ErrorArnes(
            `nadie tocó ${nombre} en ${Math.round(ESPERA_MS / 60000)} minutos`,
            '',
            `  esperaba: ${destino}`,
            `  para: ${queEsperaba}`,
            '',
            'Esto es arnés roto, no una falla del panel: que el guión no se haya ejecutado',
            'no dice nada sobre el producto.',
            '',
            'Se puede estirar con ARNES_ESPERA_DUENO_MS.',
          );
        }
        if (Date.now() - ultimoLatido >= LATIDO_MS) {
          ultimoLatido = Date.now();
          registrar(`   ⏳ sigo esperando ${nombre} — la corrida está viva y el pedido no se pierde`);
        }
        await new Promise((listo) => setTimeout(listo, 500));
      }
    },
  };
}

// ── La corrida ──────────────────────────────────────────────────────────────

async function correr({ env, proveedorBot, transcripcion, presupuesto }) {
  const registrar = (m) => console.log(m);
  const buzon = crearBuzon(registrar);
  const graph = crearGraphFalso();
  await graph.escuchar();

  let gateway = null;
  let bot = null;
  try {
    console.log('\n⚙️  Aislamiento — el negocio de esta corrida');
    const corrida = await crearCorrida({ env });
    const carta = await cargarCarta(corrida.api, corrida.tokenDueno);
    console.log(`   negocio ${corrida.negocioId} · carta v${carta.version} · ${carta.platos.length} platos`);

    bot = crearBot({ proveedor: proveedorBot, transcripcion, presupuesto });
    gateway = await levantarGateway({
      tenant: corrida.tenant(),
      graphUrl: graph.url,
      queryFn: bot.queryFn,
      coreUrl: env.coreUrl,
      modelo: env.modelo || undefined,
    });
    const cliente = crearCliente({
      gateway,
      telefono: corrida.telefonoCliente,
      nombre: 'Cliente del arnés',
    });

    const datos = datosParaElGuion(corrida, { env, demoraLibre: DEMORA_LIBRE });
    await buzon.escribir('SIGUIENTE.md', siguienteEnProsa({ datos, buzon, env }));

    console.log('');
    console.log(datos);
    console.log('');
    console.log('── El guión ────────────────────────────────────────────────────────────');
    console.log(`  qué hacer:  ${path.join(env.raiz, 'arnes', 'dueno', 'guion.md')}`);
    console.log(`  el buzón:   ${buzon.dir}`);
    console.log(`  empezá por: ${buzon.ruta('SIGUIENTE.md')}`);
    console.log('');
    console.log('  Este proceso NO maneja el navegador. Lo maneja un agente con Chrome.');
    console.log('  Lo que hace acá es sostener la corrida viva para que el guión se pueda hacer.');
    console.log('');

    // ── Apretón 1: el dueño ya está mirando el tablero ────────────────────
    console.log('⏸  Pasos 1 a 4 del guión: entrar, cambiar la contraseña, llegar al tablero.');
    console.log(`   Cuando estés en el tablero y con la ventana ADELANTE, tocá:`);
    console.log(`   touch ${buzon.ruta('ESTOY-EN-EL-TABLERO.txt')}`);
    await buzon.esperar('ESTOY-EN-EL-TABLERO.txt', 'que el dueño esté mirando el tablero antes de que el cliente escriba');

    // ── El cliente escribe, con el dueño mirando ──────────────────────────
    console.log('\n👤 el cliente está escribiendo. **Mirá el tablero ahora**: eso es el paso 5.');
    const antes = graph.cantidad;
    await cliente.decir(MENSAJE_DEL_CLIENTE);
    console.log(`   👤 ${MENSAJE_DEL_CLIENTE}`);
    try {
      const respuesta = await graph.esperarMensaje({
        telefono: corrida.telefonoCliente, desde: antes, timeoutMs: 60_000,
      });
      console.log(`   🤖 ${(respuesta.texto || '(plantilla)').split('\n')[0]}`);
    } catch (err) {
      // El bot no contestó. No corta el guión: los pasos del panel se pueden
      // hacer igual y el paso 12 se va a marcar no evaluable solo. Cortar acá
      // tiraría a la basura el resto del guión por un problema de otro actor.
      console.log(`   ⚠ el bot no le contestó al cliente: ${err.message}`);
      console.log('     El pedido igual tiene que estar en el tablero. Seguí el guión y marcá');
      console.log('     el paso 12 como NO EVALUABLE.');
    }

    // ── Apretón 2: el guión terminó ───────────────────────────────────────
    console.log('\n⏸  Pasos 5 a 11 del guión: ver el pedido aparecer, confirmar con');
    console.log(`   ${DEMORA_LIBRE} minutos EN EL CAMPO LIBRE, mover a listo, responder la consulta.`);
    console.log(`   Cuando termines, tocá:`);
    console.log(`   touch ${buzon.ruta('TERMINE.txt')}`);
    await buzon.esperar('TERMINE.txt', 'que el agente termine los pasos del panel');

    // ── El paso 12: lo que el teléfono del cliente recibió de verdad ──────
    const recibidos = graph.recibidos({ telefono: corrida.telefonoCliente });
    console.log('\n── Paso 12 · lo que recibió el teléfono del cliente ─────────────────────');
    if (!recibidos.length) {
      console.log('  (nada)');
      console.log('  El cliente no recibió NINGÚN mensaje. Si confirmaste con demora, esto es un');
      console.log('  hallazgo del producto y va en el reporte del guión — el aviso de vuelta es');
      console.log('  la mitad del valor (docs/FLUJOS.md).');
    } else {
      for (const m of recibidos) {
        const texto = m.texto ?? `[${m.plantilla}] ${(m.variables ?? []).join(' · ')}`;
        console.log(`  ${m.indice + 1}. ${texto.split('\n').join('\n     ')}`);
      }
      const conDemora = recibidos.some((m) => JSON.stringify(m).includes(String(DEMORA_LIBRE)));
      console.log('');
      console.log(conDemora
        ? `  ✓ hay un mensaje con ${DEMORA_LIBRE} — la demora que escribiste en el campo libre viajó`
        : `  ⚠ ningún mensaje menciona ${DEMORA_LIBRE}. Si confirmaste con esa demora, anotalo`);
      console.log('    en el reporte: la aserción es sobre lo RECIBIDO, nunca sobre lo encolado.');
    }

    // Guardado crudo, porque de acá sale el reporte del agente.
    await buzon.escribir('recibido-por-el-cliente.json', `${JSON.stringify(recibidos, null, 2)}\n`);
    console.log(`\n  crudo: ${buzon.ruta('recibido-por-el-cliente.json')}`);
    return buzon;
  } finally {
    await bot?.cerrar?.();
    await gateway?.cerrar?.();
    await graph.cerrar();
  }
}

/** El archivo que el agente abre primero. */
function siguienteEnProsa({ datos, buzon, env }) {
  return [
    '# El guión del dueño en Chrome — te toca',
    '',
    `**El guión completo:** \`${path.join(env.raiz, 'arnes', 'dueno', 'guion.md')}\``,
    '',
    'Leelo entero antes de tocar nada: tiene cuatro gotchas y los cuatro se disfrazan',
    'de bug del panel.',
    '',
    '## Los datos de esta corrida',
    '',
    '```',
    datos,
    '```',
    '',
    '## El apretón de manos con la corrida',
    '',
    'La corrida está viva esperándote. Son dos archivos:',
    '',
    `1. Hacé los **pasos 1 a 4** (entrar, cambiar contraseña, llegar al tablero) y dejá`,
    '   la ventana de Chrome adelante y visible. Después:',
    '',
    `   \`\`\`sh`,
    `   touch ${buzon.ruta('ESTOY-EN-EL-TABLERO.txt')}`,
    `   \`\`\``,
    '',
    '   Recién ahí el cliente va a escribir. **Mirá el tablero mientras escribe**: que el',
    '   pedido aparezca solo, sin recargar, es el paso 5 y es una de las dos aserciones',
    '   que justifican que este guión exista.',
    '',
    `2. Hacé los **pasos 5 a 11** y después:`,
    '',
    `   \`\`\`sh`,
    `   touch ${buzon.ruta('TERMINE.txt')}`,
    `   \`\`\``,
    '',
    '   La corrida va a imprimir todo lo que recibió el teléfono del cliente, que es lo',
    `   que el paso 12 necesita leer, y lo va a dejar en`,
    `   \`${buzon.ruta('recibido-por-el-cliente.json')}\`.`,
    '',
    '## Qué tenés que entregar',
    '',
    'El reporte del guión, con el mismo formato que la corrida automática: actor, paso,',
    'qué se esperaba, qué pasó. Está definido en `arnes/actores/dueno/reporte.js`.',
    '',
    'Y la regla que no se negocia: **una captura es evidencia, nunca una aserción.**',
    'Capturá sólo el paso que falla.',
    '',
    '## Las que sólo vos podés afirmar',
    '',
    ...SOLO_NAVEGADOR.map((o) => `- ${o.cardinal ? '**(cardinal)** ' : ''}paso ${o.guion} — ${o.que}`),
    '',
    'Las dos cardinales son las que se caen en silencio con el panel funcionando "casi',
    'bien". El resto se cae solo si el panel se rompe entero.',
    '',
  ].join('\n');
}

// ── main ────────────────────────────────────────────────────────────────────

function elegirProveedorDelBot(env) {
  if (env.botProveedor === 'agente') {
    return crearProveedorAgente({
      buzon: env.buzon,
      corrida: 'guion-del-dueno',
      timeoutMs: env.buzonTimeoutMs,
    });
  }
  if (env.botProveedor !== 'guion') {
    throw new ErrorArnes(
      `ARNES_BOT=${env.botProveedor} no existe`,
      'Los que hay: `guion` y `agente`.',
    );
  }
  return crearProveedorGuion({ pasos: GUION_DEL_BOT, usaMcp: true });
}

async function main() {
  const env = entorno();

  console.log('Arnés · EL GUIÓN DEL DUEÑO EN CHROME');
  console.log('Lo maneja un agente, no este proceso. Acá no hay Playwright ni Chromium (design §9).');

  if (env.duenoModo !== 'navegador') {
    console.log(`\n⚠  ARNES_DUENO=${env.duenoModo}, pero este comando ES el modo navegador.`);
    console.log('   Se ignora: lo que sigue monta el escenario para el guión igual.');
  }
  // Que el bot sea de guion está bien acá y hay que decirlo igual: lo que se
  // viene a mirar es la PANTALLA, no lo que decidió el bot. Un verde de este
  // comando nunca dijo nada del bot, corra con el proveedor que corra.
  console.log(`   proveedor del bot: ${env.botProveedor} — acá se mira el panel, no el bot.`);

  await preflight();

  const proveedorBot = elegirProveedorDelBot(env);
  const transcripcion = crearTranscripcion({
    escenario: 'guion-del-dueno',
    proveedorBot: proveedorBot.nombre,
    modelo: env.modelo || '(el default de gateway/src/config.js)',
  });
  const presupuesto = crearPresupuesto({ topeUsd: env.topeUsd, proveedorBot: proveedorBot.nombre });

  const buzon = await conGatewayDelComposeParado(() => correr({
    env, proveedorBot, transcripcion, presupuesto,
  }));

  console.log('\n── La conversación');
  console.log(transcripcion.resumenLegible());

  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log('  La corrida se sostuvo entera. ESO es lo único que dice este exit 0.');
  console.log('  El veredicto sobre el panel lo escribe el agente que miró la pantalla,');
  console.log(`  en su reporte. El material quedó en ${buzon.dir}`);
  console.log('════════════════════════════════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((err) => {
  const tty = process.stdout.isTTY;
  const ROJO = tty ? '\x1b[31m' : '';
  const NEGRITA = tty ? '\x1b[1m' : '';
  const FIN = tty ? '\x1b[0m' : '';
  if (err instanceof ErrorArnes || err?.arnesRoto) {
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${err.message}`);
    for (const pista of err.pistas || []) console.error(`    ${pista}`);
  } else {
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — se cayó la corrida: ${err?.stack || err}`);
  }
  console.error('\n  exit 2 NO dice nada sobre el panel: el guión no llegó a hacerse.');
  process.exit(2);
});
