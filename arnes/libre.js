/**
 * Modo `libre` — la sesión de prototipado del 18/08, automatizada.
 *
 *   make arnes-libre
 *   ARNES_CLIENTE=de-prueba ARNES_BOT=guion node arnes/libre.js   ← ejercita la costura, gratis
 *
 * Un cliente que improvisa le escribe al bot por el webhook real, con la
 * persona y el objetivo que le tocaron, y se conversa hasta que alguno cierra o
 * hasta el techo de 15 turnos. No hay aserciones, no hay juez, no hay guion.
 *
 * ── Qué produce, que no es un veredicto ─────────────────────────────────────
 * **Candidatos a escenario del modo `guion`** (design §2). Nada más y nada
 * menos. El guion sólo encuentra lo que alguien ya imaginó; esto encuentra la
 * frase que a nadie se le ocurrió escribir. Cuando acá aparece algo, el trabajo
 * que sigue **no es arreglar el modo libre**: es escribir el escenario
 * scripteado que lo captura para siempre, en `arnes/escenarios/`, con sus
 * aserciones de nivel 1 y 2. Ese escenario es el que después defiende contra la
 * regresión; este archivo no defiende nada y no tiene que hacerlo.
 *
 * ── Por qué NUNCA rompe el build ────────────────────────────────────────────
 * Dos modelos improvisando no repiten una corrida. Un chequeo que no repite y
 * rompe el build se apaga en una semana, y con él se apaga el modo `guion`, que
 * sí sirve. Entonces:
 *
 *   exit 0 — SIEMPRE que la corrida haya terminado, encuentre o no encuentre.
 *            Un hallazgo del modo libre es una tarea, no un rojo.
 *   exit 2 — ARNÉS ROTO: el compose caído, el buzón mal contestado, el corte
 *            por presupuesto. No dice nada sobre el producto, como siempre.
 *
 * No hay exit 1 en este archivo, y su ausencia es la decisión.
 *
 * ── Con quién corrió, que hay que leerlo antes que el resultado ─────────────
 * Los dos extremos de la conversación son proveedores inyectables y los dos se
 * imprimen en toda salida:
 *
 *   ARNES_CLIENTE=agente     un agente improvisando en personaje. **El único
 *                            que puede encontrar algo.**
 *   ARNES_CLIENTE=de-prueba  líneas fijas: ejercita el bucle, no el producto.
 *   ARNES_BOT=agente         un agente leyendo el `SKILL.md` real.
 *   ARNES_BOT=guion          respuestas fijas: prueba el arnés, jamás el bot.
 *
 * Con los dos en modo fijo esto no mira nada, y la salida lo dice con esas
 * palabras. Un informe que no aclara quién estaba de cada lado es peor que no
 * tener informe.
 */

import fs from 'node:fs';
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
import { crearInforme } from './informe.js';
import { crearBot } from './actores/bot.js';
import { crearProveedorGuion } from './actores/proveedor/guion.js';
import { crearProveedorAgente } from './actores/proveedor/agente.js';
import { crearClienteLibre, MAX_TURNOS } from './actores/cliente/libre.js';
import { crearProveedorClienteAgente } from './actores/cliente/proveedor/agente.js';
import { crearProveedorClienteDePrueba } from './actores/cliente/proveedor/de-prueba.js';

const ESCENARIO = 'libre';

/**
 * El guion del BOT cuando corre con `ARNES_BOT=guion`.
 *
 * Una sola línea, repetida tantas veces como turnos pueda haber. Es
 * deliberadamente tonta: en modo libre el bot scripteado no está para contestar
 * bien, está para que el bucle tenga con quién hablar mientras se ejercita el
 * arnés. Cualquier cosa más elaborada acá sería el arnés escribiéndole las
 * respuestas al producto y creyendo después que probó algo.
 *
 * Se repite en vez de tener un solo paso porque el proveedor `guion` explota
 * cuando se queda corto —y con razón, en modo `guion`, donde un guion corto es
 * un guion mal escrito—. Acá el cliente improvisa y nadie sabe cuántos turnos
 * van a ser, así que el guion se dimensiona por el techo.
 */
const LINEA_DE_MENTIRA = 'Hola, soy el asistente del local. Decime qué necesitás.';
const botDeMentira = (turnos) => Array.from({ length: turnos + 1 }, () => ({ texto: LINEA_DE_MENTIRA }));

// ── Elegir quién habla de cada lado ─────────────────────────────────────────

