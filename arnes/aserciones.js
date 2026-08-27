/**
 * aserciones.js — los niveles 1 y 2, y la frase humana de lo que protegen.
 *
 * ── La regla que ordena todo esto (spec, §6 del design) ─────────────────────
 * Un escenario **prefiere el nivel más bajo que pueda expresar lo que quiere
 * proteger**. Lo que se puede verificar sobre el estado NO se verifica sobre el
 * texto:
 *
 *   nivel 1 — **estado**: lo que quedó en el core, leído por su API. Determinista.
 *   nivel 2 — **tools**:  qué llamó el bot, con qué y en qué orden. Determinista.
 *   nivel 3 — **dicho**:  lo que escribió, juzgado por un modelo. No determinista.
 *
 * Casi todo lo que importa es 1 o 2. *"El pedido entra al panel apenas hay
 * ítems"* es nivel 1 con un reloj. *"Una modificación de una sola unidad separa
 * la línea"* es nivel 1 puro. *"El bot no confirma solo"* es nivel 1. Ninguna
 * necesita interpretar prosa, y pedirle a un juez que interprete lo que se
 * puede leer de una tabla es cambiar un dato por una opinión.
 *
 * ── `protege` no es opcional y no es un nombre de variable ──────────────────
 * Cada aserción lleva **la frase humana de lo que defiende**, sacada del
 * `SKILL.md` o de `docs/FLUJOS.md`, textual y entre comillas. El arnés se corre
 * a las once de la noche antes de un release, y la pregunta es "¿me lo llevo o
 * no?". `AssertionError: expected false to be true` obliga a reconstruir la
 * respuesta leyendo el código del test; «*el bot no promete demoras: la demora
 * la pone el local desde el panel*» la contesta sola.
 *
 * Por eso `protege` se exige en tiempo de ejecución: una aserción sin frase
 * humana es una aserción que dentro de tres meses nadie sabe si se puede
 * borrar.
 */

import { ErrorArnes } from './entorno.js';

// ── El colector: la costura con el informe ──────────────────────────────────

/**
 * El colector de aserciones: **anota en la bitácora del informe, no imprime**.
 *
 * Antes esto exportaba un `crearInforme` propio con su printer corto. Perdió y
 * está bien que haya perdido: el de `informe.js` arma la línea de tiempo, los
 * artefactos por escenario, la cita apuntando a `transcripcion.md:58` y los
 * tres carteles de exit. Dos módulos exportando `crearInforme` no pueden
 * convivir, y de los dos el que resuelve *"que una falla se lea a las once de
 * la noche"* es aquél.
 *
 * Entonces lo que queda acá es lo que sí es de este archivo: **saber a qué
 * turno se ancla cada aserción**. `b.asercion({ turno })` quiere el objeto que
 * devolvió `b.bot(...)`, y quién sabe cuál es ese objeto para una llamada a una
 * tool del turno 3 es la transcripción, no el runner. El colector hace esa
 * traducción una vez y en un solo lugar.
 *
 * @param {object} bitacora       de `informe.escenario({...})`
 * @param {object} transcripcion  de `crearTranscripcion({ bitacora })`
 */
