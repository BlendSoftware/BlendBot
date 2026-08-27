/**
 * El gateway del arnés, levantado EN PROCESO desde `gateway/src`.
 *
 * No es una copia del gateway ni una versión de prueba: es el mismo código que
 * corre en producción, armado con las costuras que `gateway/src` ya expone y
 * documenta como inyectables (`crearApp`, `crearAgente({queryFn})`,
 * `tenantsDeObjeto`, `diferir`). Por eso este archivo no tiene un solo `if`
 * de testing: todo lo que hace es pasar dependencias distintas.
 *
 * Por qué en proceso y no el contenedor del compose (design §3) — tres cosas
 * que acá salen gratis y allá son imposibles:
 *
 *  1. **El token del agente se rota por corrida.** `POST /api/admin/negocios/
 *     :id/token-agente` no deja elegir el token, así que con el contenedor
 *     habría que escribir `tenants.json` y hacer `up -d --force-recreate
 *     gateway` en cada corrida: lento, racy, y con una ventana en la que el
 *     gateway viejo sigue comiendo de la cola. Acá el tenant se arma en
 *     memoria con `tenantsDeObjeto` y listo.
 *  2. **`queryFn` observado.** Es lo único que permite ver qué tools llamó el
 *     bot (el nivel 2 de aserciones). Por el contenedor habría que agregarle
 *     al gateway un `TRANSCRIPT_DIR`, o sea código de prueba en producción.
 *  3. **`diferir` inyectable.** Ver `crearDiferir` acá abajo: es lo que
 *     convierte "esperá un rato y fijate" en "esperá a que termine".
 *
 * Lo que se pierde y se acepta: esto NO prueba `gateway/Dockerfile` ni las env
 * del compose. Es el mismo JavaScript; el contenedor lo cubre el smoke con
 * `/salud`.
 *
 * Ojo con el `GRAPH_URL`: `gateway/src/config.js` lo lee pero el
 * `docker-compose.yml` no lo pasa. No es un bug hoy (sólo importa para
 * testing) y este camino lo esquiva sin tocar el compose, que es justamente
 * por qué es el camino que se toma.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { entorno, RAIZ } from './entorno.js';
import { urlDeRedisDelHost } from './compose.js';
import { cargarConfig } from '../gateway/src/config.js';
import { tenantsDeObjeto } from '../gateway/src/tenants.js';
import { crearSesiones } from '../gateway/src/sesiones.js';
import { crearAgente } from '../gateway/src/agente.js';
import { crearOutbox, enviarPorGraph } from '../gateway/src/outbox.js';
import { crearSalidas } from '../gateway/src/salidas.js';
import { crearApp, RUTA_WEBHOOK } from '../gateway/src/index.js';

export { RUTA_WEBHOOK };

/**
 * `redis` se resuelve **desde `gateway/`**, no desde `arnes/`.
 *
 * Dos motivos, y el segundo es el que importa:
 *  1. `arnes/package.json` no declara `redis`: es una dependencia del gateway,
 *     y el arnés no duplica lo que el componente ya trae (el resto —`express`,
 *     el SDK— resuelve solo, porque lo importa código que vive adentro de
 *     `gateway/src`; este es el único que importa el arnés directo).
 *  2. Si el arnés instalara su propia copia, podría quedar en otra versión que
 *     la del gateway. El cliente que se le pasa a `crearApp` tiene que ser
 *     exactamente el que el gateway espera: probar contra otro cliente de
 *     redis es probar otra cosa.
 */
const requerirDelGateway = createRequire(path.join(RAIZ, 'gateway', 'package.json'));
const { createClient } = requerirDelGateway('redis');

/**
 * La costura que le saca el fantasma de concurrencia al arnés entero.
 *
 * El webhook contesta 200 **antes** de procesar (Meta reintenta si tardás) y
 * el trabajo real se agenda con `diferir`, que en producción es
 * `setImmediate`: dispara y se olvida. Un arnés contra eso sólo puede hacer
 * polling con timeout — y ahí empieza la intermitencia: el assert corre a
 * veces antes y a veces después de que el bot terminó, y la falla no dice
 * nada.
 *
 * `crearRouter` lo deja escrito en su propio comentario: *"la función devuelve
 * la promesa a propósito: `setImmediate` la ignora, pero los tests inyectan un
 * `diferir` que la junta y la espera"*. Esto es ese `diferir`.
 *
 * **Qué cubre y qué no**: cubre hasta que el mensaje quedó ENCOLADO en el
 * outbox (agente respondió → `outbox.encolar`). NO cubre la entrega al Graph,
 * que la hace el worker en su propio bucle. Para eso está el "esperar el
 * próximo mensaje" del Graph falso, que también es una promesa y no un
 * polling. Entre las dos, el arnés nunca adivina.
 */
