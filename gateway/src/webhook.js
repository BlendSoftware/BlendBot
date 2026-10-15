/**
 * El webhook de la Cloud API. Es la puerta de entrada del producto.
 *
 * Cuatro reglas, y las cuatro tienen una cicatriz atrás:
 *
 * 1. **Firma primero.** Sin X-Hub-Signature-256 válida es 401 y no se procesa
 *    nada. La URL del webhook es pública por definición.
 * 2. **200 inmediato.** Meta espera la respuesta y reintenta si tardás. Si el
 *    200 sale recién después de correr el modelo (90s en el peor caso), Meta
 *    ya mandó el mismo mensaje dos o tres veces.
 * 3. **Idempotencia por `message.id`.** Consecuencia directa de lo anterior:
 *    aunque el reintento llegue, el segundo procesamiento se corta en seco.
 *    SETNX con TTL de 24hs, que es lo que dura la ventana de servicio.
 * 4. **Nunca silencio.** Si el modelo se cuelga o explota, el cliente recibe
 *    una disculpa corta. Un comercio prefiere "ahora te respondo" antes que un
 *    cliente hablándole a una pared.
 */

import express from 'express';
import { firmaValida } from './firma.js';
import { claveChat } from './sesiones.js';

const TTL_IDEMPOTENCIA_S = 24 * 60 * 60;

export const DISCULPA =
  'Uy, se me trabó el sistema. ¿Me lo escribís de nuevo?';
export const SOLO_TEXTO =
  'Por ahora solo puedo leer mensajes de texto. ¿Me lo escribís?';

/**
 * Aplana el payload de Meta a la lista de mensajes que nos interesan.
 * Ignora statuses (entregas/lecturas), echoes y campos que no son 'messages'.
 * Puro: los tests lo usan con fixtures reales.
 */
export function extraerEventos(body) {
  const eventos = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'messages') continue; // message_echoes, etc.
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      if (!Array.isArray(value.messages) || !value.messages.length) continue; // statuses

      const nombres = new Map(
        (value.contacts || []).map((c) => [c.wa_id, c.profile?.name]),
      );
      for (const message of value.messages) {
        if (!message?.id || !message?.from) continue;
        // Echo del propio número del negocio: no se contesta a uno mismo.
        if (message.from === value.metadata?.display_phone_number) continue;
        eventos.push({
          phoneNumberId: String(phoneNumberId),
          telefono: String(message.from),
          nombre: nombres.get(message.from) || null,
          message,
        });
      }
    }
  }
  return eventos;
}

/**
 * Texto utilizable de un mensaje. `null` = tipo que todavía no manejamos
 * (audio, imagen, ubicación...), que NO es lo mismo que texto vacío.
 */
