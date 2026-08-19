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

export function cargarConfig(env = process.env) {
  return {
    puerto: Number(env.PORT || 8090),
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',

    // Meta
    metaAppSecret: env.META_APP_SECRET || '',
    metaVerifyToken: env.META_VERIFY_TOKEN || '',
    metaGraphToken: env.META_GRAPH_TOKEN || '',
    graphUrl: env.GRAPH_URL || 'https://graph.facebook.com/v21.0',

    // Core y agente
    coreUrl: env.CORE_URL || 'http://localhost:8080',
    tenantsPath: path.resolve(env.TENANTS_PATH || path.join(RAIZ_GATEWAY, 'tenants.json')),
    sesionesDir: path.resolve(env.SESIONES_DIR || path.join(RAIZ_GATEWAY, 'data', 'sesiones')),
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    modelo: env.MODELO || MODELO_DEFAULT,

    // Raíz del repo: de ahí sale `agente/` (server MCP y skills).
    raizRepo: path.resolve(env.RAIZ_REPO || RAIZ_REPO),
  };
}

/**
 * Falla temprano y con nombre propio. Un gateway sin META_APP_SECRET no puede
 * verificar firmas: arrancarlo sería aceptar webhooks de cualquiera.
 */
export function validarConfig(cfg) {
  const faltan = [];
  if (!cfg.metaAppSecret) faltan.push('META_APP_SECRET');
  if (!cfg.metaVerifyToken) faltan.push('META_VERIFY_TOKEN');
  if (!cfg.metaGraphToken) faltan.push('META_GRAPH_TOKEN');
  if (!cfg.anthropicApiKey) faltan.push('ANTHROPIC_API_KEY');
  if (faltan.length) {
    throw new Error(
      'Faltan variables de entorno obligatorias: ' + faltan.join(', ') +
      '. Mirá gateway/env.example.',
    );
  }
  return cfg;
}

export const config = cargarConfig();
