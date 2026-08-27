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

import { entorno, ErrorArnes, MODOS_DUENO, RAIZ } from './entorno.js';

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

  // 1. El modo del dueño, primero: define si hace falta Chromium.
  const modoValido = MODOS_DUENO.includes(env.duenoModo);
  checks.push({
    nombre: `ARNES_DUENO=${env.duenoModo}`,
    ok: modoValido,
    detalle: modoValido ? null : 'no es un modo del actor dueño',
    porque: 'un typo acá apaga en silencio el único actor que prueba el panel',
    comando: `ARNES_DUENO=${MODOS_DUENO.join(' | ')}`,
  });
  const conNavegador = modoValido && env.duenoModo === 'navegador';

  // 2. Docker con el plugin compose: el arnés para y levanta el gateway del
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

  // 3. Las dependencias del arnés. Se chequean por directorio y no importando,
  //    porque importar `@playwright/test` sin instalar tira un error feo que no
  //    dice qué hacer.
  const dependencias = ['@playwright/test', '@anthropic-ai/sdk'];
  const faltantes = dependencias.filter((d) => !fs.existsSync(path.join(AQUI, 'node_modules', d)));
  checks.push({
    nombre: 'dependencias de arnes/',
    ok: faltantes.length === 0,
    detalle: faltantes.length ? `falta ${faltantes.join(', ')}` : null,
    porque: 'el arnés es un proyecto Node aparte: no comparte node_modules con el gateway ni con el panel',
    comando: [
      'npm --prefix arnes install',
      ...(conNavegador ? [] : ['# sin navegador alcanza con: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix arnes install']),
    ],
  });

  // 4. El compose entero, servicio por servicio, con las mismas URLs que usa el
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

  // 5. La clave. No hay modo "sin gastar": un arnés con el bot simulado no
  //    prueba nada de lo que este arnés existe para probar (design §1).
  checks.push({
    nombre: 'ANTHROPIC_API_KEY',
    ok: Boolean(env.anthropicApiKey),
    detalle: env.anthropicApiKey ? null : 'no está ni en el .env de la raíz ni en el entorno',
    porque: 'el bot del arnés es el bot de producción: sin clave no hay bot, y un bot simulado no prueba el bot',
    comando: 'export ANTHROPIC_API_KEY=sk-ant-...   (o ponerla en el .env de la raíz)',
  });

  // 6. `uv`: es lo que levanta el server MCP de `agente/`. Sin MCP el bot no
  //    tiene tools y contesta de memoria — o sea, falla todo por una razón que
  //    no es el producto.
  const uv = ejecuta('uv', ['--version']);
  checks.push({
    nombre: 'uv',
    ok: uv.ok,
    detalle: uv.detalle,
    nota: uv.version,
    porque: 'el MCP de agente/ se levanta con `uv run`; sin él el bot se queda sin tools',
    comando: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  });

  // 7. Chromium, sólo si el dueño va por navegador.
  if (conNavegador) {
    checks.push(await chequearChromium(faltantes.includes('@playwright/test')));
  } else {
    // No se chequea, y el renglón lo dice con el motivo real: con un
    // `ARNES_DUENO` inválido esto no es "omitido porque va por API", es
    // "no se sabe". Un ✓ que miente es peor que un ✗.
    checks.push({
      nombre: 'Chromium de Playwright',
      ok: true,
      nota: modoValido
        ? 'no hace falta: el dueño va por la API del core'
        : `sin chequear: ARNES_DUENO=${env.duenoModo} no es un modo válido`,
    });
  }

  return checks;
}

/** ¿Está bajado el Chromium que este Playwright espera? */
async function chequearChromium(sinPaquete) {
  const base = {
    nombre: 'Chromium de Playwright',
    porque: 'el actor dueño entra al panel por el navegador; es lo único que puede defender el campo libre de la demora',
    comando: 'npx --prefix arnes playwright install chromium',
  };
  if (sinPaquete) {
    return { ...base, ok: false, detalle: 'no se puede verificar: falta instalar las dependencias de arnes/' };
  }
  try {
    const { chromium } = await import('@playwright/test');
    const ruta = chromium.executablePath();
    if (!ruta || !fs.existsSync(ruta)) {
      return { ...base, ok: false, detalle: `el binario no está en ${ruta || '(sin ruta)'}` };
    }
    return { ...base, ok: true, nota: ruta };
  } catch (err) {
    return { ...base, ok: false, detalle: String(err?.message || err).split('\n')[0].slice(0, 200) };
  }
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
