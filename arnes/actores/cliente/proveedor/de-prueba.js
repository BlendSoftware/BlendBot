/**
 * PROVEEDOR `de-prueba` del cliente libre — líneas fijas. **NO es el modo libre.**
 *
 * Leé esto antes de usarlo, porque el nombre del modo invita a confundirse:
 *
 *   **Un cliente con respuestas fijas es el modo `guion` con otro nombre.**
 *
 * Este proveedor existe para ejercitar la **costura**, no el producto: que el
 * bucle de `libre.js` cuente los turnos, que el techo corte, que el reporte se
 * arme, que una respuesta mal formada salga como arnés roto y no como hallazgo.
 * Todo eso se puede verificar gratis, sin nadie en el loop y sin gastar, y
 * conviene poder verificarlo.
 *
 * Lo que **no** puede hacer, nunca, es encontrar algo. Sus líneas las escribió
 * la misma cabeza que escribió el arnés: sólo va a fallar donde quien las
 * escribió ya sabía que podía fallar, o sea nunca donde importa. Por eso
 * `improvisa: false`, y por eso `libre.js` rotula el reporte entero como "esta
 * corrida no encontró nada porque no podía encontrar nada".
 *
 * Si querés que el modo libre haga su trabajo, es `ARNES_CLIENTE=agente`.
 */

import { leerRespuestaDelCliente } from '../libre.js';

/**
 * Un cliente mínimo que pide algo, contesta lo que le pregunten con una línea
 * genérica y se va. Cuatro líneas, elegidas para recorrer el bucle entero
 * (abrir, pedir, responder una repregunta, cerrar), no para probar al bot.
 */
const LINEAS = [
  'hola',
  'una doble cheddar y unas papas, paso a buscarlo',
  'juani',
  { texto: 'listo gracias', terminar: true, motivo: 'consiguió lo que quería' },
];

/**
 * @param {object} [opts]
 * @param {Array<string|object>} [opts.lineas]  para ejercitar otro camino del bucle
 */
export function crearProveedorClienteDePrueba({ lineas = LINEAS } = {}) {
  return {
    nombre: 'de-prueba',
    /** Fijas por definición. Esto es lo que impide que su verde se lea mal. */
    improvisa: false,

    async turno(contexto) {
      const cruda = lineas[contexto.turno - 1];
      // Se acabaron las líneas: el cliente se va. No se repite la última ni se
      // inventa una, porque las dos cosas serían el arnés hablando por el
      // cliente en un modo que existe para que el cliente hable solo.
      const paso = cruda === undefined
        ? { texto: '', terminar: true, motivo: 'se acabaron las líneas fijas del proveedor de-prueba' }
        : (typeof cruda === 'string' ? { texto: cruda } : cruda);

      // Pasa por la MISMA validación que el proveedor de verdad: si el
      // protocolo cambia y esto deja de cumplirlo, se entera acá, gratis, y no
      // en medio de una corrida con un agente esperando del otro lado.
      return leerRespuestaDelCliente(
        { protocolo: 'arnes/cliente-libre@1', turno: contexto.turno, ...paso },
        { turno: contexto.turno },
        '(proveedor de-prueba, en proceso)',
      );
    },

    async cerrar() {},
  };
}