export function crearDiferir() {
  /** @type {Set<Promise<void>>} */
  const pendientes = new Set();
  /** @type {Error[]} Lo que explotó adentro del procesamiento asincrónico. */
  const errores = [];

  function diferir(fn) {
    let resultado;
    try {
      resultado = fn();
    } catch (err) {
      // Explotó sincrónicamente: no hay promesa que juntar, pero el error no
      // se puede perder — sin esto el arnés vería "el cliente no recibió nada"
      // y buscaría el bug en el bot.
      errores.push(err);
      return;
    }
    const trabajo = Promise.resolve(resultado).catch((err) => { errores.push(err); });
    pendientes.add(trabajo);
    trabajo.finally(() => pendientes.delete(trabajo));
  }

  /**
   * Espera a que no quede trabajo asincrónico en vuelo.
   *
   * El `while` no es por las dudas: un lote de Meta puede traer dos mensajes y
   * el procesamiento de uno puede encolar más trabajo. Se drena hasta vaciar.
   */
  async function esperar() {
    while (pendientes.size) {
      await Promise.all([...pendientes]);
    }
    if (errores.length) {
      const primero = errores.shift();
      const extra = errores.length ? ` (y ${errores.length} más)` : '';
      errores.length = 0;
      const err = new Error(
        `el procesamiento asincrónico del webhook explotó${extra}: ${primero?.message || primero}`,
      );
      err.cause = primero;
      throw err;
    }
  }

  return {
    diferir,
    esperar,
    get enVuelo() { return pendientes.size; },
  };
}

/**
 * Levanta el gateway del arnés y devuelve todo lo que la corrida necesita.
 *
 * El tenant se pasa entero (`corrida.tenant()` de `aislamiento.js`) porque esa
 * es la forma que come `tenantsDeObjeto`, y así el arnés no vuelve a armar a
 * mano una estructura que ya sabe armar quien creó el negocio.
 *
 * @param {object} opts
 * @param {object} opts.tenant          `{ "<phone_number_id>": { negocio, agente_token, vertical } }`
 * @param {string} opts.graphUrl        base del Graph falso (sin barra final)
 * @param {Function} opts.queryFn       el bot: `observar(queryReal)` o el de mentira
 * @param {string} [opts.redisUrl]      el redis del compose, publicado en el host
 * @param {string} [opts.coreUrl]       el core del compose
 * @param {string} [opts.modelo]        default: el mismo que producción
 * @param {number} [opts.puerto]        0 = efímero, que es lo que se quiere
 * @param {string} [opts.sesionesDir]   default: un temp por corrida
 */
