/**
 * Puerta de salida del grupo 1: **el andamio, sin modelo y sin gastar**.
 *
 *   node arnes/puerta-andamio.js
 *
 * Un mensaje del cliente entra por el webhook firmado, recorre el gateway real
 * (firma, idempotencia, tenant, agente, outbox, worker) y sale por el Graph
 * falso. El bot es un `queryFn` de mentira que devuelve un texto fijo: **esto
 * verifica el ARNÉS, no el bot**. Acá no se llama a la API de Anthropic, no se
 * levanta el MCP y no se gasta un centavo.
 *
 * Por qué existe esta puerta antes que todo lo demás: si el andamio no mueve un
 * mensaje con un bot de mentira, con el bot real sólo se gasta plata a ciegas.
 * Si esto no cierra, no se sigue.
 *
 * Exit codes (design §15):
 *   0 — el andamio mueve el mensaje
 *   1 — PRODUCTO: el mensaje no llegó, o llegó distinto
 *   2 — ARNÉS ROTO: no está el compose, no se pudo crear el negocio, etc.
 */

import process from 'node:process';

import { ErrorArnes, entorno } from './entorno.js';
import { conGatewayDelComposeParado } from './compose.js';
import { crearGraphFalso } from './graph-falso.js';
import { crearCorrida } from './aislamiento.js';
import { levantarGateway } from './gateway-en-proceso.js';
import { crearCliente } from './cliente.js';

/** Lo único que "dice" el bot de mentira. Fijo a propósito: es un andamio. */
const TEXTO_FIJO = 'Listo, lo tomo. (bot de mentira del andamio)';

/**
 * El `queryFn` de mentira.
 *
 * Devuelve exactamente la forma que `crearAgente` consume del stream del SDK
 * (`assistant` con bloques de texto, y un `session_id`) y nada más. No imita
 * tools ni costo: eso es del grupo 2, con el bot real.
 *
 * Guarda lo que le llegó para poder aseverar que el texto del cliente cruzó el
 * webhook, el tenant y el agente sin que nadie lo tocara.
 */
function queryFnDeMentira() {
  const llamadas = [];
  async function* falso({ prompt, options }) {
    llamadas.push({ prompt, options });
    const sesion = `arnes-sesion-${llamadas.length}`;
    yield { type: 'system', subtype: 'init', session_id: sesion };
    yield {
      type: 'assistant',
      session_id: sesion,
      message: { content: [{ type: 'text', text: TEXTO_FIJO }] },
    };
    yield { type: 'result', subtype: 'success', session_id: sesion };
  }
  falso.llamadas = llamadas;
  return falso;
}

// ── Salida ───────────────────────────────────────────────────────────────────
// Sin TTY: sin colores. Es lo único que hace falta para que el día que exista
// un CI esto se enchufe sin tocarlo.
const color = process.stdout.isTTY;
const VERDE = color ? '\x1b[32m' : '';
const ROJO = color ? '\x1b[31m' : '';
const GRIS = color ? '\x1b[90m' : '';
const NEGRITA = color ? '\x1b[1m' : '';
const FIN = color ? '\x1b[0m' : '';

const fallas = [];
let pasos = 0;

function titulo(t) { console.log(`\n${NEGRITA}── ${t} ${FIN}`); }
function nota(t) { console.log(`  ${GRIS}· ${t}${FIN}`); }
function ok(t) { pasos += 1; console.log(`  ${VERDE}✓${FIN} ${t}`); }

/**
 * Una aserción con la frase humana de lo que protege, no un nombre de
 * variable. Es lo que hace que la falla se lea a las once de la noche.
 */
function exigir(condicion, que, esperado, llego) {
  if (condicion) { ok(que); return true; }
  fallas.push({ que, esperado, llego });
  console.log(`  ${ROJO}✗${FIN} ${que}`);
  if (esperado !== undefined) console.log(`      esperaba: ${esperado}`);
  if (llego !== undefined) console.log(`      llegó:    ${llego}`);
  return false;
}

// ── La corrida ───────────────────────────────────────────────────────────────