function elegirProveedorDelBot(env, maxTurnos) {
  if (env.botProveedor === 'agente') {
    return crearProveedorAgente({
      buzon: env.buzon ? path.join(env.buzon, 'bot') : '',
      corrida: ESCENARIO,
      timeoutMs: env.buzonTimeoutMs,
    });
  }
  if (env.botProveedor !== 'guion') {
    throw new ErrorArnes(
      `ARNES_BOT=${env.botProveedor} no existe`,
      'Los que hay: `guion` (respuestas fijas, prueba el arnés) y `agente` (un agente Claude).',
    );
  }
  // Con `usaMcp: true` las tools se ejecutan de verdad contra el core: lo
  // scripteado es la decisión del bot, nunca el sistema.
  return crearProveedorGuion({ pasos: botDeMentira(maxTurnos), usaMcp: true });
}

function elegirProveedorDelCliente(env, modo) {
  if (modo === 'agente') {
    return crearProveedorClienteAgente({
      buzon: env.buzon ? path.join(env.buzon, 'cliente') : '',
      corrida: ESCENARIO,
      timeoutMs: env.buzonTimeoutMs,
    });
  }
  if (modo === 'de-prueba') return crearProveedorClienteDePrueba();
  throw new ErrorArnes(
    `ARNES_CLIENTE=${modo} no existe`,
    'Los que hay: `agente` (un agente improvisando en personaje — el único que encuentra algo)',
    'y `de-prueba` (líneas fijas: ejercita el bucle, no el producto).',
  );
}

// ── La corrida ──────────────────────────────────────────────────────────────

async function conversar({ env, bitacora, transcripcion, presupuesto, proveedorBot, proveedorCliente, persona, objetivo, maxTurnos }) {
  const graph = crearGraphFalso();
  await graph.escuchar();

  let gateway = null;
  let bot = null;
  let libre = null;
  try {
    console.log('\n⚙️  Aislamiento — el negocio de esta corrida');
    const corrida = await crearCorrida({ env });
    console.log(`   negocio ${corrida.negocioId} · wa_phone_id ${corrida.waPhoneId} · cliente ${corrida.telefonoCliente}`);
    bitacora.corrida = {
      negocioId: corrida.negocioId,
      waPhoneId: corrida.waPhoneId,
      telefonoCliente: corrida.telefonoCliente,
    };
    const carta = await cargarCarta(corrida.api, corrida.tokenDueno);
    console.log(`   carta v${carta.version} cargada: ${carta.platos.length} platos`);
    bitacora.sistema(`negocio creado, carta v${carta.version} cargada, token de agente rotado (cop_…)`);

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

    libre = crearClienteLibre({
      proveedor: proveedorCliente,
      cliente,
      graph,
      persona,
      objetivo,
      transcripcion,
      presupuesto,
      maxTurnos,
    });

    console.log(`\n👤 → 🤖  conversación libre (cliente: ${proveedorCliente.nombre} · bot: ${proveedorBot.nombre})`);
    const reporte = await libre.conversar();

    // El estado del core al cerrar: no se asevera nada sobre él, pero es la
    // mitad del material del que sale el escenario nuevo. "El cliente creyó que
    // pidió dos y en el core quedó una" no se ve en la transcripción.
    reporte.estadoCore = await leerEstado(corrida);
    bitacora.estadoCore(reporte.estadoCore);
    return reporte;
  } finally {
    await libre?.cerrar();
    await bot?.cerrar?.();
    await gateway?.cerrar?.();
    await graph.cerrar();
  }
}

/** Lo observable del core al cerrar, por el contrato y con el token del dueño. */
async function leerEstado(corrida) {
  const pedir = async (ruta) => {
    const res = await corrida.api('GET', ruta, corrida.tokenDueno);
    return res.status === 200 ? res.cuerpo : { error: res.status };
  };
  return {
    compromisos: await pedir('/api/compromisos'),
    servicios: await pedir('/api/servicios'),
    consultas: await pedir('/api/consultas'),
  };
}

// ── El informe ──────────────────────────────────────────────────────────────

/**
 * El markdown del modo libre. Es lo que se lee después, y está escrito para que
 * de acá se pueda **copiar** un escenario nuevo: la conversación entera, lo que
 * al cliente le resultó raro, y por dónde cerró.
 */
