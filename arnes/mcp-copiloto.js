/**
 * mcp-copiloto.js — las **tools reales** del bot, habladas por stdio.
 *
 * Cuando el bot corre por la API, el Agent SDK levanta el MCP de `agente/` y
 * ejecuta las tools por su cuenta. Sin API, ese trabajo hay que hacerlo acá: el
 * arnés levanta el MISMO proceso, con la MISMA configuración, y ejecuta las
 * mismas tools contra el core real.
 *
 * **Y la configuración no se inventa**: `arrancarMcp` recibe el bloque
 * `options.mcpServers.copiloto` tal cual lo armó `crearAgente` en
 * `gateway/src/agente.js` — el mismo `command`, los mismos `args`, el mismo
 * `env` mínimo (sin `ANTHROPIC_API_KEY`, sin `META_*`, con `AGENTE_TOKEN` y
 * `CLIENTE_TELEFONO` de esta conversación). Si el arnés armara ese spawn a
 * mano, un día el gateway le agregaría una variable de entorno al MCP y el
 * arnés seguiría probando el de antes, en verde.
 *
 * ── El detalle que decide si el escenario tiene sentido ─────────────────────
 * **Un proceso MCP por conversación, vivo de punta a punta.** No es una
 * optimización: `agente/sesion.py` guarda el borrador del pedido en el estado
 * del proceso, y `confirmar` lo lee de ahí. Un proceso por llamada haría que
 * `confirmar` no encuentre nunca lo que `armar_compromiso` acababa de armar, y
 * el síntoma sería "el bot no cierra el pedido" — buscado, por supuesto, en el
 * bot. Es la misma vida que le da el SDK en producción: una sesión MCP = una
 * conversación de WhatsApp.
 *
 * ── El transporte ───────────────────────────────────────────────────────────
 * MCP sobre stdio es JSON-RPC 2.0 con **una línea por mensaje**. No hay
 * `Content-Length` ni framing binario: se escribe JSON + `\n` y se lee lo mismo.
 * `stderr` del MCP NO es protocolo — es el log de `uv`/Python, y se guarda
 * aparte porque cuando algo falla ahí está la razón (un `AGENTE_TOKEN` mal
 * formado, el core caído, un import roto).
 */

import { spawn } from 'node:child_process';

import { ErrorArnes } from './entorno.js';

/** La versión del protocolo que se le pide al server. */
const PROTOCOLO = '2025-06-18';

/** Techo por llamada. Una tool colgada no se cae sola: se queda esperando. */
const TIMEOUT_LLAMADA_MS = 60_000;
/** Techo del arranque: `uv run` puede tener que resolver dependencias la primera vez. */
const TIMEOUT_ARRANQUE_MS = 120_000;

/**
 * Levanta el MCP y devuelve con qué hablarle.
 *
 * @param {object} spec  el `options.mcpServers.copiloto` que armó `crearAgente`
 * @param {{registrar?: (m:string)=>void}} [opts]
 */