async function correr() {
  const env = entorno();
  const bot = queryFnDeMentira();

  titulo('📱 Graph falso — el teléfono del cliente');
  const graph = crearGraphFalso();
  await graph.escuchar();
  nota(`escuchando en ${graph.url}`);

  let gateway = null;
  try {
    titulo('⚙️  Aislamiento — el negocio de esta corrida');
    const corrida = await crearCorrida({ env });
    nota(`negocio ${corrida.negocioId} · wa_phone_id ${corrida.waPhoneId} · cliente ${corrida.telefonoCliente}`);
    exigir(
      String(corrida.tokenAgente).startsWith('cop_'),
      'el token del agente es un token de agente (cop_…), que es lo que `tenantsDeObjeto` exige',
      'cop_…',
      `${String(corrida.tokenAgente).slice(0, 8)}…`,
    );

    titulo('🤖 Gateway en proceso — el producto, con el bot de mentira');
    gateway = await levantarGateway({
      tenant: corrida.tenant(),
      graphUrl: graph.url,
      coreUrl: env.coreUrl,
      queryFn: bot,
    });
    nota(`gateway del arnés en ${gateway.url} — sin tenants.json y sin reiniciar nada`);
    nota(`redis: ${gateway.config.redisUrl}`);

    const salud = await (await fetch(`${gateway.url}/salud`)).json();
    exigir(
      salud.ok === true && salud.tenants === 1 && (salud.degradado || []).length === 0,
      'el gateway del arnés levanta entero, con un tenant y sin credenciales faltantes',
      '{ ok: true, tenants: 1, degradado: [] }',
      JSON.stringify(salud),
    );

    // ── El mensaje ─────────────────────────────────────────────────────────
    titulo('👤 → 🤖 → 📱  un mensaje entra por el webhook y sale por el Graph');
    const cliente = crearCliente({
      gateway,
      telefono: corrida.telefonoCliente,
      nombre: 'Cliente del arnés',
    });

    const dicho = await cliente.decir('hola, ¿están abiertos?');
    ok('el webhook aceptó la firma y contestó 200');

    exigir(
      bot.llamadas.length === 1,
      'el mensaje llegó hasta el agente (una sola vez)',
      '1 llamada al bot',
      `${bot.llamadas.length}`,
    );
    exigir(
      bot.llamadas[0]?.prompt === dicho.texto,
      'el texto del cliente llegó al bot tal cual lo escribió',
      JSON.stringify(dicho.texto),
      JSON.stringify(bot.llamadas[0]?.prompt),
    );

    const recibido = await graph.esperarMensaje({
      phoneNumberId: corrida.waPhoneId,
      telefono: corrida.telefonoCliente,
    });
    ok('el mensaje salió del outbox y llegó al Graph falso');

    exigir(
      recibido?.texto === TEXTO_FIJO,
      'el cliente recibió lo que el bot dijo, sin que nadie lo toque en el camino',
      JSON.stringify(TEXTO_FIJO),
      JSON.stringify(recibido?.texto),
    );
    exigir(
      recibido?.telefono === String(corrida.telefonoCliente),
      'el mensaje salió al teléfono de este cliente',
      String(corrida.telefonoCliente),
      String(recibido?.telefono),
    );

    // ── El fantasma del `message.id` ───────────────────────────────────────
    // El webhook descarta un id repetido EN SILENCIO (SETNX con TTL de 24hs).
    // Se prueba acá, en el andamio y gratis, porque si el arnés algún día
    // reusa un id el síntoma va a ser "el bot no contestó ese turno" y se va a
    // buscar en el bot. Que quede en verde de una vez.
    titulo('👻 El fantasma: un `message.id` repetido se descarta en silencio');
    await cliente.postear(cliente.payloadDeTexto({ id: dicho.id, texto: 'esto no tiene que pasar' }));
    await gateway.esperar();
    exigir(
      bot.llamadas.length === 1,
      'el id repetido no llegó al bot: la idempotencia de 24hs lo cortó antes de cualquier efecto',
      '1 llamada al bot',
      `${bot.llamadas.length}`,
    );

    // Un tercero con id nuevo. El outbox es FIFO por teléfono, así que si el
    // repetido hubiera generado respuesta llegaría ANTES que ésta: contar al
    // final alcanza y no hace falta un `sleep` para probar una ausencia.
    await cliente.decir('¿me tomás un pedido?');
    await graph.esperarMensaje({
      phoneNumberId: corrida.waPhoneId,
      telefono: corrida.telefonoCliente,
      desde: recibido.indice + 1,
    });
    const todos = graph.recibidos({ phoneNumberId: corrida.waPhoneId });
    exigir(
      todos.length === 2,
      'el cliente recibió dos mensajes, uno por cada mensaje suyo que no era repetido',
      '2 mensajes',
      `${todos.length}`,
    );
  } finally {
    await gateway?.cerrar();
    await graph.cerrar();
  }
}

// ── Entrada ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${NEGRITA}Arnés · puerta del grupo 1 — el andamio, sin modelo y sin gastar${FIN}`);
  console.log(`${GRIS}El bot es de mentira a propósito: esto verifica el arnés, no el bot.${FIN}`);

  // Todo adentro: si algo explota, el gateway del compose vuelve a levantarse
  // igual. Dejarlo caído le rompe el preflight a la corrida siguiente.
  await conGatewayDelComposeParado(correr);

  if (fallas.length) {
    console.log(`\n${ROJO}${NEGRITA}✗ PRODUCTO${FIN} — el andamio no movió el mensaje (${fallas.length} de ${pasos + fallas.length} aserciones)`);
    for (const f of fallas) console.log(`    · ${f.que}`);
    console.log('\n  Dónde mirar: el mensaje pasa por webhook → tenant → agente → outbox → Graph falso.');
    console.log('  El primer eslabón que no reportó verde es el que hay que abrir.');
    process.exit(1);
  }

  console.log(`\n${VERDE}${NEGRITA}✓ EL ANDAMIO CIERRA${FIN} — ${pasos} aserciones, sin modelo y sin gastar`);
  process.exit(0);
}

main().catch((err) => {
  if (err instanceof ErrorArnes || err?.arnesRoto) {
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${err.message}`);
    for (const pista of err.pistas || []) console.error(`    ${pista}`);
    console.error('\n  No hay veredicto sobre el producto.');
    process.exit(2);
  }
  console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — se cayó el andamio: ${err?.stack || err}`);
  console.error('\n  No hay veredicto sobre el producto.');
  process.exit(2);
});
