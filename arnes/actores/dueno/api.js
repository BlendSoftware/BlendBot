/**
 * api.js — **el dueño manejado por la API del core**.
 *
 * Es una de las dos implementaciones del actor dueño (design §9). La otra es
 * `arnes/dueno/guion.md`, que ejecuta un agente manejando Chrome de verdad.
 * Las dos hacen **los mismos gestos, en el mismo orden**, y anotan en la misma
 * bitácora (`arnes/informe/bitacora.js`), así que las dos salidas se leen igual.
 *
 * **Qué gestos hace el dueño**, y son todos los que hace de verdad:
 *   entrar · ver los pedidos · confirmar con demora · mover a listo ·
 *   responder una consulta.
 *
 * **Por qué existe esta implementación**: es la que corre desatendida, en
 * `make arnes`, sin browser y sin nadie mirando. Un arnés cuyo único dueño
 * necesita a alguien manejando Chrome no corre nunca.
 *
 * **Por qué NO alcanza**, y hay que decirlo fuerte: esta implementación le
 * habla al core, no al panel. `PATCH /api/compromisos/:id/estado
 * {"demora_min": 33}` pasa **con o sin campo libre en la pantalla**, y D8 dice
 * que sin campo libre "el producto miente". Y que el pedido exista en la base
 * no es que el dueño lo VEA aparecer mientras el cliente escribe: eso es
 * render, no dato. Son dos afirmaciones distintas y el producto vende la
 * segunda.
 *
 * Por eso cada gesto que no puede afirmar lo que el guión sí, **lo anota**
 * (`cobertura.js` → `bitacora.omitida()`), y `informe.js` lo imprime al final,
 * verde o roja. Una omisión silenciosa es una mentira; una que se anuncia es
 * una tarea.
 *
 * **Y por eso mismo esta implementación no es un plan B**: que las dos existan
 * es lo que permite atribuir una falla. Si un escenario pasa acá y falla en
 * Chrome, el problema es del panel. Sin las dos, esa pregunta se contesta a
 * mano cada vez.
 *
 * ── Cómo se usa ─────────────────────────────────────────────────────────────
 *
 *   const b = informe.escenario({ escenario: 'pedido-feliz', corrida });
 *   const dueno = crearDuenoApi({ corrida, bitacora: b });
 *
 *   await dueno.entrar();
 *   const pedido = await dueno.esperarPedidoDe({ telefono: corrida.telefonoCliente });
 *   if (!pedido) return;                      // la falla YA quedó anotada
 *   await dueno.confirmarConDemora(pedido.id, 33);
 *   await dueno.marcarListo(pedido.id);
 *
 * **Un gesto que falla anota y sigue; no tira.** Es el contrato de la bitácora
 * y está bien: así una corrida muestra TODAS las fallas y no la primera. Lo que
 * sí devuelve `null` es lo que no se puede continuar (un pedido que nunca
 * entró): **si te devuelve `null`, no encadenes los gestos que dependían de
 * eso** — la falla ya está anotada y seguir sólo agrega ruido.
 *
 * Lo que sí tira es `ErrorArnes` (exit 2): el dueño no pudo entrar, el core no
 * contestó. Eso no es el producto roto, es el arnés roto, y no hay veredicto.
 */

import { ErrorArnes, entorno } from '../../entorno.js';
import { crearApi } from '../../aislamiento.js';
import { crearBitacora } from '../../informe/bitacora.js';
import { anotarOmitida } from './cobertura.js';

/**
 * Cuánto espera el dueño a que un pedido aparezca. Generoso a propósito: el
 * camino es cliente → webhook → bot → tools del MCP → core, y el bot puede
 * tardar varios segundos por turno. Un timeout corto acá produce una falla que
 * dice "el pedido no entró al panel" cuando en realidad entró un segundo
 * después, y ese es el rojo que enseña a ignorar el rojo.
 */
const ESPERA_PEDIDO_MS = 45_000;
/** Cada cuánto vuelve a mirar. El panel refresca cada 15 s; el arnés no espera eso. */
const SONDEO_MS = 300;

/**
 * Los estados que el dueño ve en su tablero. Copia deliberada de
 * `ESTADOS_TABLERO` de `panel/src/componentes/usarPedidos.ts`: el arnés NO
 * importa código del panel (es un componente del producto y no se toca), así
 * que si allá cambia y acá no, la diferencia se ve como una falla del guión
 * contra el modo `api` — que es exactamente la señal que estas dos
 * implementaciones existen para dar.
 */
