/**
 * preflight.js — lo que tiene que estar ANTES de gastar el primer peso.
 *
 *   node arnes/preflight.js
 *
 * Sale 0 si está todo. Sale **2** (`ARNÉS ROTO`) si falta algo, nombrando qué
 * falta y con qué comando se arregla. Nunca sale 1: acá no hay veredicto sobre
 * el producto, sólo sobre la máquina.
 *
 * Por qué corre primero y solo: enterarse de que falta `uv` en el turno 6 de
 * una conversación es haber pagado seis llamadas al modelo para descubrir algo
 * que se sabía antes de empezar. El arnés cuesta plata y minutos; el preflight
 * cuesta un segundo.
 *
 * Chequea TODO y recién después informa. Fallar en el primero obliga a correrlo
 * cuatro veces para enterarse de las cuatro cosas que faltan.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { entorno, ErrorArnes, MODOS_DUENO, PROVEEDORES_BOT, RAIZ } from './entorno.js';

const AQUI = path.join(RAIZ, 'arnes');

// ── Salida ───────────────────────────────────────────────────────────────────
// Sin TTY no hay colores. Es lo único que hace falta para que el día que exista
// un CI esto se enchufe sin escupir códigos de escape en el log.
const tty = process.stdout.isTTY;
const ROJO = tty ? '\x1b[31m' : '';
const VERDE = tty ? '\x1b[32m' : '';
const GRIS = tty ? '\x1b[90m' : '';
const NEGRITA = tty ? '\x1b[1m' : '';
const FIN = tty ? '\x1b[0m' : '';

// ── Herramientas de chequeo ──────────────────────────────────────────────────

/** ¿Responde este HTTP con 200 y —si se pide— con este texto adentro? */
async function responde(url, { buscar = '', timeoutMs = 5000 } = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, detalle: `respondió HTTP ${res.status}` };
    if (buscar) {
      const cuerpo = await res.text();
      if (!cuerpo.includes(buscar)) {
        return { ok: false, detalle: `respondió 200 pero sin «${buscar}» en el cuerpo` };
      }
    }
    return { ok: true };
  } catch (err) {
    const detalle = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? `no respondió en ${timeoutMs}ms`
      : String(err?.cause?.code || err?.message || err);
    return { ok: false, detalle };
  }
}

/** ¿Está este ejecutable y contesta? Se lo corre de verdad, no se busca en el PATH. */
function ejecuta(comando, args) {
  const r = spawnSync(comando, args, { encoding: 'utf8', timeout: 15000 });
  if (r.error) return { ok: false, detalle: r.error.code === 'ENOENT' ? 'no está en el PATH' : String(r.error.message) };
  if (r.status !== 0) {
    const salida = String(r.stderr || r.stdout || '').trim().split('\n')[0] || `exit ${r.status}`;
    return { ok: false, detalle: salida.slice(0, 200) };
  }
  return { ok: true, version: String(r.stdout || '').trim().split('\n')[0] };
}

// ── Los chequeos ─────────────────────────────────────────────────────────────

/**
 * @returns {Promise<Array<{nombre: string, ok: boolean, detalle?: string, porque?: string, comando?: string|string[], nota?: string}>>}
 */
