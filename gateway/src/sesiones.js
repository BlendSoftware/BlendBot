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
 * Expiración: 2hs sin actividad. Antes eran 24hs (la ventana de servicio de
 * WhatsApp), pero el 15/10 en producción eso dejó reanudar una conversación
 * de 40 turnos arrastrada del día anterior y el modelo (gemini-2.5-flash-lite)
 * terminó inventando un pedido entero sin llamar a ninguna tool. 2hs es un
 * contexto que el modelo todavía puede sostener sin desvariar.
 *
 * Tope de turnos: además del tiempo, una sesión muy larga (aunque esté
 * dentro de las 2hs) tiene el mismo riesgo de que el modelo pierda el hilo y
 * alucine. Por eso también se corta a los MAX_TURNOS intercambios.
 */

import fs from 'node:fs';
import path from 'node:path';

export const TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_TURNOS = 20;
const ARCHIVO = 'sesiones.json';

export function claveChat(phoneNumberId, telefono) {
  return `${phoneNumberId}:${telefono}`;
}

/**
 * @param {object} opts
 * @param {string} opts.dir  SESIONES_DIR
 * @param {number} [opts.ttlMs]
 * @param {number} [opts.maxTurnos]
 * @param {() => number} [opts.ahora]  reloj inyectable (tests de expiración)
 */
export function crearSesiones({ dir, ttlMs = TTL_MS, maxTurnos = MAX_TURNOS, ahora = Date.now } = {}) {
  const ruta = path.join(dir, ARCHIVO);
  /** @type {Map<string, {resumeId: string, ultimoUso: number, turnos: number}>} */
  const mapa = new Map();

  cargar();

  function cargar() {
    try {
      const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      for (const [clave, v] of Object.entries(crudo || {})) {
        if (v && typeof v.resumeId === 'string') {
          // Un registro viejo no tiene `turnos`: se grabó antes de que
          // existiera el contador. Se asume 1 (ya tuvo al menos un turno)
          // para no resetear de golpe un tope que todavía no se cumplió.
          mapa.set(clave, {
            resumeId: v.resumeId,
            ultimoUso: Number(v.ultimoUso) || 0,
            turnos: Number(v.turnos) || 1,
          });
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

    /**
     * @returns {string|null} resumeId vigente, o null si no hay, venció por
     * tiempo o ya pasó el tope de turnos — en ambos casos se borra, porque
     * para el caller "venció" y "no reanuda" es la misma cosa.
     */
    obtener(clave) {
      const v = mapa.get(clave);
      if (!v) return null;
      if (v.ultimoUso < ahora() - ttlMs || v.turnos >= maxTurnos) {
        mapa.delete(clave);
        volcar();
        return null;
      }
      return v.resumeId;
    },

    /** Write-through: vuelve a disco en el acto. */
    guardar(clave, resumeId) {
      if (!resumeId) return;
      const anterior = mapa.get(clave);
      // Mismo resumeId que ya teníamos → un turno más de la misma
      // conversación. Un resumeId distinto (o no había nada) → conversación
      // nueva, el contador arranca de 1.
      const turnos = anterior && anterior.resumeId === resumeId ? anterior.turnos + 1 : 1;
      mapa.set(clave, { resumeId, ultimoUso: ahora(), turnos });
      volcar();
    },

    /** Marca actividad sin cambiar el resumeId (renueva la ventana y cuenta el turno). */
    tocar(clave) {
      const v = mapa.get(clave);
      if (!v) return;
      v.ultimoUso = ahora();
      v.turnos += 1;
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