const ESTADOS_TABLERO = ['pendiente', 'confirmado', 'en_curso', 'listo'];

/**
 * A qué columna del tablero cae cada estado. También copia de
 * `panel/src/dominio/pedidos.ts`, y también a propósito.
 *
 * Ojo con qué se puede aseverar con esto y qué no: sirve para LEER el tablero
 * como lo lee el dueño ("¿cuántos hay sin confirmar?"). Las aserciones que
 * pesan van siempre contra `estado`, que es el contrato del core. Aseverar
 * contra la columna sería aseverar contra esta copia, no contra el panel.
 */
const COLUMNA_DE_ESTADO = {
  pendiente: 'pendientes',
  confirmado: 'cocina',
  en_curso: 'cocina',
  listo: 'listos',
  completado: 'cobrar',
};

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Vuelve a preguntar hasta que `mirar()` devuelva algo distinto de `null`, o
 * hasta que se acabe el tiempo. Devuelve `null` si se acabó.
 */
async function sondear(mirar, { timeoutMs, cadaMs = SONDEO_MS } = {}) {
  const hasta = Date.now() + timeoutMs;
  for (;;) {
    const visto = await mirar();
    if (visto !== null && visto !== undefined) return visto;
    if (Date.now() >= hasta) return null;
    await pausa(cadaMs);
  }
}

/**
 * El dueño de esta corrida, manejado por la API.
 *
 * @param {object} opts
 * @param {object} opts.corrida    lo que devuelve `crearCorrida()` de aislamiento.js
 * @param {object} [opts.bitacora] la del escenario (`informe.escenario({...})`).
 *   Si no viene, el dueño se arma una propia y anda igual — sirve para probarlo
 *   suelto, pero entonces nadie imprime lo que anotó.
 * @param {string} [opts.escenario]  sólo si no se pasa `bitacora`
 * @param {ReturnType<typeof entorno>} [opts.env]
 */
