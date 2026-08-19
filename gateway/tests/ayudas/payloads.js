/**
 * Payloads con la estructura REAL del webhook de WhatsApp Business Cloud API
 * (v21.0). Copiados de la forma que manda Meta, no de una versión simplificada:
 * la mitad de los bugs de un gateway están en el anidamiento
 * entry[].changes[].value.messages[].
 */

export const PHONE_ID = '106540352242922';
export const PHONE_ID_AJENO = '999999999999999';
export const NUMERO_NEGOCIO = '5492611234567';
export const CLIENTE = '5492619876543';

function sobre(value) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ value, field: 'messages' }] }],
  };
}

function valueBase(phoneNumberId = PHONE_ID) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: NUMERO_NEGOCIO, phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: 'Carla Gómez' }, wa_id: CLIENTE }],
  };
}

function conMensaje(message, phoneNumberId = PHONE_ID) {
  return sobre({ ...valueBase(phoneNumberId), messages: [message] });
}

/** Mensaje de texto: el 95% del tráfico. */
export function textoEntrante({
  id = 'wamid.HBgNNTQ5MjYxOTg3NjU0MxUCABIYFjNFQjBDN0E4RjE5NDAxMkFCQzEyMwA=',
  cuerpo = 'Hola, quiero un turno para el jueves',
  telefono = CLIENTE,
  phoneNumberId = PHONE_ID,
} = {}) {
  return conMensaje({
    from: telefono,
    id,
    timestamp: '1755550000',
    type: 'text',
    text: { body: cuerpo },
  }, phoneNumberId);
}

/** Botón de un mensaje interactivo (el que manda el agente). */
export function botonInteractivo({ id = 'wamid.INTERACTIVO1', titulo = 'Confirmar turno' } = {}) {
  return conMensaje({
    from: CLIENTE,
    id,
    timestamp: '1755550100',
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id: 'confirmar_turno', title: titulo },
    },
  });
}

/** Opción de una lista interactiva. */
export function opcionDeLista({ id = 'wamid.LISTA1', titulo = 'Jueves 10:30' } = {}) {
  return conMensaje({
    from: CLIENTE,
    id,
    timestamp: '1755550200',
    type: 'interactive',
    interactive: {
      type: 'list_reply',
      list_reply: { id: 'hueco_3', title: titulo, description: 'Con la Dra. Pérez' },
    },
  });
}

/** Quick reply de una PLANTILLA: así vuelve el "Confirmar" del recordatorio. */
export function botonDePlantilla({ id = 'wamid.BOTONPLANTILLA1', texto = 'Confirmar' } = {}) {
  return conMensaje({
    from: CLIENTE,
    id,
    timestamp: '1755550300',
    type: 'button',
    context: { from: NUMERO_NEGOCIO, id: 'wamid.PLANTILLAORIGEN' },
    button: { payload: 'confirmar', text: texto },
  });
}

/** Audio: todavía no lo manejamos, pero llega y no puede tirar el gateway. */
export function audioEntrante({ id = 'wamid.AUDIO1' } = {}) {
  return conMensaje({
    from: CLIENTE,
    id,
    timestamp: '1755550400',
    type: 'audio',
    audio: {
      mime_type: 'audio/ogg; codecs=opus',
      sha256: 'e5b1c4...',
      id: '1234567890',
      voice: true,
    },
  });
}

/** Imagen con caption: el caption NO se usa como texto, es otro flujo. */
export function imagenEntrante({ id = 'wamid.IMAGEN1' } = {}) {
  return conMensaje({
    from: CLIENTE,
    id,
    timestamp: '1755550500',
    type: 'image',
    image: { caption: 'mirá', mime_type: 'image/jpeg', sha256: 'abc...', id: '99887766' },
  });
}

/** Acuse de entrega/lectura: NO es un mensaje, se ignora entero. */
export function estadoEntregado({ id = 'wamid.SALIENTE1' } = {}) {
  return sobre({
    ...valueBase(),
    statuses: [{
      id,
      status: 'delivered',
      timestamp: '1755550600',
      recipient_id: CLIENTE,
      conversation: { id: 'CONV1', origin: { type: 'service' } },
      pricing: { billable: true, pricing_model: 'CBP', category: 'service' },
    }],
  });
}

/** Otro campo del mismo webhook (echoes, calidad del número, etc.). */
export function campoQueNoEsMensajes() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '102290129340398',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: NUMERO_NEGOCIO, phone_number_id: PHONE_ID },
          event: 'FLAGGED',
          current_limit: 'TIER_1K',
        },
        field: 'message_template_quality_update',
      }],
    }],
  };
}

/** Dos mensajes del mismo cliente en un solo POST: Meta los agrupa. */
export function loteDeDos() {
  return sobre({
    ...valueBase(),
    messages: [
      { from: CLIENTE, id: 'wamid.LOTE1', timestamp: '1755550700', type: 'text', text: { body: 'Hola' } },
      { from: CLIENTE, id: 'wamid.LOTE2', timestamp: '1755550701', type: 'text', text: { body: '¿tenés lugar el viernes?' } },
    ],
  });
}

export const TENANTS = {
  [PHONE_ID]: {
    negocio: 'Consultorio de prueba',
    agente_token: 'cop_token_de_prueba',
    vertical: 'salud',
    wa_numero: `+${NUMERO_NEGOCIO}`,
  },
};
