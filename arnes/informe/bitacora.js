/**
 * La bitácora: **la forma de entrada de toda la salida del arnés**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTO ES EL CONTRATO. Si escribís el runner de un escenario, lo único que
 * tenés que hacer es ir llamando estos métodos en el orden en que pasan las
 * cosas. La bitácora no sabe correr nada ni asevera nada: **anota**. De
 * convertirla en `transcripcion.md`, en una línea de falla y en un exit code se
 * ocupa `informe.js`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   import { crearInforme } from '../informe.js';
 *
 *   const informe = crearInforme({ modelos, duenoModo: 'api', topeUsd: 1 });
 *   const b = informe.escenario({
 *     escenario: 'pedido-feliz',
 *     etiquetas: ['@rapido'],
 *     corrida: { negocioId, waPhoneId, telefonoCliente },
 *   });
 *
 *   // ── quién habló ────────────────────────────────────────────────────────
 *   b.cliente('hola qerria dos hamburgesa');           // 👤
 *   const t = b.bot('¡Hola! Dale, dos hamburguesas…');  // 🤖 → devuelve el turno
 *   t.tool({ nombre: 'consultar_catalogo', argumentos: {}, resultado: {…} });
 *   b.dueno({ gesto: 'confirmó el pedido con 35 minutos', detalle: { demora_min: 35 } });
 *   b.sistema('el worker entregó el aviso al Graph falso');
 *
 *   // ── qué se aseveró ─────────────────────────────────────────────────────
 *   b.asercion({ ok, nivel: 1, que: 'la frase humana de lo que protege',
 *                esperado, llego, turno: t, origen: 'FLUJOS.md flujo A' });
 *
 *   // ── qué dijo el juez ───────────────────────────────────────────────────
 *   b.veredicto({ regla: 'R2', texto: 'nunca prometas una demora',
 *                 origen: 'SKILL.md regla 2', dura: true,
 *                 votos: [{ condena: true, cita: '…', turno: t }, …] });
 *
 *   // ── el cierre ──────────────────────────────────────────────────────────
 *   b.estadoCore({ compromisos, stock, consultas, cobros });
 *   b.gasto({ actor: 'juez', usd: 0.0143 });
 *   await informe.cerrarEscenario(b);
 *
 * **Devolver el turno importa**: `b.bot(...)` devuelve un objeto con `.n` (el
 * número que se va a imprimir) y `.tool()`. Pasale ese objeto a `turno:` en las
 * aserciones y la falla queda anclada al renglón exacto de la transcripción. Si
 * pasás un número suelto también anda, pero el objeto es a prueba de que alguien
 * agregue un turno en el medio.
 *
 * **Qué NO va acá**: nada que decida. La bitácora no sabe si el escenario pasó.
 * `asercion({ ok: false })` es un hecho anotado, no una excepción tirada: el
 * runner sigue y al final se ven TODAS las fallas de una corrida, no la primera.
 * Es la diferencia entre "falló algo" y "falló esto, esto y esto".
 *
 * **Un `ErrorArnes` no se anota como falla del producto**: se anota con
 * `b.roto(err)` y esa corrida sale por exit 2 sin afirmar nada del sistema
 * (design §15).
 */

import { ErrorArnes } from '../entorno.js';

/** Los cuatro que pueden hablar en la línea de tiempo (design §14). */
export const ACTORES = {
  cliente: { emoji: '👤', nombre: 'cliente', plano: '[cliente]' },
  bot: { emoji: '🤖', nombre: 'bot', plano: '[bot]' },
  dueno: { emoji: '🧑‍🍳', nombre: 'dueño', plano: '[dueño]' },
  sistema: { emoji: '⚙️', nombre: 'sistema', plano: '[sistema]' },
};

/**
 * Los que consumen modelo y por lo tanto gastan. **No son los mismos que los
 * que hablan**: el `sistema` no piensa y el `dueño` por API tampoco. Tenerlos
 * separados evita el desglose mentiroso de un actor que nunca pudo gastar.
 */
