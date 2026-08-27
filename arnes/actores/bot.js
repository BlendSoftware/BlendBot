/**
 * 🤖 El bot — la costura, no la implementación.
 *
 * Este archivo **no decide una sola respuesta**. Lo único que hace es armar el
 * `queryFn` que `crearAgente({config, sesiones, queryFn})` espera, correr el
 * bucle agéntico (pedir turno → ejecutar tools → volver a pedir) y delegar cada
 * decisión en un **proveedor inyectable**. Quién contesta se elige afuera, con
 * `ARNES_BOT`.
 *
 * ── Por qué la decisión vive afuera (design §1, reescrita durante el apply) ──
 * El principio que se protege es que **el bot no lo escriba la misma cabeza que
 * escribió el prompt**. Un mock con `if (mensaje.includes('hamburguesa'))`
 * comparte los puntos ciegos del prompt *por construcción*: sólo falla donde el
 * que lo escribió ya sabía que podía fallar, o sea nunca donde importa. Un
 * modelo leyendo el prompt de verdad tiene los puntos ciegos del **producto**,
 * que es exactamente lo que se viene a medir.
 *
 * Los dos proveedores que hay, y no se pueden confundir:
 *
 *   `proveedor/guion.js`  respuestas fijas. **Prueba el ARNÉS, jamás el bot.**
 *                         Un verde con guion quiere decir "mis respuestas fijas
 *                         siguen siendo fijas", no "el bot está bien".
 *   `proveedor/agente.js` un agente Claude leyendo el `SKILL.md` real y las
 *                         tools reales. **Es el único que emite veredicto sobre
 *                         el bot.**
 *
 * `nombreDelProveedor` viaja en el objeto que devuelve `crearBot` y en la
 * transcripción, para que ninguna salida pueda decir verde sin decir con qué
 * proveedor corrió.
 *
 * ── Qué reproduce y qué no ──────────────────────────────────────────────────
 * Reproduce el **prompt** (el `SKILL.md` del vertical, tal cual lo lee
 * `crearAgente`) y las **tools** (el MCP de `agente/`, levantado con la misma
 * config que le pasaría el SDK). NO reproduce el **transporte** del Agent SDK:
 * la serialización del stream, la reanudación de sesión en disco y los límites
 * de tokens del SDK quedan fuera de alcance, y hay que decirlo en vez de
 * dejarlo implícito. Todo lo que el arnés asevera sobre **qué decidió el bot**
 * —qué tool llamó, con qué argumentos, qué se negó a decir— es válido.
 */

import { ErrorArnes } from '../entorno.js';
import { crearPoolMcp } from '../mcp-copiloto.js';

/** Techo de idas y vueltas con tools dentro de UN turno. Un bucle se corta. */
export const MAX_PASOS_POR_TURNO = 12;

/**
 * Las opciones que `crearAgente` le manda al SDK en producción, y que este
 * arnés tiene que ver llegar **idénticas** (tarea 9.2).
 *
 * No es paranoia: si el arnés corriera con otras opciones —otro modelo, otro
 * set de tools, `settingSources` cargando el `CLAUDE.md` de la máquina— estaría
 * probando otro bot, y el veredicto entero no valdría. Que la verificación
 * viva acá y no en un test aparte es a propósito: se ejecuta en cada corrida,
 * gratis, y una divergencia se entera en el turno 1 y no en la revisión.
 */
const OPCIONES_DE_PRODUCCION = {
  tools: (v) => Array.isArray(v) && v.length === 0,
  settingSources: (v) => Array.isArray(v) && v.length === 0,
  allowedTools: (v) => Array.isArray(v) && v.includes('mcp__copiloto'),
  disallowedTools: (v) => Array.isArray(v)
    && ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'Glob', 'Grep'].every((t) => v.includes(t)),
  includePartialMessages: (v) => v === false,
  systemPrompt: (v) => typeof v === 'string' && v.length > 0,
  mcpServers: (v) => Boolean(v?.copiloto?.command),
};

