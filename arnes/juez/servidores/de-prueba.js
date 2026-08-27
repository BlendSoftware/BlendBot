/**
 * servidores/de-prueba.js — un juez de mentira, para probar **el arnés**.
 *
 * Mismo espíritu que el `queryFn` de mentira de `puerta-andamio.js`: antes de
 * gastar un veredicto real hay que saber que la maquinaria del juez hace lo que
 * dice. Este servidor devuelve veredictos de guion, así que se puede probar
 * gratis y offline que:
 *
 *   · una condena sin cita se descarta;
 *   · una condena con una cita inventada se descarta;
 *   · una condena que cita al CLIENTE se descarta;
 *   · 2 de 3 alcanza y 1 de 3 no;
 *   · una regla en cuarentena no rompe;
 *   · una regla cuyo caso negativo el juez perdona no cuenta como verificada.
 *
 * Nada de esto se puede comprobar con un juez real sin correr una conversación
 * entera y pagarla. Lo usa `autoprueba.js`.
 *
 * **No sirve para juzgar nada.** No mira la transcripción: devuelve lo que le
 * dijeron que devuelva.
 */

import { servidorDeFuncion } from './agente.js';

/**
 * @param {object} opts
 * @param {(pedido: import('../protocolo.js').Pedido, n: number) => any} opts.responder
 *        `n` es el número de veredicto pedido para este juez (1, 2, 3, …)
 */
export function servidorDePrueba({ responder }) {
  let n = 0;
  return servidorDeFuncion({
    modo: 'de-prueba',
    modelo: 'ninguno (juez de mentira: devuelve veredictos de guion)',
    independenciaDeModelo: {
      garantizada: false,
      motivo: 'No hay modelo. Este juez existe para probar el arnés, no el producto.',
    },
    fn: async (pedido) => {
      n += 1;
      return responder(pedido, n);
    },
  });
}

/** Atajos para escribir guiones legibles. */
export const CONDENA = (cita, turno) => ({ veredicto: 'viola', cita, turno, motivo: 'de guion' });
export const ABSUELVE = () => ({ veredicto: 'no_viola', cita: null, turno: null, motivo: 'de guion' });
export const CONDENA_SIN_CITA = () => ({ veredicto: 'viola', cita: null, turno: 4, motivo: 'de guion' });