export function crearDuenoApi({ corrida, bitacora, escenario = 'dueno-suelto', env = entorno() }) {
  if (!corrida?.usuarioDueno) {
    throw new ErrorArnes(
      'el dueño por API necesita la corrida que devuelve crearCorrida()',
      'crearDuenoApi({ corrida }) — de ahí salen el usuario, la contraseña y el negocio.',
    );
  }

  const api = corrida.api || crearApi(env.coreUrl);
  // El fallback existe para poder probar el dueño suelto, pero AVISA. Una
  // bitácora huérfana se traga todo lo que el dueño asevera —incluidas sus
  // fallas— y la corrida sale verde sin haber mirado nada de lo suyo. Es
  // exactamente la clase de verde que no ejercita nada, y sin este cartel el
  // que la pise no se entera nunca.
  const b = bitacora || (() => {
    console.warn(
      `⚠️  ARNÉS: el dueño de «${escenario}» está anotando en una bitácora suelta.\n` +
      '   Lo que asevere NO va a salir en el informe de la corrida.\n' +
      '   Pasale la del escenario: crearDuenoApi({ corrida, bitacora: b }).',
    );
    return crearBitacora({ escenario, corrida: { negocioId: corrida.negocioId } });
  })();

  /** El JWT del dueño de ESTA sesión. Sale de `entrar()`, no de la corrida. */
  let token = null;
  /** La ficha del negocio, como la lee el panel al entrar. */
  let negocio = null;

  /** El token que el panel llevaría en cada request. Sin `entrar()`, no hay. */
  function exigirSesion() {
    if (!token) {
      throw new ErrorArnes(
        'el dueño no entró todavía',
        'llamá a dueno.entrar() antes de cualquier gesto — es el primer paso del guión también.',
      );
    }
    return token;
  }

  /** Anota la omisión que corresponde a este gesto (tarea 3.8). */
  const omitir = (id) => anotarOmitida(b, id);

  const dueno = {
    modo: 'api',
    bitacora: b,
    get negocio() { return negocio; },

    // ── 1. Entrar ────────────────────────────────────────────────────────────

    /**
     * El dueño entra con su usuario y su contraseña, y el panel lo deja pasar
     * derecho al tablero.
     *
     * `aislamiento.js` ya cambió la contraseña temporal en el alta, así que lo
     * que este gesto afirma es el estado en que quedó: **el dueño entra y no le
     * vuelven a pedir que la cambie**. Es la misma afirmación que hace el paso
     * 4 del guión, del lado del dato.
     *
     * Lo que NO afirma: que la pantalla de cambio sea una puerta y no un
     * cartel. Eso lo decide el guard de las rutas del panel.
     */
    async entrar() {
      const turno = b.dueno({
        gesto: `entré al panel como ${corrida.usuarioDueno}`,
        detalle: { usuario: corrida.usuarioDueno, panel: env.panelUrl },
      });

      const res = await api('POST', '/api/auth/login', '', {
        username: corrida.usuarioDueno,
        password: corrida.passwordDueno,
      });

      if (res.status !== 200) {
        // El dueño que no puede entrar es arnés roto, no producto roto: el alta
        // la hizo el propio arnés tres pasos antes, así que si esto falla el
        // que se rompió fue él. No hay veredicto sobre el producto.
        throw new ErrorArnes(
          `el dueño de la corrida no pudo entrar: HTTP ${res.status}`,
          `usuario ${corrida.usuarioDueno}`,
          `cuerpo: ${res.texto.slice(0, 300)}`,
        );
      }

      token = res.json.access_token;
      const pideCambio = res.json.usuario?.must_change_password === true;
      b.asercion({
        ok: !pideCambio,
        nivel: 1,
        turno,
        actor: 'dueno',
        que: 'el dueño entra derecho al tablero: la contraseña provisoria ya se cambió y no se la vuelven a pedir',
        esperado: 'must_change_password = false',
        llego: `must_change_password = ${pideCambio}`,
        origen: 'panel/src/App.tsx · el guard del cambio de contraseña',
      });
      omitir('cambio-de-contrasena-obligatorio');

      // La ficha del negocio: es lo primero que pide el panel al entrar, y de
      // acá salen los presets de demora del selector.
      const ficha = await api('GET', '/api/negocio', token);
      if (ficha.status !== 200) {
        throw new ErrorArnes(
          `no pude leer la ficha del negocio: HTTP ${ficha.status}`,
          'sin ella no se sabe qué presets de demora dibuja el panel.',
        );
      }
      negocio = ficha.json;

      b.asercion({
        ok: negocio?.vertical === 'gastronomia',
        nivel: 1,
        turno,
        actor: 'dueno',
        que: 'gastronomía ve el tablero de cocina, no la agenda de un consultorio',
        esperado: 'vertical = gastronomia',
        llego: `vertical = ${negocio?.vertical}`,
        origen: 'panel/src/vistas/Tablero.tsx · la bifurcación por vertical',
      });

      return dueno;
    },

    /**
     * Los presets de demora del negocio: los botones que el selector dibuja.
     * Si el negocio no los configuró, el panel cae a [15, 25, 40]
     * (`panel/src/contexto.tsx`), y esa copia está acá por el mismo motivo que
     * las otras: el arnés no importa código del panel.
     */
    presetsDeDemora() {
      const delNegocio = negocio?.config?.demoras_sugeridas;
      return Array.isArray(delNegocio) && delNegocio.length ? delNegocio : [15, 25, 40];
    },

    // ── 2. Ver los pedidos ───────────────────────────────────────────────────

    /**
     * El tablero como lo ve el dueño: los pedidos vivos, agrupados por columna.
     *
     * No anota nada: es una lectura, no un gesto. Lo que afirma quien la usa es
     * que **los registros existen**; que el dueño los VEA —sin recargar,
     * mientras el cliente todavía escribe— es otra afirmación y es del guión.
     */
    async tablero() {
      const t = exigirSesion();
      const res = await api('GET', `/api/compromisos?estado=${ESTADOS_TABLERO.join(',')}`, t);
      if (res.status !== 200) {
        throw new ErrorArnes(`no pude leer el tablero: HTTP ${res.status}`, res.texto.slice(0, 300));
      }
      const pedidos = (res.json || []).filter((c) => c.tipo === 'pedido');
      const columnas = { pendientes: [], cocina: [], listos: [], cobrar: [] };
      for (const p of pedidos) {
        const col = COLUMNA_DE_ESTADO[p.estado];
        if (col) columnas[col].push(p);
      }
      return { pedidos, columnas };
    },

    /**
     * Espera a que entre un pedido de este teléfono y lo devuelve.
     *
     * **Es el gesto que más difiere del guión y hay que tenerlo claro**: acá se
     * pregunta por el registro cada 300 ms. En la pantalla el pedido aparece
     * solo —la vista se refresca sola— y ESA es la promesa de `docs/FLUJOS.md`.
     * Este gesto anota la omisión.
     *
     * Devuelve `null` si no entró: la falla ya quedó anotada y encadenar los
     * gestos que dependían del pedido sólo agrega ruido.
     *
     * @param {object} opts
     * @param {string} opts.telefono     el del cliente de la corrida
     * @param {string[]} [opts.ignorar]  ids que ya se vieron: sin esto, dos
     *   esperas seguidas devuelven dos veces el mismo pedido, que es el
     *   fantasma clásico de un arnés que "pasa" leyendo lo de antes
     * @param {string} [opts.estado]     en qué estado esperarlo. Default: pendiente
     * @param {number} [opts.timeoutMs]
     */
    async esperarPedidoDe({ telefono, ignorar = [], estado = 'pendiente', timeoutMs = ESPERA_PEDIDO_MS }) {
      exigirSesion();
      const yaVistos = new Set(ignorar);
      const desde = Date.now();

      const turno = b.dueno({
        gesto: `me quedé mirando el tablero, esperando el pedido de ${telefono}`,
        detalle: { telefono, estado },
      });

      const pedido = await sondear(
        async () => {
          const { pedidos } = await dueno.tablero();
          return (
            pedidos.find(
              (p) =>
                p.cliente_telefono === String(telefono) &&
                p.estado === estado &&
                !yaVistos.has(p.id),
            ) || null
          );
        },
        { timeoutMs },
      );

      const segundos = Math.round((Date.now() - desde) / 1000);
      b.asercion({
        ok: Boolean(pedido),
        nivel: 1,
        turno,
        // El culpable de que no entre un pedido es el bot, no el dueño: el
        // dueño hizo su parte, que es mirar. Anclarlo al dueño mandaría a
        // buscar el bug en el panel, que es el lugar equivocado.
        actor: pedido ? 'dueno' : 'bot',
        que: 'el pedido entra al panel apenas hay ítems, sin que el dueño tenga que hacer nada',
        esperado: `un pedido ${estado} de ${telefono}`,
        llego: pedido
          ? `${pedido.id} · ${pedido.lineas?.length ?? 0} línea(s) · total ${pedido.total} · a los ${segundos} s`
          : `nada en ${Math.round(timeoutMs / 1000)} s`,
        origen: 'docs/FLUJOS.md · flujo A',
        dondeMirar: pedido ? null : 'GET /api/compromisos?estado=pendiente con el token del dueño',
      });

      omitir('pedido-aparece-sin-recargar');
      omitir('tarjeta-muestra-items-y-notas');
      return pedido;
    },

    // ── 3. Confirmar con demora ──────────────────────────────────────────────

    /**
     * El gesto central del producto: el local dice que sí y en cuánto sale.
     *
     * `minutos` tiene que ser un valor que **no** sea preset, porque ese es el
     * caso que el campo libre defiende. Acá pasa igual —el core no sabe qué se
     * dibujó— y por eso este gesto anota la omisión más grande del modo `api`.
     */
    async confirmarConDemora(pedidoId, minutos) {
      const t = exigirSesion();
      const presets = dueno.presetsDeDemora();

      if (presets.includes(minutos)) {
        // No es una falla del producto: es un escenario mal escrito. Confirmar
        // con un preset no prueba nada sobre el campo libre, ni acá ni en el
        // guión, y dejarlo pasar en silencio convierte la aserción cardinal en
        // una que nunca se evaluó.
        throw new ErrorArnes(
          `confirmar con ${minutos} min no prueba el campo libre: ${minutos} ES uno de los presets (${presets.join(', ')})`,
          'elegí un valor que no esté en negocio.config.demoras_sugeridas.',
        );
      }

      const turno = b.dueno({
        gesto: `confirmé el pedido con ${minutos} minutos, escritos a mano (los presets son ${presets.join('/')})`,
        detalle: { pedido: pedidoId, demora_min: minutos, presets },
      });

      const res = await api('PATCH', `/api/compromisos/${pedidoId}/estado`, t, {
        estado: 'confirmado',
        demora_min: minutos,
      });
      const c = res.json;
      const ok =
        res.status === 200 &&
        c?.estado === 'confirmado' &&
        c?.demora_min === minutos &&
        Boolean(c?.confirmado_en);

      b.asercion({
        ok,
        nivel: 1,
        turno,
        actor: 'dueno',
        que: 'el local confirma el pedido con la demora que él eligió, y esa demora queda guardada',
        esperado: `estado confirmado · demora_min ${minutos} · confirmado_en sellado`,
        llego:
          res.status !== 200
            ? `HTTP ${res.status}: ${res.texto.slice(0, 200)}`
            : `estado ${c?.estado} · demora_min ${c?.demora_min} · confirmado_en ${c?.confirmado_en ?? 'null'}`,
        origen: 'docs/FLUJOS.md · «el local confirma y le pone la demora»',
      });

      omitir('campo-libre-demora');
      omitir('presets-del-negocio-dibujados');
      omitir('tarjeta-cambia-de-columna');
      return ok ? c : null;
    },

    // ── 4. Mover a listo ─────────────────────────────────────────────────────

    /**
     * Mover a listo son **dos** gestos, no uno, y así es en la pantalla:
     * "Empezar" (confirmado → en_curso) y después "Listo" (en_curso → listo).
     * El grafo del core no admite confirmado → listo directo
     * (`core/internal/model/estado.go`, espejado en `panel/src/dominio/estados.ts`),
     * así que un arnés que intentara el salto fallaría con un 409 y parecería
     * un bug del core.
     */
    async marcarListo(pedidoId) {
      const empezado = await dueno.transicionar(pedidoId, 'en_curso', {
        gesto: 'toqué «Empezar»: el pedido pasa a la cocina',
        que: 'el pedido que entró a la cocina se ve como en curso',
      });
      if (!empezado) return null;
      return dueno.transicionar(pedidoId, 'listo', {
        gesto: 'toqué «Listo»: el pedido está para salir',
        que: 'el pedido terminado se ve como listo, esperando que se lo lleven',
      });
    },

    /** El pedido salió y se lo llevaron. */
    async entregar(pedidoId) {
      return dueno.transicionar(pedidoId, 'completado', {
        gesto: 'toqué «Entregado»',
        que: 'el pedido entregado sale del tablero de cocina y queda para cobrar',
      });
    },

    /**
     * Un cambio de estado cualquiera, con su aserción. Es la primitiva de la
     * que salen `marcarListo` y `entregar`; se expone porque un escenario puede
     * necesitar rechazar o cancelar. Devuelve `null` si no pasó.
     */
    async transicionar(pedidoId, estado, { gesto, que, extra = {}, origen = null } = {}) {
      const t = exigirSesion();
      const turno = b.dueno({
        gesto: gesto || `moví el pedido a ${estado}`,
        detalle: { pedido: pedidoId, estado, ...extra },
      });
      const res = await api('PATCH', `/api/compromisos/${pedidoId}/estado`, t, { estado, ...extra });
      const c = res.json;
      const ok = res.status === 200 && c?.estado === estado;

      b.asercion({
        ok,
        nivel: 1,
        turno,
        actor: 'dueno',
        que: que || `el pedido queda ${estado}`,
        esperado: `estado ${estado}`,
        llego:
          res.status !== 200
            ? `HTTP ${res.status}: ${res.texto.slice(0, 200)}`
            : `estado ${c?.estado}`,
        origen: origen || 'core/internal/model/estado.go · el grafo de estados',
      });
      return ok ? c : null;
    },

    // ── 5. Responder una consulta ────────────────────────────────────────────

    /** Las preguntas que el bot no supo contestar y dejó para el dueño. */
    async consultasPendientes() {
      const t = exigirSesion();
      const res = await api('GET', '/api/consultas?estado=pendiente', t);
      if (res.status !== 200) {
        throw new ErrorArnes(`no pude leer las consultas: HTTP ${res.status}`, res.texto.slice(0, 300));
      }
      return res.json || [];
    },

    /**
     * Espera a que el bot deje una pregunta de este cliente.
     *
     * Que la consulta EXISTA es nivel 1. Que el dueño se entere sin ir a
     * buscarla —la franja del tablero, con su número— es del panel.
     */
    async esperarConsultaDe({ telefono, ignorar = [], timeoutMs = ESPERA_PEDIDO_MS }) {
      exigirSesion();
      const yaVistas = new Set(ignorar);
      const desde = Date.now();

      const turno = b.dueno({
        gesto: `miré el buzón de preguntas esperando una de ${telefono}`,
        detalle: { telefono },
      });

      const consulta = await sondear(
        async () => {
          const lista = await dueno.consultasPendientes();
          return lista.find((c) => c.telefono === String(telefono) && !yaVistas.has(c.id)) || null;
        },
        { timeoutMs },
      );

      const segundos = Math.round((Date.now() - desde) / 1000);
      b.asercion({
        ok: Boolean(consulta),
        nivel: 1,
        turno,
        // Si no quedó la consulta, el que se salió del libreto es el bot:
        // o inventó una respuesta o no registró la pregunta.
        actor: consulta ? 'dueno' : 'bot',
        que: 'lo que el bot no sabe no se inventa: queda como pregunta para el dueño',
        esperado: `una consulta pendiente de ${telefono}`,
        llego: consulta ? `«${consulta.pregunta}» a los ${segundos} s` : `nada en ${Math.round(timeoutMs / 1000)} s`,
        origen: 'agente/skills/gastronomia/SKILL.md · no responder de memoria lo que no verificó',
      });

      omitir('aviso-de-consultas-pendientes');
      return consulta;
    },

    /**
     * El dueño contesta y el core le manda la respuesta al cliente por
     * WhatsApp ("Sobre tu consulta: …").
     *
     * **Que el mensaje llegó se asevera en el Graph falso, nunca acá.** Un 200
     * de este endpoint dice que el core lo encoló; un mensaje encolado no es un
     * mensaje recibido, y esa diferencia es la mitad del valor del producto.
     */
    async responderConsulta(consultaId, respuesta) {
      const t = exigirSesion();
      const turno = b.dueno({
        gesto: 'respondí la pregunta del cliente desde el panel',
        texto: respuesta,
        detalle: { consulta: consultaId },
      });

      const res = await api('PATCH', `/api/consultas/${consultaId}/responder`, t, { respuesta });
      const c = res.json;
      const ok = res.status === 200 && c?.estado === 'respondida' && c?.respuesta === respuesta;

      b.asercion({
        ok,
        nivel: 1,
        turno,
        actor: 'dueno',
        que: 'la pregunta queda respondida y sale del buzón del dueño',
        esperado: `estado respondida · respuesta «${respuesta}»`,
        llego:
          res.status !== 200
            ? `HTTP ${res.status}: ${res.texto.slice(0, 200)}`
            : `estado ${c?.estado} · respuesta «${c?.respuesta ?? ''}»`,
        origen: 'panel/src/vistas/Consultas.tsx · «Respondé acá y el cliente lo recibe por WhatsApp»',
      });

      omitir('consulta-se-va-al-responder');
      return ok ? c : null;
    },
  };

  return dueno;
}