export async function levantarGateway({
  tenant,
  graphUrl,
  queryFn,
  // `null` = se le pregunta al compose en qué puerto publicó redis. Ver
  // `urlDeRedisDelHost`: acá NO se hardcodea el 6379, porque un
  // `docker-compose.override.yml` local puede haberlo movido y el síntoma sería
  // "el cliente nunca recibió nada" con todo lo demás en verde.
  redisUrl = null,
  coreUrl = entorno().coreUrl,
  // Vacío = el default de `gateway/src/config.js`, que es el mismo que corre en
  // producción. El arnés NO define un modelo propio: probar con otro cerebro
  // invalida el veredicto entero (design §2 del spec, tarea 9.2).
  modelo = entorno().modelo || undefined,
  puerto = 0,
  sesionesDir = null,
}) {
  faltante('graphUrl', graphUrl);
  const phoneIds = Object.keys(tenant || {});
  if (phoneIds.length !== 1) {
    throw new Error(
      'levantarGateway: `tenant` tiene que traer exactamente un phone_number_id ' +
      `(llegaron ${phoneIds.length}). Se espera \`corrida.tenant()\` de aislamiento.js.`,
    );
  }
  const waPhoneId = phoneIds[0];
  if (typeof queryFn !== 'function') {
    throw new Error(
      'levantarGateway: falta `queryFn`. El bot NUNCA se simula (design §1): ' +
      'acá va `observar(queryReal)`, o el de mentira sólo en la puerta del grupo 1.',
    );
  }

  // El secreto de firma es del arnés y de nadie más: con esto `firmar()` arma
  // webhooks que este gateway acepta, sin depender de qué META_APP_SECRET
  // tenga el `.env` de la máquina (en desarrollo está vacío, y con el vacío
  // `firmaValida()` rechaza todo con 401 — correcto, y fatal para el arnés).
  const secreto = crypto.randomBytes(32).toString('hex');

  // Sesiones en un temp propio: si dos corridas compartieran el archivo, la
  // segunda "reanudaría" la conversación de la primera y el bot arrancaría
  // sabiendo cosas que en este escenario nadie le dijo.
  const dirSesiones = sesionesDir
    || fs.mkdtempSync(path.join(os.tmpdir(), 'arnes-sesiones-'));

  const urlRedis = redisUrl || await urlDeRedisDelHost({ registrar: (m) => console.log(m) });

  // Se arma con `cargarConfig` y no a mano: así el arnés recorre exactamente
  // la misma normalización de entorno que el gateway real (defaults incluidos,
  // `modelo` sobre todo).
  const config = cargarConfig({
    PORT: String(puerto),
    APP_ENV: 'development',
    REDIS_URL: urlRedis,
    CORE_URL: coreUrl,
    GRAPH_URL: graphUrl,
    SESIONES_DIR: dirSesiones,
    // Las cuatro credenciales van con valor para que `/salud` no reporte
    // `degradado`: acá ninguna está "faltando", están puestas por el arnés.
    META_APP_SECRET: secreto,
    META_VERIFY_TOKEN: `arnes-verify-${waPhoneId}`,
    META_GRAPH_TOKEN: `arnes-graph-token-${waPhoneId}`,
    ANTHROPIC_API_KEY: entorno().anthropicApiKey || 'arnes-sin-api-key',
    ...(modelo ? { MODELO: modelo } : {}),
  });

  // Sin archivo `tenants.json` y sin reiniciar contenedores: el mapa
  // phone_number_id → negocio vive en memoria y muere con la corrida. Es el
  // mismo `cargarTenants` que en producción, así que si el token no arranca con
  // `cop_` esto tira acá y no tres minutos después.
  const tenants = tenantsDeObjeto(tenant);

  // Tres conexiones, igual que `index.js`: cada BRPOP se come la suya mientras
  // espera, y si el SETNX de idempotencia queda atrás de un brPop de 1s el
  // webhook se vuelve lento sin razón.
  const redis = createClient({ url: config.redisUrl });
  redis.on('error', (err) => console.error('[arnes:redis] %s', err.message));
  await redis.connect();
  const redisOutbox = redis.duplicate();
  const redisSalidas = redis.duplicate();
  redisOutbox.on('error', (err) => console.error('[arnes:redis:outbox] %s', err.message));
  redisSalidas.on('error', (err) => console.error('[arnes:redis:salidas] %s', err.message));
  await redisOutbox.connect();
  await redisSalidas.connect();

  const sesiones = crearSesiones({ dir: config.sesionesDir });
  const agente = crearAgente({ config, sesiones, queryFn });

  const outbox = crearOutbox({
    redis,
    redisBloqueante: redisOutbox,
    enviar: enviarPorGraph(config), // el envío real, apuntado al Graph falso
    // Sólo la cola de ESTA corrida: `outbox:<phoneId>` está particionada por
    // teléfono, así que acá no hay colisión con nadie. La que sí colisiona es
    // `salidas_whatsapp`, y por eso el gateway del compose se para (compose.js).
    colas: () => tenants.phoneIds().map((id) => `outbox:${id}`),
  });
  const salidas = crearSalidas({ redis, redisBloqueante: redisSalidas, outbox, tenants });

  outbox.arrancar();
  salidas.arrancar();

  const reloj = crearDiferir();
  const app = crearApp({ config, tenants, redis, agente, outbox, diferir: reloj.diferir });

  const server = await escuchar(app, puerto);
  const puertoReal = server.address().port;
  const url = `http://127.0.0.1:${puertoReal}`;

  let cerrado = false;
  async function cerrar() {
    if (cerrado) return;
    cerrado = true;
    await new Promise((listo) => server.close(listo));
    await outbox.detener();
    await salidas.detener();
    await Promise.allSettled([redisOutbox.quit(), redisSalidas.quit(), redis.quit()]);
    // El temp de sesiones no es evidencia de nada (son resume-id opacos) y sí
    // es basura acumulada en /tmp. Si lo trajo el que llama, es de él.
    if (!sesionesDir) fs.rmSync(dirSesiones, { recursive: true, force: true });
  }

  return {
    url,
    puerto: puertoReal,
    rutaWebhook: RUTA_WEBHOOK,
    /** El secreto con el que hay que firmar para que este gateway acepte. */
    secreto,
    waPhoneId,
    config,
    tenants,
    sesiones,
    outbox,
    salidas,
    /** Espera a que termine el procesamiento asincrónico del webhook. */
    esperar: reloj.esperar,
    get enVuelo() { return reloj.enVuelo; },
    cerrar,
  };
}

function faltante(nombre, valor) {
  if (!valor) throw new Error(`levantarGateway: falta \`${nombre}\``);
}

function escuchar(app, puerto) {
  return new Promise((listo, fallo) => {
    const server = app.listen(puerto, '127.0.0.1', () => listo(server));
    server.on('error', fallo);
  });
}
