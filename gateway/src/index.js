/**
 * Arranque del gateway.
 *
 * El detalle que arruina la tarde si se hace mal: **el body crudo**. La firma
 * de Meta se calcula sobre los bytes exactos que mandó Meta. Si el body se
 * parsea con `express.json()` y después se reserializa para verificar, la
 * firma no cierra NUNCA (orden de claves, espacios, escapes unicode). Por eso
 * acá se recibe como Buffer con `express.raw` y el JSON se parsea a mano
 * DESPUÉS de guardarnos el crudo.
 */

import process from 'node:process';
import express from 'express';
import { createClient } from 'redis';

import { config, validarConfig } from './config.js';
import { cargarTenants } from './tenants.js';
import { crearSesiones } from './sesiones.js';
import { crearAgente } from './agente.js';
import { crearOutbox, enviarPorGraph } from './outbox.js';
import { crearSalidas } from './salidas.js';
import { crearRouter } from './webhook.js';

export const RUTA_WEBHOOK = '/webhook/whatsapp';

/** App de express lista para montar o para supertest. */
export function crearApp({ config: cfg, tenants, redis, agente, outbox, diferir }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/salud', (_req, res) => res.json({ ok: true, tenants: tenants.cantidad }));

  app.use(
    RUTA_WEBHOOK,
    express.raw({ type: () => true, limit: '1mb' }),
    (req, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
        try {
          req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString('utf8')) : {};
        } catch {
          // Body no-JSON: si además la firma es válida, el lote sale vacío y
          // no pasa nada. Si no lo es, el 401 lo corta igual.
          req.body = {};
        }
      }
      next();
    },
    crearRouter({ config: cfg, tenants, redis, agente, outbox, diferir }),
  );

  return app;
}

async function main() {
  validarConfig(config);

  const tenants = cargarTenants(config.tenantsPath);
  console.log('[gateway] %d tenant(s) cargados desde %s', tenants.cantidad, config.tenantsPath);

  const redis = createClient({ url: config.redisUrl });
  redis.on('error', (err) => console.error('[redis] %s', err.message));
  await redis.connect();
  // Dos conexiones más: cada BRPOP se come la suya mientras espera.
  const redisOutbox = redis.duplicate();
  const redisSalidas = redis.duplicate();
  redisOutbox.on('error', (err) => console.error('[redis:outbox] %s', err.message));
  redisSalidas.on('error', (err) => console.error('[redis:salidas] %s', err.message));
  await redisOutbox.connect();
  await redisSalidas.connect();

  const sesiones = crearSesiones({ dir: config.sesionesDir });
  const agente = crearAgente({ config, sesiones });

  const outbox = crearOutbox({
    redis,
    redisBloqueante: redisOutbox,
    enviar: enviarPorGraph(config),
    colas: () => tenants.phoneIds().map((id) => `outbox:${id}`),
  });
  const salidas = crearSalidas({ redis, redisBloqueante: redisSalidas, outbox, tenants });

  outbox.arrancar();
  salidas.arrancar();

  // Las sesiones vencidas no se limpian solas si nadie vuelve a escribir.
  const purga = setInterval(() => {
    const n = sesiones.purgar();
    if (n) console.log('[sesiones] purgadas %d sesiones vencidas', n);
  }, 60 * 60 * 1000);
  purga.unref();

  const app = crearApp({ config, tenants, redis, agente, outbox });
  const server = app.listen(config.puerto, () => {
    console.log('[gateway] escuchando en :%d — webhook en %s', config.puerto, RUTA_WEBHOOK);
  });

  let cerrando = false;
  async function apagar(senal) {
    if (cerrando) return;
    cerrando = true;
    console.log('[gateway] %s — cerrando', senal);
    clearInterval(purga);
    server.close();
    await outbox.detener();
    await salidas.detener();
    // Lo que quedó encolado sigue en redis: se entrega cuando volvamos.
    await Promise.allSettled([redisOutbox.quit(), redisSalidas.quit(), redis.quit()]);
    process.exit(0);
  }
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
}

const esEntrada = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (esEntrada) {
  main().catch((err) => {
    console.error('[gateway] no pude arrancar: %s', err?.stack || err);
    process.exit(1);
  });
}