const EXPLICACIONES = {
  tools: '`tools: []` es lo que RESTRINGE el set de herramientas; sin él sobrevive todo el preset de Claude Code',
  settingSources: '`settingSources: []` es lo que evita que el bot lea CLAUDE.md, settings y skills del disco',
  allowedTools: 'sin `mcp__copiloto` auto-aprobado la conversación se cuelga esperando un permiso que nadie contesta',
  disallowedTools: 'el cinturón además del tirante contra las tools peligrosas',
  includePartialMessages: 'con parciales prendidos el mismo texto llega dos veces y la transcripción lo duplica',
  systemPrompt: 'sin systemPrompt no hay SKILL.md, y sin SKILL.md el bot del arnés no es el bot',
  mcpServers: 'sin el MCP el bot no tiene tools y contesta de memoria',
};

/**
 * @param {object} opts
 * @param {object} opts.proveedor       de `proveedor/guion.js` o `proveedor/agente.js`
 * @param {object} opts.transcripcion   de `transcripcion.js` — el tee del stream
 * @param {object} [opts.presupuesto]   de `presupuesto.js`
 * @param {boolean} [opts.conMcp]       levantar el MCP real. Default: lo que pida el proveedor
 * @param {number} [opts.maxPasos]
 * @param {(m: string) => void} [opts.registrar]
 */
