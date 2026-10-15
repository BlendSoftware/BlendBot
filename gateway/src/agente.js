/**
 * El puente con el modelo: una query del Agent SDK por mensaje de WhatsApp.
 *
 * Rescatado de wa-claude/src/claude.js (`runSdkQuery`), sin nada de Baileys:
 *  - `resume` para continuar la conversación en vez de re-explicar el contexto
 *  - `AbortController` con techo de tiempo, porque una query colgada no se
 *    cae sola: se queda esperando un socket muerto para siempre y el cliente
 *    del otro lado se queda mirando el "escribiendo..."
 *  - el `session_id` sale de los mensajes del stream y se persiste afuera
 *
 * Lo que agrega este gateway y wa-claude no necesitaba: **aislamiento por
 * tenant**. El MCP se levanta por conversación con el `agente_token` del
 * negocio y el `CLIENTE_TELEFONO` de quien escribió. Por eso el modelo no
 * puede pasar un `negocio_id` como argumento aunque quiera: no existe la tool
 * que lo acepte, y el proceso que las sirve ya está atado a un solo negocio.
 */

import fs from 'node:fs';
import path from 'node:path';

export const TIMEOUT_MS = 90_000;

/**
 * Guarda contra afirmaciones sin tool: caso de producción del 15/10. En una
 * conversación reanudada de ~40 turnos, gemini-2.5-flash-lite afirmó "Ya
 * está en el local" (y un precio de 3 pizzas) sin haber llamado `confirmar`
 * ni ninguna tool de catálogo. El cliente creyó que pidió; el local nunca se
 * enteró. Si el texto final afirma una de estas cosas y el turno no llamó a
 * la tool que la respalda, no se manda: se reintenta una vez con sesión
 * nueva y, si tampoco alcanza, se manda el texto seguro.
 */
const TOOL_CONFIRMAR = 'mcp__copiloto__confirmar';
/** Tools que devuelven un precio real (ver `agente/server.py`). */
const TOOLS_DE_PRECIO = ['mcp__copiloto__ver_catalogo', 'mcp__copiloto__armar_compromiso', TOOL_CONFIRMAR];
/** Frases (en minúscula) que afirman que el pedido quedó confirmado/enviado. */
const FRASES_DE_CONFIRMACION = ['confirmad', 'ya está en el local', 'le pasé', 'se envió al local', 'ya lo pasé'];
const REGEX_PRECIO = /\$\s?\d/;
const TEXTO_SEGURO = 'Perdón, no pude registrar tu pedido todavía. ¿Me lo repetís así lo cargo?';

/** @returns {boolean} si el texto afirma algo que el set de tools usadas no respalda. */
function afirmaSinRespaldo(texto, toolsUsadas) {
  const minusculas = texto.toLowerCase();
  const afirmaConfirmacion = FRASES_DE_CONFIRMACION.some((frase) => minusculas.includes(frase));
  const afirmaPrecio = REGEX_PRECIO.test(texto);
  const faltaConfirmar = afirmaConfirmacion && !toolsUsadas.has(TOOL_CONFIRMAR);
  const faltaToolDePrecio = afirmaPrecio && !TOOLS_DE_PRECIO.some((nombre) => toolsUsadas.has(nombre));
  return faltaConfirmar || faltaToolDePrecio;
}

/** Se tira cuando la query pasó el techo de tiempo. El caller se disculpa. */
export class AgenteTimeout extends Error {
  constructor(ms) {
    super(`la query del agente superó ${ms}ms y fue abortada`);
    this.name = 'AgenteTimeout';
  }
}

let _queryDelSdk = null;
async function queryPorDefecto(args) {
  if (!_queryDelSdk) {
    ({ query: _queryDelSdk } = await import('@anthropic-ai/claude-agent-sdk'));
  }
  return _queryDelSdk(args);
}

/**
 * @param {object} opts
 * @param {object} opts.config
 * @param {object} opts.sesiones  el store de sesiones.js
 * @param {Function} [opts.queryFn]  inyectable — los tests no hablan con la API
 * @param {number} [opts.timeoutMs]
 * @param {(vertical: string) => string} [opts.leerSkill]
 */