/**
 * El bloque que hay que pegarle al agente que va a ejecutar `guion.md`.
 *
 * El guión no puede inventarse el usuario, la contraseña ni el teléfono del
 * cliente: son de la corrida, salen de `crearCorrida()` y cambian en cada una.
 * Esto los imprime juntos y en el orden en que el guión los pide, para que el
 * que corre el arnés en modo navegador copie una sola cosa.
 *
 * La contraseña se imprime porque es de un negocio de prueba creado hace un
 * minuto y sirve sólo contra el compose local. **Nunca** meter acá una
 * credencial de producción.
 */
export function datosParaElGuion(corrida, { env = entorno(), demoraLibre = 33 } = {}) {
  return [
    '── Datos de esta corrida (para arnes/dueno/guion.md) ──',
    `  panel:            ${env.panelUrl}/panel/`,
    `  usuario:          ${corrida.usuarioDueno}`,
    `  contraseña:       ${corrida.passwordDueno}`,
    `  negocio:          ${corrida.nombreNegocio} (${corrida.negocioId})`,
    `  wa_phone_id:      ${corrida.waPhoneId}`,
    `  teléfono cliente: ${corrida.telefonoCliente}`,
    `  demora a escribir: ${demoraLibre} min (paso 6 — NO tiene que ser un preset)`,
    '',
    '  Poné la ventana de Chrome ADELANTE y dejala visible: el tablero salta el',
    '  refresco automático cuando la pestaña está oculta, y sin eso el pedido no',
    '  aparece nunca. Eso NO es una falla del panel (guion.md, gotcha 1).',
    '',
    '  La corrida tiene que quedar viva hasta el final: el teléfono del cliente',
    '  vive dentro de este proceso y el último paso del guión lee de ahí.',
    '',
    '  El guión nombra los elementos por rol, etiqueta y texto visible.',
    '  Si un gesto te pide un selector de CSS, eso es un hallazgo de',
    '  accesibilidad del panel: anotalo, no lo resuelvas con el selector.',
  ].join('\n');
}