export function crearColectorDeAserciones(bitacora, transcripcion = null) {
  if (typeof bitacora?.asercion !== 'function') {
    throw new Error(
      'crearColectorDeAserciones: falta la bitácora. Se arma con ' +
      '`crearInforme(...).escenario({ escenario, etiquetas, corrida })` de informe.js.',
    );
  }

  /**
   * Anota una aserción. `protege` es la frase humana y es obligatoria: la
   * bitácora la exige y tiene razón — un nombre de variable no se puede leer a
   * las once de la noche.
   *
   * **Devuelve el registro, no un booleano**, igual que `bitacora.asercion`.
   * Un escenario que quiera encadenar (*"si el compromiso no existe, omití las
   * que dependen"*) pregunta por `.ok`. Devolver un booleano suelto se veía
   * mejor y era una trampa: `if (unaAsercion(...))` con un objeto siempre es
   * verdadero, y esa falla es muda.
   */
  function anotar({ ok, nivel, protege, origen, esperado, llego, turno, actor }) {
    return bitacora.asercion({
      ok,
      nivel,
      protege,
      origen,
      esperado: esperado === undefined ? undefined : mostrar(esperado),
      llego: llego === undefined ? undefined : mostrar(llego),
      // El ancla se resuelve acá: si llega un número de turno de conversación,
      // se traduce al objeto de turno de la bitácora. Un número suelto también
      // anda, pero el objeto sobrevive a que alguien agregue un turno en el medio.
      turno: typeof turno === 'number' ? transcripcion?.anclaDelTurno(turno) ?? turno : turno,
      actor,
    });
  }

  /**
   * Una aserción que **no se pudo evaluar** porque otra, más arriba, ya falló.
   *
   * Existe para el problema que arruina la lectura de una corrida: una sola
   * causa —"el compromiso no existe"— hace caer cinco aserciones, y la salida
   * muestra cinco fallas de las que cuatro no dicen nada nuevo. A las once de
   * la noche eso se lee como "está todo roto" cuando lo que hay es un bug.
   *
   * Va por `bitacora.omitida`, que es lo mismo que usa la tarea 3.8 para lo que
   * el dueño por API no puede afirmar, y por el mismo motivo: **una omisión
   * silenciosa es una mentira; una que se anuncia es una tarea**. No cuenta
   * como aprobada.
   */
  function omitir({ protege, porque, comoSeCubre = null, origen = null }) {
    return bitacora.omitida({ que: protege, porque, comoSeCubre, origen });
  }

  return {
    anotar,
    omitir,
    bitacora,
    /** Nivel 2 — las tools. Necesita la transcripción: es de donde salen. */
    nivel2: (t = transcripcion) => nivel2(t, { anotar }),
    /** Nivel 1 — el estado del core. */
    nivel1: (opciones) => nivel1({ ...opciones, colector: { anotar }, transcripcion }),
  };
}

