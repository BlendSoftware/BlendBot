/**
 * PROVEEDOR `agente` — el bot lo sirve un agente Claude leyendo el prompt real.
 *
 * Es el **único** proveedor que emite veredicto sobre el bot (`juzgaAlBot:
 * true`). El otro, `guion`, prueba el arnés.
 *
 * ── Por qué existe así (design §1, reescrita durante el apply) ──────────────
 * No hay `ANTHROPIC_API_KEY` en esta máquina y el dueño del producto decidió no
 * poner una. El principio no se movió: **el bot no lo puede escribir la misma
 * cabeza que escribió el prompt**. Un mock comparte los puntos ciegos del
 * prompt por construcción; un modelo leyendo el prompt de verdad tiene los
 * puntos ciegos del *producto*, que es lo que se viene a medir. Lo que cambió
 * es quién cumple el principio: un agente Claude en el loop, en vez de un
 * `POST` a la API.
 *
 * Qué se reproduce: el **prompt** (el `SKILL.md` que lee `crearAgente`) y las
 * **tools** (el MCP de `agente/`, con la config que le pasaría el SDK). Qué NO:
 * el **transporte** del Agent SDK — serialización del stream, reanudación de
 * sesión en disco, límites de tokens del SDK. Eso queda fuera de alcance y se
 * dice, no se deja implícito.
 *
 * Lo que se gana además de no gastar: **el agente puede ser interrogado**.
 * Cuando falla, se le puede preguntar por qué eligió esa tool. Un `POST` a la
 * API no ofrece eso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL PROTOCOLO — `arnes/proveedor-agente@1`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un turno de conversación es un **intercambio de dos archivos JSON** en un
 * directorio (el *buzón*). El arnés deja un pedido y espera una respuesta; el
 * agente lee el pedido y escribe la respuesta. Se repite hasta que el turno
 * cierra.
 *
 * ── Los archivos ────────────────────────────────────────────────────────────
 *
 *   <buzon>/SIGUIENTE.md                     ← qué hay que hacer AHORA, en prosa
 *   <buzon>/turno-003-paso-1.pedido.json     ← lo escribe el ARNÉS
 *   <buzon>/turno-003-paso-1.respuesta.json  ← lo escribe el AGENTE
 *
 * Los dos se escriben con `write` a un `.tmp` y después `rename`, que en el
 * mismo filesystem es atómico. Sin eso, el que lee agarra un archivo a medio
 * escribir y el error que ve es "JSON inválido", que no dice nada de lo que
 * pasó realmente.
 *
 * ── `pedido.json` — qué recibe el agente ────────────────────────────────────
 *
 * {
 *   "protocolo": "arnes/proveedor-agente@1",
 *   "corrida": "arnes-482910337",
 *   "turno": 3,                     // número de turno de la conversación
 *   "paso": 1,                      // ida y vuelta dentro del turno (tools)
 *   "sesion_id": "arnes-sesion-1",
 *   "instrucciones": "…",           // el contrato, en prosa, en cada pedido
 *   "system_prompt": {
 *     "origen": "agente/skills/gastronomia/SKILL.md",
 *     "texto": "<el SKILL.md ENTERO, tal cual lo lee crearAgente>"
 *   },
 *   "opciones_del_sdk": {           // las mismas que en producción, para auditar
 *     "model": "…", "tools": [], "allowedTools": ["mcp__copiloto"],
 *     "disallowedTools": [...], "settingSources": []
 *   },
 *   "tools": [                      // el catálogo REAL, salido de `tools/list` del MCP
 *     { "nombre": "mcp__copiloto__ver_catalogo",
 *       "nombre_corto": "ver_catalogo",
 *       "descripcion": "<el docstring real de agente/server.py>",
 *       "parametros": { …json schema… } }
 *   ],
 *   "historial": [                  // toda la conversación hasta acá
 *     { "rol": "cliente",   "texto": "hola" },
 *     { "rol": "asistente", "texto": "…", "tool_use": [ { "id": "…", "nombre": "…", "argumentos": {…} } ] },
 *     { "rol": "tool",      "tool_use_id": "…", "nombre": "…", "resultado": {…}, "error": false }
 *   ],
 *   "mensaje_del_cliente": "te piedo una hhhamburguesa doble cheddar yunas paps",
 *   "responder_en": "/ruta/absoluta/turno-003-paso-1.respuesta.json"
 * }
 *
 * ── `respuesta.json` — qué devuelve el agente ───────────────────────────────
 *
 * {
 *   "protocolo": "arnes/proveedor-agente@1",
 *   "turno": 3,
 *   "paso": 1,
 *   "texto": "¡Listo! Te lo armo así: …",   // lo que le decís al cliente; "" si sólo llamás tools
 *   "tool_use": [                            // vacío o ausente = el turno cierra acá
 *     { "nombre": "armar_compromiso",
 *       "argumentos": { "lineas": [ { "servicio": "doble cheddar" } ], "entrega": "retira" } }
 *   ],
 *   "uso":  { "input_tokens": null, "output_tokens": null },  // opcional; null es válido
 *   "costo_usd": null,                                        // opcional; null es válido
 *   "nota": "…"                                               // opcional: por qué elegiste esto
 * }
 *
 * ── Las reglas del intercambio ──────────────────────────────────────────────
 *
 *  1. **`tool_use` no vacío ⇒ el turno sigue.** El arnés ejecuta esas tools
 *     contra el MCP real, y escribe el pedido del paso siguiente con los
 *     resultados adentro del `historial`. `tool_use` vacío o ausente cierra el
 *     turno y ese `texto` es lo que sale por WhatsApp.
 *  2. **La tool se nombra corta o larga, indistinto.** `ver_catalogo` y
 *     `mcp__copiloto__ver_catalogo` valen las dos; `bot.js` traduce.
 *  3. **Los argumentos son los del esquema real**, el que viene en `tools[]`.
 *     No hay un esquema del arnés: es el de `agente/server.py`.
 *  4. **El agente no ve qué se espera.** El pedido trae el prompt, las tools y
 *     la conversación. No trae el nombre del escenario, ni las aserciones, ni
 *     si el turno anterior estuvo bien. Un agente que sabe qué se espera te da
 *     la razón, y ahí el arnés deja de medir el producto.
 *  5. **Ni texto ni tools = arnés roto**, no producto roto. Un bot mudo por un
 *     buzón mal contestado no es un bot mudo.
 *  6. **Un `respuesta.json` ilegible o de otro turno se rechaza con exit 2.**
 *     Aceptarlo "más o menos" es inventar un turno que nadie dijo.
 *
 * ── Cómo se ejercita ────────────────────────────────────────────────────────
 *
 *   1. Correr el escenario con `ARNES_BOT=agente`. Se cuelga esperando el
 *      primer `respuesta.json` e imprime la ruta del buzón.
 *   2. Abrir `<buzon>/SIGUIENTE.md`: dice qué archivo leer y dónde contestar.
 *   3. Leer el `pedido.json`, actuar **como el asistente que describe el
 *      `system_prompt`**, escribir el `respuesta.json`.
 *   4. El arnés lo levanta solo (mira el directorio cada 400ms) y sigue.
 *
 * El timeout es de 15 minutos por paso (`ARNES_BUZON_TIMEOUT_MS`) justamente
 * porque del otro lado hay alguien leyendo un `SKILL.md` de 400 líneas.
 *
 * ── El otro transporte, para tests del arnés ────────────────────────────────
 * `crearProveedorAgente({ responder })` acepta una función en proceso que
 * recibe el pedido y devuelve la respuesta. Es la misma costura sin el
 * filesystem en el medio: sirve para ejercitar el protocolo (que el pedido
 * traiga lo que promete, que una respuesta mal formada se rechace) sin nadie en
 * el loop. **No sirve para juzgar al bot**: quien juzgue al bot tiene que ser
 * un agente leyendo el prompt, no una función escrita al lado del prompt.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ErrorArnes } from '../../entorno.js';

export const PROTOCOLO = 'arnes/proveedor-agente@1';

/** Cada cuánto se mira el buzón. Bajo, porque el que espera es una máquina. */
const LATIDO_MS = 400;

