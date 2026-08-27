/**
 * servidores/api.js — el juez servido por la API, **el día que haya key**.
 *
 * Hoy no corre: no hay `ANTHROPIC_API_KEY` en esta máquina y el dueño del
 * producto decidió no poner una (design §1). Este archivo existe igual, y no es
 * código muerto por descuido: es la prueba de que la costura del juez está bien
 * puesta. Si para servir el juez por la API hubiera que tocar `juez.js`, los
 * escenarios o el protocolo, la costura estaría mal elegida.
 *
 * Es también donde **vuelve la garantía que hoy falta**: con la API, el modelo
 * del juez se elige (`ARNES_MODELO_JUEZ`), se pinnea a una versión exacta y se
 * escribe en la salida. Ahí `independenciaDeModelo.garantizada` pasa a ser
 * `true` de verdad, no por optimismo.
 *
 * ── Cómo se enchufa ──────────────────────────────────────────────────────────
 *   ARNES_JUEZ=api ARNES_MODELO_JUEZ=<modelo-con-fecha> make arnes
 *
 * Y hay que elegir un modelo **distinto del que corre el bot** y más capaz. Un
 * juez que comparte modelo con el acusado comparte sus puntos ciegos: si el
 * modelo cree que "ya sale" no es prometer una demora, lo cree las dos veces y
 * la regla nunca dispara (design §7).
 */

import { ErrorArnes, leerEnv } from '../../entorno.js';
import { pedidoComoTexto } from '../protocolo.js';

/**
 * Sin default. Un modelo de juez que se elige solo es un modelo que flota, y un
 * veredicto irreproducible no se puede discutir con nadie (design §7). El que
 * lo corre elige, con fecha, y queda escrito en la salida.
 */
export const VAR_MODELO = 'ARNES_MODELO_JUEZ';

/**
 * El juez no necesita hablar mucho: un JSON de una línea. El techo está bajo a
 * propósito, para que una respuesta que se va por las ramas se corte y se
 * descarte como veredicto malformado en vez de costar tokens.
 */
const MAX_TOKENS = 400;

/**
 * @param {object} [opts]
 * @param {string} [opts.modelo]   default: `ARNES_MODELO_JUEZ`. Sin default global
 * @param {string} [opts.apiKey]
 * @returns {Promise<import('../juez.js').Servidor>}
 */
export async function servidorApi({ modelo, apiKey } = {}) {
  const modeloElegido = modelo || leerEnv(VAR_MODELO);
  if (!modeloElegido) {
    throw new ErrorArnes(
      `falta ${VAR_MODELO}: el modelo del juez no tiene default a propósito`,
      'Un juez cuyo modelo flota vuelve los veredictos irreproducibles, y un veredicto',
      'irreproducible no se puede discutir ni comparar con la corrida anterior.',
      '',
      `Elegí uno pinneado con fecha, distinto y más capaz que el del bot: ${VAR_MODELO}=<modelo>`,
    );
  }
  const clave = apiKey || leerEnv('ANTHROPIC_API_KEY');
  if (!clave) {
    throw new ErrorArnes(
      'falta ANTHROPIC_API_KEY para servir el juez por la API',
      'Hoy el modo por defecto es `agente` (ARNES_JUEZ=agente), que no necesita key',
      'pero tampoco garantiza que el juez sea un modelo distinto del bot.',
    );
  }

  // Import dinámico: si nadie usa el modo `api`, el SDK ni se carga y una
  // corrida en modo agente no depende de que esté instalado.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const cliente = new Anthropic({ apiKey: clave });

  return {
    modo: 'api',
    modelo: modeloElegido,
    independenciaDeModelo: {
      garantizada: true,
      motivo:
        `El juez corre sobre ${modeloElegido}, pinneado y elegido a mano. Verificá que ` +
        'NO sea el mismo que corre el bot: el arnés no lo puede chequear solo porque ' +
        'el bot lo sirve un agente.',
    },
    async servir(pedido) {
      const res = await cliente.messages.create({
        model: modeloElegido,
        max_tokens: MAX_TOKENS,
        // `temperature: 0` no se pone: los tres veredictos existen justamente
        // para muestrear la variación del juez. Con temperatura cero los tres
        // serían el mismo veredicto tres veces y la mayoría no diría nada.
        messages: [{ role: 'user', content: pedidoComoTexto(pedido) }],
      });
      return res.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    },
  };
}
