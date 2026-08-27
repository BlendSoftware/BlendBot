/**
 * El gateway del compose se **para** mientras corre el arnés. Y se vuelve a
 * levantar siempre, aunque la corrida explote.
 *
 * ── POR QUÉ (design §4) ──────────────────────────────────────────────────────
 * El worker de salidas hace `BRPOP salidas_whatsapp`. Esa cola es UNA sola para
 * todo el sistema: el core hace `LPUSH` ahí cuando el dueño confirma un pedido
 * desde el panel, y de ahí sale el aviso al cliente — que es, textual en
 * `docs/FLUJOS.md`, *"la mitad del valor"* del producto.
 *
 * Si el gateway del compose y el del arnés están vivos a la vez, **los dos
 * hacen BRPOP sobre la misma cola y se roban los mensajes entre sí**. El que
 * llega primero se lo lleva; el otro se queda esperando. Como el gateway del
 * compose no conoce el `wa_phone_id` de la corrida, cuando le toca a él el
 * aviso se descarta con un `tenant_desconocido` en un log que nadie mira.
 *
 * El síntoma sería: *"el cliente nunca recibió la confirmación"*, **una de cada
 * dos veces**. Y se buscaría en el bot, en el panel o en el core — nunca acá.
 * Por eso esto no es un detalle de implementación: es el bug que este arnés
 * generaría si no se decidiera ahora.
 *
 * Lo que NO colisiona: `outbox:<phone_number_id>` está particionada por
 * teléfono, así que cada gateway come de la suya. La única cola compartida es
 * `salidas_whatsapp`.
 *
 * La solución limpia y definitiva es particionar esa cola por
 * `phone_number_id`, pero eso toca `core/internal/worker/cola.go` y este cambio
 * no toca el core. Queda anotado como mejora propia, no como requisito.
 *
 * ── Riesgo asumido ───────────────────────────────────────────────────────────
 * Un `kill -9` al proceso del arnés deja el gateway del compose parado: ninguna
 * señal se puede atrapar. Por eso al arrancar se **dice fuerte** que se paró y
 * con qué comando se restaura a mano.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { leerEnv } from './entorno.js';

const ejecutar = promisify(execFile);

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** Raíz del repo: de acá cuelgan el `docker-compose.yml` y el override. */
export const RAIZ_REPO = path.resolve(AQUI, '..');

export const SERVICIO = 'gateway';
export const COMANDO_RESTAURAR = `docker compose -f ${path.join(RAIZ_REPO, 'docker-compose.yml')} start ${SERVICIO}`;

async function compose(args, { timeoutMs = 60_000 } = {}) {
  try {
    return await ejecutar('docker', ['compose', ...args], { cwd: RAIZ_REPO, timeout: timeoutMs });
  } catch (err) {
    const detalle = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new Error(`\`docker compose ${args.join(' ')}\` falló: ${detalle.slice(0, 400)}`);
  }
}

/**
 * `--format json` devuelve un objeto por línea en unas versiones de compose y
 * un array en otras. Se aceptan las dos: acá no se pelea con el formato.
 */
function parsearPs(salida) {
  const texto = String(salida || '').trim();
  if (!texto) return [];
  try {
    const uno = JSON.parse(texto);
    return Array.isArray(uno) ? uno : [uno];
  } catch {
    return texto.split('\n').flatMap((linea) => {
      try { return [JSON.parse(linea)]; } catch { return []; }
    });
  }
}

/**
 * @returns {Promise<'corriendo'|'parado'|'ausente'>}
 *   `ausente` = el servicio no está creado (nunca se hizo `up`).
 */
export async function estadoDelGateway() {
  // `--all`: sin esto, un contenedor parado no aparece y no se puede
  // distinguir "está parado" de "no existe".
  const { stdout } = await compose(['ps', '--all', '--format', 'json', SERVICIO]);
  const filas = parsearPs(stdout);
  if (!filas.length) return 'ausente';
  const estado = String(filas[0].State || filas[0].state || '').toLowerCase();
  return estado === 'running' ? 'corriendo' : 'parado';
}