/**
 * El contrato en prosa. Va **en cada pedido**, no en un README aparte: el
 * agente que contesta el turno 7 puede no haber leído nada de lo anterior, y un
 * protocolo que hay que ir a buscar es un protocolo que se cumple a medias.
 */
const INSTRUCCIONES = [
  'Sos el asistente descripto en `system_prompt`. Contestá el `mensaje_del_cliente`',
  'siguiendo ESE prompt y usando SOLAMENTE las tools de `tools`.',
  '',
  'Escribí tu respuesta en el archivo que dice `responder_en`, con esta forma:',
  '  { "protocolo": "' + PROTOCOLO + '", "turno": N, "paso": M,',
  '    "texto": "lo que le decís al cliente",',
  '    "tool_use": [ { "nombre": "ver_catalogo", "argumentos": {} } ] }',
  '',
  'Si querés llamar tools, poné `tool_use` y dejá `texto` vacío: el arnés las ejecuta',
  'de verdad contra el MCP y te vuelve a preguntar con los resultados en `historial`.',
  'Cuando `tool_use` va vacío (o no va), el turno cierra y `texto` es lo que sale por',
  'WhatsApp.',
  '',
  'No sabés qué se espera de vos y es a propósito: acá no hay un resultado correcto',
  'escrito en ningún lado. Contestá como contestaría el asistente del prompt.',
];

