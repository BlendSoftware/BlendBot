/**
 * Entorno del arnés: de dónde salen los puertos, las credenciales y la raíz.
 *
 * Mismo criterio que `leer_env` de `scripts/smoke.sh`, y por el mismo motivo:
 * **el `.env` de la raíz manda** sobre lo que haya exportado en la shell,
 * porque el `.env` es lo que el `docker compose` levantó de verdad. Si tu shell
 * dice `CORE_PORT=9999` pero el compose arrancó con el 8080 del `.env`, el
 * arnés tiene que hablarle al 8080 o va a fallar contra un puerto vacío
 * diciendo "el core no responde", que es la peor forma de perder media hora.
 *
 * Si el `.env` no está o no trae la clave, vale lo que haya en `process.env`;
 * si tampoco, el mismo default que el `docker-compose.yml` (los `${VAR:-...}`).
 * Así el arnés funciona en frío, igual que el smoke.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del repo (arnes → repo). De acá cuelgan `.env`, `gateway/` y `agente/`. */
export const RAIZ = path.resolve(AQUI, '..');

/**
 * `ARNÉS ROTO`: el arnés no pudo emitir veredicto sobre el producto.
 *
 * Vive acá, en el módulo que importa todo el mundo, porque casi todo lo que
 * rompe el arnés es una afirmación sobre el entorno: falta una credencial, el
 * compose no está arriba, no hay `uv`, no está el MCP. Un `ErrorArnes` sale
 * con **exit 2** y NO dice nada sobre el producto (design §15). Confundirlo con
 * un rojo del producto es la forma más rápida de perder una hora arreglando un
 * bug que no existe.
 */
export class ErrorArnes extends Error {
  /**
   * @param {string} mensaje  qué pasó, en castellano
   * @param {...(string|string[])} pistas  qué hacer al respecto, una por línea
   */
  constructor(mensaje, ...pistas) {
    super(mensaje);
    this.name = 'ErrorArnes';
    this.arnesRoto = true;
    this.exitCode = 2;
    // Se conservan las líneas vacías: son los renglones en blanco que separan
    // un requisito faltante del siguiente. Un `filter(Boolean)` acá pega todo
    // en un bloque y lo vuelve ilegible justo cuando más se lo necesita leer.
    this.pistas = pistas.flat().filter((p) => typeof p === 'string');
  }
}

// ── El .env de la raíz ───────────────────────────────────────────────────────

let cacheEnvArchivo = null;

/** Parsea `RAIZ/.env` una sola vez. Ausente o ilegible = objeto vacío. */
function envDeArchivo() {
  if (cacheEnvArchivo) return cacheEnvArchivo;
  cacheEnvArchivo = {};
  const ruta = path.join(RAIZ, '.env');
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch {
    return cacheEnvArchivo; // sin .env se cae a process.env y a los defaults
  }
  for (const linea of crudo.split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte < 1) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    // Una sola capa de comillas, como el `sed` del smoke.
    if (valor.length >= 2 && ((valor[0] === '"' && valor.endsWith('"')) ||
        (valor[0] === "'" && valor.endsWith("'")))) {
      valor = valor.slice(1, -1);
    }
    cacheEnvArchivo[clave] = valor; // la última repetición gana, como `tail -n1`
  }
  return cacheEnvArchivo;
}

/**
 * Valor de una variable: `.env` de la raíz → `process.env` → default.
 * Un valor vacío cuenta como ausente.
 */
export function leerEnv(clave, defecto = '') {
  const delArchivo = envDeArchivo()[clave];
  if (delArchivo) return delArchivo;
  const delProceso = process.env[clave];
  if (delProceso) return delProceso;
  return defecto;
}

// ── La foto del entorno ──────────────────────────────────────────────────────

/** Modos válidos del actor dueño (design §9). */
export const MODOS_DUENO = ['navegador', 'api'];

/**
 * Quién sirve los turnos del bot (design §1, reescrita durante el apply).
 *
 * No hay `ANTHROPIC_API_KEY` en esta máquina y el dueño del producto decidió no
 * poner una. El principio no se movió: **el bot no lo escribe la misma cabeza
 * que escribió el prompt**. Lo que cambió es quién lo cumple.
 *
 *  - `guion`  — respuestas fijas escritas a mano. Sirve para probar **el
 *               ARNÉS** (que el mensaje cruce el webhook, que las aserciones
 *               de nivel 2 sepan leer un `tool_use`, que el presupuesto sume).
 *               **JAMÁS sirve para probar el bot**: un guion comparte los
 *               puntos ciegos del prompt por construcción — sólo falla donde el
 *               que lo escribió ya sabía que podía fallar, o sea nunca donde
 *               importa. Un verde con `guion` NO es un verde del producto.
 *  - `agente` — un agente Claude leyendo el `SKILL.md` real y llamando las
 *               tools reales del MCP, por el buzón de
 *               `actores/proveedor/agente.js`. Es el único que emite veredicto
 *               sobre el bot.
 *
 * Que esto sea explícito y viaje en toda salida no es burocracia: **un arnés
 * que dice verde sin decir con qué proveedor corrió es peor que no tener
 * arnés**, porque el verde se lee como "el bot está bien" cuando puede querer
 * decir "mis respuestas fijas siguen siendo fijas".
 */