export function crearBot({
  proveedor,
  transcripcion,
  presupuesto = null,
  conMcp = null,
  maxPasos = MAX_PASOS_POR_TURNO,
  registrar = (m) => console.log(m),
}) {
  if (typeof proveedor?.turno !== 'function') {
    throw new Error(
      'crearBot: falta el proveedor. El bot NO se implementa acá — se elige afuera ' +
      'con ARNES_BOT (guion | agente). Ver actores/proveedor/.',
    );
  }
  if (!transcripcion?.observar) throw new Error('crearBot: falta la transcripción');

  const nombreDelProveedor = proveedor.nombre ?? 'sin-nombre';
  const usaMcp = conMcp === null ? proveedor.usaMcp !== false : conMcp;
  const pool = usaMcp ? crearPoolMcp({ registrar }) : null;

  /**
   * El historial por conversación.
   *
   * La clave es el `session_id`, que es exactamente lo que el gateway persiste
   * y le devuelve al SDK como `options.resume`. Así el arnés reproduce la
   * reanudación por la misma costura que producción: si el gateway dejara de
   * guardar el `session_id`, acá el bot empezaría de cero, igual que allá.
   *
   * @type {Map<string, Array<object>>}
   */
  const historiales = new Map();
  let sesiones = 0;

  /** Las opciones que se vieron llegar, para poder auditarlas después. */
  const opcionesVistas = [];

  /**
   * El `queryFn` que consume `crearAgente`. Async generator, como el `query`
   * del SDK: `for await (const msg of stream)`.
   */
  async function* queryFn({ prompt, options }) {
    verificarOpciones(options);
    opcionesVistas.push(options);

    // Se respeta el `resume` del gateway: si trae uno, se continúa esa
    // conversación; si no, es una nueva. Igual que el SDK.
    const sesionId = options.resume || `arnes-sesion-${++sesiones}`;
    if (!historiales.has(sesionId)) historiales.set(sesionId, []);
    const historial = historiales.get(sesionId);

    const turno = transcripcion.abrirTurnoDelBot({
      mensajeDelCliente: prompt,
      clave: sesionId,
      reanudo: Boolean(options.resume),
    });

    yield transcripcion.observar({ type: 'system', subtype: 'init', session_id: sesionId });

    const mcp = pool ? await pool.obtener(options.mcpServers.copiloto) : null;
    const catalogo = mcp ? catalogoDeTools(mcp.tools) : [];

    historial.push({ rol: 'cliente', texto: prompt });

    let usoDelTurno = null;
    let costoDelTurno = null;

    for (let paso = 1; paso <= maxPasos; paso += 1) {
      const respuesta = await proveedor.turno({
        mensajeDelCliente: prompt,
        systemPrompt: options.systemPrompt,
        opciones: options,
        tools: catalogo,
        historial: [...historial],
        paso,
        sesionId,
        // El **turno de la conversación**, no el índice de la línea de tiempo.
        // Son dos numeraciones y cada una tiene su público: al agente que
        // contesta le importa "estás contestando el 3er mensaje del cliente";
        // al que lee una falla a las once de la noche le importa el renglón
        // exacto de `transcripcion.md`, y ese lo numera `informe.js`.
        turno: turno.conv ?? turno.n,
      });

      // El presupuesto se anota **por paso**, y `costoUsd`/`uso` pueden venir
      // en null: con el proveedor `agente` nadie informa un precio. `null` no
      // es cero y `presupuesto.js` lo sabe leer.
      const bloques = [];
      const texto = String(respuesta?.texto ?? '');
      if (texto) bloques.push({ type: 'text', text: texto });

      const llamadas = (respuesta?.toolUse ?? []).map((t, i) => ({
        type: 'tool_use',
        id: t.id || `arnes-tool-${turno.n}-${paso}-${i + 1}`,
        name: conPrefijo(t.nombre, catalogo),
        input: t.argumentos ?? {},
        /** Sólo del guion: un resultado escrito a mano evita levantar el MCP. */
        _resultadoDelGuion: t.resultado,
      }));
      for (const l of llamadas) bloques.push({ type: 'tool_use', id: l.id, name: l.name, input: l.input });

      if (!bloques.length) {
        // Ni texto ni tools: el proveedor no dijo nada. Es arnés roto y no
        // producto roto — un bot que se queda mudo por un buzón mal contestado
        // no es un bot que se quedó mudo.
        throw new ErrorArnes(
          `el proveedor «${nombreDelProveedor}» devolvió un turno vacío (turno ${turno.n}, paso ${paso})`,
          'Una respuesta tiene que traer `texto`, o `toolUse`, o las dos cosas.',
        );
      }

      yield transcripcion.observar({
        type: 'assistant',
        session_id: sesionId,
        message: { role: 'assistant', content: bloques },
      });

      historial.push({
        rol: 'asistente',
        texto: texto || null,
        toolUse: llamadas.map((l) => ({ id: l.id, nombre: l.name, argumentos: l.input })),
      });

      const ultimoPaso = llamadas.length === 0;
      presupuesto?.anotar('bot', {
        costoUsd: respuesta?.costoUsd ?? null,
        uso: respuesta?.uso ?? null,
        cierraTurno: ultimoPaso,
      });
      if (respuesta?.uso) usoDelTurno = sumarUso(usoDelTurno, respuesta.uso);
      if (typeof respuesta?.costoUsd === 'number') costoDelTurno = (costoDelTurno ?? 0) + respuesta.costoUsd;

      if (ultimoPaso) break;

      // ── Ejecutar las tools de verdad ────────────────────────────────────
      const resultados = [];
      for (const llamada of llamadas) {
        let contenido;
        let esError = false;
        if (llamada._resultadoDelGuion !== undefined) {
          contenido = llamada._resultadoDelGuion;
        } else if (mcp) {
          const r = await mcp.llamar(llamada.name, llamada.input);
          contenido = r.valor;
          esError = r.esError;
        } else {
          throw new ErrorArnes(
            `el proveedor «${nombreDelProveedor}» pidió llamar \`${llamada.name}\` pero no hay MCP levantado`,
            'Un proveedor que llama tools tiene que declarar `usaMcp: true`,',
            'o traer el `resultado` escrito en cada `toolUse` (eso es lo que hace el guion).',
          );
        }
        resultados.push({ type: 'tool_result', tool_use_id: llamada.id, content: contenido, is_error: esError });
        historial.push({
          rol: 'tool',
          tool_use_id: llamada.id,
          nombre: llamada.name,
          resultado: contenido,
          error: esError,
        });
      }

      yield transcripcion.observar({
        type: 'user',
        session_id: sesionId,
        message: { role: 'user', content: resultados },
      });

      if (paso === maxPasos) {
        throw new ErrorArnes(
          `el bot no cerró el turno ${turno.n} en ${maxPasos} pasos de tools`,
          'Se corta acá para no quedarse en un bucle. Mirá la transcripción: si el bot',
          'llama la misma tool una y otra vez, el hallazgo es ese y hay que escribirlo',
          'como escenario, no subir el techo.',
        );
      }
    }

    yield transcripcion.observar({
      type: 'result',
      subtype: 'success',
      session_id: sesionId,
      usage: usoDelTurno,
      total_cost_usd: costoDelTurno,
    });

    transcripcion.cerrarTurnoDelBot();
  }

  return {
    queryFn,
    /** Qué proveedor sirvió los turnos. Viaja a toda salida, sin excepción. */
    nombreDelProveedor,
    /** ¿Esta corrida puede emitir un veredicto sobre el bot, o sólo sobre el arnés? */
    juzgaAlBot: proveedor.juzgaAlBot === true,
    opcionesVistas,
    async cerrar() {
      await pool?.cerrarTodo();
      await proveedor.cerrar?.();
    },
  };
}

