/**
 * graph-falso.js — el teléfono del cliente.
 *
 * Un HTTP mínimo que imita `POST /<phone_number_id>/messages` de la Cloud API
 * de Meta: responde `{ messages: [{ id }] }` y **guarda el cuerpo**. Es el único
 * componente falso que el arnés se permite, porque es el único que no le
 * pertenece al proyecto (spec: "El Graph falso es el teléfono del cliente").
 *
 * Por acá salen las dos clases de mensaje que existen, y que sean **el mismo
 * agujero** es justamente lo que se prueba:
 *   1. la respuesta del bot         (webhook → agente → outbox → Graph)
 *   2. el aviso que dispara el dueño (panel → core → cola de salidas → worker
 *                                     → outbox → Graph)
 *
 * El arnés NUNCA da por entregado un mensaje leyéndolo de la base ni de la cola
 * de redis. Un mensaje encolado no es un mensaje recibido, y esa diferencia es
 * la mitad del valor del producto según `docs/FLUJOS.md`.
 *
 * Sin `express`: `node:http` alcanza y el arnés se queda con dos dependencias.
 */

import http from 'node:http';

/**
 * La respuesta feliz de Graph. Es el default.
 *
 * El envío es una **función inyectable** a propósito: el día que un escenario
 * necesite verificar que el outbox reintenta y que nada se pierde, se le pasa
 * una que devuelva 500 o 429 y no hay que reescribir una línea de acá
 * (design §5). Es una función, no una constante.
 *
 * @param {object} mensaje  el mensaje ya parseado
 * @returns {{status: number, cuerpo: object}}
 */
export function entregarOk(mensaje) {
  return {
    status: 200,
    cuerpo: {
      messaging_product: 'whatsapp',
      contacts: [{ input: mensaje.telefono, wa_id: mensaje.telefono }],
      messages: [{ id: mensaje.id }],
    },
  };
}

/** `POST /<phoneId>/messages`, con o sin el `/v21.0` adelante. */
const RUTA = /^\/(?:v\d+\.\d+\/)?([^/]+)\/messages\/?$/;

/**
 * @param {object} [opts]
 * @param {(mensaje: object) => {status: number, cuerpo: object}} [opts.entregar]
 *        cómo contesta el Graph falso. Cambiala para hacerlo fallar.
 * @param {() => number} [opts.ahora]  reloj inyectable (epoch ms)
 */