export function crearAgente({
  config,
  sesiones,
  queryFn = queryPorDefecto,
  timeoutMs = TIMEOUT_MS,
  leerSkill,
} = {}) {
  const cacheSkill = new Map();
  const dirAgente = path.join(config.raizRepo, 'agente');

  const leer = leerSkill || ((vertical) => {
    const ruta = path.join(dirAgente, 'skills', vertical, 'SKILL.md');
    return fs.readFileSync(ruta, 'utf8');
  });

  function systemPrompt(vertical) {
    if (!cacheSkill.has(vertical)) {
      let texto;
      try {
        texto = leer(vertical);
      } catch (err) {
        throw new Error(
          `No encontré el SKILL.md del vertical "${vertical}" (${err.message}). ` +
          'Revisá el campo `vertical` del tenant en tenants.json.',
        );
      }
      cacheSkill.set(vertical, texto);
    }
    return cacheSkill.get(vertical);
  }

  /** El MCP del agente, atado a ESTE negocio y ESTE cliente. */
  function mcpServers(tenant, telefono) {
    return {
      copiloto: {
        type: 'stdio',
        command: 'uv',
        args: ['--directory', dirAgente, 'run', 'python', 'server.py'],
        // Entorno MÍNIMO: sólo lo que el MCP necesita para arrancar (PATH para
        // encontrar uv/python) más los cinco datos de la sesión. NO se spreadea
        // process.env: ahí viven ANTHROPIC_API_KEY, META_GRAPH_TOKEN y
        // META_APP_SECRET, y un prompt injection que logre correr algo dentro
        // del MCP no tiene por qué poder leerlos.
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CORE_URL: config.coreUrl,
          AGENTE_TOKEN: tenant.agente_token,
          CLIENTE_TELEFONO: telefono,
          VERTICAL: tenant.vertical,
          // Dónde espejar el borrador y el hold entre procesos MCP (uno nuevo
          // por mensaje): sin esto, confirmar en el mensaje siguiente no
          // encuentra lo que armó el mensaje anterior.
          BORRADORES_DIR: config.borradoresDir,
        },
      },
    };
  }

  /**
   * Corre una consulta y devuelve el texto final para mandarle al cliente.
   *
   * @param {object} p
   * @param {object} p.tenant
   * @param {string} p.telefono
   * @param {string} p.texto
   * @param {string} p.clave  chatKey (phone_number_id:telefono)
   * @returns {Promise<{texto: string, sesionId: string|null, reanudo: boolean}>}
   */
  async function responder(p) {
    const guardada = sesiones.obtener(p.clave) || undefined;
    let r;
    try {
      r = await intentar(p, guardada);
    } catch (err) {
      // El resume-id vive en el gateway, pero la conversación la guarda el motor
      // del agente en su propio disco. Si ese disco se perdió (contenedor
      // recreado sin volumen), el id apunta a nada y fallaría en cada mensaje:
      // se olvida y se arranca una conversación nueva.
      if (!guardada || !/No conversation found/i.test(err?.message || '')) throw err;
      console.warn('[agente] %s: la sesión guardada ya no existe, arranco una nueva', p.clave);
      sesiones.borrar(p.clave);
      r = await intentar(p, undefined);
    }
    return { texto: r.texto, sesionId: r.sesionId, reanudo: r.reanudo };
  }

  async function intentar(p, resume) {
    const primero = await unIntento(p, resume);
    if (!afirmaSinRespaldo(primero.texto, primero.toolsUsadas)) return primero;

    console.warn('[agente] %s: afirmó sin respaldo de tool — reintento con sesión nueva', p.clave);
    const segundo = await unIntento(p, undefined);
    if (!afirmaSinRespaldo(segundo.texto, segundo.toolsUsadas)) return segundo;

    console.warn('[agente] %s: el reintento también afirmó sin respaldo — mando texto seguro', p.clave);
    return { ...segundo, texto: TEXTO_SEGURO };
  }

  /** Una sola corrida del SDK — sin la guarda de arriba, que vive en `intentar`. */
  async function unIntento({ tenant, telefono, texto, clave }, resume) {
    const opciones = {
      model: config.modelo,
      systemPrompt: systemPrompt(tenant.vertical),
      mcpServers: mcpServers(tenant, telefono),
      // `tools: []` es lo que RESTRINGE el set de herramientas: deja fuera todo
      // el preset de Claude Code (Bash, Read, Write, WebFetch…) y sólo sobreviven
      // las tools del MCP `copiloto`. `allowedTools` NO restringe — según el SDK
      // sólo auto-aprueba —, así que sin esto un prompt injection en un mensaje
      // de WhatsApp tendría acceso al disco del servidor.
      tools: [],
      // Cinturón además del tirante: bloquea explícitamente las peligrosas por
      // si una versión futura del SDK cambia el default de `tools`.
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'Glob', 'Grep'],
      // Auto-aprueba las tools del MCP (son las únicas que quedan) para no colgar
      // la conversación esperando un permiso que nadie va a contestar.
      allowedTools: ['mcp__copiloto'],
      // Nada de CLAUDE.md, settings ni skills del disco: la única instrucción
      // es el SKILL.md del vertical.
      settingSources: [],
      cwd: dirAgente,
      includePartialMessages: false,
    };
    if (resume) opciones.resume = resume;

    const ac = new AbortController();
    opciones.abortController = ac;
    let vencio = false;
    const reloj = setTimeout(() => {
      vencio = true;
      console.warn('[agente] %s superó %dms — abortando', clave, timeoutMs);
      ac.abort();
    }, timeoutMs);

    let salida = '';
    let sesionId = null;
    const toolsUsadas = new Set();
    const t0 = Date.now();

    try {
      const stream = await queryFn({ prompt: texto, options: opciones });
      for await (const msg of stream) {
        if (msg?.type === 'assistant' && Array.isArray(msg.message?.content)) {
          for (const bloque of msg.message.content) {
            if (bloque.type === 'text' && bloque.text) salida += bloque.text;
            if (bloque.type === 'tool_use' && bloque.name) toolsUsadas.add(bloque.name);
          }
        }
        // El session_id llega tanto en el 'system' de arranque como en el
        // 'result'. Nos quedamos con el último que veamos.
        if (msg?.session_id) sesionId = msg.session_id;
      }
    } catch (err) {
      if (vencio || /abort/i.test(err?.message || '')) throw new AgenteTimeout(timeoutMs);
      throw err;
    } finally {
      clearTimeout(reloj);
    }

    if (sesionId) sesiones.guardar(clave, sesionId);
    else if (resume) sesiones.tocar(clave);

    console.log(
      '[agente] %s · %dms · %s · %d chars',
      clave, Date.now() - t0, resume ? 'resume' : 'nueva', salida.length,
    );

    return { texto: salida.trim(), sesionId, reanudo: Boolean(resume), toolsUsadas };
  }

  return { responder };
}
