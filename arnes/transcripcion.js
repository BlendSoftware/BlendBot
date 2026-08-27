/**
 * transcripcion.js — lo que pasó, turno por turno, en una estructura que se
 * puede aseverar.
 *
 * Es la memoria de la corrida y la fuente de los tres niveles de aserción:
 *   - **nivel 2** (tools) sale de acá y de ningún otro lado,
 *   - **nivel 3** (dicho) se le da al juez como contexto,
 *   - y la salida legible de `arnes/salida/` se arma con esto.
 *
 * ── De dónde salen los datos ────────────────────────────────────────────────
 * `observar(msg)` come **mensajes con la forma del stream del Agent SDK**, que
 * es exactamente lo que `crearAgente` consume en `gateway/src/agente.js`:
 *
 *   `{type:'system', subtype:'init', session_id}`
 *   `{type:'assistant', session_id, message:{content:[{type:'text'|'tool_use', …}]}}`
 *   `{type:'user',      session_id, message:{content:[{type:'tool_result', …}]}}`
 *   `{type:'result',    session_id, usage, total_cost_usd}`
 *
 * Se lee esa forma y no una propia **a propósito**: el `queryFn` del arnés está
 * enchufado en la misma costura que en producción, así que si un día vuelve a
 * haber una API de por medio, esta transcripción sigue leyendo lo mismo sin
 * tocar una línea. La transcripción no sabe —ni tiene por qué saber— quién
 * sirvió los turnos.
 *
 * ── El detalle que hace que las aserciones sirvan ───────────────────────────
 * Cada `tool_use` se guarda con su **orden global** además de su orden dentro
 * del turno. Sin el orden global no se puede aseverar *"consultó el catálogo
 * antes de armar el compromiso"* cuando las dos llamadas caen en turnos
 * distintos — y ese es justo el caso del Flujo A, donde `ver_catalogo` pasa en
 * el turno 2 y `armar_compromiso` en el 3.
 *
 * Y cada `tool_use` se **empareja con su `tool_result`** por `tool_use_id`. Sin
 * eso, una tool que se llamó y devolvió `ok:false` se ve igual que una que
 * anduvo, y la mitad de los escenarios del `SKILL.md` son justamente sobre qué
 * hace el bot cuando una tool le contesta que no.
 *
 * ── Y la bitácora, que es quien lo cuenta ───────────────────────────────────
 * Esto **no imprime nada y no escribe archivos**. De convertir lo que pasó en
 * `transcripcion.md`, en una línea de falla anclada al renglón exacto y en un
 * exit code se ocupa `informe.js`. Si se le pasa una `bitacora`
 * (`informe.escenario({...})`), cada evento se espeja ahí a medida que pasa, y
 * cada turno del bot guarda su **ancla**: el objeto de turno que devuelve
 * `b.bot()`, que es lo que después convierte una aserción en
 * `transcripcion.md:58` en vez de "turno 5, andá a buscarlo".
 *
 * Se espeja en vez de que la bitácora sea la única memoria porque las dos
 * estructuras responden preguntas distintas: la bitácora sabe **contar** lo que
 * pasó, y esto sabe **buscar** adentro (qué tools, en qué orden, con qué
 * argumentos), que es lo que necesita el nivel 2.
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.escenario]
 * @param {string} [opts.proveedorBot]  `guion` | `agente` — viaja en la salida
 * @param {string} [opts.modelo]        el modelo del bot, si se sabe
 * @param {object} [opts.bitacora]      de `informe.escenario({...})` — se espeja todo ahí
 * @param {() => number} [opts.ahora]   reloj inyectable (epoch ms)
 */