export const ACTORES_DEL_GASTO = ['bot', 'cliente', 'juez'];

/** Los tres niveles de aserción, con su autoridad (spec `aserciones-de-conversacion`). */
export const NIVELES = {
  1: { nombre: 'estado', autoridad: 'determinista' },
  2: { nombre: 'tools', autoridad: 'determinista' },
  3: { nombre: 'dicho', autoridad: 'juicio de un modelo' },
};

/** Normaliza el actor y explota temprano si alguien inventa uno nuevo. */
function actorValido(actor) {
  const clave = String(actor || '').toLowerCase().replace('ñ', 'n');
  if (!ACTORES[clave]) {
    throw new Error(
      `actor desconocido: ${JSON.stringify(actor)}. ` +
      `Los de la línea de tiempo son: ${Object.keys(ACTORES).join(', ')}.`,
    );
  }
  return clave;
}

/** Acepta el objeto turno, un número, o nada. Devuelve el número o null. */
function numeroDeTurno(turno) {
  if (turno == null) return null;
  if (typeof turno === 'number') return turno;
  if (typeof turno.n === 'number') return turno.n;
  return null;
}

/**
 * @param {object} opciones
 * @param {string} opciones.escenario   nombre del escenario, tal cual se lo invoca
 * @param {string[]} [opciones.etiquetas]  `@rapido`, `@pendiente`…
 * @param {object} [opciones.corrida]   ids del aislamiento, para poder volver a mirar la base
 * @param {() => number} [opciones.ahora]  inyectable para que el ejemplo dé siempre lo mismo
 */