export function crearGraphFalso({ entregar = entregarOk, ahora = () => Date.now() } = {}) {
  /** Todo lo recibido, en orden de llegada. El índice es la identidad. */
  const recibidos = [];
  /** Quiénes están esperando un mensaje que todavía no llegó. */
  const esperando = new Set();
  let servidor = null;
  let contador = 0;
  let url = null;
  let puerto = null;

  function coincide(mensaje, filtro) {
    if (filtro.telefono && mensaje.telefono !== String(filtro.telefono)) return false;
    if (filtro.phoneNumberId && mensaje.phone_number_id !== String(filtro.phoneNumberId)) return false;
    return true;
  }

  function guardar(phoneNumberId, cuerpo) {
    // Se guarda el cuerpo crudo Y la lectura: el crudo es la evidencia (es lo
    // que Meta habría recibido) y la lectura es lo que asevera el escenario.
    const mensaje = {
      indice: recibidos.length,
      id: `wamid.arnes.${++contador}`,
      recibido_en: ahora(),
      phone_number_id: String(phoneNumberId),
      telefono: String(cuerpo?.to ?? ''),
      tipo: cuerpo?.type === 'template' ? 'plantilla' : 'texto',
      texto: cuerpo?.text?.body ?? null,
      plantilla: cuerpo?.template?.name ?? null,
      variables: (cuerpo?.template?.components?.[0]?.parameters ?? []).map((p) => p?.text),
      cuerpo,
    };
    recibidos.push(mensaje);

    for (const espera of [...esperando]) {
      if (coincide(mensaje, espera.filtro) && mensaje.indice >= espera.desde) {
        esperando.delete(espera);
        espera.resolver(mensaje);
      }
    }
    return mensaje;
  }

  const manejar = (req, res) => {
    const responder = (status, cuerpo) => {
      const json = JSON.stringify(cuerpo);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
      res.end(json);
    };

    const m = RUTA.exec(req.url || '');
    if (req.method !== 'POST' || !m) {
      // Un 404 que no explica nada acá se lee como "el bot no contestó". Que
      // diga qué ruta llegó ahorra la media hora de buscarlo en el gateway.
      return responder(404, {
        error: { message: `el Graph falso sólo atiende POST /<phone_number_id>/messages; llegó ${req.method} ${req.url}` },
      });
    }

    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('error', () => responder(400, { error: { message: 'se cortó el cuerpo del request' } }));
    req.on('end', () => {
      let cuerpo;
      try {
        cuerpo = JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}');
      } catch (err) {
        return responder(400, { error: { message: `cuerpo ilegible: ${err.message}` } });
      }
      const mensaje = guardar(m[1], cuerpo);
      const { status, cuerpo: respuesta } = entregar(mensaje);
      responder(status, respuesta);
    });
  };

  return {
    /** Levanta el servidor. Puerto 0 = uno libre, así dos corridas no se pisan. */
    async escuchar(puertoPedido = 0, host = '127.0.0.1') {
      servidor = http.createServer(manejar);
      await new Promise((resolver, rechazar) => {
        servidor.once('error', rechazar);
        servidor.listen(puertoPedido, host, resolver);
      });
      const dir = servidor.address();
      puerto = dir.port;
      // Esto es lo que se le pone al gateway como `graphUrl`.
      url = `http://${host}:${dir.port}`;
      return url;
    },

    /** La URL para `config.graphUrl` del gateway en proceso. */
    get url() { return url; },
    get puerto() { return puerto; },

    /** Todo lo que recibió el teléfono, opcionalmente filtrado. */
    recibidos(filtro = {}) {
      return recibidos.filter((m) => coincide(m, filtro));
    },

    /**
     * Espera el próximo mensaje para este teléfono.
     *
     * `desde` es el índice a partir del cual mirar: pasarle `anterior.indice + 1`
     * es lo que hace que dos esperas seguidas no devuelvan dos veces el mismo
     * mensaje — el fantasma clásico de un arnés que "pasa" leyendo lo de antes.
     *
     * Un timeout acá es **falla del producto**, no del arnés: el mensaje no
     * llegó. Por eso el error dice hasta dónde se llegó a ver.
     *
     * @param {{telefono?: string, phoneNumberId?: string, desde?: number, timeoutMs?: number}} opts
     * @returns {Promise<object>} el mensaje
     */
    esperarMensaje({ telefono, phoneNumberId, desde = 0, timeoutMs = 20000 } = {}) {
      const filtro = { telefono, phoneNumberId };
      const ya = recibidos.find((m) => m.indice >= desde && coincide(m, filtro));
      if (ya) return Promise.resolve(ya);

      return new Promise((resolver, rechazar) => {
        const espera = { filtro, desde, resolver: null, cancelar: null };
        const reloj = setTimeout(() => {
          esperando.delete(espera);
          const paraOtros = recibidos.length - recibidos.filter((m) => coincide(m, filtro)).length;
          rechazar(new Error(
            `el cliente ${telefono ?? '(cualquiera)'} no recibió ningún mensaje en ${timeoutMs}ms. ` +
            `Al Graph falso llegaron ${recibidos.length} mensajes en total` +
            (paraOtros ? ` (${paraOtros} para otros teléfonos)` : '') + '.',
          ));
        }, timeoutMs);
        espera.resolver = (mensaje) => { clearTimeout(reloj); resolver(mensaje); };
        espera.cancelar = (motivo) => { clearTimeout(reloj); rechazar(new Error(motivo)); };
        esperando.add(espera);
      });
    },

    /** Cuántos mensajes lleva recibidos. Es el `desde` de la próxima espera. */
    get cantidad() {
      return recibidos.length;
    },

    async cerrar() {
      // El que estaba esperando un mensaje se entera de que ya no va a llegar.
      // Sin esto, una corrida que se cierra a mitad de camino deja una promesa
      // colgada y el proceso no termina nunca.
      for (const espera of [...esperando]) {
        esperando.delete(espera);
        espera.cancelar('el Graph falso se cerró mientras se esperaba un mensaje');
      }
      if (!servidor) return;
      await new Promise((resolver) => servidor.close(resolver));
      servidor = null;
    },
  };
}
