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
 * compose no está arriba, no hay `uv`, no hay Chromium. Un `ErrorArnes` sale
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

    anthropicApiKey: leerEnv('ANTHROPIC_API_KEY'),
    // Vacío = el gateway va a usar su propio default (gateway/src/config.js).
    // No se duplica acá el nombre del modelo: dos defaults es un default que
    // miente, y el arnés tiene que correr con el MISMO cerebro que producción.
    modelo: leerEnv('MODELO'),

    // Qué implementación del actor dueño se usa. `navegador` es el default
    // porque es la que prueba el panel; `api` es la salida de emergencia para
    // una máquina sin Chromium (design §9).
    duenoModo: (leerEnv('ARNES_DUENO', 'navegador')).toLowerCase(),
  };
}