export const PROVEEDORES_BOT = ['guion', 'agente'];

/**
 * Todo lo que el arnés necesita saber de la máquina, resuelto una vez.
 * No valida nada: de eso se ocupa `preflight.js`, que además sabe explicar.
 */
export function entorno() {
  const corePort = leerEnv('CORE_PORT', '8080');
  const arcaPort = leerEnv('ARCA_PORT', '8001');
  const gatewayPort = leerEnv('GATEWAY_PORT', '8090');
  const panelPort = leerEnv('PANEL_PORT', '8081');

  return {
    raiz: RAIZ,

    corePort,
    arcaPort,
    gatewayPort,
    panelPort,
    coreUrl: `http://localhost:${corePort}`,
    arcaUrl: `http://localhost:${arcaPort}`,
    gatewayUrl: `http://localhost:${gatewayPort}`,
    panelUrl: `http://localhost:${panelPort}`,

    // redisUrl NO se resuelve acá y es a propósito. La del compose
    // (`redis://redis:6379/0`) es el hostname de la red de docker y desde el
    // host no resuelve; y el puerto publicado NO es necesariamente el 6379 —en
    // esta máquina un `docker-compose.override.yml` lo mueve al 6380 porque
    // otro proyecto ocupa el de siempre—. Hardcodear un puerto acá era una
    // segunda fuente de verdad que mentía, y el modo de falla es feo: el
    // cliente de redis reintenta en silencio, el proceso queda colgado con un
    // `err.message` vacío, y parece "el bot no contestó".
    //
    // La única fuente es `urlDeRedisDelHost()` de compose.js, que le PREGUNTA
    // al compose (`docker compose port redis 6379`) en vez de asumir. Se pisa
    // con ARNES_REDIS_URL.

    adminUsuario: leerEnv('ADMIN_USERNAME', 'admin'),
    adminPassword: leerEnv('ADMIN_PASSWORD', 'cambiame-admin-dev'),

    // Puede estar vacía y es lo normal: el bot del arnés NO va por la API
    // (design §1). Se lee igual porque `cargarConfig` del gateway la pide y
    // porque, si alguna vez hay una, el arnés tiene que decir que la había.
    anthropicApiKey: leerEnv('ANTHROPIC_API_KEY'),
    // Vacío = el gateway va a usar su propio default (gateway/src/config.js).
    // No se duplica acá el nombre del modelo: dos defaults es un default que
    // miente, y el arnés tiene que correr con el MISMO cerebro que producción.
    modelo: leerEnv('MODELO'),

    // Quién sirve los turnos del bot. Default `guion` a propósito: es el único
    // que corre solo, sin nadie en el loop. Que el default NO emita veredicto
    // sobre el bot es incómodo y es honesto — la alternativa era un default que
    // se cuelga esperando a una persona.
    botProveedor: (leerEnv('ARNES_BOT', 'guion')).toLowerCase(),
    // Dónde vive el buzón del proveedor `agente` (pedidos y respuestas de
    // turno). Vacío = un temp por corrida, que la corrida imprime.
    buzon: leerEnv('ARNES_BUZON'),
    // Cuánto se espera a que el agente conteste un turno por el buzón. Es
    // grande a propósito: del otro lado hay alguien leyendo un SKILL.md.
    buzonTimeoutMs: Number(leerEnv('ARNES_BUZON_TIMEOUT_MS', '900000')),

    // Techo de gasto (design §10). Con el proveedor `agente` puede que no haya
    // costo en dólares que sumar; ver `presupuesto.js`, que NO inventa un cero.
    topeUsd: Number(leerEnv('ARNES_TOPE_USD', '1.00')),

    // Qué implementación del actor dueño se usa. `navegador` es el default
    // porque es la única que prueba el panel; `api` es la que corre
    // desatendida. Ojo: `navegador` NO es Playwright — Playwright se sacó del
    // proyecto y lo maneja un agente con su propio Chrome, siguiendo un guión
    // escrito (design §9). O sea que `navegador` no corre solo.
    // El default es `api`, no `navegador`, y esto se cambió a propósito: el
    // default tiene que ser el modo que SÍ puede correr solo. Defaultear a
    // `navegador` hacía que `make arnes` en una máquina sin nadie mirando
    // pidiera un modo que necesita a alguien manejando Chrome — o sea, colgarse
    // o mentir. El costo de `api` es que no mira el panel, y ese costo NO queda
    // oculto: la corrida imprime al final, con nombre y apellido, las ocho
    // aserciones que sólo el navegador puede afirmar. Una omisión que se anuncia
    // es una tarea; el default que se cuelga es una trampa.
    duenoModo: (leerEnv('ARNES_DUENO', 'api')).toLowerCase(),
  };
}