export function crearBitacora({ escenario, etiquetas = [], corrida = {}, ahora = () => Date.now() } = {}) {
  if (!escenario) throw new Error('la bitácora necesita el nombre del escenario');

  const t0 = ahora();
  /** @type {any[]} */
  const eventos = [];
  /** @type {any[]} */
  const aserciones = [];
  /** @type {any[]} */
  const veredictos = [];
  /** @type {any[]} */
  const omitidas = [];
  const gastos = [];
  let estadoCore = null;
  let motivoSinEstado = null;
  let roto = null;
  let pendiente = null;
  let fin = null;

  /** Anota un evento de la línea de tiempo y devuelve su handle. */
  function anotar(actor, texto, extra = {}) {
    const clave = actorValido(actor);
    const evento = {
      // El número lo lleva TODO lo que se imprime, incluido ⚙️ sistema, y es a
      // propósito: "turno 4" tiene que ser el cuarto renglón que contás en la
      // transcripción. Si los eventos del sistema no numeraran, el número de la
      // línea de falla no coincidiría con lo que ve el que la lee, y un número
      // que no se puede contar es peor que no tener número.
      n: eventos.length + 1,
      actor: clave,
      texto: texto == null ? '' : String(texto),
      ms: ahora() - t0,
      tools: [],
      gestos: [],
      evidencia: [],
      ...extra,
    };
    eventos.push(evento);

    /** Handle liviano: lo que el runner pasa como `turno:` y lo que cuelga tools. */
    const handle = {
      get n() { return evento.n; },
      evento,
      /**
       * Una tool que llamó el bot en ESTE turno, con sus argumentos y lo que
       * devolvió. Va debajo del turno del bot y no en un archivo aparte: leer
       * la conversación y ver qué hizo el bot tiene que ser el mismo acto.
       */
      tool({ nombre, argumentos = null, resultado = null, error = null, ms = null }) {
        evento.tools.push({
          nombre, argumentos, resultado, error,
          ms: ms == null ? ahora() - t0 : ms,
        });
        return handle;
      },
      /** Un gesto del dueño: qué hizo, con qué, y —si hubo— la captura. */
      gesto({ que, detalle = null, captura = null }) {
        evento.gestos.push({ que, detalle, captura });
        if (captura) evento.evidencia.push({ archivo: captura, descripcion: que });
        return handle;
      },
      /**
       * Evidencia del turno (capturas, dumps). NUNCA es aserción: una captura
       * como aserción falla por antialiasing y enseña a ignorar el rojo.
       */
      evidencia({ archivo, descripcion = '' }) {
        evento.evidencia.push({ archivo, descripcion });
        return handle;
      },
    };
    return handle;
  }

  const bitacora = {
    escenario,
    etiquetas,
    corrida,
    t0,
    eventos,
    aserciones,
    veredictos,
    omitidas,
    gastos,

    // ── Quién habló ────────────────────────────────────────────────────────
    /** 👤 Lo que el cliente escribió por WhatsApp, textual, faltas incluidas. */
    cliente(texto, extra) { return anotar('cliente', texto, extra); },
    /** 🤖 Lo que el bot contestó. Colgale las tools con `.tool()`. */
    bot(texto, extra) { return anotar('bot', texto, extra); },
    /**
     * 🧑‍🍳 Un gesto del dueño en el panel (o por API). `gesto` es la frase
     * humana de lo que hizo; `texto` es opcional para cuando además escribió
     * algo (por ejemplo, la respuesta a una consulta).
     */
    dueno({ gesto, texto = '', detalle = null, captura = null } = {}) {
      const h = anotar('dueno', texto);
      h.gesto({ que: gesto, detalle, captura });
      return h;
    },
    /** ⚙️ Lo que hizo el andamio: creó el negocio, entregó el aviso, esperó. */
    sistema(texto, extra) { return anotar('sistema', texto, extra); },

    // ── Qué se aseveró ─────────────────────────────────────────────────────
    /**
     * Una aserción, con la **frase humana de lo que protege** — no el nombre de
     * una variable. `que` es lo que se lee a las once de la noche.
     *
     * @param {object} a
     * @param {boolean} a.ok
     * @param {1|2|3} a.nivel      1 estado · 2 tools · 3 dicho
     * @param {string} a.que       la frase humana (alias: `protege`, como en `aserciones.js`)
     * @param {*} [a.esperado]     qué tenía que pasar
     * @param {*} [a.llego]        qué pasó
     * @param {object|number} [a.turno]  a qué turno se ancla
     * @param {string} [a.actor]   quién se salió del libreto; por defecto, el actor del turno
     * @param {string} [a.origen]  de dónde sale la regla: `SKILL.md regla 2`, `FLUJOS.md flujo A`
     * @param {string} [a.dondeMirar]  una pista extra para el que abre esto de noche
     */
    asercion({ ok, nivel = 1, que, protege, esperado, llego, turno, actor, origen = null, dondeMirar = null, rompe }) {
      // `protege` es el nombre que usa `aserciones.js`; `que` el de acá. Son la
      // misma cosa —la frase humana— y aceptar los dos evita que la costura
      // entre los dos módulos sea un renombre masivo.
      const frase = que || protege;
      if (!frase) {
        throw new Error(
          'una aserción sin frase humana no sirve: pasá `que` (o `protege`) con lo que protege, ' +
          'textual del SKILL.md o de FLUJOS.md. Un nombre de variable no se puede leer a las once de la noche.',
        );
      }
      const n = numeroDeTurno(turno);
      const delTurno = n ? eventos[n - 1]?.actor : null;
      const registro = {
        ok: Boolean(ok), nivel, que: frase, esperado, llego, rompe,
        turno: n,
        // Por defecto, el culpable es el que habló en ese turno. Se puede pisar:
        // un total mal calculado lo rompe el bot aunque se lea en el core.
        actor: actor ? actorValido(actor) : (delTurno || 'sistema'),
        origen, dondeMirar,
      };
      aserciones.push(registro);
      return registro;
    },
    /** Azúcar: `b.ok({...})` / `b.falla({...})`. Misma forma que `asercion`. */
    ok(a) { return bitacora.asercion({ ...a, ok: true }); },
    falla(a) { return bitacora.asercion({ ...a, ok: false }); },

    /**
     * El veredicto del juez sobre una regla del dicho. Tres votos, mayoría, y
     * **cita textual obligatoria en toda condena**: una condena sin cita, o con
     * una cita que no aparece en la transcripción, no es falla del producto —
     * es el arnés que no pudo emitir veredicto sobre esa regla.
     *
     * @param {object} v
     * @param {string} v.regla       identificador corto: `R2`
     * @param {string} v.texto       la prohibición en castellano: «nunca prometas una demora»
     * @param {string} v.origen      `SKILL.md regla 2`
     * @param {boolean} [v.dura]     si es de las innegociables: sólo esas rompen
     * @param {string|null} [v.cuarentena]  motivo; en cuarentena reporta pero no rompe
     * @param {boolean} [v.confiable]  false si el juez perdonó su caso negativo
     * @param {Array<{condena:boolean, cita?:string, turno?:object|number, razon?:string}>} v.votos
     */
    veredicto({ regla, texto, origen = null, dura = false, cuarentena = null, confiable = true, votos = [] }) {
      const normalizados = votos.map((v) => ({
        condena: Boolean(v.condena),
        cita: v.cita ?? null,
        turno: numeroDeTurno(v.turno),
        razon: v.razon ?? null,
      }));
      const registro = { regla, texto, origen, dura, cuarentena, confiable, votos: normalizados };
      veredictos.push(registro);
      return registro;
    },

    /**
     * Una aserción que esta corrida **no pudo** afirmar y por qué. Es la tarea
     * 3.8 y es lo único que evita que "no corre solo" se convierta en "no corre
     * nunca": una omisión silenciosa es una mentira; una que se anuncia es una
     * tarea. Nombrala con nombre y apellido, no "cosas del panel".
     */
    omitida({ que, porque, comoSeCubre = null, origen = null }) {
      const registro = { que, porque, comoSeCubre, origen };
      omitidas.push(registro);
      return registro;
    },

    /**
     * El estado del core al cerrar. Se guarda tal cual en `estado-core.json`.
     * Si un escenario no lo captura, decí por qué con `sinEstadoCore(motivo)`:
     * un archivo vacío sin explicación es la clase de agujero que nadie mira.
     */
    estadoCore(estado) { estadoCore = estado; return estado; },
    sinEstadoCore(motivo) { motivoSinEstado = motivo; },

    /**
     * Lo gastado por actor. `usd: null` significa **no hay costo real**, que no
     * es lo mismo que cero: hoy el bot lo sirve un agente leyendo el `SKILL.md`
     * y no hay factura que mirar (design §1). Imprimir `$0.00` ahí sería decir
     * "salió gratis" cuando lo cierto es "no sé".
     */
    gasto({ actor, usd = null, tokens = null, nota = null }) {
      if (!ACTORES_DEL_GASTO.includes(actor)) {
        throw new Error(
          `gasto de un actor desconocido: ${JSON.stringify(actor)}. ` +
          `Los que consumen modelo son: ${ACTORES_DEL_GASTO.join(', ')}.`,
        );
      }
      const registro = { actor, usd, tokens, nota };
      gastos.push(registro);
      return registro;
    },

    /** El escenario no se corrió porque espera otra cosa (`@pendiente`). */
    marcarPendiente(motivo) { pendiente = motivo; },

    /**
     * El arnés se rompió en este escenario. NO es falla del producto: sale por
     * exit 2 y la corrida no afirma nada del sistema.
     */
    roto(err) {
      roto = err instanceof ErrorArnes ? err : new ErrorArnes(String(err?.message || err));
      if (!(err instanceof ErrorArnes) && err?.stack) roto.pistas = [err.stack];
      return roto;
    },

    /** Cierra el reloj. Idempotente: el runner puede llamarlo de más. */
    cerrar() { if (fin == null) fin = ahora() - t0; return fin; },

    // ── Lo que lee `informe.js` ────────────────────────────────────────────
    get duracionMs() { return fin == null ? ahora() - t0 : fin; },
    get estado() { return estadoCore; },
    get motivoSinEstado() { return motivoSinEstado; },
    get roto_() { return roto; },
    get pendiente_() { return pendiente; },
  };

  return bitacora;
}

