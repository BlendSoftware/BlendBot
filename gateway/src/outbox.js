/**
 * Outbox: todo lo que sale hacia WhatsApp pasa por acá.
 *
 * Patrón de wa-claude/src/outbox.js, con el mismo motivo: allá, cuando el
 * envío agotaba sus intentos, el mensaje se PERDÍA para siempre — briefs
 * enteros que nunca llegaron y sólo aparecían en el log como "AGOTADOS". Acá
 * el mensaje vive en una lista de redis, no en la memoria del proceso: un
 * restart, un deploy o un 500 de Graph no se comen la respuesta.
 *
 * Diferencias con wa-claude:
 *  - la cola es de redis y está particionada por `phone_number_id`, así un
 *    comercio con Graph enojado no le tapa la salida a los otros
 *  - los que agotan reintentos caen en `outbox:muertos` (DLQ) en vez de al log
 *  - el envío es una función inyectable: los tests no tocan la red
 */

const MAX_INTENTOS = 3;
const BASE_BACKOFF_MS = 1000;
const IDIOMA_PLANTILLA = 'es_AR';

export const COLA_MUERTOS = 'outbox:muertos';

export function colaDe(phoneNumberId) {
  return `outbox:${phoneNumberId}`;
}

/** Arma el body de Graph para un mensaje del outbox. Exportado para tests. */
export function cuerpoGraph(mensaje) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: mensaje.telefono };

  if (mensaje.tipo === 'plantilla') {
    return {
      ...base,
      type: 'template',
      template: {
        name: mensaje.plantilla,
        language: { code: mensaje.idioma || IDIOMA_PLANTILLA },
        components: parametros(mensaje.variables),
      },
    };
  }

  return { ...base, type: 'text', text: { preview_url: false, body: mensaje.texto } };
}

/**
 * Las plantillas de WhatsApp toman parámetros POSICIONALES ({{1}}, {{2}}...).
 * El core encola un objeto `{nombre, fecha_hora_local, negocio}`: el orden que
 * vale es el de las claves del JSON, que es el orden de inserción. Si alguna
 * vez importa más, mandá un array y listo.
 */
function parametros(variables) {
  if (!variables) return [];
  const valores = Array.isArray(variables) ? variables : Object.values(variables);
  if (!valores.length) return [];
  return [{
    type: 'body',
    parameters: valores.map((v) => ({ type: 'text', text: String(v) })),
  }];
}

/** Envío real contra la Graph API. Es el default; en tests se inyecta otro. */
export function enviarPorGraph(config, fetchFn = fetch) {
  return async function enviar(mensaje) {
    const url = `${config.graphUrl}/${mensaje.phone_number_id}/messages`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metaGraphToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpoGraph(mensaje)),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      const err = new Error(`Graph ${res.status}: ${detalle.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json().catch(() => ({}));
  };
}

/**
 * @param {object} opts
 * @param {object} opts.redis  cliente redis (o el fake de los tests)
 * @param {(mensaje: object) => Promise<any>} opts.enviar  inyectable
 * @param {() => string[]} [opts.colas]  qué colas escucha el worker
 * @param {number} [opts.maxIntentos]
 * @param {(fn: Function, ms: number) => any} [opts.programar]  setTimeout inyectable
 */
export function crearOutbox({
  redis,
  // BRPOP bloquea la conexión entera: el worker necesita la suya, o el SETNX
  // de idempotencia del webhook se queda esperando detrás de un brPop de 1s.
  redisBloqueante = redis,
  enviar,
  colas = () => [],
  maxIntentos = MAX_INTENTOS,
  baseBackoffMs = BASE_BACKOFF_MS,
  programar = setTimeout,
} = {}) {
  let corriendo = false;
  let bucle = null;

  function backoff(intentos) {
    return baseBackoffMs * Math.pow(2, Math.max(0, intentos - 1));
  }

  /** Encola un saliente. `tipo` es 'texto' o 'plantilla'. */
  async function encolar(mensaje) {
    if (!mensaje?.phone_number_id || !mensaje?.telefono) {
      throw new Error('outbox: falta phone_number_id o telefono');
    }
    const tipo = mensaje.tipo || 'texto';
    if (tipo === 'texto' && !mensaje.texto?.trim()) {
      // Un texto vacío es un bug nuestro, no un mensaje. Que no llegue a Meta.
      console.warn('[outbox] descarto texto vacío para %s', mensaje.telefono);
      return null;
    }
    if (tipo === 'plantilla' && !mensaje.plantilla) {
      throw new Error('outbox: mensaje de plantilla sin nombre de plantilla');
    }

    const item = {
      id: mensaje.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      phone_number_id: String(mensaje.phone_number_id),
      telefono: String(mensaje.telefono),
      tipo,
      texto: mensaje.texto,
      plantilla: mensaje.plantilla,
      variables: mensaje.variables,
      idioma: mensaje.idioma,
      negocio_id: mensaje.negocio_id,
      creado_en: mensaje.creado_en || new Date().toISOString(),
      intentos: mensaje.intentos || 0,
    };
    await redis.lPush(colaDe(item.phone_number_id), JSON.stringify(item));
    return item;
  }

  /**
   * Un intento de entrega. Si falla, reprograma o manda a la DLQ.
   * Nunca tira: el worker no se puede caer por un mensaje.
   * @returns {Promise<'entregado'|'reintenta'|'muerto'>}
   */
  async function entregar(item) {
    try {
      await enviar(item);
      return 'entregado';
    } catch (err) {
      const intentos = (item.intentos || 0) + 1;
      const siguiente = { ...item, intentos, ultimo_error: String(err?.message || err).slice(0, 300) };

      if (intentos >= maxIntentos) {
        await redis.lPush(COLA_MUERTOS, JSON.stringify(siguiente));
        console.error(
          '[outbox] MUERTO tras %d intentos → %s (%s a %s): %s',
          intentos, COLA_MUERTOS, item.tipo, item.telefono, siguiente.ultimo_error,
        );
        return 'muerto';
      }

      const espera = backoff(intentos);
      console.warn(
        '[outbox] intento %d/%d falló para %s (%s) — reintento en %dms',
        intentos, maxIntentos, item.telefono, siguiente.ultimo_error, espera,
      );
      // rPush: vuelve al frente de la cola (se consume con brPop del extremo
      // derecho), así el reintento no espera detrás de todo lo que entró después.
      programar(() => {
        redis.rPush(colaDe(item.phone_number_id), JSON.stringify(siguiente))
          .catch((e) => console.error('[outbox] no pude reencolar: %s', e.message));
      }, espera);
      return 'reintenta';
    }
  }

  /** Un ciclo del worker: espera un mensaje y lo entrega. Para tests. */
  async function tick(timeoutSeg = 1) {
    const claves = colas();
    if (!claves.length) return null;
    const res = await redisBloqueante.brPop(claves, timeoutSeg);
    if (!res) return null;
    let item;
    try {
      item = JSON.parse(res.element ?? res[1]);
    } catch (err) {
      console.error('[outbox] mensaje ilegible descartado: %s', err.message);
      return null;
    }
    return { item, resultado: await entregar(item) };
  }

  function arrancar() {
    if (corriendo) return;
    corriendo = true;
    bucle = (async () => {
      while (corriendo) {
        try {
          await tick();
        } catch (err) {
          if (!corriendo) break;
          console.error('[outbox] error en el worker: %s', err.message);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    })();
  }

  async function detener() {
    corriendo = false;
    await bucle?.catch(() => {});
    bucle = null;
  }

  return { encolar, entregar, tick, arrancar, detener, colaDe, COLA_MUERTOS };
}