// ── La verificación de las opciones (tarea 2.1 y 9.2) ───────────────────────

/**
 * Que las opciones que llegan al `queryFn` sean las de producción.
 *
 * Falla con **arnés roto**, no con producto roto: si el bot corrió con otras
 * opciones, el arnés no probó el bot — probó otra cosa y no tiene veredicto.
 */
export function verificarOpciones(options) {
  if (!options || typeof options !== 'object') {
    throw new ErrorArnes('el queryFn del arnés recibió opciones vacías: no es el `crearAgente` de producción');
  }
  const mal = [];
  for (const [clave, comprobar] of Object.entries(OPCIONES_DE_PRODUCCION)) {
    if (!comprobar(options[clave])) {
      mal.push(`  · ${clave} = ${JSON.stringify(options[clave])?.slice(0, 120)} — ${EXPLICACIONES[clave]}`);
    }
  }
  if (!mal.length) return;
  throw new ErrorArnes(
    `el bot del arnés no está recibiendo las opciones de producción (${mal.length} divergencia${mal.length > 1 ? 's' : ''})`,
    '',
    ...mal,
    '',
    'Cualquier diferencia acá invalida el veredicto entero: el arnés estaría probando',
    'otro bot que el que corre en producción. Si la diferencia es inevitable, hay que',
    'dejarla escrita en el design, no tolerarla en silencio.',
  );
}

// ── Detalles de forma ───────────────────────────────────────────────────────

/**
 * El catálogo que ve el proveedor: nombre completo (el que espera el MCP),
 * nombre corto (el que usa el `SKILL.md`), descripción y esquema.
 */
function catalogoDeTools(tools) {
  return (tools ?? []).map((t) => ({
    nombre: t.name,
    nombreCorto: String(t.name).split('__').pop(),
    descripcion: t.description ?? '',
    parametros: t.inputSchema ?? null,
  }));
}

/**
 * El proveedor puede nombrar la tool como la nombra el `SKILL.md`
 * (`ver_catalogo`) y acá se traduce al nombre que el MCP entiende. Obligar al
 * que escribe un guion a acordarse del prefijo es una fuente de fallas que no
 * enseñan nada.
 */
function conPrefijo(nombre, catalogo) {
  const corto = String(nombre ?? '');
  const encontrada = catalogo.find((t) => t.nombre === corto || t.nombreCorto === corto);
  return encontrada?.nombre ?? corto;
}

function sumarUso(a, b) {
  if (!b) return a;
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b.output_tokens ?? 0),
  };
}