function renderHallazgos(r, { corridaId, modeloBot }) {
  const l = [];
  l.push(`# Modo libre — ${corridaId}`);
  l.push('');
  l.push('> Esto **no es un veredicto**. Es material para escribir un escenario del modo');
  l.push('> `guion`, que es el único que después defiende contra la regresión.');
  l.push('');
  l.push('| | |');
  l.push('|---|---|');
  l.push(`| cliente | \`${r.proveedor}\` — ${r.improvisa ? 'improvisa: lo que encuentre vale' : '**líneas fijas: no puede encontrar nada**'} |`);
  l.push(`| bot | \`${r.proveedorBot}\` — ${r.juzgaAlBot ? 'un agente leyendo el SKILL.md real' : '**respuestas fijas: no dice nada del bot**'} |`);
  l.push(`| modelo del bot | ${modeloBot || '(el default de gateway/src/config.js)'} |`);
  l.push(`| turnos | ${r.turnos} de un techo de ${r.maxTurnos} |`);
  l.push(`| cerró | ${textoDeCierre(r.cierre)} |`);
  l.push('');

  l.push('## La conversación');
  l.push('');
  for (const c of r.conversacion) {
    const quien = c.rol === 'vos' ? '👤 cliente' : '🤖 local';
    l.push(`**${quien}** — ${c.texto.split('\n').join('  \n')}`);
    l.push('');
  }

  l.push('## Lo que al cliente le resultó raro');
  l.push('');
  if (!r.rarezas.length) {
    l.push(r.improvisa
      ? '_Nada. El cliente no marcó nada raro en toda la conversación._'
      : '_Nada, y no podía marcar nada: el cliente son líneas fijas._');
  } else {
    l.push('Cada uno de estos es un **candidato a escenario**. El que sobreviva se escribe');
    l.push('en `arnes/escenarios/` con sus aserciones, y ahí recién empieza a defender.');
    l.push('');
    for (const x of r.rarezas) l.push(`- **turno ${x.turno}** — ${x.que}`);
  }
  l.push('');

  if (r.silencios.length) {
    l.push('## El local no contestó');
    l.push('');
    for (const s of r.silencios) {
      l.push(`- **turno ${s.turno}** — el cliente escribió ${JSON.stringify(s.texto)} y no le llegó nada.`);
      l.push(`  ${s.detalle}`);
    }
    l.push('');
    l.push('Esto es un hallazgo sobre el producto y **acá no rompe nada**, porque en modo libre');
    l.push('nada rompe. Si se repite, el escenario en modo `guion` que lo capture sí va a romper.');
    l.push('');
  }

  l.push('## El personaje');
  l.push('');
  l.push(`- **quién es:** ${r.persona.quien_sos}`);
  l.push(`- **cómo escribe:** ${r.persona.como_escribis}`);
  l.push(`- **qué sabe:** ${r.persona.que_sabes}`);
  l.push(`- **qué quería:** ${r.objetivo}`);
  l.push('');
  return `${l.join('\n')}\n`;
}

