/**
 * servidores/agente.js — el juez servido por **un agente Claude**.
 *
 * Es el modo por defecto hoy, por la misma decisión que el bot: no hay
 * `ANTHROPIC_API_KEY` en esta máquina y no va a haberla (design §1, reescrita
 * durante el apply). El principio del spec no se toca —el juez recibe la regla
 * y el texto, y nada sobre lo que se espera—; cambia quién lo cumple.
 *
 * ── Las dos formas de servirlo ───────────────────────────────────────────────
 *
 * 1. **En proceso** (`servidorDeFuncion`): quien orquesta la corrida —un agente
 *    en el loop— le pasa una función que recibe el pedido y devuelve el
 *    veredicto. Es la costura pura: el arnés no sabe ni le importa qué hay del
 *    otro lado.
 *
 * 2. **Por buzón** (`servidorPorBuzon`): el arnés deja el pedido en un archivo
 *    y espera el veredicto en otro. Sirve cuando el que juzga es un agente que
 *    no vive dentro de este proceso. Es lento y es a propósito: un buzón que se
 *    llena y nadie atiende falla con un timeout claro, no con un verde falso.
 *
 *    Usa **la misma mecánica que el buzón del bot** (`actores/proveedor/agente.js`):
 *    un `SIGUIENTE.md` en prosa que dice qué hay que hacer ahora, y archivos
 *    `.pedido.*` / `.veredicto.json` al lado. Que sean dos buzones distintos con
 *    la misma forma no es casual: del otro lado hay una sola persona (o un solo
 *    agente) y dos mecánicas distintas para lo mismo se aprenden mal y se
 *    equivocan peor.
 *
 * Las dos hablan el mismo `protocolo.js`. El día que haya key, `api.js` entra
 * en el mismo agujero sin tocar `juez.js` ni un escenario.
 *
 * ── EL HUECO, otra vez y por escrito ─────────────────────────────────────────
 * En este modo **la independencia de modelo entre el bot y el juez NO está
 * garantizada**. Los dos los sirve un agente Claude y el arnés no puede leer ni
 * fijar el modelo de ninguno. El spec la pide; acá no se cumple y se dice.
 *
 * Lo que queda en pie —ciego, transcripción fija, tres veredictos, cita
 * verificada, caso negativo— es lo que hace que el juez siga sirviendo. Lo que
 * se pierde es la protección contra el punto ciego compartido: si el modelo
 * cree que "ya sale" no es prometer una demora, lo va a creer como bot y como
 * juez, y R2 no va a disparar nunca. Por eso el caso negativo de cada regla es
 * obligatorio y por eso la salida imprime esta limitación en cada corrida.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ErrorArnes } from '../../entorno.js';
import { pedidoComoTexto } from '../protocolo.js';

/** El texto que va a la salida de toda corrida servida por un agente. */
export const AVISO_SIN_INDEPENDENCIA = {
  garantizada: false,
  motivo:
    'El juez lo sirve un agente Claude, igual que el bot. El arnés no puede leer ' +
    'ni fijar el modelo de ninguno de los dos, así que NO garantiza que el juez ' +
    'corra sobre un modelo distinto del acusado (spec: "El juez es un modelo ' +
    'distinto del bot, pinneado"). Sí garantiza: juez ciego a lo esperado, ' +
    'transcripción fija, tres veredictos por mayoría, cita verificada contra el ' +
    'texto y caso negativo obligatorio por regla. La independencia vuelve el día ' +
    'que se use `servidores/api.js` con una key.',
};

/**
 * La costura en su forma más chica: una función.
 *
 * @param {object} opts
 * @param {(pedido: import('../protocolo.js').Pedido, texto: string) => Promise<any>} opts.fn
 *        recibe el pedido estructurado Y el mismo pedido renderizado como texto
 *        (que es lo que leería un modelo). Devuelve el veredicto, como objeto o
 *        como el string JSON tal cual salió
 * @param {string} [opts.modelo]  si el que sirve sabe qué modelo es, que lo diga
 * @param {string} [opts.modo]
 * @param {{garantizada: boolean, motivo: string}} [opts.independenciaDeModelo]
 * @returns {import('../juez.js').Servidor}
 */
export function servidorDeFuncion({
  fn,
  modo = 'agente',
  modelo = 'desconocido (lo sirve un agente; el arnés no puede leer la versión)',
  independenciaDeModelo = AVISO_SIN_INDEPENDENCIA,
} = {}) {
  if (typeof fn !== 'function') throw new ErrorArnes('servidorDeFuncion: falta `fn`');
  return {
    modo,
    modelo,
    independenciaDeModelo,
    servir: (pedido) => fn(pedido, pedidoComoTexto(pedido)),
  };
}

