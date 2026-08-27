/**
 * 👤 El cliente — modo `guion`.
 *
 * Escribe por la única puerta que tiene el producto: `POST /webhook/whatsapp`
 * con un payload con la forma real de Meta y una firma HMAC válida. No hay
 * atajo, no hay "llamar al agente directamente": si el arnés no entra por acá,
 * no está probando el gateway.
 *
 * En modo `guion` el texto es fijo, sacado literal de `docs/FLUJOS.md` —
 * incluida la tipeada `"te piedo una hhhamburguesa doble cheddar yunas paps"`,
 * que no es color: entender eso *es* la gracia del producto. El cliente es el
 * lado determinista de la conversación; el no-determinismo que queda es el del
 * modelo, y contra eso están los tres niveles de aserción (design §1 y §6).
 *
 * ── El fantasma que hay que conocer ──────────────────────────────────────────
 * El webhook tiene **idempotencia por `message.id`** con TTL de 24hs (SETNX en
 * redis). Un id repetido se descarta **en silencio**: 200, cero respuesta, cero
 * error. Si el arnés reusara el id, el síntoma sería "el bot no contestó el
 * turno 3" y se buscaría en el bot, en el modelo o en la cola — nunca acá. Por
 * eso cada mensaje lleva un id único y por eso `payloadDeTexto` obliga a
 * pasarlo. Repetir un id es una decisión que se toma a propósito (para probar
 * la idempotencia), nunca un descuido.
 */

import { firmar } from '../gateway/src/firma.js';

let contador = 0;

/**
 * Un `wamid` único. La forma es la de Meta (prefijo `wamid.` + base64) para
 * que nada del camino se comporte distinto por el formato del id.
 */
export function nuevoWamid() {
  contador += 1;
  const semilla = `arnes:${process.pid}:${Date.now()}:${contador}:${Math.random()}`;
  return `wamid.${Buffer.from(semilla).toString('base64')}`;
}

/**
 * El sobre completo que manda Meta para un mensaje de texto.
 *
 * El anidamiento es el real (`entry[].changes[].value.messages[]`) porque ahí
 * está la mitad de los bugs de un gateway, y porque `extraerEventos` lo
 * recorre entero: un payload "simplificado" probaría otro código.
 *
 * @param {object} p
 * @param {string} p.id               `message.id` — ÚNICO (ver arriba)
 * @param {string} p.texto
 * @param {string} p.telefono         el del cliente, sin `+`
 * @param {string} p.phoneNumberId    el de la corrida
 * @param {string} [p.nombre]         el perfil de WhatsApp
 * @param {string} [p.numeroNegocio]  `display_phone_number` del negocio
 * @param {number} [p.timestamp]      epoch en segundos
 */
export function payloadDeTexto({
  id,
  texto,
  telefono,
  phoneNumberId,
  nombre = null,
  numeroNegocio = null,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  if (!id) throw new Error('payloadDeTexto: falta `id` — sin id único el webhook lo descarta en silencio');

  const value = {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: numeroNegocio || `${phoneNumberId}`,
      phone_number_id: String(phoneNumberId),
    },
    // `contacts` es de dónde sale el nombre del perfil. Va aunque sea null
    // porque su ausencia también es un caso real y no queremos dos formas.
    contacts: [{ profile: { name: nombre }, wa_id: String(telefono) }],
    messages: [{
      from: String(telefono),
      id,
      timestamp: String(timestamp),
      type: 'text',
      text: { body: texto },
    }],
  };

  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ value, field: 'messages' }] }],
  };
}

/**
 * 👤 El actor cliente, atado a un gateway y a un teléfono.
 *
 * @param {object} opts
 * @param {object} opts.gateway   lo que devuelve `levantarGateway`
 * @param {string} opts.telefono  el teléfono de ESTA corrida (con su sufijo)
 * @param {string} [opts.nombre]
 * @param {string} [opts.numeroNegocio]
 */
export function crearCliente({ gateway, telefono, nombre = null, numeroNegocio = null }) {
  if (!gateway?.url) throw new Error('crearCliente: falta el gateway (levantarGateway)');
  if (!telefono) throw new Error('crearCliente: falta el teléfono del cliente');

  const url = `${gateway.url}${gateway.rutaWebhook}`;
  /** Lo que el cliente mandó, en orden. Lo lee la transcripción. */
  const dichos = [];

  /**
   * Manda un payload ya armado, firmado como lo firma Meta.
   *
   * El detalle que arruina la tarde: se firma **el body crudo**, byte por
   * byte, y se manda EXACTAMENTE esos bytes. Si se firmara el objeto y se
   * reserializara para mandarlo, la firma no cerraría nunca (orden de claves,
   * espacios, unicode) y todo daría 401 sin decir por qué.
   */
  async function postear(payload) {
    const crudo = Buffer.from(JSON.stringify(payload), 'utf8');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': firmar(crudo, gateway.secreto),
      },
      body: crudo,
    });
    if (res.status === 401) {
      throw new Error(
        'el webhook devolvió 401: la firma no cerró. El arnés firma con el secreto ' +
        'que generó `levantarGateway`; si esto pasa, el cliente está apuntando a ' +
        'otro gateway (¿el del compose?), no al del arnés.',
      );
    }
    if (res.status !== 200) {
      throw new Error(`el webhook devolvió ${res.status} (esperaba 200)`);
    }
    return res;
  }

  /**
   * Dice una línea del guion y **espera a que el sistema termine de
   * procesarla**.
   *
   * El `esperar()` es la mitad del valor de esta función: el webhook contesta
   * 200 antes de hacer nada (Meta reintenta si tardás), así que sin esto el
   * assert siguiente correría contra una carrera. Ver `crearDiferir` en
   * `gateway-en-proceso.js`.
   *
   * Lo que NO garantiza: que el mensaje ya haya llegado al Graph falso. Eso lo
   * entrega el worker del outbox en su propio bucle y se espera con el
   * "esperar el próximo mensaje" del Graph falso.
   *
   * @returns {Promise<{id: string, texto: string, en: number}>}
   */
  async function decir(texto) {
    const id = nuevoWamid();
    const payload = payloadDeTexto({
      id, texto, telefono, phoneNumberId: gateway.waPhoneId, nombre, numeroNegocio,
    });
    const dicho = { id, texto, en: Date.now() };
    dichos.push(dicho);
    await postear(payload);
    await gateway.esperar();
    return dicho;
  }

  return {
    telefono: String(telefono),
    nombre,
    dichos,
    decir,
    postear,
    /** Para un escenario que quiera reenviar el MISMO id a propósito. */
    payloadDeTexto: (p) => payloadDeTexto({
      telefono, phoneNumberId: gateway.waPhoneId, nombre, numeroNegocio, ...p,
    }),
  };
}
