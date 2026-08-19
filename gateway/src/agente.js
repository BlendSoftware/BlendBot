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
        env: {
          ...process.env,
          CORE_URL: config.coreUrl,
          AGENTE_TOKEN: tenant.agente_token,
          CLIENTE_TELEFONO: telefono,
          VERTICAL: tenant.vertical,
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
  async function responder({ tenant, telefono, texto, clave }) {
    const resume = sesiones.obtener(clave) || undefined;

    const opciones = {
      model: config.modelo,
      systemPrompt: systemPrompt(tenant.vertical),
      mcpServers: mcpServers(tenant, telefono),
      // El agente sólo puede usar SUS tools. Sin esto el SDK le deja Bash, Read
      // y Write: un prompt injection en un mensaje de WhatsApp pasaría de ser
      // un chiste a ser acceso al disco del servidor.
      allowedTools: ['mcp__copiloto'],
      // Nada de CLAUDE.md, settings ni skills del disco: la única instrucción
      // es el SKILL.md del vertical.
      settingSources: [],
      permissionMode: 'bypassPermissions',
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
    const t0 = Date.now();

    try {
      const stream = await queryFn({ prompt: texto, options: opciones });
      for await (const msg of stream) {
        if (msg?.type === 'assistant' && Array.isArray(msg.message?.content)) {
          for (const bloque of msg.message.content) {
            if (bloque.type === 'text' && bloque.text) salida += bloque.text;
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

    return { texto: salida.trim(), sesionId, reanudo: Boolean(resume) };
  }

  return { responder };
}
