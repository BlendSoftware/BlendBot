/**
 * PROVEEDOR `agente` del cliente libre — lo sirve un agente Claude en personaje.
 *
 * Es el **único** proveedor del modo libre que improvisa de verdad
 * (`improvisa: true`), y por lo tanto el único cuyos hallazgos valen como
 * candidatos a escenario del modo `guion`. El otro, `de-prueba`, ejercita la
 * costura.
 *
 * ── Por qué existe así ──────────────────────────────────────────────────────
 * El design §2 dice que el cliente del modo libre es "un segundo modelo con
 * persona y objetivo". No hay `ANTHROPIC_API_KEY` en esta máquina y el dueño
 * del producto decidió no poner una, así que acá pasa exactamente lo mismo que
 * con el bot (design §1, reescrita durante el apply): **el principio no se
 * mueve, cambia quién lo cumple**. Un cliente improvisado por un agente en el
 * loop encuentra la frase que a nadie se le ocurrió; un cliente scripteado es
 * el modo `guion` con otro nombre.
 *
 * El transporte es el mismo buzón que `actores/proveedor/agente.js` usa para el
 * bot, y es a propósito: quien ya contestó turnos del bot no tiene que aprender
 * un protocolo nuevo. El contrato está escrito entero en
 * `actores/cliente/libre.js`.
 *
 * ── Lo que este archivo NO hace, y no es un olvido ──────────────────────────
 * No contiene una sola línea de lo que dice el cliente. Si acá hubiera un
 * `if (turno === 1) return 'hola'`, esto sería un guion y habría que llamarlo
 * guion.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ErrorArnes } from '../../../entorno.js';
import { PROTOCOLO_CLIENTE, leerRespuestaDelCliente } from '../libre.js';

/** Cada cuánto se mira el buzón. Bajo, porque el que espera es una máquina. */
const LATIDO_MS = 400;

/**
 * El contrato en prosa, en **cada** pedido.
 *
 * Igual que en el protocolo del bot: un contrato que hay que ir a buscar a otro
 * archivo es un contrato que se cumple a medias, y acá lo que se cumple a
 * medias es el personaje — que es justo lo único que hace valioso al modo.
 */
const INSTRUCCIONES = [
  'Sos la persona que describe `persona`, escribiéndole por WhatsApp a un local que no conocés.',
  'Tu objetivo es el de `objetivo`. Escribí el próximo mensaje que le mandarías.',
  '',
  'Escribí tu respuesta en el archivo que dice `responder_en`, con esta forma:',
  '  { "protocolo": "' + PROTOCOLO_CLIENTE + '", "turno": N,',
  '    "texto": "lo que le escribís al local",',
  '    "terminar": false, "motivo": null, "raro": null }',
  '',
  'Las reglas, que son cuatro:',
  '',
  '  1. NO salís del personaje. No sos un tester, no estás probando nada, no sabés que',
  '     esto es un arnés. Escribí como escribiría esa persona: si `como_escribis` dice',
  '     minúsculas y errores de tipeo, van minúsculas y errores de tipeo.',
  '  2. NO sabés qué se espera de vos ni qué se espera del local. No hay una respuesta',
  '     correcta escrita en ningún lado. Improvisá.',
  '  3. `terminar: true` cuando conseguiste lo que querías, o cuando en la vida real',
  '     cerrarías el chat (te cansaste, no te entendieron, te fuiste a otro lado).',
  '     Poné en `motivo` por qué te fuiste: esa frase vale tanto como la conversación.',
  '  4. `raro` es lo más importante que podés escribir. Si algo del local te resultó',
  '     raro —te prometió algo que no te podía prometer, te repreguntó lo que ya',
  '     dijiste, te ofreció algo que después no existía, contestó al lado—, decilo ahí',
  '     en una línea, como cliente y sin diagnosticar. Eso es lo que después se',
  '     convierte en un escenario del modo `guion`, que es el que defiende de verdad.',
];

/**
 * @param {object} [opts]
 * @param {string} [opts.buzon]     directorio del intercambio. Vacío = un temp por corrida
 * @param {string} [opts.corrida]
 * @param {number} [opts.timeoutMs]
 * @param {(pedido: object) => Promise<object>} [opts.responder]
 *        transporte alternativo en proceso, para ejercitar el protocolo sin filesystem.
 *        **Sigue sin improvisar**: quien escribe la función escribe al cliente.
 * @param {(m: string) => void} [opts.registrar]
 */