/**
 * @param {object} [opts]
 * @param {string} [opts.buzon]      directorio del intercambio. Vacío = un temp por corrida
 * @param {string} [opts.corrida]    etiqueta de la corrida, para el pedido
 * @param {number} [opts.timeoutMs]  cuánto se espera una respuesta
 * @param {(pedido: object) => Promise<object>} [opts.responder]
 *        transporte alternativo en proceso, para ejercitar el protocolo sin filesystem
 * @param {(m: string) => void} [opts.registrar]
 */
export function crearProveedorAgente({
  buzon = '',
  corrida = 'sin-corrida',
  timeoutMs = 900_000,
  responder = null,
  registrar = (m) => console.log(m),
} = {}) {
  const dir = responder
    ? null
    : (buzon || fs.mkdtempSync(path.join(os.tmpdir(), 'arnes-buzon-')));
  if (dir) fs.mkdirSync(dir, { recursive: true });

  let anunciado = false;

  return {
    nombre: 'agente',
    /**
     * **El único proveedor que puede decir algo sobre el bot.** El bot lo sirve
     * un agente leyendo el prompt real y llamando las tools reales.
     */
    juzgaAlBot: true,
    /** Las tools se ejecutan de verdad: sin MCP este proveedor no tiene sentido. */
    usaMcp: true,
    buzon: dir,

    async turno(contexto) {
      const pedido = armarPedido({ ...contexto, corrida });

      if (responder) {
        return leerRespuesta(await responder(pedido), pedido, '(transporte en proceso)');
      }

      if (!anunciado) {
        anunciado = true;
        registrar(
          `\n🤖 ARNES_BOT=agente — los turnos del bot los sirve un agente Claude.\n` +
          `   Buzón: ${dir}\n` +
          `   El arnés se queda esperando cada respuesta hasta ${Math.round(timeoutMs / 1000)}s.\n`,
        );
      }

      const base = `turno-${String(contexto.turno).padStart(3, '0')}-paso-${contexto.paso}`;
      const rutaPedido = path.join(dir, `${base}.pedido.json`);
      const rutaRespuesta = path.join(dir, `${base}.respuesta.json`);
      pedido.responder_en = rutaRespuesta;

      await escribirAtomico(rutaPedido, pedido);
      await escribirAtomico(path.join(dir, 'SIGUIENTE.md'), siguienteEnProsa(pedido, rutaPedido, rutaRespuesta), false);
      registrar(`   ⏳ turno ${contexto.turno} paso ${contexto.paso} — esperando ${path.basename(rutaRespuesta)}`);

      const crudo = await esperarArchivo(rutaRespuesta, timeoutMs, { pedido: rutaPedido });
      return leerRespuesta(crudo, pedido, rutaRespuesta);
    },

    async cerrar() {
      // El buzón NO se borra: es la evidencia de qué se le pidió al agente y
      // qué contestó. Borrarlo al terminar se lleva puesta justo la prueba de
      // la falla que se acaba de encontrar. Vive en un temp o en ARNES_BUZON.
      if (dir) registrar(`   📬 el buzón queda en ${dir} (es la evidencia del turno, no se borra)`);
    },
  };
}

// ── Armar el pedido ─────────────────────────────────────────────────────────

function armarPedido({ corrida, turno, paso, sesionId, mensajeDelCliente, systemPrompt, opciones, tools, historial }) {
  return {
    protocolo: PROTOCOLO,
    corrida,
    turno,
    paso,
    sesion_id: sesionId,
    instrucciones: INSTRUCCIONES.join('\n'),
    system_prompt: {
      // Se nombra el origen para que el que contesta pueda ir a leerlo entero
      // si quiere, y para que si un día el vertical cambia se vea acá.
      origen: `agente/skills/${opciones?.mcpServers?.copiloto?.env?.VERTICAL ?? 'gastronomia'}/SKILL.md`,
      texto: systemPrompt,
    },
    // Las opciones de producción viajan enteras: es lo que permite auditar, sin
    // leer código, que el bot del arnés corrió con el mismo cerebro y las
    // mismas restricciones que el de producción (tarea 9.2).
    opciones_del_sdk: {
      model: opciones?.model ?? null,
      tools: opciones?.tools ?? null,
      allowedTools: opciones?.allowedTools ?? null,
      disallowedTools: opciones?.disallowedTools ?? null,
      settingSources: opciones?.settingSources ?? null,
      resume: opciones?.resume ?? null,
    },
    tools: (tools ?? []).map((t) => ({
      nombre: t.nombre,
      nombre_corto: t.nombreCorto,
      descripcion: t.descripcion,
      parametros: t.parametros,
    })),
    historial: (historial ?? []).map(aHistorialPlano),
    mensaje_del_cliente: mensajeDelCliente,
    responder_en: null,
  };
}