function mostrar(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  NIVEL 2 — las tools
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aserciones sobre lo que el bot **hizo**, no sobre lo que dijo.
 *
 * Es el nivel que sólo existe porque el `queryFn` está observado (design §3):
 * sin él, la mitad del valor del arnés no se puede aseverar y habría que
 * meterle un `TRANSCRIPT_DIR` al gateway — o sea, código de prueba en
 * producción.
 *
 * @param {object} transcripcion  de `transcripcion.js`
 * @param {object} colector       de `crearColectorDeAserciones`
 */
export function nivel2(transcripcion, colector) {
  const anotar = (a) => colector.anotar({ ...a, nivel: 2, actor: 'bot' });

  /**
   * Una tool que **tiene que** haberse llamado.
   *
   * @param {object} p
   * @param {string} p.tool     nombre como en el SKILL.md: `ver_catalogo`
   * @param {string} p.protege  la frase humana
   * @param {string} [p.origen]
   * @param {number} [p.turno]  restringir a un turno
   * @param {number} [p.veces]  cuántas exactamente; sin esto, "al menos una"
   */
  function llamo({ tool, protege, origen, turno, veces }) {
    const encontradas = transcripcion.tools({ nombre: tool, turno });
    const ok = veces === undefined ? encontradas.length > 0 : encontradas.length === veces;
    return anotar({
      ok, protege, origen, turno,
      esperado: veces === undefined ? `llamó \`${tool}\`` : `llamó \`${tool}\` ${veces} vez/veces`,
      llego: encontradas.length ? `${encontradas.length} llamada(s) en turno(s) ${[...new Set(encontradas.map((l) => l.turno))].join(', ')}` : `no llamó \`${tool}\``,
    });
  }

  /**
   * Una tool que **NO** tiene que haberse llamado.
   *
   * Es la mitad menos obvia y la más valiosa: *"para pedidos de comida
   * `consultar_disponibilidad` no se usa: la comida no ocupa agenda"* sólo se
   * puede defender aseverando una ausencia.
   */
  function noLlamo({ tool, protege, origen, turno }) {
    const encontradas = transcripcion.tools({ nombre: tool, turno });
    return anotar({
      ok: encontradas.length === 0, protege, origen, turno,
      esperado: `NO llamó \`${tool}\``,
      llego: encontradas.length
        ? `la llamó ${encontradas.length} vez/veces con ${mostrar(encontradas[0].argumentos)}`
        : `no la llamó`,
    });
  }

  /**
   * Los argumentos de una llamada.
   *
   * `comprobar` recibe los argumentos y devuelve `true`, o un string con qué
   * estuvo mal. Un string es mejor que un `false`: *"la línea sin panceta no
   * trae nota"* dice adónde mirar; `false` obliga a abrir el JSON entero.
   *
   * @param {object} p
   * @param {string} p.tool
   * @param {string} p.protege
   * @param {(args: object, llamada: object) => true|string} p.comprobar
   * @param {number} [p.indice]  cuál de las llamadas; `-1` = la última
   */
  function argumentos({ tool, protege, origen, comprobar, indice = -1, turno }) {
    const encontradas = transcripcion.tools({ nombre: tool, turno });
    if (!encontradas.length) {
      return anotar({
        ok: false, protege, origen, turno,
        esperado: `una llamada a \`${tool}\` para mirarle los argumentos`,
        llego: `nunca la llamó`,
      });
    }
    const llamada = indice < 0 ? encontradas[encontradas.length + indice] : encontradas[indice];
    let veredicto;
    try {
      veredicto = comprobar(llamada.argumentos, llamada);
    } catch (err) {
      veredicto = `la comprobación explotó: ${err.message}`;
    }
    return anotar({
      ok: veredicto === true, protege, origen, turno: llamada.turno,
      esperado: veredicto === true ? 'los argumentos esperados' : String(veredicto),
      llego: mostrar(llamada.argumentos),
    });
  }

  /**
   * El orden **relativo** entre tools, mirando toda la conversación.
   *
   * Global y no por turno a propósito: en el Flujo A `ver_catalogo` cae en un
   * turno y `armar_compromiso` en otro, y la promesa que se defiende —*"el
   * precio sale de `ver_catalogo` textual o no se dice"*— cruza los dos.
   *
   * @param {string[]} p.secuencia  nombres en el orden esperado
   */
  function orden({ secuencia, protege, origen }) {
    const posiciones = secuencia.map((nombre) => {
      const l = transcripcion.tools({ nombre })[0];
      return { nombre, ordenGlobal: l?.ordenGlobal ?? null, turno: l?.turno ?? null };
    });
    const faltante = posiciones.find((p) => p.ordenGlobal === null);
    if (faltante) {
      return anotar({
        ok: false, protege, origen,
        esperado: secuencia.join(' → '),
        llego: `nunca llamó \`${faltante.nombre}\``,
      });
    }
    let ok = true;
    for (let i = 1; i < posiciones.length; i += 1) {
      if (posiciones[i].ordenGlobal < posiciones[i - 1].ordenGlobal) ok = false;
    }
    return anotar({
      ok, protege, origen,
      esperado: secuencia.join(' → '),
      llego: [...posiciones].sort((a, b) => a.ordenGlobal - b.ordenGlobal)
        .map((p) => `${p.nombre}(t${p.turno})`).join(' → '),
    });
  }

  return { llamo, noLlamo, argumentos, orden };
}

// ═══════════════════════════════════════════════════════════════════════════
//  NIVEL 1 — el estado en el core
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aserciones contra el core, con el token del **dueño** (no el del agente): es
 * lo que ve el local en su panel, que es donde el producto tiene que estar bien.
 *
 * ── Aseverables en cualquier turno, y ese es el punto ───────────────────────
 * Las promesas del producto sobre **cuándo** pasa algo se verifican en el turno
 * en que tienen que pasar, no al final. *"El pedido entra al panel apenas hay
 * ítems: la cocina lo ve venir mientras el cliente todavía escribe"*
 * (`FLUJOS.md`) es falsa si el compromiso aparece recién al cerrar — y al final
 * de la conversación las dos versiones se ven idénticas. Por eso `foto()` se
 * saca cuando el escenario quiere, y una confirmación anticipada falla **en el
 * turno en que ocurrió**.
 *
 * ── Contra el contrato, nunca contra la fuente del número (design §13) ──────
 * El stock se lee de `restante`/`agotado` de `GET /api/servicios`. **Nunca** de
 * `cupo_jornada`, ni de recetas, ni de insumos. `insumos-y-recetas` va a sumar
 * una segunda fuente del mismo número y su propio proposal promete que el
 * contrato hacia afuera no cambia: un arnés aseverado contra el contrato prueba
 * las dos fuentes sin tocar una línea, y encima verifica esa promesa.
 *
 * @param {object} p
 * @param {object} p.corrida   de `aislamiento.js`
 * @param {object} p.colector  de `crearColectorDeAserciones`
 * @param {object} [p.carta]   de `cargarCarta`, para traducir servicio_id → nombre
 * @param {object} [p.transcripcion]  para etiquetar la aserción con el turno actual
 */
export function nivel1({ corrida, colector, carta = null, transcripcion = null }) {
  const { api, tokenDueno } = corrida;
  const nombrePorId = new Map((carta?.platos ?? []).map((p) => [p.id, p.nombre]));

  // El actor por defecto es el **bot** y no "el core": el core no se equivoca
  // solo. Un total mal calculado o un pedido que no entró al panel lo produjo
  // una decisión del bot; que se lea en la API del core es dónde se descubre,
  // no de quién es la culpa. Culpar al lugar donde se mira es cómo se manda a
  // leer el código equivocado.
  const anotar = (a) => colector.anotar({
    ...a,
    nivel: 1,
    actor: a.actor ?? 'bot',
    turno: a.turno ?? transcripcion?.ultimaAncla?.() ?? transcripcion?.turnoActual,
  });

  /** Una lectura del core en este instante. Sacala en el turno que te importa. */
  async function foto() {
    const [comp, serv, cons] = await Promise.all([
      api('GET', '/api/compromisos', tokenDueno),
      api('GET', '/api/servicios', tokenDueno),
      api('GET', '/api/consultas', tokenDueno),
    ]);
    for (const [nombre, res] of [['compromisos', comp], ['servicios', serv], ['consultas', cons]]) {
      if (res.status !== 200) {
        // Que el core no conteste no es una falla del bot: es arnés roto.
        throw new ErrorArnes(
          `el core devolvió HTTP ${res.status} en ${nombre}`,
          `cuerpo: ${res.texto.slice(0, 300)}`,
        );
      }
    }
    return {
      compromisos: lista(comp.json),
      servicios: lista(serv.json),
      consultas: lista(cons.json),
      en: Date.now(),
    };
  }

  /** Cuántos compromisos hay (opcionalmente en un estado). */
  function cuantosCompromisos(foto, { protege, origen, estado, esperado, turno }) {
    const los = foto.compromisos.filter((c) => !estado || c.estado === estado);
    return anotar({
      ok: los.length === esperado, protege, origen, turno,
      esperado: `${esperado} compromiso(s)${estado ? ` en «${estado}»` : ''}`,
      llego: los.length
        ? `${los.length}: ${los.map((c) => `${c.estado}/$${c.total}`).join(', ')}`
        : 'ninguno',
    });
  }

  /**
   * El compromiso de esta conversación. Hay uno solo por corrida (el negocio es
   * nuevo y el cliente es uno), así que no hace falta filtrar por teléfono —
   * pero se filtra igual, porque el día que un escenario tenga dos clientes
   * (`dos-contra-el-ultimo`) esto tiene que seguir siendo cierto.
   */
  function elCompromiso(foto, { telefono = corrida.telefonoCliente } = {}) {
    const suyos = foto.compromisos.filter((c) => String(c.cliente_telefono ?? '').includes(String(telefono)));
    return suyos[suyos.length - 1] ?? null;
  }

  /**
   * Un campo del compromiso. `total` se compara como número: el core lo manda
   * como string de `numeric(12,2)` ("13400.00") y compararlo como string
   * fallaría contra `13400` por el formato, que no es lo que se quiere probar.
   */
  function campo(compromiso, nombre, esperado, { protege, origen, turno } = {}) {
    const valor = compromiso?.[nombre] ?? null;
    const ok = nombre === 'total'
      ? Number(valor) === Number(esperado)
      : valor === esperado;
    return anotar({
      ok, protege, origen, turno,
      esperado: `${nombre} = ${mostrar(esperado)}`,
      llego: compromiso ? `${nombre} = ${mostrar(valor)}` : 'no hay compromiso',
    });
  }

  /**
   * Las líneas, con sus cantidades y sus notas.
   *
   * Es la aserción que defiende *"una modificación que aplica a una sola unidad
   * separa la línea"*: `[{servicio:'La Birra', nota:'sin panceta'}, {servicio:'La Birra'}]`
   * y no `{cantidad: 2, nota:'sin panceta'}`. Se compara **por conjunto**, no
   * por orden: el core no promete un orden de líneas y aseverarlo sería
   * aseverar una casualidad.
   */
  function lineas(compromiso, esperadas, { protege, origen, turno } = {}) {
    const reales = (compromiso?.lineas ?? []).map((l) => ({
      servicio: nombrePorId.get(l.servicio_id) ?? l.servicio_id,
      cantidad: l.cantidad,
      nota: l.nota ?? null,
    }));
    const clave = (l) => `${l.servicio}|${l.cantidad}|${l.nota ?? ''}`;
    const a = reales.map(clave).sort();
    const b = esperadas.map((l) => clave({ cantidad: 1, nota: null, ...l })).sort();
    return anotar({
      ok: a.length === b.length && a.every((x, i) => x === b[i]),
      protege, origen, turno,
      esperado: esperadas.map((l) => `${l.cantidad ?? 1}× ${l.servicio}${l.nota ? ` (${l.nota})` : ''}`).join(' + '),
      llego: reales.length
        ? reales.map((l) => `${l.cantidad}× ${l.servicio}${l.nota ? ` (${l.nota})` : ''}`).join(' + ')
        : 'sin líneas',
    });
  }

  /**
   * El stock, **por el contrato**: `restante` y `agotado` de `GET /api/servicios`.
   * Nunca por `cupo_jornada` ni por recetas (design §13).
   */
  function stock(foto, nombre, esperado, { protege, origen, turno } = {}) {
    const s = foto.servicios.find((x) => x.nombre === nombre);
    const real = s ? { restante: s.restante ?? null, agotado: s.agotado ?? false, disponible: s.disponible !== false } : null;
    const ok = Boolean(real) && Object.entries(esperado).every(([k, v]) => real[k] === v);
    return anotar({
      ok, protege, origen, turno,
      esperado: `«${nombre}» ${mostrar(esperado)}`,
      llego: real ? mostrar(real) : `«${nombre}» no está en el catálogo`,
    });
  }

  /** Las consultas que el bot dejó para que las responda el local. */
  function consultas(foto, esperadas, { protege, origen, turno } = {}) {
    const cuantas = foto.consultas.length;
    return anotar({
      ok: cuantas === esperadas, protege, origen, turno,
      esperado: `${esperadas} consulta(s) pendientes`,
      llego: cuantas ? foto.consultas.map((c) => JSON.stringify(c.pregunta)).join(', ') : 'ninguna',
    });
  }

  /** Escotilla para lo que no tenga helper. Igual exige `protege`. */
  function exigir({ ok, protege, origen, esperado, llego, turno }) {
    return anotar({ ok, protege, origen, esperado, llego, turno });
  }

  return { foto, cuantosCompromisos, elCompromiso, campo, lineas, stock, consultas, exigir };
}

/** El core devuelve `[]` o `{items:[]}` según el endpoint; se aceptan los dos. */
function lista(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}