/**
 * Mayoría sobre los tres votos, con la cita verificada contra la transcripción.
 *
 * Devuelve `{ condena, proporcion, cita, turno, noEvaluable, motivo }`.
 * `noEvaluable: true` = **arnés roto para esa regla**, jamás falla del producto.
 *
 * La verificación de la cita es literal contra el texto de los turnos: si el
 * juez condena citando una frase que el bot no dijo, el juez alucinó, y una
 * alucinación no puede poner nada en rojo. Es la defensa contra el riesgo
 * número uno del cambio.
 */
export function resolverVeredicto(veredicto, eventos) {
  // SÓLO los turnos del bot. Buscar la cita en toda la transcripción es el
  // agujero más convincente que puede tener un juez: condenar al bot por
  // "prometer una demora" citando al CLIENTE que preguntó "¿cuánto tarda?".
  // Hay cita, la cita está textual en la transcripción, y no prueba nada —
  // pero pasa todas las verificaciones ingenuas y pone en rojo al producto por
  // algo que el producto no dijo. Una condena tiene que probarse con lo que
  // dijo el acusado.
  const dichos = eventos
    .filter((e) => e.actor === 'bot')
    .map((e) => normalizar(e.texto));
  const condenas = veredicto.votos.filter((v) => v.condena);

  const conCita = condenas.filter((v) => {
    if (!v.cita || !String(v.cita).trim()) return false;
    const aguja = normalizar(v.cita);
    return dichos.some((d) => d.includes(aguja));
  });
  const sinCita = condenas.length - conCita.length;

  const total = veredicto.votos.length;
  const mayoriaCruda = condenas.length * 2 > total;
  const mayoriaConCita = conCita.length * 2 > total;

  // Condenaron los suficientes, pero lo que sostiene la condena son votos sin
  // prueba. No se descuenta a favor del producto ni en contra: la regla queda
  // **no evaluable**, que es arnés roto para esa regla y nada más.
  if (mayoriaCruda && !mayoriaConCita) {
    return {
      condena: false,
      noEvaluable: true,
      proporcion: `${condenas.length}/${total}`,
      votosSinCita: sinCita,
      motivo: motivoDeDescarte(condenas),
      cita: null,
      turno: null,
    };
  }

  const elegida = conCita[0] || null;
  return {
    condena: mayoriaConCita,
    noEvaluable: false,
    proporcion: `${conCita.length}/${total}`,
    votosSinCita: sinCita,
    cita: elegida?.cita ?? null,
    turno: elegida?.turno ?? null,
    motivo: null,
  };
}

/**
 * Por qué se descartó la condena, con la distinción que importa: no citar y
 * citar algo que nadie dijo son dos problemas distintos del juez. El primero es
 * un prompt que no le pidió la prueba; el segundo es un juez que alucina, que
 * es bastante peor y hay que poder verlo escrito.
 */
function motivoDeDescarte(condenas) {
  const mudos = condenas.filter((v) => !v.cita || !String(v.cita).trim()).length;
  const inventados = condenas.length - mudos;
  if (inventados && mudos) {
    return `${mudos} ${mudos === 1 ? 'condenó' : 'condenaron'} sin citar y ` +
      `${inventados} ${inventados === 1 ? 'citó' : 'citaron'} una frase que no aparece en la transcripción`;
  }
  if (inventados) return 'el juez citó una frase que no aparece en la transcripción: la inventó';
  return 'el juez condenó sin citar';
}

/** Comparación tolerante a espacios y mayúsculas, no a las palabras. */
function normalizar(texto) {
  return String(texto || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