function textoDeCierre(cierre) {
  if (!cierre) return '(?)';
  if (cierre.quien === 'techo') return `techo de turnos — ${cierre.motivo}`;
  if (cierre.quien === 'silencio') return `el local dejó de contestar — ${cierre.motivo}`;
  return `se fue el cliente — ${cierre.motivo}`;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const env = entorno();
  const modoCliente = (leerEnv('ARNES_CLIENTE', 'agente')).toLowerCase();
  const maxTurnos = Number(leerEnv('ARNES_MAX_TURNOS', String(MAX_TURNOS))) || MAX_TURNOS;

  console.log('Arnés · modo LIBRE — genera candidatos a escenario, no veredictos');
  console.log('Este modo NUNCA rompe el build: exit 0 encuentre o no encuentre (design §2).');

  await preflight();

  const proveedorBot = elegirProveedorDelBot(env, maxTurnos);
  const proveedorCliente = elegirProveedorDelCliente(env, modoCliente);

  if (!proveedorCliente.improvisa) {
    console.log(
      `\n⚠  ARNES_CLIENTE=${proveedorCliente.nombre}: el cliente son líneas fijas.\n` +
      '   Esto ejercita el bucle del modo libre; NO puede encontrar nada del producto.\n' +
      '   El modo libre de verdad es ARNES_CLIENTE=agente.',
    );
  }
  if (!proveedorBot.juzgaAlBot) {
    console.log(
      `\n⚠  ARNES_BOT=${proveedorBot.nombre}: el bot son respuestas fijas.\n` +
      '   Nada de lo que salga de acá dice algo sobre el bot.',
    );
  }

  const modeloBot = env.modelo || '(el default de gateway/src/config.js)';
  const informe = crearInforme({
    modelos: { bot: `${modeloBot} · servido por el proveedor \`${proveedorBot.nombre}\`` },
    proveedorBot: proveedorBot.nombre,
    juzgaAlBot: proveedorBot.juzgaAlBot === true,
    duenoModo: 'ninguno — en modo libre el dueño no entra',
    topeUsd: env.topeUsd,
    modo: 'libre',
  });

  const bitacora = informe.escenario({ escenario: ESCENARIO, etiquetas: ['@libre'] });
  const transcripcion = crearTranscripcion({
    escenario: ESCENARIO,
    proveedorBot: proveedorBot.nombre,
    modelo: modeloBot,
    bitacora,
  });
  const presupuesto = crearPresupuesto({ topeUsd: env.topeUsd, proveedorBot: proveedorBot.nombre });

  let reporte = null;
  try {
    reporte = await conGatewayDelComposeParado(() => conversar({
      env,
      bitacora,
      transcripcion,
      presupuesto,
      proveedorBot,
      proveedorCliente,
      persona: undefined,
      objetivo: undefined,
      maxTurnos,
    }));
  } catch (err) {
    // Todo lo que se cae en modo libre es arnés roto por definición: acá no hay
    // ninguna aserción que pueda acusar al producto.
    informe.romper(err);
  }

  // El gasto por actor, con la aclaración de POR QUÉ no hay número — que no es
  // la misma en los dos casos. Un proveedor de líneas fijas no gastó nada de
  // verdad; un agente en el loop gastó y el arnés no tiene la factura. Meter
  // los dos en un mismo "sin costo" borra justo esa diferencia.
  const estado = presupuesto.estado();
  const porQueNoHayNumero = {
    guion: 'respuestas fijas: no corrió ningún modelo, así que el cero es de verdad',
    'de-prueba': 'líneas fijas: no corrió ningún modelo, así que el cero es de verdad',
    agente: 'lo sirvió un agente leyendo el prompt, no la API: no hay factura que mirar',
  };
  const proveedorDe = { bot: proveedorBot.nombre, cliente: proveedorCliente.nombre };
  for (const actor of ['bot', 'cliente']) {
    const a = estado.porActor[actor];
    if (!a?.pasos) continue;
    const quien = proveedorDe[actor];
    informe.gasto({
      actor,
      usd: a.conCosto ? a.usd : null,
      nota: a.conCosto
        ? null
        : `${a.pasos} ${a.pasos === 1 ? 'paso' : 'pasos'} · proveedor \`${quien}\` — ${porQueNoHayNumero[quien] ?? 'sin costo reportado'}`,
    });
  }

  await informe.cerrarEscenario(bitacora);

  if (reporte) {
    reporte.proveedorBot = proveedorBot.nombre;
    reporte.juzgaAlBot = proveedorBot.juzgaAlBot === true;
    const destino = path.join(informe.dir, ESCENARIO, 'hallazgos.md');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, renderHallazgos(reporte, { corridaId: informe.corridaId, modeloBot }));

    console.log('\n── Lo que dejó el modo libre');
    console.log(`  turnos: ${reporte.turnos} de ${reporte.maxTurnos} · cerró por ${textoDeCierre(reporte.cierre)}`);
    if (reporte.rarezas.length) {
      console.log(`  candidatos a escenario (${reporte.rarezas.length}):`);
      for (const x of reporte.rarezas) console.log(`    · turno ${x.turno} — ${x.que}`);
      console.log('    Se resuelven escribiendo el escenario en arnes/escenarios/, NO tocando el modo libre.');
    } else {
      console.log(reporte.improvisa
        ? '  ningún candidato: el cliente no marcó nada raro'
        : '  ningún candidato, y no podía haberlos: el cliente son líneas fijas');
    }
    for (const s of reporte.silencios) {
      console.log(`  ⚠ turno ${s.turno}: el local no le contestó a ${JSON.stringify(s.texto)}`);
    }
    console.log(`  informe: ${path.relative(process.cwd(), destino)}`);
    console.log('  (el cartel de abajo dice exit 0 SIEMPRE: en modo libre no hay rojo del producto.');
    console.log('   Lo que vale de esta corrida son los candidatos, no el verde.)');
  }

  const salida = await informe.cerrar();

  // Acá está la decisión del modo, en una línea: un rojo del producto en modo
  // libre no existe. Si el informe devolvió 1, se baja a 0 y se dice por qué.
  // El 2 se respeta: el arnés roto sigue siendo arnés roto en cualquier modo.
  if (salida === 1) {
    console.log('\n  El modo libre NO rompe el build: lo de arriba es un candidato a escenario, no un rojo.');
    process.exit(0);
  }
  process.exit(salida);
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
  console.error('\n  No hay nada que reportar del producto: la conversación no llegó a terminar.');
  process.exit(2);
});
