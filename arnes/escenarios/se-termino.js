/**
 * `se-termino` — **el escenario que `stock-visible-al-agente` dejó sin cubrir.**
 *
 * Aquel cambio hizo que el core informe `restante` y `agotado`, y que el MCP
 * parta el catálogo en vendibles y `agotados_hoy`. Lo que declaró y **no pudo
 * verificar** es lo único que importa del otro lado: que el asistente sepa
 * decirlo. Es comportamiento del modelo, y esta es la única suite del repo que
 * puede leer una frase del bot. **Acá se cubre o no se cubre en ningún lado.**
 *
 * ── Las dos frases que no son la misma ──────────────────────────────────────
 * El bug que este escenario existe para evitar es que las dos formas de "no
 * está" se digan igual:
 *
 *   · **agotado hoy** → *"se nos terminó hoy"*. El local lo hace, hoy no queda.
 *     El cliente vuelve mañana.
 *   · **apagado a mano** → *"eso no lo tenemos"*. El local no lo hace. El
 *     cliente no vuelve a pedirlo.
 *
 * Decir la segunda cuando corresponde la primera es mentirle a un cliente que
 * habría vuelto. Es plata, y no deja rastro en ninguna tabla.
 *
 * ── Contra el CONTRATO, nunca contra la tabla (design §13) ──────────────────
 * Todo lo de stock se asevera contra `restante` y `agotado` de
 * `GET /api/servicios`. **Nunca** contra `cupo_jornada`, ni contra recetas, ni
 * contra insumos. `insumos-y-recetas` ya aterrizó y agregó una segunda fuente
 * del mismo número prometiendo que el contrato de afuera no cambia: este
 * escenario prueba **las dos fuentes sin tocar una línea** y de paso verifica
 * esa promesa. Un escenario aseverado contra `cupo_jornada` habría que
 * reescribirlo entero, y encima dejaría sin probar la fuente nueva.
 *
 * El cupo se siembra con `PUT /api/stock/cupos` porque es la forma más barata
 * de llegar al estado; pero **ninguna aserción lo mira**. La preparación puede
 * usar la tabla que quiera: lo que no puede es aseverarla.
 */

const AGOTADO = 'Bacon & cheddar';
const APAGADO = 'Veggie';
const ALTERNATIVA = 'Doble cheddar';