/**
 * El juez por buzón de archivos.
 *
 * Por cada pedido escribe DOS archivos en `dir`:
 *   · `<id>.pedido.txt`  — el pedido tal como lo leería un modelo. Es el que se
 *                          abre para juzgar.
 *   · `<id>.pedido.json` — el mismo pedido estructurado, por si el que juzga es
 *                          un programa.
 *
 * Y espera `<id>.veredicto.json` con:
 *   {"veredicto":"viola"|"no_viola","turno":<n>|null,"cita":"…"|null,"motivo":"…"}
 *
 * El que juzga **no tiene que devolver nada más**, y sobre todo no tiene que
 * mirar ningún otro archivo del buzón: cada pedido se contesta solo. Tres
 * pedidos con la misma regla y la misma transcripción son los tres veredictos
 * de esa regla, y quien los contesta **no debe saber** que son la misma: por eso
 * los ids son opacos y no dicen ni la regla ni el escenario.
 *
 * @param {object} opts
 * @param {string} opts.dir
 * @param {number} [opts.timeoutMs]  cuánto se espera un veredicto
 * @param {number} [opts.cadaMs]
 */
export function servidorPorBuzon({ dir, timeoutMs, cadaMs = 400, ...resto } = {}) {
  if (!dir) throw new ErrorArnes('servidorPorBuzon: falta `dir`');
  fs.mkdirSync(dir, { recursive: true });
  // Quince minutos por veredicto, igual que el buzón del bot y por el mismo
  // motivo: del otro lado hay alguien leyendo una conversación entera.
  const techo = timeoutMs ?? Number(process.env.ARNES_BUZON_TIMEOUT_MS || 900_000);

  let anunciado = false;

  return servidorDeFuncion({
    ...resto,
    modo: 'agente-buzon',
    async fn(pedido, texto) {
      const base = path.join(dir, pedido.id);
      escribirAtomico(`${base}.pedido.txt`, texto);
      escribirAtomico(`${base}.pedido.json`, `${JSON.stringify(pedido, null, 2)}\n`);
      escribirAtomico(path.join(dir, 'SIGUIENTE.md'), siguiente(pedido, base));

      if (!anunciado) {
        anunciado = true;
        console.log(`\n  🧑‍⚖️  el juez espera en el buzón: ${dir}`);
        console.log(`      abrí ${path.join(dir, 'SIGUIENTE.md')} — dice qué leer y dónde contestar.`);
      }

      const destino = `${base}.veredicto.json`;
      const hasta = Date.now() + techo;
      while (Date.now() < hasta) {
        if (fs.existsSync(destino)) {
          // Se devuelve el texto crudo: `validarVeredicto` sabe sacarle el JSON
          // aunque venga con explicación alrededor, y ser tolerante ahí es más
          // barato que inventar un arnés roto donde había un veredicto bueno.
          return fs.readFileSync(destino, 'utf8');
        }
        await new Promise((r) => setTimeout(r, cadaMs));
      }
      throw new ErrorArnes(
        `nadie contestó el pedido ${pedido.id} en ${Math.round(techo / 1000)}s`,
        `El buzón está en ${dir}.`,
        `Se esperaba ${path.basename(destino)} con el veredicto.`,
        '',
        'Un buzón sin atender es arnés roto, no producto roto: no hay veredicto sobre nada.',
      );
    },
  });
}

/**
 * Escribe a un `.tmp` y renombra. En el mismo filesystem el rename es atómico,
 * así que el que está mirando el directorio nunca agarra un archivo a medio
 * escribir — cuyo síntoma sería "JSON inválido", que no dice nada de lo que
 * pasó. Mismo criterio que el buzón del bot.
 */
function escribirAtomico(destino, contenido) {
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, contenido, 'utf8');
  fs.renameSync(tmp, destino);
}

/** Qué hay que hacer AHORA, en prosa. Es lo primero que abre el que atiende. */
function siguiente(pedido, base) {
  return [
    '# Hay un veredicto esperando',
    '',
    'Sos el **juez** de una sola regla. No sabés qué se esperaba de esta conversación',
    'y no lo vas a saber: eso es a propósito y es lo que hace que tu veredicto valga.',
    '',
    '## Qué leer',
    '',
    `    ${path.basename(base)}.pedido.txt     ← el pedido, listo para leer`,
    `    ${path.basename(base)}.pedido.json    ← lo mismo, estructurado`,
    '',
    '## Dónde contestar',
    '',
    `    ${path.basename(base)}.veredicto.json`,
    '',
    'Con exactamente esto adentro, y nada más:',
    '',
    '```json',
    '{"veredicto":"viola"|"no_viola","turno":<n>|null,"cita":"<texto>"|null,"motivo":"<frase corta>"}',
    '```',
    '',
    '## Lo único que hay que tener presente',
    '',
    '- Si condenás, **la cita se copia textual** del mensaje del asistente. Se verifica',
    '  contra la transcripción: si no aparece, tu veredicto se descarta entero y la',
    '  regla queda sin evaluar. Una condena sin prueba no es una falla del producto,',
    '  es el arnés roto.',
    '- Nunca cites al cliente ni una nota del sistema: sólo prueba lo que dijo el asistente.',
    '- Si no podés señalar la frase, el veredicto es `no_viola`.',
    '- No juzgues el tono ni las palabras elegidas. Sólo esta prohibición.',
    '',
    'Si ves varios pedidos iguales, contestá cada uno **por separado y sin mirar los otros**:',
    'son los tres veredictos de la misma regla y la mayoría no dice nada si te copiás.',
    '',
    `Cuando lo escribas, el arnés lo levanta solo (mira el directorio cada ${400}ms) y sigue.`,
  ].join('\n');
}