async function chequear(env) {
  const checks = [];

  // 1. El modo del dueño, primero: define si la corrida puede ser desatendida.
  const modoValido = MODOS_DUENO.includes(env.duenoModo);
  checks.push({
    nombre: `ARNES_DUENO=${env.duenoModo}`,
    ok: modoValido,
    detalle: modoValido ? null : 'no es un modo del actor dueño',
    porque: 'un typo acá apaga en silencio el único actor que prueba el panel',
    comando: `ARNES_DUENO=${MODOS_DUENO.join(' | ')}`,
  });
  // 2. **Quién sirve los turnos del bot.** Es el chequeo más importante de
  //    todos y por eso va arriba de todo lo demás.
  //
  //    Este renglón reemplazó al de `ANTHROPIC_API_KEY`, que ya no es un
  //    requisito: no hay clave en esta máquina y el dueño del producto decidió
  //    no poner una (design §1, reescrita durante el apply). El principio no se
  //    movió — el bot no lo escribe la misma cabeza que escribió el prompt —,
  //    cambió quién lo cumple.
  //
  //    Un typo acá no rompe nada: cae al default y la corrida termina en verde.
  //    Ese es exactamente el problema, porque el verde de `guion` NO es un
  //    veredicto sobre el bot. Por eso el proveedor se nombra siempre, incluso
  //    cuando está bien.
  const proveedorValido = PROVEEDORES_BOT.includes(env.botProveedor);
  checks.push({
    nombre: `ARNES_BOT=${env.botProveedor}`,
    ok: proveedorValido,
    detalle: proveedorValido ? null : 'no es un proveedor de bot conocido',
    nota: proveedorValido ? notaDelProveedor(env.botProveedor) : null,
    porque: 'el proveedor decide si la corrida emite veredicto sobre el bot o solamente sobre el arnés',
    comando: `ARNES_BOT=${PROVEEDORES_BOT.join(' | ')}`,
  });

  const conNavegador = modoValido && env.duenoModo === 'navegador';

  // 3. Docker con el plugin compose: el arnés para y levanta el gateway del
  //    compose durante la corrida (design §4).
  const docker = ejecuta('docker', ['compose', 'version']);
  checks.push({
    nombre: 'docker compose',
    ok: docker.ok,
    detalle: docker.detalle,
    nota: docker.version,
    porque: 'el arnés para el gateway del compose mientras corre, para no competir por la cola de salidas',
    comando: 'https://docs.docker.com/engine/install/',
  });

  // 4. `redis`, la única dependencia que el arnés importa directo — y sale de
  //    `gateway/node_modules`, no de una copia propia (design §17). El cliente
  //    que se le pasa a `crearApp` tiene que ser EXACTAMENTE el que el gateway
  //    espera: probar contra otro cliente de redis es probar otra cosa, y esa
  //    clase de falla aparece meses después y disfrazada.
  const redisDelGateway = path.join(RAIZ, 'gateway', 'node_modules', 'redis');
  checks.push({
    nombre: 'redis (de gateway/node_modules)',
    ok: fs.existsSync(redisDelGateway),
    detalle: fs.existsSync(redisDelGateway) ? null : 'no está instalado en gateway/',
    porque: 'el arnés levanta el gateway en proceso y le pasa el cliente de redis que el gateway espera',
    comando: 'npm --prefix gateway install',
  });

  // 5. El compose entero, servicio por servicio, con las mismas URLs que usa el
  //    smoke. Un fallo acá nombra el servicio: "no responde" a secas manda a
  //    leer logs de cuatro contenedores.
  const core = await responde(`${env.coreUrl}/health`, { buscar: '"status":"ok"' });
  checks.push({
    nombre: `core (${env.coreUrl}/health)`,
    ok: core.ok,
    detalle: core.detalle,
    porque: 'el arnés crea su negocio, su carta y sus aserciones contra el core real',
    comando: 'docker compose up -d',
  });

  const gateway = await responde(`${env.gatewayUrl}/salud`, { buscar: '"ok":true' });
  checks.push({
    nombre: `gateway del compose (${env.gatewayUrl}/salud)`,
    ok: gateway.ok,
    detalle: gateway.detalle,
    porque: 'el arnés lo para durante la corrida y lo vuelve a levantar; si ya estaba caído, la máquina quedó a medias',
    comando: [
      'docker compose up -d gateway',
      '# si lo dejó parado una corrida del arnés que murió a mitad de camino: docker compose start gateway',
    ],
  });

  const panel = await responde(`${env.panelUrl}/panel/`, { buscar: 'id="raiz"' });
  checks.push({
    nombre: `panel (${env.panelUrl}/panel/)`,
    ok: panel.ok,
    detalle: panel.detalle,
    porque: 'es la pantalla que el actor dueño abre en el navegador',
    comando: 'docker compose up -d panel',
  });

  // 6. `uv`: es lo que levanta el server MCP de `agente/`. Sin MCP el bot no
  //    tiene tools y contesta de memoria — o sea, falla todo por una razón que
  //    no es el producto.
  //
  //    Sólo hace falta con el proveedor `agente`, que es el único que llama
  //    tools de verdad. Con `guion` las respuestas ya vienen escritas y el MCP
  //    no se levanta: exigir `uv` ahí sería un requisito inventado.
  if (env.botProveedor === 'agente') {
    const uv = ejecuta('uv', ['--version']);
    checks.push({
      nombre: 'uv',
      ok: uv.ok,
      detalle: uv.detalle,
      nota: uv.version,
      porque: 'el MCP de agente/ se levanta con `uv run`; sin él el bot se queda sin tools y contesta de memoria',
      comando: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
    });
  } else {
    checks.push({
      nombre: 'uv',
      ok: true,
      nota: proveedorValido
        ? 'no hace falta: con ARNES_BOT=guion no se levanta el MCP'
        : `sin chequear: ARNES_BOT=${env.botProveedor} no es un proveedor válido`,
    });
  }

  // Nada de Chromium ni de Playwright: se sacaron del proyecto entero
  // (design §9). El actor dueño por navegador lo maneja un agente con su Chrome
  // siguiendo un guión escrito, y eso no es un binario que el preflight pueda
  // chequear — es una persona o un agente que lo corre. Lo único que el arnés
  // puede hacer al respecto es lo que hace la corrida al final: **nombrar las
  // aserciones que sólo ese guión cubre** (tarea 3.8), para que "no corre solo"
  // no se convierta en "no corre nunca".
  if (conNavegador) {
    checks.push({
      nombre: 'actor dueño por navegador',
      ok: true,
      nota: 'lo ejecuta un agente con Chrome siguiendo arnes/dueno/guion.md — no corre desatendido',
    });
  }

  return checks;
}

