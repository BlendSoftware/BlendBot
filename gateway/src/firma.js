/**
 * Verificación de X-Hub-Signature-256.
 *
 * Sin esto, cualquiera que conozca la URL puede hacer que el agente le hable a
 * los clientes del comercio. Es la única puerta del gateway.
 *
 * Tres cosas que no se negocian:
 * 1. Se firma el **raw body**, byte por byte. Si se firma `JSON.stringify(req.body)`
 *    la firma no cierra nunca (Meta no reserializa igual: espacios, orden, unicode).
 * 2. `timingSafeEqual`, no `===`. Comparar strings filtra el prefijo correcto por
 *    tiempo y deja adivinar la firma a fuerza de intentos.
 * 3. `timingSafeEqual` TIRA si los buffers miden distinto, así que la longitud se
 *    chequea antes.
 */

import crypto from 'node:crypto';

const PREFIJO = 'sha256=';

/** Firma un cuerpo tal como lo hace Meta. Se usa en los tests y en el README. */
export function firmar(rawBody, secret) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return PREFIJO + crypto.createHmac('sha256', secret).update(buf).digest('hex');
}

/**
 * @param {Buffer|string} rawBody  el cuerpo crudo, sin parsear
 * @param {string|undefined} header  valor de X-Hub-Signature-256
 * @param {string} secret  META_APP_SECRET
 * @returns {boolean}
 */
export function firmaValida(rawBody, header, secret) {
  if (!secret) return false;
  if (typeof header !== 'string' || !header.startsWith(PREFIJO)) return false;
  if (rawBody === undefined || rawBody === null) return false;

  const esperada = Buffer.from(firmar(rawBody, secret), 'utf8');
  const recibida = Buffer.from(header, 'utf8');
  if (esperada.length !== recibida.length) return false;

  try {
    return crypto.timingSafeEqual(esperada, recibida);
  } catch {
    return false;
  }
}