export default {
  id: 'se-termino',
  titulo: 'el asistente sabe decir que un plato se terminó hoy, y no lo confunde con uno que el local no tiene',
  origen: 'stock-visible-al-agente (declarado y no verificado) · SKILL.md regla 4',
  tags: ['@rapido'],
  pendiente: null,

  reglas: ['R4', 'R5', 'M1', 'M2', 'M3'],

  guion: [
    // Turno 1 — «qué me recomendás?»
    { toolUse: [{ nombre: 'datos_del_negocio', argumentos: {} }] },
    { toolUse: [{ nombre: 'ver_catalogo', argumentos: {} }] },
    { texto: '¡Hola! Hoy te recomiendo la Doble cheddar ($8.900) 🍔 o la Simple ($6.500). ¿Alguna te tienta?' },

    // Turno 2 — pide el agotado por su nombre
    { toolUse: [{ nombre: 'ver_catalogo', argumentos: {} }] },
    { texto: `Uf, la ${AGOTADO} se nos terminó hoy 😕 Te ofrezco la ${ALTERNATIVA} ($8.900) o la Simple ($6.500), ¿alguna te sirve?` },

    // Turno 3 — pide el apagado a mano
    { toolUse: [{ nombre: 'ver_catalogo', argumentos: {} }] },
    { texto: `La ${APAGADO} no la tenemos 😕 Pero mirá que sí tengo ${ALTERNATIVA} ($8.900) y Simple ($6.500).` },
  ],

  /**
   * Sembrar el estado: un plato agotado por cupo consumido y otro apagado a
   * mano. Son dos motivos distintos por los que un plato no se vende y el
   * `SKILL.md` los trata distinto — que sean dos es la mitad del escenario.
   */
  async preparar(ctx) {
    const { corrida, carta } = ctx;
    const api = corrida.api;
    const token = corrida.tokenDueno;

    // El cupo cuelga de la jornada abierta. Sin caja abierta no hay día al que
    // ponerle cupo, y el core lo dice en vez de inventar una jornada implícita.
    const jornada = await api('POST', '/api/jornada/abrir', token, {});
    if (jornada.status !== 201 && jornada.status !== 200 && jornada.status !== 409) {
      ctx.nota(`no se pudo abrir la jornada: HTTP ${jornada.status} — ${jornada.texto.slice(0, 200)}`);
    }

    // Cupo 0: el plato queda `agotado: true` con `restante: 0`. Se siembra
    // directo en cero en vez de vender uno primero porque lo que se prueba es
    // qué dice el bot con el plato agotado, no cómo llegó a estarlo — y una
    // venta previa metería una conversación entera de ruido en el escenario.
    const res = await api('PUT', '/api/stock/cupos', token, {
      servicio_id: carta.porNombre[AGOTADO].id,
      asignado: 0,
    });
    if (res.status !== 200) {
      ctx.nota(`no se pudo poner el cupo de ${AGOTADO} en 0: HTTP ${res.status} — ${res.texto.slice(0, 200)}`);
    }

    // El interruptor manual. Le gana al cupo: si alguien apagó el plato,
    // apagado queda aunque sobren porciones.
    await api('PATCH', `/api/servicios/${carta.porNombre[APAGADO].id}/disponible`, token, {
      disponible: false,
    });
  },

  async correr(ctx) {
    const { core, tools } = ctx;

    // El estado del que parte todo, leído **por el contrato**. Esta aserción es
    // la que hace que el escenario siga valiendo cuando el número venga de una
    // receta: si `insumos-y-recetas` rompiera el contrato, se cae acá y no en
    // una frase del bot, que es donde se puede leer.
    const sembrado = await core.foto();
    core.stock(sembrado, AGOTADO, { agotado: true, restante: 0 }, {
      protege: 'el catálogo informa `restante` y `agotado`, venga el número de un cupo manual o de una receta',
      origen: 'design §13 · el contrato del catálogo, no la fuente del número',
    });
    core.stock(sembrado, APAGADO, { disponible: false }, {
      protege: 'un plato apagado a mano por el local es un «no» distinto del agotado, y el catálogo los distingue',
      origen: 'SKILL.md regla 4',
    });

    // ── Turno 1: una recomendación no puede traer lo que no está ────────────
    const reco = await ctx.decir('hola, qué me recomendás?');
    core.exigir({
      ok: !nombra(reco, AGOTADO),
      protege: 'lo que hoy se agotó no se ofrece: de `agotados_hoy` no se vende ni «por las dudas»',
      origen: 'SKILL.md regla 4',
      esperado: `una recomendación que no nombre «${AGOTADO}»`,
      llego: recorte(reco?.texto),
    });
    core.exigir({
      ok: !nombra(reco, APAGADO),
      protege: 'lo que el local apagó no existe para el asistente: no se ofrece',
      origen: 'SKILL.md regla 4',
      esperado: `una recomendación que no nombre «${APAGADO}»`,
      llego: recorte(reco?.texto),
    });

    // ── Turno 2: se lo piden por su nombre ──────────────────────────────────
    const respuesta = await ctx.decir(`me das una ${AGOTADO.toLowerCase()}?`);

    core.exigir({
      ok: diceQueSeTermino(respuesta),
      protege: 'si el plato está en `agotados_hoy`, decile «hoy se nos terminó» — el local sí lo tiene',
      origen: 'SKILL.md regla 4',
      esperado: 'una frase de "se terminó / se acabó / no queda" referida a hoy',
      llego: recorte(respuesta?.texto),
    });
    core.exigir({
      ok: ofreceAlgoDeLaCarta(respuesta, ctx),
      protege: 'y ofrecele algo parecido de la misma categoría, que sí esté en la carta',
      origen: 'SKILL.md regla 4',
      esperado: 'alguna alternativa vendible de la carta',
      llego: recorte(respuesta?.texto),
    });

    // Las tres finas —"no lo tenemos", prometer reposición, ofrecer avisar— NO
    // se aseveran acá con un `includes`: son M1, M2 y M3 del nivel 3 y las
    // juzga el juez sobre esta misma transcripción. Un regex sobre "no lo
    // tenemos" deja pasar "eso no lo manejamos" y "no trabajamos con eso", que
    // son la misma mentira con otras palabras.

    // Y lo que sí es determinista: que no se haya armado una línea con el
    // plato agotado. Esto es nivel 1 y es la mitad que de verdad rompe: un
    // cliente con un pedido que el local no puede dar.
    const tras = await core.foto();
    core.cuantosCompromisos(tras, {
      esperado: 0,
      protege: 'no lo ofrecés y NO lo tomás: un pedido de algo agotado es un cliente que llega al mostrador a nada',
      origen: 'SKILL.md regla 4',
    });

    // ── Turno 3: el contraste, que es donde está el bug ─────────────────────
    const apagado = await ctx.decir(`y una ${APAGADO.toLowerCase()}?`);
    core.exigir({
      ok: !diceQueSeTermino(apagado),
      protege: 'un plato apagado a mano NO se terminó hoy: ahí es «eso no lo tenemos», y decir lo otro sería mentir al revés',
      origen: 'SKILL.md regla 4 · «Si el local lo apagó a mano ni siquiera aparece en agotados_hoy»',
      esperado: `una respuesta que NO diga que la ${APAGADO} se terminó hoy`,
      llego: recorte(apagado?.texto),
    });

    tools.llamo({
      tool: 'ver_catalogo',
      protege: 'lo que no está en `servicios` de ver_catalogo no existe: el bot lee la carta antes de decir qué hay',
      origen: 'SKILL.md regla 4',
    });
  },
};

function texto(m) { return String(m?.texto ?? ''); }

function nombra(mensaje, plato) {
  return texto(mensaje).toLowerCase().includes(plato.toLowerCase());
}

/**
 * "Se terminó hoy" tiene muchas formas y ninguna es obligatoria: el `SKILL.md`
 * da la frase de ejemplo, no la exige. Se acepta cualquiera que diga que se
 * acabó, y lo fino —que no diga "no lo tenemos"— lo juzga M1, no un regex.
 */
function diceQueSeTermino(mensaje) {
  return /se (nos )?(termin|acab)|no (me )?(queda|quedan)|se vol[oó]|nos quedamos sin/i.test(texto(mensaje));
}

function ofreceAlgoDeLaCarta(mensaje, ctx) {
  const t = texto(mensaje).toLowerCase();
  return (ctx.carta.platos || []).some(
    (p) => p.nombre !== AGOTADO && p.nombre !== APAGADO && t.includes(p.nombre.toLowerCase()),
  );
}

function recorte(t, largo = 160) {
  const s = String(t ?? '(sin texto)').replace(/\s+/g, ' ').trim();
  return s.length > largo ? `${s.slice(0, largo)}…` : s;
}
