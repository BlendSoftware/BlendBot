/**
 * Sesiones del agente: chatKey → resumeId.
 *
 * Patrón de wa-claude/src/claude.js (`sonnetSessions`, un Map chatId→resumeId)
 * con el gotcha que allá costó caro: **el Map en memoria no alcanza**. Un
 * restart del proceso y todas las conversaciones en curso arrancan de cero, el
 * cliente repite lo que ya dijo y el agente vuelve a preguntar el nombre. Acá
 * el Map es write-through a disco: cada `guardar` escribe el archivo.
 *
 * La clave es `<phone_number_id>:<telefono>` y no sólo el teléfono: la misma
 * persona puede ser clienta de dos comercios nuestros y esas dos
 * conversaciones no pueden compartir contexto (ni historial, ni token).
 *
 * Expiración: 24hs sin actividad. Coincide a propósito con la ventana de
 * servicio de WhatsApp — si pasaron 24hs, la conversación anterior ya terminó.
 */

import fs from 'node:fs';
import path from 'node:path';

export const TTL_MS = 24 * 60 * 60 * 1000;
const ARCHIVO = 'sesiones.json';

export function claveChat(phoneNumberId, telefono) {
  return `${phoneNumberId}:${telefono}`;
}

/**
 * @param {object} opts
 * @param {string} opts.dir  SESIONES_DIR
 * @param {number} [opts.ttlMs]
 * @param {() => number} [opts.ahora]  reloj inyectable (tests de expiración)
 */
export function crearSesiones({ dir, ttlMs = TTL_MS, ahora = Date.now } = {}) {
  const ruta = path.join(dir, ARCHIVO);
  /** @type {Map<string, {resumeId: string, ultimoUso: number}>} */
  const mapa = new Map();

  cargar();

  function cargar() {
    try {
      const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      for (const [clave, v] of Object.entries(crudo || {})) {
        if (v && typeof v.resumeId === 'string') {
          mapa.set(clave, { resumeId: v.resumeId, ultimoUso: Number(v.ultimoUso) || 0 });
        }
      }
    } catch (err) {
      // Primer arranque (ENOENT) es normal. Un JSON roto no puede tumbar el
      // gateway: se pierde el contexto, no el servicio.
      if (err.code !== 'ENOENT') {
        console.warn('[sesiones] no pude leer %s (%s) — arranco vacío', ruta, err.message);
      }
    }
  }

  /** Escritura atómica: tmp + rename. Un corte a mitad no deja el archivo mocho. */
  function volcar() {
    const obj = {};
    for (const [clave, v] of mapa.entries()) obj[clave] = v;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${ruta}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, ruta);
    } catch (err) {
      // Si el disco falla seguimos en memoria: peor es cortar la conversación.
      console.error('[sesiones] no pude persistir en %s: %s', ruta, err.message);
    }
  }

  function purgar() {
    const corte = ahora() - ttlMs;
    let vencidas = 0;
    for (const [clave, v] of mapa.entries()) {
      if (v.ultimoUso < corte) {
        mapa.delete(clave);
        vencidas++;
      }
    }
    if (vencidas) volcar();
    return vencidas;
  }

  return {
    ruta,

    /** @returns {string|null} resumeId vigente, o null si no hay o venció. */
    obtener(clave) {
      const v = mapa.get(clave);
      if (!v) return null;
      if (v.ultimoUso < ahora() - ttlMs) {
        mapa.delete(clave);
        volcar();
        return null;
      }
      return v.resumeId;
    },

    /** Write-through: vuelve a disco en el acto. */
    guardar(clave, resumeId) {
      if (!resumeId) return;
      mapa.set(clave, { resumeId, ultimoUso: ahora() });
      volcar();
    },

    /** Marca actividad sin cambiar el resumeId (renueva las 24hs). */
    tocar(clave) {
      const v = mapa.get(clave);
      if (!v) return;
      v.ultimoUso = ahora();
      volcar();
    },

    borrar(clave) {
      if (mapa.delete(clave)) volcar();
    },

    purgar,

    get cantidad() {
      return mapa.size;
    },
  };
}