/**
 * En qué `localhost:<puerto>` está publicado el redis del compose.
 *
 * **No se asume el 6379 y se pregunta.** Esta máquina es el ejemplo de por qué:
 * tiene un `docker-compose.override.yml` (local, gitignoreado) que publica el
 * redis en el **6380** porque otro proyecto ya ocupa el 6379. Un arnés que
 * hardcodea el 6379 acá se conecta a la nada, o —peor— al redis de OTRO
 * proyecto: la cola siempre vacía, el aviso al cliente que nunca llega, y el
 * bug buscado durante una hora en el outbox.
 *
 * Adentro de la red del compose los servicios siguen hablando por
 * `redis://redis:6379`, y ese hostname no resuelve desde la máquina: por eso el
 * `REDIS_URL` del compose NO sirve como valor para el arnés.
 *
 * Precedencia: `ARNES_REDIS_URL` explícito → lo que publica el compose → el
 * default de siempre, avisando.
 *
 * @returns {Promise<string>} una URL de redis usable desde el host, db 0 (la
 *   misma que usa el core: si el arnés mirara otra db, la cola estaría vacía).
 */
export async function urlDeRedisDelHost({ registrar = () => {} } = {}) {
  const explicita = leerEnv('ARNES_REDIS_URL', '');
  if (explicita) return explicita;

  try {
    // `docker compose port redis 6379` → "0.0.0.0:6380" (o "[::]:6380")
    const { stdout } = await compose(['port', 'redis', '6379'], { timeoutMs: 20_000 });
    const puerto = String(stdout).trim().split('\n')[0]?.split(':').pop()?.trim();
    if (puerto && /^\d+$/.test(puerto)) return `redis://localhost:${puerto}`;
  } catch (err) {
    registrar(`⚙️  no pude preguntarle al compose por el puerto de redis (${err.message})`);
  }

  registrar('⚙️  uso redis://localhost:6379 por defecto — si el compose lo publica en otro puerto, poné ARNES_REDIS_URL');
  return 'redis://localhost:6379';
}

/**
 * Para el gateway del compose si está arriba y devuelve cómo restaurarlo.
 *
 * No asume el estado de la máquina: mira, actúa y **lo dice**. Si ya estaba
 * parado, no lo levanta al terminar — la máquina queda como se la encontró.
 *
 * @param {{registrar?: (msg: string) => void}} [opts]
 * @returns {Promise<{estabaArriba: boolean, restaurar: () => Promise<void>}>}
 */
export async function pararGatewayDelCompose({ registrar = (m) => console.log(m) } = {}) {
  const antes = await estadoDelGateway();

  if (antes === 'ausente') {
    registrar('⚙️  el gateway del compose no está creado — no hay nada que parar');
    return { estabaArriba: false, restaurar: async () => {} };
  }
  if (antes === 'parado') {
    registrar('⚙️  el gateway del compose ya estaba parado — lo dejo como estaba');
    return { estabaArriba: false, restaurar: async () => {} };
  }

  registrar(
    '⚙️  PARANDO el gateway del compose: mientras corre el arnés hay dos ' +
    'candidatos a `BRPOP salidas_whatsapp` y se roban los avisos entre sí.',
  );
  await compose(['stop', SERVICIO]);
  registrar(`⚙️  gateway del compose parado. Si el arnés muere de un kill -9, restauralo con:\n    ${COMANDO_RESTAURAR}`);

  let restaurado = false;
  async function restaurar() {
    if (restaurado) return;
    restaurado = true;
    await compose(['start', SERVICIO]);
    registrar('⚙️  gateway del compose levantado de nuevo');
  }

  return { estabaArriba: true, restaurar };
}

/**
 * Corre `fn` con el gateway del compose parado y lo restaura **pase lo que
 * pase**: el `finally` cubre el error y el `return`, y las señales cubren el
 * Ctrl-C. Lo único que no se puede cubrir es `SIGKILL`, y por eso se avisa.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{registrar?: (msg: string) => void}} [opts]
 * @returns {Promise<T>}
 */
export async function conGatewayDelComposeParado(fn, { registrar } = {}) {
  const { restaurar } = await pararGatewayDelCompose({ registrar });

  const señales = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const alRecibirSeñal = (señal) => {
    // El handler no puede ser async y esperar: se hace lo posible y se sale
    // con el código que corresponde a esa señal.
    restaurar()
      .catch((err) => console.error(`⚙️  no pude restaurar el gateway: ${err.message}\n    ${COMANDO_RESTAURAR}`))
      .finally(() => process.exit(señal === 'SIGINT' ? 130 : 143));
  };
  for (const s of señales) process.on(s, alRecibirSeñal);

  try {
    return await fn();
  } finally {
    for (const s of señales) process.off(s, alRecibirSeñal);
    await restaurar().catch((err) => {
      // Que no se coma la falla original: se informa y se sigue tirando lo que
      // haya venido de adentro.
      console.error(`⚙️  no pude restaurar el gateway del compose: ${err.message}\n    ${COMANDO_RESTAURAR}`);
    });
  }
}