export async function arrancarMcp(spec, { registrar = () => {} } = {}) {
  if (!spec || spec.type !== 'stdio' || !spec.command) {
    throw new ErrorArnes(
      'el MCP del agente no viene como un server stdio en las opciones del bot',
      `llegó: ${JSON.stringify(spec)?.slice(0, 300)}`,
      'Se espera `options.mcpServers.copiloto` tal cual lo arma gateway/src/agente.js.',
    );
  }

  const proceso = spawn(spec.command, spec.args ?? [], {
    cwd: spec.cwd,
    env: spec.env ?? {},
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  /** Lo que escupió el MCP por stderr. Es la evidencia cuando algo no arranca. */
  const bitacora = [];
  proceso.stderr.setEncoding('utf8');
  proceso.stderr.on('data', (t) => {
    bitacora.push(t);
    // Se acota para que un MCP que loguea en loop no se coma la memoria de la
    // corrida. Lo último es lo que importa: el error suele ser lo último.
    if (bitacora.length > 400) bitacora.splice(0, bitacora.length - 400);
  });

  /** @type {Map<number, {resolver:Function, rechazar:Function, reloj:any, metodo:string}>} */
  const enVuelo = new Map();
  let id = 0;
  let buffer = '';
  let muerto = null;

  proceso.stdout.setEncoding('utf8');
  proceso.stdout.on('data', (trozo) => {
    buffer += trozo;
    let corte;
    while ((corte = buffer.indexOf('\n')) >= 0) {
      const linea = buffer.slice(0, corte).trim();
      buffer = buffer.slice(corte + 1);
      if (!linea) continue;
      let msg;
      try {
        msg = JSON.parse(linea);
      } catch {
        // Una línea que no es JSON en stdout es un `print()` perdido en el
        // server. No es protocolo: se anota y se sigue, pero se anota, porque
        // rompe el transporte de MCP y hay que poder verlo.
        bitacora.push(`[stdout no-JSON] ${linea.slice(0, 200)}\n`);
        continue;
      }
      const espera = msg?.id !== undefined && enVuelo.get(msg.id);
      if (!espera) continue; // notificaciones del server: no se piden, no se esperan
      enVuelo.delete(msg.id);
      clearTimeout(espera.reloj);
      if (msg.error) {
        espera.rechazar(new Error(`el MCP falló en ${espera.metodo}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
      } else {
        espera.resolver(msg.result);
      }
    }
  });

  function morir(motivo) {
    muerto = motivo;
    for (const [, espera] of enVuelo) {
      clearTimeout(espera.reloj);
      espera.rechazar(new Error(motivo));
    }
    enVuelo.clear();
  }

  proceso.on('error', (err) => morir(
    err.code === 'ENOENT'
      ? `no encontré \`${spec.command}\` en el PATH — el MCP de agente/ se levanta con \`uv run\``
      : `el proceso del MCP falló: ${err.message}`,
  ));
  proceso.on('exit', (codigo, señal) => morir(
    `el proceso del MCP se murió (exit ${codigo}${señal ? `, señal ${señal}` : ''}).\n` +
    `Últimas líneas de su stderr:\n${cola(bitacora)}`,
  ));

  function pedir(metodo, params, timeoutMs = TIMEOUT_LLAMADA_MS) {
    if (muerto) return Promise.reject(new Error(muerto));
    id += 1;
    const mensaje = { jsonrpc: '2.0', id, method: metodo, params };
    return new Promise((resolver, rechazar) => {
      const reloj = setTimeout(() => {
        enVuelo.delete(mensaje.id);
        rechazar(new Error(
          `el MCP no contestó \`${metodo}\` en ${timeoutMs}ms.\n` +
          `Su stderr:\n${cola(bitacora)}`,
        ));
      }, timeoutMs);
      enVuelo.set(mensaje.id, { resolver, rechazar, reloj, metodo });
      proceso.stdin.write(`${JSON.stringify(mensaje)}\n`);
    });
  }

  function avisar(metodo, params) {
    proceso.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: metodo, params })}\n`);
  }

  // ── El apretón de manos ──────────────────────────────────────────────────
  let servidor;
  try {
    servidor = await pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'copiloto-arnes', version: '1.0.0' },
    }, TIMEOUT_ARRANQUE_MS);
  } catch (err) {
    proceso.kill('SIGKILL');
    throw new ErrorArnes(
      `no pude levantar el MCP de agente/: ${err.message}`,
      '',
      'Sin MCP el bot no tiene tools y contesta de memoria — o sea, la corrida',
      'fallaría por una razón que NO es el producto. Por eso esto es arnés roto.',
      '',
      `Se levantó así: ${spec.command} ${(spec.args ?? []).join(' ')}`,
      `  CORE_URL=${spec.env?.CORE_URL} VERTICAL=${spec.env?.VERTICAL}`,
      `  AGENTE_TOKEN=${String(spec.env?.AGENTE_TOKEN ?? '').slice(0, 8)}… CLIENTE_TELEFONO=${spec.env?.CLIENTE_TELEFONO}`,
    );
  }
  avisar('notifications/initialized', {});

  const { tools = [] } = await pedir('tools/list', {}, TIMEOUT_ARRANQUE_MS);
  registrar(`⚙️  MCP de agente/ arriba (${servidor?.serverInfo?.name ?? 'copiloto'}) · ${tools.length} tools`);

  return {
    /** Lo que declaró el server: nombre, descripción y esquema de cada tool. */
    tools,
    servidor,

    /**
     * Llama una tool y devuelve lo que devolvió, ya desenvuelto.
     *
     * FastMCP contesta con `content:[{type:'text',text:'<json>'}]` y, según la
     * versión, también con `structuredContent`. Se prefiere el estructurado y
     * se cae al texto parseado; si nada parsea, vuelve el texto crudo, que
     * sigue siendo lo que el modelo habría leído.
     */
    async llamar(nombre, argumentos = {}) {
      const r = await pedir('tools/call', { name: nombre, arguments: argumentos ?? {} });
      const texto = (r?.content ?? [])
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('\n');
      let valor = r?.structuredContent ?? null;
      if (valor === null && texto) {
        try { valor = JSON.parse(texto); } catch { valor = texto; }
      }
      return { valor: valor ?? texto ?? null, texto, esError: r?.isError === true, crudo: r };
    },

    /** Las últimas líneas del stderr del MCP. Evidencia, no aserción. */
    bitacora: () => cola(bitacora),

    async cerrar() {
      if (proceso.exitCode !== null) return;
      proceso.stdin.end();
      // Se le da un respiro para que cierre solo; si no, se lo baja. Un MCP
      // colgado deja el proceso del arnés sin terminar nunca.
      await new Promise((listo) => {
        const reloj = setTimeout(() => { proceso.kill('SIGKILL'); listo(); }, 3000);
        proceso.once('exit', () => { clearTimeout(reloj); listo(); });
      });
    },
  };
}

/**
 * Un pool de MCPs, uno por conversación.
 *
 * La clave es el `CLIENTE_TELEFONO` porque eso es lo que identifica a una
 * conversación en todo el sistema (el `chatKey` del gateway es
 * `phone_number_id:telefono`, y el `phone_number_id` es uno solo por corrida).
 */
export function crearPoolMcp({ registrar = () => {} } = {}) {
  /** @type {Map<string, Promise<object>>} */
  const abiertos = new Map();

  return {
    /** El MCP de esta conversación, levantándolo la primera vez. */
    obtener(spec) {
      const clave = String(spec?.env?.CLIENTE_TELEFONO ?? 'sin-telefono');
      if (!abiertos.has(clave)) abiertos.set(clave, arrancarMcp(spec, { registrar }));
      return abiertos.get(clave);
    },
    async cerrarTodo() {
      const todos = [...abiertos.values()];
      abiertos.clear();
      await Promise.allSettled(todos.map(async (p) => (await p).cerrar()));
    },
    get cantidad() { return abiertos.size; },
  };
}

function cola(lineas, cuantas = 20) {
  return lineas.join('').split('\n').slice(-cuantas).join('\n').trim() || '(vacío)';
}