export function textoDelMensaje(message) {
  switch (message?.type) {
    case 'text':
      return message.text?.body?.trim() || null;
    case 'interactive': {
      const i = message.interactive || {};
      const t = i.button_reply?.title || i.list_reply?.title;
      return t?.trim() || null;
    }
    case 'button':
      // Respuesta rápida de una plantilla (confirmar/cancelar del recordatorio).
      return message.button?.text?.trim() || null;
    default:
      return null;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.tenants
 * @param {object} deps.redis
 * @param {object} deps.agente   { responder }
 * @param {object} deps.outbox   { encolar }
 * @param {(fn: Function) => void} [deps.diferir]  cómo se agenda el trabajo async
 */
export function crearRouter({ config, tenants, redis, agente, outbox, diferir = setImmediate }) {
  const router = express.Router();

  // ── GET: el handshake de alta del webhook ────────────────────────────────
  router.get('/', (req, res) => {
    const modo = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (modo === 'subscribe' && token && token === config.metaVerifyToken) {
      console.log('[webhook] verificación OK');
      return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }
    console.warn('[webhook] verificación rechazada (modo=%s)', modo);
    return res.sendStatus(403);
  });

  // ── POST: los mensajes ───────────────────────────────────────────────────
  router.post('/', (req, res) => {
    const firma = req.get('x-hub-signature-256');
    if (!firmaValida(req.rawBody, firma, config.metaAppSecret)) {
      console.warn('[webhook] firma inválida o ausente — 401');
      return res.sendStatus(401);
    }

    // 200 YA. Todo lo que sigue es asincrónico y no puede hacer esperar a Meta.
    res.sendStatus(200);

    const body = req.body;
    // La función devuelve la promesa a propósito: `setImmediate` la ignora,
    // pero los tests inyectan un `diferir` que la junta y la espera.
    diferir(() => procesarLote(body).catch((err) => {
      console.error('[webhook] el lote explotó: %s', err?.stack || err);
    }));
  });

  /** @returns {Promise<Array>} resultados por mensaje (los tests los leen). */
  async function procesarLote(body) {
    const eventos = extraerEventos(body);
    const salida = [];
    for (const ev of eventos) {
      try {
        salida.push(await procesarUno(ev));
      } catch (err) {
        console.error('[webhook] error procesando %s: %s', ev.message?.id, err?.stack || err);
        salida.push({ estado: 'error', id: ev.message?.id });
      }
    }
    return salida;
  }

  async function procesarUno(ev) {
    const { phoneNumberId, telefono, message } = ev;

    const tenant = tenants.porPhoneId(phoneNumberId);
    if (!tenant) {
      // No es tráfico nuestro (o falta dar de alta el tenant). Se descarta sin
      // contestar: responderle a un número desconocido es peor que ignorarlo.
      console.warn('[webhook] phone_number_id desconocido: %s — descarto', phoneNumberId);
      return { estado: 'tenant_desconocido', id: message.id };
    }

    // Idempotencia. Va ANTES de cualquier efecto: el reintento de Meta no
    // puede generar dos respuestas ni, peor, dos turnos.
    const clave = `wa:msg:${message.id}`;
    const primero = await redis.set(clave, '1', { NX: true, EX: TTL_IDEMPOTENCIA_S });
    if (!primero) {
      console.log('[webhook] duplicado %s — ya procesado', message.id);
      return { estado: 'duplicado', id: message.id };
    }

    const texto = textoDelMensaje(message);
    if (!texto) {
      console.log('[webhook] tipo "%s" sin texto usable — aviso al cliente', message.type);
      await outbox.encolar({
        phone_number_id: phoneNumberId, telefono, tipo: 'texto', texto: SOLO_TEXTO,
        negocio_id: tenant.negocio,
      });
      return { estado: 'sin_texto', id: message.id };
    }

    const chatKey = claveChat(phoneNumberId, telefono);
    let respuesta;
    try {
      respuesta = await agente.responder({ tenant, telefono, texto, clave: chatKey });
    } catch (err) {
      // Modelo caído, timeout, MCP que no levanta: el cliente igual recibe algo.
      console.error('[webhook] el agente falló para %s: %s', chatKey, err?.message);
      await outbox.encolar({
        phone_number_id: phoneNumberId, telefono, tipo: 'texto', texto: DISCULPA,
        negocio_id: tenant.negocio,
      });
      return { estado: 'disculpa', id: message.id, motivo: err?.name || 'error' };
    }

    // `.trim()`: un texto de puros espacios pasa el truthy pero el outbox lo
    // descarta, y ahí el cliente se queda sin respuesta y sin disculpa.
    if (!respuesta?.texto?.trim()) {
      console.warn('[webhook] el agente devolvió vacío para %s — mando disculpa', chatKey);
      await outbox.encolar({
        phone_number_id: phoneNumberId, telefono, tipo: 'texto', texto: DISCULPA,
        negocio_id: tenant.negocio,
      });
      return { estado: 'disculpa', id: message.id, motivo: 'vacio' };
    }

    await outbox.encolar({
      phone_number_id: phoneNumberId, telefono, tipo: 'texto', texto: respuesta.texto,
      negocio_id: tenant.negocio,
    });
    return { estado: 'respondido', id: message.id };
  }

  // Expuesto para los tests: procesar sin pasar por HTTP.
  router.procesarLote = procesarLote;
  return router;
}