export function crearProveedorClienteAgente({
  buzon = '',
  corrida = 'sin-corrida',
  timeoutMs = 900_000,
  responder = null,
  registrar = (m) => console.log(m),
} = {}) {
  const dir = responder
    ? null
    : (buzon || fs.mkdtempSync(path.join(os.tmpdir(), 'arnes-cliente-')));
  if (dir) fs.mkdirSync(dir, { recursive: true });

  let anunciado = false;

  return {
    nombre: 'agente',
    /**
     * **El único cliente del modo libre que improvisa.** Un hallazgo suyo es un
     * candidato a escenario; un hallazgo del `de-prueba` es una línea que
     * alguien escribió.
     *
     * Con el transporte en proceso (`responder`) esto sigue siendo `true` sólo
     * si quien lo enchufa es un agente. Como no se puede saber desde acá, se
     * declara `false` cuando hay `responder`: la dirección conservadora es no
     * atribuirle improvisación a algo que puede ser una función escrita al lado.
     */
    improvisa: !responder,
    buzon: dir,

    async turno(contexto) {
      const pedido = armarPedido({ ...contexto, corrida });

      if (responder) {
        return leerRespuestaDelCliente(await responder(pedido), pedido, '(transporte en proceso)');
      }

      if (!anunciado) {
        anunciado = true;
        registrar(
          `\n👤 ARNES_CLIENTE=agente — los turnos del cliente los improvisa un agente Claude.\n` +
          `   Buzón: ${dir}\n` +
          `   El arnés se queda esperando cada respuesta hasta ${Math.round(timeoutMs / 1000)}s.\n`,
        );
      }

      const base = `cliente-turno-${String(contexto.turno).padStart(2, '0')}`;
      const rutaPedido = path.join(dir, `${base}.pedido.json`);
      const rutaRespuesta = path.join(dir, `${base}.respuesta.json`);
      pedido.responder_en = rutaRespuesta;

      await escribirAtomico(rutaPedido, pedido);
      await escribirAtomico(
        path.join(dir, 'SIGUIENTE.md'),
        siguienteEnProsa(pedido, rutaPedido, rutaRespuesta),
        false,
      );
      registrar(`   ⏳ turno ${contexto.turno} de ${contexto.topeDeTurnos} — esperando ${path.basename(rutaRespuesta)}`);

      const crudo = await esperarArchivo(rutaRespuesta, timeoutMs, { pedido: rutaPedido });
      return leerRespuestaDelCliente(crudo, pedido, rutaRespuesta);
    },

    async cerrar() {
      // El buzón no se borra: es la evidencia de qué improvisó el cliente y qué
      // le contestó el local. Borrarlo al terminar se lleva puesto justo el
      // material del que sale el escenario nuevo.
      if (dir) registrar(`   📬 el buzón del cliente queda en ${dir} (es la evidencia, no se borra)`);
    },
  };
}

// ── Armar el pedido ─────────────────────────────────────────────────────────

function armarPedido({ corrida, turno, topeDeTurnos, persona, objetivo, conversacion }) {
  return {
    protocolo: PROTOCOLO_CLIENTE,
    corrida,
    turno,
    tope_de_turnos: topeDeTurnos,
    instrucciones: INSTRUCCIONES.join('\n'),
    persona,
    objetivo,
    // Sólo lo que el cliente pudo ver: lo que él escribió y lo que le llegó al
    // teléfono. Nada de tools, nada de estado del core, nada del SKILL.md. Un
    // cliente que ve las tools del bot deja de ser un cliente.
    conversacion: (conversacion ?? []).map((c) => ({ rol: c.rol, texto: c.texto })),
    responder_en: null,
  };
}

// ── El filesystem, con cuidado ──────────────────────────────────────────────

/** Escribe a un `.tmp` y renombra: en el mismo filesystem el rename es atómico. */
async function escribirAtomico(ruta, contenido, comoJson = true) {
  const tmp = `${ruta}.tmp`;
  await fsp.writeFile(tmp, comoJson ? `${JSON.stringify(contenido, null, 2)}\n` : contenido, 'utf8');
  await fsp.rename(tmp, ruta);
}

async function esperarArchivo(ruta, timeoutMs, contexto = {}) {
  const hasta = Date.now() + timeoutMs;
  for (;;) {
    try {
      const crudo = await fsp.readFile(ruta, 'utf8');
      if (crudo.trim()) return JSON.parse(crudo);
    } catch (err) {
      if (err.code !== 'ENOENT' && Date.now() >= hasta) {
        throw new ErrorArnes(
          `no pude leer la respuesta del cliente en ${ruta}: ${err.message}`,
          'Si el archivo existe pero no parsea, quedó a medio escribir.',
        );
      }
    }
    if (Date.now() >= hasta) {
      throw new ErrorArnes(
        `el cliente libre no contestó el turno en ${Math.round(timeoutMs / 1000)}s`,
        '',
        `  esperaba: ${ruta}`,
        `  el pedido está en: ${contexto.pedido ?? '(?)'}`,
        '',
        'Con ARNES_CLIENTE=agente los turnos del cliente los improvisa un agente: la corrida',
        'no avanza sola. Si querés ejercitar el bucle sin nadie en el loop es',
        'ARNES_CLIENTE=de-prueba, que NO improvisa y por lo tanto NO encuentra nada.',
        '',
        'Se puede estirar con ARNES_BUZON_TIMEOUT_MS.',
      );
    }
    await new Promise((listo) => setTimeout(listo, LATIDO_MS));
  }
}

/** El archivo que el agente abre primero. */
function siguienteEnProsa(pedido, rutaPedido, rutaRespuesta) {
  const ultimo = [...(pedido.conversacion ?? [])].reverse().find((c) => c.rol === 'local');

  return [
    `# Turno ${pedido.turno} de ${pedido.tope_de_turnos} — sos el cliente`,
    '',
    `**Leé:** \`${rutaPedido}\``,
    `**Escribí:** \`${rutaRespuesta}\``,
    '',
    '## Quién sos',
    '',
    `${pedido.persona?.quien_sos ?? ''}`,
    '',
    `**Cómo escribís:** ${pedido.persona?.como_escribis ?? ''}`,
    `**Qué sabés:** ${pedido.persona?.que_sabes ?? ''}`,
    '',
    '## Qué querés',
    '',
    pedido.objetivo ?? '',
    '',
    '## La conversación hasta acá',
    '',
    ...(pedido.conversacion?.length
      ? pedido.conversacion.map((c) => `  ${c.rol === 'vos' ? '👤 vos  ' : '🏪 local'} · ${JSON.stringify(c.texto)}`)
      : ['  (todavía no escribiste nada: este es tu primer mensaje)']),
    '',
    ...(ultimo ? [`Lo último que te contestó el local:`, '', `> ${String(ultimo.texto).split('\n').join('\n> ')}`, ''] : []),
    '## Qué tenés que hacer',
    '',
    pedido.instrucciones,
    '',
  ].join('\n');
}