function aHistorialPlano(h) {
  if (h.rol === 'asistente') {
    return {
      rol: 'asistente',
      texto: h.texto ?? null,
      tool_use: (h.toolUse ?? []).map((t) => ({ id: t.id, nombre: t.nombre, argumentos: t.argumentos })),
    };
  }
  if (h.rol === 'tool') {
    return {
      rol: 'tool',
      tool_use_id: h.tool_use_id,
      nombre: h.nombre,
      resultado: h.resultado,
      error: h.error === true,
    };
  }
  return { rol: 'cliente', texto: h.texto };
}

// ── Leer y validar la respuesta ─────────────────────────────────────────────

/**
 * Valida la respuesta y la traduce a lo que espera `bot.js`.
 *
 * Todo lo que se rechaza acá sale como **arnés roto** (exit 2), nunca como
 * falla del producto: una respuesta mal formada no es una decisión del bot, es
 * un turno que nunca se llegó a servir. Aceptarla "más o menos" sería inventar
 * un turno que nadie dijo, y ahí el arnés empieza a medirse a sí mismo.
 */
export function leerRespuesta(crudo, pedido, donde) {
  const r = crudo ?? {};
  const problemas = [];

  if (r.protocolo && r.protocolo !== PROTOCOLO) {
    problemas.push(`\`protocolo\` dice «${r.protocolo}» y este arnés habla «${PROTOCOLO}»`);
  }
  if (r.turno !== undefined && Number(r.turno) !== Number(pedido.turno)) {
    problemas.push(`es la respuesta del turno ${r.turno} y se pidió la del ${pedido.turno}`);
  }
  if (r.paso !== undefined && Number(r.paso) !== Number(pedido.paso)) {
    problemas.push(`es la respuesta del paso ${r.paso} y se pidió la del ${pedido.paso}`);
  }
  if (r.texto !== undefined && r.texto !== null && typeof r.texto !== 'string') {
    problemas.push('`texto` tiene que ser un string (o faltar)');
  }

  const toolUse = [];
  const crudas = r.tool_use ?? r.toolUse ?? [];
  if (!Array.isArray(crudas)) {
    problemas.push('`tool_use` tiene que ser una lista');
  } else {
    for (const [i, t] of crudas.entries()) {
      const nombre = t?.nombre ?? t?.name ?? '';
      if (!nombre) { problemas.push(`\`tool_use[${i}]\` no tiene \`nombre\``); continue; }
      const conocidas = pedido.tools.map((c) => [c.nombre, c.nombre_corto]).flat();
      if (conocidas.length && !conocidas.includes(nombre)) {
        // Una tool inventada es un hallazgo del PRODUCTO —regla 6 del SKILL:
        // no inventar— pero acá no se puede distinguir de un typo del que
        // contesta. Se rechaza y se nombran las que sí existen; si de verdad el
        // bot inventó una tool, el escenario lo asevera con nivel 2 sobre lo
        // que llamó, no con un crash del transporte.
        problemas.push(
          `\`tool_use[${i}].nombre\` = «${nombre}» no está en el catálogo real. ` +
          `Hay: ${pedido.tools.map((c) => c.nombre_corto).join(', ')}`,
        );
        continue;
      }
      const argumentos = t?.argumentos ?? t?.arguments ?? t?.input ?? {};
      if (typeof argumentos !== 'object' || Array.isArray(argumentos)) {
        problemas.push(`\`tool_use[${i}].argumentos\` tiene que ser un objeto`);
        continue;
      }
      toolUse.push({ nombre, argumentos });
    }
  }

  const texto = typeof r.texto === 'string' ? r.texto : '';
  if (!problemas.length && !texto && !toolUse.length) {
    problemas.push('no trae `texto` ni `tool_use`: no dice nada y no hace nada');
  }

  if (problemas.length) {
    throw new ErrorArnes(
      `la respuesta del agente al turno ${pedido.turno} (paso ${pedido.paso}) no cumple el protocolo`,
      `archivo: ${donde}`,
      '',
      ...problemas.map((p) => `  · ${p}`),
      '',
      'Esto es arnés roto, no producto roto: el turno nunca se llegó a servir, así que',
      'no hay nada que decir sobre el bot. Corregí el archivo y volvé a correr.',
    );
  }

  return {
    texto,
    toolUse,
    // `null` es un valor válido y esperado: un agente en el loop no reporta
    // precio. `presupuesto.js` sabe que null NO es cero.
    uso: r.uso ?? null,
    costoUsd: typeof r.costo_usd === 'number' ? r.costo_usd : null,
    nota: r.nota ?? null,
  };
}

