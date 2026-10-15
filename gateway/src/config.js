/**
 * Configuración del gateway: todo por entorno, nada hardcodeado.
 *
 * `cargarConfig(env)` es puro a propósito: los tests le pasan un objeto y no
 * dependen de lo que haya en el `process.env` de la máquina. `config` es la
 * instancia que usa el proceso real.
 *
 * La validación NO corre al importar el módulo: corre en `validarConfig()`,
 * que llama `index.js` al arrancar. Así los tests importan sin necesitar
 * secretos de Meta.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** Raíz del repo (gateway/src → gateway → repo). De acá cuelga `agente/`. */
export const RAIZ_REPO = path.resolve(AQUI, '..', '..');
export const RAIZ_GATEWAY = path.resolve(AQUI, '..');

const MODELO_DEFAULT = 'claude-haiku-4-5-20251001';

function leerAlias(texto) {
  if (!texto) return {};
  try {
    const valor = JSON.parse(texto);
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  } catch {
    return {};
  }
}

export function cargarConfig(env = process.env) {
  const sesionesDir = path.resolve(env.SESIONES_DIR || path.join(RAIZ_GATEWAY, 'data', 'sesiones'));

  return {
    puerto: Number(env.PORT || 8090),
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',

    // `development` habilita el arranque degradado (ver `faltantesDeConfig`).
    // El default NO es development a propósito: un deploy que se olvide de
    // setear APP_ENV tiene que fallar ruidoso, no arrancar a medias.
    entorno: String(env.APP_ENV || env.NODE_ENV || 'production').toLowerCase(),

    // Meta
    metaAppSecret: env.META_APP_SECRET || '',
    metaVerifyToken: env.META_VERIFY_TOKEN || '',
    metaGraphToken: env.META_GRAPH_TOKEN || '',
    graphUrl: env.GRAPH_URL || 'https://graph.facebook.com/v21.0',
    // JSON {"549…": "54…15…"}: sólo para la lista de prueba de Meta (ver outbox.js).
    waDestinoAlias: leerAlias(env.WA_DESTINO_ALIAS),

    // Core y agente
    coreUrl: env.CORE_URL || 'http://localhost:8080',
    tenantsPath: path.resolve(env.TENANTS_PATH || path.join(RAIZ_GATEWAY, 'tenants.json')),
    sesionesDir,
    // El borrador y el hold del agente, espejados entre procesos MCP (uno por
    // mensaje). Por defecto, subdirectorio de `sesionesDir`: en Docker ESE es
    // el volumen `gwsesiones`, así que sobrevive a un restart del contenedor
    // sin pedir un volumen nuevo.
    borradoresDir: path.resolve(env.BORRADORES_DIR || path.join(sesionesDir, 'borradores')),
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    // Alternativa a la API key: un gateway compatible con la API de Anthropic
    // (por ejemplo OpenRouter). El SDK del agente lee estas dos variables del
    // entorno del proceso; acá sólo se validan.
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL || '',
    anthropicAuthToken: env.ANTHROPIC_AUTH_TOKEN || '',
    modelo: env.MODELO || MODELO_DEFAULT,

    // Raíz del repo: de ahí sale `agente/` (server MCP y skills).
    raizRepo: path.resolve(env.RAIZ_REPO || RAIZ_REPO),
  };
}

/**
 * Qué credenciales faltan, por nombre de variable. Vacío = está todo.
 *
 * Existe separado de `validarConfig` porque en desarrollo el gateway tiene que
 * poder levantar sin las credenciales de Meta ni la API key: el compose de dev
 * no las tiene y el sistema igual se prueba de punta a punta. Lo que NO cambia
 * es la seguridad — sin META_APP_SECRET `firmaValida()` devuelve false y el
 * webhook contesta 401 a todo el mundo, que es exactamente lo que corresponde.
 */
export function faltantesDeConfig(cfg) {
  const faltan = [];
  if (!cfg.metaAppSecret) faltan.push('META_APP_SECRET');
  if (!cfg.metaVerifyToken) faltan.push('META_VERIFY_TOKEN');
  if (!cfg.metaGraphToken) faltan.push('META_GRAPH_TOKEN');
  const viaGateway = Boolean(cfg.anthropicBaseUrl && cfg.anthropicAuthToken);
  if (!cfg.anthropicApiKey && !viaGateway) {
    faltan.push('ANTHROPIC_API_KEY o ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN');
  }
  return faltan;
}

/**
 * Falla temprano y con nombre propio. Un gateway sin META_APP_SECRET no puede
 * verificar firmas: arrancarlo en producción sería aceptar webhooks de
 * cualquiera.
 */
export function validarConfig(cfg) {
  const faltan = faltantesDeConfig(cfg);
  if (faltan.length) {
    throw new Error(
      'Faltan variables de entorno obligatorias: ' + faltan.join(', ') +
      '. Mirá gateway/env.example.',
    );
  }
  return cfg;
}

export const config = cargarConfig();