export function crearTranscripcion({
  escenario = 'sin-nombre',
  proveedorBot = 'guion',
  modelo = null,
  bitacora = null,
  ahora = () => Date.now(),
} = {}) {
  const t0 = ahora();

  /** @type {Array<object>} Las entradas de la línea de tiempo, en orden. `n` es el índice + 1. */
  const turnos = [];
  /** @type {Array<object>} Todas las llamadas a tools de la corrida, en orden global. */
  const llamadas = [];

  /**
   * El **turno de la conversación**, que es otra cosa que el índice de la línea
   * de tiempo y por eso se cuenta aparte.
   *
   * La línea de tiempo tiene una entrada por cada cosa que pasó: lo que dijo el
   * cliente, lo que contestó el bot, lo que recibió el teléfono, el gesto del
   * dueño. El turno, en cambio, es lo que cuenta `docs/FLUJOS.md` cuando dice
   * *"turno 4"*: **una cosa que dijo el cliente y todo lo que pasó por eso**.
   *
   * Que la falla diga "turno 9" cuando el documento dice "turno 3" obliga a la
   * persona que la lee a traducir entre dos numeraciones a las once de la
   * noche. Se cuenta bien acá, una vez.
   */
  let conversacion = 0;

  /** El turno del bot que está abierto ahora mismo, si hay uno. */
  let abierto = null;

  function reloj() {
    return { en: ahora(), t: ahora() - t0 };
  }

  function agregar(turno) {
    turnos.push({ n: turnos.length + 1, conv: conversacion, ...turno });
    return turnos[turnos.length - 1];
  }

  // ── Los actores que no son el bot ─────────────────────────────────────────

  /** 👤 El cliente escribió algo. **Esto es lo que abre un turno.** */
  function cliente(texto, extra = {}) {
    conversacion += 1;
    const entrada = agregar({ actor: 'cliente', texto, ...reloj(), ...extra });
    entrada.ancla = bitacora?.cliente(texto) ?? null;
    return entrada;
  }

  /** 🧑‍🍳 El dueño hizo un gesto (confirmó con demora, movió a listo, …). */
  function dueno(gesto, extra = {}) {
    const entrada = agregar({ actor: 'dueno', texto: gesto, ...reloj(), ...extra });
    entrada.ancla = bitacora?.dueno({ gesto, detalle: extra.detalle ?? null }) ?? null;
    return entrada;
  }

  /** ⚙️ Algo del sistema que hay que poder leer en la línea de tiempo. */
  function sistema(texto, extra = {}) {
    const entrada = agregar({ actor: 'sistema', texto, ...reloj(), ...extra });
    entrada.ancla = bitacora?.sistema(texto) ?? null;
    return entrada;
  }

  /**
   * 📱 Lo que el teléfono del cliente recibió de verdad (del Graph falso).
   *
   * En la bitácora va como `sistema` y no como un actor propio, a propósito: los
   * actores de la línea de tiempo son cuatro y el teléfono no es uno más, es el
   * **resultado** de que el sistema haya entregado. Que se lea "el cliente
   * recibió" y no "habló el teléfono" es lo correcto: nadie habló, algo llegó.
   */
  function recibido(mensaje) {
    const entrada = agregar({
      actor: 'telefono',
      texto: mensaje?.texto ?? null,
      plantilla: mensaje?.plantilla ?? null,
      variables: mensaje?.variables ?? [],
      ...reloj(),
    });
    const que = mensaje?.plantilla
      ? `📱 el cliente recibió la plantilla «${mensaje.plantilla}» (${(mensaje.variables ?? []).join(' · ')})`
      : `📱 el cliente recibió: ${String(mensaje?.texto ?? '').replace(/\s+/g, ' ')}`;
    entrada.ancla = bitacora?.sistema(que) ?? null;
    return entrada;
  }

  // ── 🤖 El turno del bot ───────────────────────────────────────────────────

  /**
   * Abre un turno del bot. Lo llama el observador del `queryFn` cuando arranca
   * la query, antes del primer mensaje del stream.
   */
  function abrirTurnoDelBot({ mensajeDelCliente = null, clave = null, reanudo = false } = {}) {
    if (abierto) cerrarTurnoDelBot();
    abierto = agregar({
      actor: 'bot',
      mensajeDelCliente,
      clave,
      reanudo,
      texto: '',
      /** Los bloques en el orden en que el bot los produjo (texto y tool_use mezclados). */
      bloques: [],
      /** Las tools de ESTE turno, con su resultado emparejado. */
      tools: [],
      sesionId: null,
      uso: null,
      costoUsd: null,
      pasos: 0,
      ...reloj(),
    });
    return abierto;
  }

  /**
   * Cierra el turno del bot y **recién ahí** lo espeja en la bitácora.
   *
   * Al final y no al abrir porque `b.bot(texto)` quiere el texto completo, y el
   * texto de un turno se termina de conocer cuando el bot dejó de hablar: entre
   * medio puede haber tres idas y vueltas con tools. Espejarlo al abrir dejaría
   * en `transcripcion.md` un turno del bot vacío, que es peor que ninguno.
   */
  function cerrarTurnoDelBot() {
    if (!abierto) return null;
    abierto.ms = ahora() - abierto.en;
    abierto.texto = abierto.texto.trim();
    if (bitacora) {
      abierto.ancla = bitacora.bot(abierto.texto);
      for (const l of abierto.tools) {
        abierto.ancla.tool({ nombre: l.nombreCompleto || l.nombre, argumentos: l.argumentos, resultado: l.resultado });
      }
    }
    const cerrado = abierto;
    abierto = null;
    return cerrado;
  }

  /**
   * El ancla del turno del bot que contestó el turno `conv` de la conversación.
   * Es lo que convierte una aserción del nivel 2 en `transcripcion.md:58`.
   */
  function anclaDelTurno(conv) {
    const t = [...turnos].reverse().find((x) => x.actor === 'bot' && x.conv === conv);
    return t?.ancla ?? null;
  }

  /** El ancla del último turno del bot. Es a lo que se cuelga el nivel 1. */
  function ultimaAncla() {
    const t = [...turnos].reverse().find((x) => x.actor === 'bot');
    return t?.ancla ?? null;
  }

  /**
   * Come un mensaje del stream, con la forma del Agent SDK.
   *
   * Devuelve el mensaje sin tocarlo, para poder usarse como un `tee`:
   * `yield transcripcion.observar(msg)`.
   */
  function observar(msg) {
    if (!msg || typeof msg !== 'object') return msg;
    if (!abierto) abrirTurnoDelBot({});

    if (msg.session_id) abierto.sesionId = msg.session_id;

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      abierto.pasos += 1;
      for (const bloque of msg.message.content) {
        if (bloque?.type === 'text' && bloque.text) {
          abierto.texto += bloque.text;
          abierto.bloques.push({ tipo: 'texto', texto: bloque.text, ...reloj() });
        }
        if (bloque?.type === 'tool_use') {
          const llamada = {
            /** Orden dentro del turno, desde 1. */
            orden: abierto.tools.length + 1,
            /** Orden en toda la conversación, desde 1. Es el que sirve para "antes de". */
            ordenGlobal: llamadas.length + 1,
            turno: abierto.conv,
            id: bloque.id ?? null,
            /** Como lo nombró el SDK: `mcp__copiloto__ver_catalogo`. */
            nombreCompleto: String(bloque.name ?? ''),
            /** Sin el prefijo del MCP: `ver_catalogo`. Es como lo nombra el SKILL.md. */
            nombre: sinPrefijo(String(bloque.name ?? '')),
            argumentos: bloque.input ?? {},
            /** Se completa cuando llega el `tool_result` con este `id`. */
            resultado: undefined,
            error: undefined,
            ...reloj(),
          };
          abierto.tools.push(llamada);
          abierto.bloques.push({ tipo: 'tool_use', llamada });
          llamadas.push(llamada);
        }
      }
    }

    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const bloque of msg.message.content) {
        if (bloque?.type !== 'tool_result') continue;
        // Se empareja por id. Si el proveedor no puso id (puede pasar con un
        // guion escrito a mano), se cae a "la última sin resultado", que es lo
        // que un humano quiso decir.
        const llamada = abierto.tools.find((l) => l.id && l.id === bloque.tool_use_id)
          || [...abierto.tools].reverse().find((l) => l.resultado === undefined);
        if (!llamada) continue;
        llamada.resultado = bloque.content;
        llamada.error = bloque.is_error === true ? true : undefined;
        abierto.bloques.push({ tipo: 'tool_result', llamada, ...reloj() });
      }
    }

    if (msg.type === 'result') {
      // El uso y el costo pueden no venir, y no venir **no es cero**: con el
      // proveedor `agente` nadie los informa. Se guardan tal cual llegan
      // (incluido `null`) y es `presupuesto.js` el que sabe leer esa ausencia.
      abierto.uso = msg.usage ?? null;
      abierto.costoUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null;
      abierto.subtipoResultado = msg.subtype ?? null;
    }

    return msg;
  }

  // ── Lo que se le pregunta al escribir una aserción ───────────────────────

  /** Los turnos del bot, en orden. `turnosDelBot()[0]` es el primero. */
  const turnosDelBot = () => turnos.filter((t) => t.actor === 'bot');

  /**
   * Las llamadas a tools, filtrables.
   * @param {{nombre?: string, turno?: number}} [filtro]
   */
  function tools(filtro = {}) {
    return llamadas.filter((l) => {
      if (filtro.nombre && l.nombre !== filtro.nombre) return false;
      if (filtro.turno !== undefined && l.turno !== filtro.turno) return false;
      return true;
    });
  }

  /** Todo lo que el bot dijo, concatenado. Es lo que ve el juez del nivel 3. */
  const dicho = () => turnosDelBot().map((t) => t.texto).filter(Boolean).join('\n\n');

  /**
   * Un resumen para stdout. **No escribe archivos**: `transcripcion.md` y el
   * resto de la salida son del grupo 4, que vive en `arnes/salida/`.
   */
  function resumenLegible({ maxTexto = 200 } = {}) {
    const iconos = { cliente: '👤', bot: '🤖', dueno: '🧑‍🍳', sistema: '⚙️ ', telefono: '📱' };
    const lineas = [];
    for (const t of turnos) {
      const seg = ((t.t ?? 0) / 1000).toFixed(1).padStart(5);
      const texto = String(t.texto ?? '').replace(/\s+/g, ' ').slice(0, maxTexto);
      lineas.push(`  ${seg}s ${iconos[t.actor] ?? '  '} turno ${String(t.conv).padStart(2)} · ${texto}`);
      for (const l of t.tools ?? []) {
        const args = JSON.stringify(l.argumentos ?? {});
        lineas.push(`          ↳ ${l.nombre}(${args.length > 160 ? `${args.slice(0, 160)}…` : args})`);
      }
    }
    return lineas.join('\n');
  }

  return {
    escenario,
    proveedorBot,
    modelo,
    turnos,
    llamadas,

    cliente,
    dueno,
    sistema,
    recibido,
    abrirTurnoDelBot,
    cerrarTurnoDelBot,
    observar,
    anclaDelTurno,
    ultimaAncla,
    bitacora,

    turnosDelBot,
    tools,
    dicho,
    resumenLegible,

    /** El turno de la conversación en curso. Es el que citan las aserciones. */
    get turnoActual() { return conversacion; },
    /** Cuántas entradas lleva la línea de tiempo. Es otra cosa que el turno. */
    get entradas() { return turnos.length; },
    get ms() { return ahora() - t0; },
  };
}

/**
 * `mcp__copiloto__ver_catalogo` → `ver_catalogo`.
 *
 * Las aserciones nombran la tool como la nombra el `SKILL.md`, que es el
 * documento que la persona que lee la falla tiene abierto al lado. Obligarla a
 * traducir el prefijo del SDK es pedirle trabajo para nada.
 */
export function sinPrefijo(nombre) {
  const partes = String(nombre).split('__');
  return partes[partes.length - 1] || String(nombre);
}