/** Qué quiere decir cada proveedor, en una línea, en el renglón del preflight. */
function notaDelProveedor(proveedor) {
  if (proveedor === 'agente') {
    return 'un agente Claude lee el SKILL.md real y llama las tools reales — ESTA corrida juzga al bot';
  }
  return 'respuestas fijas: verifica el ARNÉS, no el bot. Un verde acá NO es un verde del producto';
}

// ── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Corre todos los chequeos y los imprime.
 * @param {{silencioso?: boolean}} [opts]
 * @returns {Promise<Array>} los chequeos, para que el runner los guarde
 * @throws {ErrorArnes} si falta algo
 */
export async function preflight({ silencioso = false } = {}) {
  const env = entorno();
  const checks = await chequear(env);

  if (!silencioso) {
    process.stdout.write(`\n${NEGRITA}── Requisitos del arnés${FIN}\n`);
    for (const c of checks) {
      const marca = c.ok ? `${VERDE}✓${FIN}` : `${ROJO}✗${FIN}`;
      const cola = c.ok
        ? (c.nota ? ` ${GRIS}· ${c.nota}${FIN}` : '')
        : ` ${GRIS}— ${c.detalle}${FIN}`;
      process.stdout.write(`  ${marca} ${c.nombre}${cola}\n`);
    }
    if (env.modelo) {
      process.stdout.write(`  ${GRIS}· el bot va a correr con MODELO=${env.modelo}${FIN}\n`);
    } else {
      process.stdout.write(`  ${GRIS}· MODELO sin definir: vale el default de gateway/src/config.js${FIN}\n`);
    }
    // El aviso más importante del preflight, y va último para que sea lo último
    // que se lee. Con `guion` la corrida NO juzga al bot, y eso no puede quedar
    // escondido en un renglón gris entre otros diez.
    if (env.botProveedor === 'guion') {
      process.stdout.write(
        `\n  ${NEGRITA}⚠ ARNES_BOT=guion${FIN} — esta corrida verifica el ARNÉS, no el bot.\n` +
        `  ${GRIS}Un guion comparte los puntos ciegos del prompt por construcción. Para juzgar al bot: ARNES_BOT=agente${FIN}\n`,
      );
    }
  }

  const rotos = checks.filter((c) => !c.ok);
  if (rotos.length) {
    const pistas = [];
    for (const c of rotos) {
      pistas.push('');
      pistas.push(`${c.nombre} — ${c.detalle}`);
      if (c.porque) pistas.push(`    ${c.porque}`);
      for (const linea of [c.comando].flat().filter(Boolean)) pistas.push(`    → ${linea}`);
    }
    throw new ErrorArnes(
      `faltan ${rotos.length} requisito${rotos.length > 1 ? 's' : ''}, no se gastó un peso`,
      pistas,
    );
  }

  return checks;
}

/** ¿Se está corriendo este archivo directamente? */
function esCli() {
  const invocado = process.argv[1];
  return Boolean(invocado) && import.meta.url === pathToFileURL(invocado).href;
}

if (esCli()) {
  try {
    await preflight();
    process.stdout.write(`\n${VERDE}${NEGRITA}✓ PREFLIGHT OK${FIN} — está todo para correr el arnés.\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${err.message}\n`);
    for (const linea of err.pistas || []) process.stderr.write(`${linea}\n`);
    process.stderr.write(`\n${GRIS}  ARNÉS ROTO (exit 2) no dice nada sobre el producto: el arnés no llegó a preguntar.${FIN}\n`);
    process.exit(err.exitCode || 2);
  }
}