// ── El filesystem, con cuidado ──────────────────────────────────────────────

/**
 * Escribe a un `.tmp` y renombra. En el mismo filesystem el rename es atómico,
 * así que el que está mirando el directorio nunca ve un archivo a medias — y un
 * JSON a medias se reporta como "JSON inválido", que no dice nada del problema
 * real y manda a buscarlo al lugar equivocado.
 */
async function escribirAtomico(ruta, contenido, comoJson = true) {
  const tmp = `${ruta}.tmp`;
  await fsp.writeFile(tmp, comoJson ? `${JSON.stringify(contenido, null, 2)}\n` : contenido, 'utf8');
  await fsp.rename(tmp, ruta);
}

/**
 * Espera a que aparezca el archivo y lo parsea.
 *
 * El `catch` del parse no aborta: si el archivo se está escribiendo sin rename
 * (porque el que contesta lo escribió con un editor), se reintenta al latido
 * siguiente. Sólo el timeout aborta.
 */
async function esperarArchivo(ruta, timeoutMs, contexto = {}) {
  const hasta = Date.now() + timeoutMs;
  for (;;) {
    try {
      const crudo = await fsp.readFile(ruta, 'utf8');
      if (crudo.trim()) return JSON.parse(crudo);
    } catch (err) {
      if (err.code !== 'ENOENT' && Date.now() >= hasta) {
        throw new ErrorArnes(
          `no pude leer la respuesta del agente en ${ruta}: ${err.message}`,
          'Si el archivo existe pero no parsea, quedó a medio escribir.',
        );
      }
    }
    if (Date.now() >= hasta) {
      throw new ErrorArnes(
        `el agente no contestó el turno en ${Math.round(timeoutMs / 1000)}s`,
        '',
        `  esperaba: ${ruta}`,
        `  el pedido está en: ${contexto.pedido ?? '(?)'}`,
        '',
        'Con ARNES_BOT=agente los turnos los sirve un agente Claude por el buzón: la',
        'corrida no avanza sola. Si querés una corrida desatendida, es ARNES_BOT=guion,',
        'que verifica el arnés y NO emite veredicto sobre el bot.',
        '',
        'Se puede estirar con ARNES_BUZON_TIMEOUT_MS.',
      );
    }
    await new Promise((listo) => setTimeout(listo, LATIDO_MS));
  }
}

/**
 * El archivo que el agente abre primero. Existe porque un protocolo que sólo
 * vive en un JSON obliga a leer el JSON para saber qué hacer con el JSON.
 */
function siguienteEnProsa(pedido, rutaPedido, rutaRespuesta) {
  const ultimasTools = (pedido.historial ?? [])
    .filter((h) => h.rol === 'tool')
    .slice(-4)
    .map((h) => `  · ${h.nombre} → ${JSON.stringify(h.resultado)?.slice(0, 160)}`);

  return [
    `# Turno ${pedido.turno}, paso ${pedido.paso} — te toca`,
    '',
    `**Leé:** \`${rutaPedido}\``,
    `**Escribí:** \`${rutaRespuesta}\``,
    '',
    '## Qué pasó recién',
    '',
    `El cliente escribió: **${JSON.stringify(pedido.mensaje_del_cliente)}**`,
    '',
    ...(ultimasTools.length ? ['Las últimas tools que llamaste devolvieron:', '', ...ultimasTools, ''] : []),
    '## Qué tenés que hacer',
    '',
    pedido.instrucciones,
    '',
    '## Las tools que existen',
    '',
    ...pedido.tools.map((t) => `  · \`${t.nombre_corto}\` — ${primeraLinea(t.descripcion)}`),
    '',
    '## El prompt',
    '',
    `Está entero en el campo \`system_prompt.texto\` del pedido, y su origen es`,
    `\`${pedido.system_prompt.origen}\`. Ese es el prompt de producción, sin recortar.`,
    '',
  ].join('\n');
}

function primeraLinea(texto) {
  return String(texto ?? '').split('\n')[0].slice(0, 120);
}
