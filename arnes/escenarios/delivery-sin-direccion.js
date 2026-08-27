/**
 * `delivery-sin-direccion` — un delivery no se cierra sin dirección, y un local
 * que no hace delivery lo dice y ofrece lo que sí hace.
 *
 * Son dos mitades y las dos importan:
 *
 *   1. El local **sí** hace delivery y el cliente no da la dirección. El bot se
 *      la pide y el pedido no se confirma sin ella. El core ya devuelve
 *      `falta_direccion` como error con instrucción adentro (`SKILL.md`: *"si
 *      una tool devuelve `ok:false`, leé el campo `error`: es una instrucción"*),
 *      así que lo que se prueba acá es que el bot **haga caso** en vez de
 *      improvisar una dirección o reintentar igual.
 *
 *   2. El local **no** hace delivery. Ahí no hay error de tool que lo empuje:
 *      el dato está en `datos_del_negocio` y el bot tiene que leerlo antes de
 *      ofrecer algo que el local no hace. Es la mitad que se rompe sin ruido:
 *      un compromiso con `entrega: delivery` en un local sin delivery entra
 *      igual al panel y el problema aparece en la puerta del cliente.
 *
 * La segunda mitad corre en **su propio negocio**, porque `acepta_delivery` es
 * config del alta y cambiarla a mitad de una conversación sería probar un
 * sistema que no existe. Ver `negocioAlterno`.
 */

export default {
  id: 'delivery-sin-direccion',
  titulo: 'un delivery no se cierra sin dirección, y un local sin delivery lo dice y ofrece las alternativas',
  origen: 'SKILL.md · El flujo del pedido · docs/FLUJOS.md',
  tags: [],
  pendiente: null,

  reglas: ['R2', 'R3', 'R5', 'M4'],
  guion: null,

  /** El local de este escenario SÍ hace delivery. La otra mitad usa el suyo. */
  negocio: { config: { confirmacion: { pedido: 'humana' }, acepta_delivery: true } },

  /**
   * La segunda mitad necesita un negocio con el delivery apagado. `correr.js`
   * lo levanta como una corrida aparte con su propio tenant y su propio
   * teléfono, y se lo pasa en `ctx.alterno`.
   */
  negocioAlterno: {
    id: 'sin-delivery',
    config: { confirmacion: { pedido: 'humana' }, acepta_delivery: false },
  },

  async correr(ctx) {
    const { core, tools } = ctx;

    // ── Mitad 1: pide delivery y no da la dirección ─────────────────────────
    await ctx.decir('hola, quiero una doble cheddar para delivery');

    const sinDireccion = await core.foto();
    const pedido = core.elCompromiso(sinDireccion);

    // El pedido puede existir o no en este turno —el core rechaza el
    // `armar_compromiso` sin dirección con `falta_direccion`— y las dos cosas
    // son aceptables. Lo que NO es aceptable es que quede confirmado.
    core.exigir({
      ok: !pedido || pedido.estado !== 'confirmado',
      protege: 'sin dirección no se puede cerrar un delivery',
      origen: 'SKILL.md · «Si es delivery, pedí la dirección antes de confirmar»',
      esperado: 'ningún pedido confirmado todavía',
      llego: pedido ? `estado ${pedido.estado}` : 'no hay pedido',
    });
    core.exigir({
      ok: !pedido?.direccion,
      protege: 'el asistente no inventa una dirección: si no la tiene, la pide',
      origen: 'SKILL.md regla 6 · «si no lo verificaste con una tool, no lo afirmás»',
      esperado: 'sin dirección',
      llego: pedido?.direccion ? `dirección «${pedido.direccion}»` : 'sin dirección',
    });

    // ── El cliente la da, y recién ahí se cierra ────────────────────────────
    await ctx.decir('San Martín 1234');
    await ctx.decir('a nombre de Juani, dale');

    const conDireccion = await core.foto();
    const cerrado = core.elCompromiso(conDireccion);
    core.campo(cerrado, 'entrega', 'delivery', {
      protege: 'el pedido queda como delivery, que es lo que el cliente pidió',
      origen: 'SKILL.md · armar_compromiso',
    });
    core.exigir({
      ok: Boolean(cerrado?.direccion),
      protege: 'la dirección que dio el cliente queda en el pedido que ve la cocina',
      origen: 'SKILL.md · «pedí la dirección (calle y número) antes de confirmar»',
      esperado: 'una dirección cargada',
      llego: cerrado?.direccion ?? 'sin dirección',
    });
    core.campo(cerrado, 'estado', 'pendiente', {
      protege: 'vos NO confirmás el pedido solo, ni siquiera cuando ya tenés todos los datos',
      origen: 'SKILL.md regla 3',
    });
    tools.argumentos({
      tool: 'armar_compromiso',
      protege: 'la dirección va en `direccion` de armar_compromiso, no escondida en una nota',
      origen: 'SKILL.md · armar_compromiso',
      comprobar: (args) => (args.direccion ? true : 'la última llamada a armar_compromiso no trae `direccion`'),
    });

    // ── Mitad 2: el local no hace delivery ──────────────────────────────────
    if (!ctx.alterno) {
      ctx.informe.omitir({
        protege: 'si el local no hace delivery, decilo y ofrecé retira o comer en el local',
        origen: 'SKILL.md · El flujo del pedido',
        porque: 'no se levantó el negocio alterno con `acepta_delivery: false`',
      });
      return;
    }

    const otro = ctx.alterno;
    await otro.decir('hola, me mandan una doble cheddar a casa?');

    const alterna = await otro.core.foto();
    const suPedido = otro.core.elCompromiso(alterna);
    otro.core.exigir({
      ok: !suPedido || suPedido.entrega !== 'delivery',
      protege: 'si el local no hace delivery, no se arma un compromiso con entrega a domicilio',
      origen: 'SKILL.md · «Si el local no hace delivery (acepta_delivery=false), decílo»',
      esperado: 'ningún pedido con entrega delivery',
      llego: suPedido ? `entrega ${suPedido.entrega}` : 'no hay pedido',
    });
    otro.tools.llamo({
      tool: 'datos_del_negocio',
      protege: 'arrancá siempre por datos_del_negocio: de ahí sale si el local hace delivery',
      origen: 'SKILL.md · Las tools',
    });

    // Que lo DIGA y ofrezca las alternativas es lo que el juez mira sobre esta
    // transcripción: las formas de decirlo son muchas y ninguna es obligatoria.
    const dicho = otro.recibidos().map((m) => m.texto ?? '').join('\n').toLowerCase();
    otro.core.exigir({
      ok: /retir|buscar|local|mostrador|ac[aá]/.test(dicho),
      protege: 'decilo y ofrecé retira o comer en el local: no lo mandes a otro lado ni lo dejes sin salida',
      origen: 'SKILL.md · El flujo del pedido',
      esperado: 'alguna alternativa que el local sí hace',
      llego: dicho ? dicho.slice(0, 160) : 'no dijo nada',
    });
  },
};
