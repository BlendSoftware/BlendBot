/**
 * `insumo-compartido` — vender un plato baja las porciones posibles de otro que
 * comparte materia prima, y el asistente no puede mentir sobre ninguno de los
 * dos.
 *
 * ── Por qué este escenario nació declarado `@pendiente` y por qué ya no lo es ─
 * Cuando se escribió el cambio, `insumos-y-recetas` no existía y este escenario
 * quedó declarado pendiente con su motivo (spec: *"un escenario que todavía no
 * se puede correr se saltea ruidosamente"*). Esa capacidad **ya aterrizó**.
 *
 * Se resolvió el pendiente de la forma que el propio spec pide en su segundo
 * scenario —*"WHEN la capacidad de la que dependía ya está en el sistema, THEN
 * el escenario corre"*—: en vez de un `pendiente` escrito a mano que alguien
 * tiene que acordarse de borrar, el escenario **pregunta si la capacidad está**
 * (`requisito()`) y se declara pendiente solo si no está. Un pendiente escrito
 * a mano sobrevive a la capacidad que lo justificaba y se convierte en un test
 * muerto que nadie extraña; uno que se pregunta se apaga solo el día correcto.
 *
 * ── Qué asevera, y contra qué ───────────────────────────────────────────────
 * Contra el **contrato**, como todo lo de stock (design §13): `restante` y
 * `agotado` de `GET /api/servicios`. Ni una aserción mira `insumo`, `receta` ni
 * `cupo_jornada`. Ésa es justamente la promesa que `insumos-y-recetas` hizo
 * —*"cambia de dónde sale el número"*, el contrato de afuera no— y este
 * escenario la verifica de paso: las mismas aserciones que en `se-termino`,
 * sobre un número que ahora sale de otro lado.
 *
 * Y el corolario que el design le encargó a este arnés: el riesgo que
 * `insumos-y-recetas` nombra —*"una receta mal cargada apaga un plato
 * vendible"*— tiene como síntoma **una frase del bot**, y ésta es la única
 * suite del repo que puede leerla.
 */

/** Los dos platos que comparten materia prima. */
const PLATO_A = 'Doble cheddar';
const PLATO_B = 'Bacon & cheddar';
/** El insumo compartido: el medallón. Alcanza para dos hamburguesas dobles. */
const INSUMO = 'Medallón';
const STOCK_INICIAL = 4;
const POR_HAMBURGUESA = 2;

export default {
  id: 'insumo-compartido',
  titulo: 'vender un plato baja las porciones posibles de otro que comparte materia prima, y el bot no miente sobre ninguno',
  origen: 'insumos-y-recetas · design §13, corolario',
  tags: [],
  pendiente: null,

  reglas: ['R4', 'R5', 'M1', 'M2'],
  guion: null,

  /**
   * ¿Está la capacidad de la que este escenario depende?
   *
   * Se pregunta en vez de asumir. Si `GET /api/insumos` no existe, el escenario
   * se lista como **pendiente con su motivo** y no cuenta como aprobado — que
   * es exactamente lo que el spec pide de un escenario que todavía no se puede
   * correr. Un pendiente que se saltea en silencio es un test muerto.
   */
  async requisito(ctx) {
    const res = await ctx.corrida.api('GET', '/api/insumos', ctx.corrida.tokenDueno);
    if (res.status === 200) return null;
    return {
      motivo: `el core todavía no expone /api/insumos (HTTP ${res.status}): sin recetas no hay insumo compartido que probar`,
      desbloquea: 'el cambio `insumos-y-recetas`',
    };
  },

  /** Un insumo compartido y dos recetas que lo consumen. */
  async preparar(ctx) {
    const { corrida, carta } = ctx;
    const token = corrida.tokenDueno;

    await corrida.api('POST', '/api/jornada/abrir', token, {});

    const insumo = await corrida.api('POST', '/api/insumos', token, {
      nombre: INSUMO,
      unidad: 'unidad',
      stock_inicial: STOCK_INICIAL,
    });
    if (insumo.status !== 201) {
      ctx.nota(`no se pudo crear el insumo: HTTP ${insumo.status} — ${insumo.texto.slice(0, 200)}`);
      return;
    }
    ctx.insumoId = insumo.json.id;

    // Las dos recetas consumen el MISMO insumo. Ése es el escenario entero: con
    // 4 medallones y 2 por hamburguesa, hay dos hamburguesas en total —no dos
    // de cada una—, y el catálogo lo tiene que decir para las dos.
    for (const plato of [PLATO_A, PLATO_B]) {
      const r = await corrida.api('PUT', `/api/servicios/${carta.porNombre[plato].id}/receta`, token, {
        items: [{ insumo_id: ctx.insumoId, cantidad: POR_HAMBURGUESA }],
      });
      if (r.status !== 200) {
        ctx.nota(`no se pudo cargar la receta de ${plato}: HTTP ${r.status} — ${r.texto.slice(0, 200)}`);
      }
    }
  },

  async correr(ctx) {
    const { core } = ctx;
    const posibles = Math.floor(STOCK_INICIAL / POR_HAMBURGUESA);

    // ── El punto de partida, por el contrato ────────────────────────────────
    const inicial = await core.foto();
    core.stock(inicial, PLATO_A, { restante: posibles, agotado: false }, {
      protege: 'el catálogo informa cuántas porciones quedan, venga el número de un cupo manual o de una receta',
      origen: 'design §13 · el contrato del catálogo, no la fuente del número',
    });
    core.stock(inicial, PLATO_B, { restante: posibles, agotado: false }, {
      protege: 'dos platos que comparten materia prima informan el mismo restante: la materia prima es una sola',
      origen: 'insumos-y-recetas',
    });

    // ── Se vende uno, y el OTRO baja ────────────────────────────────────────
    await ctx.decir(`hola, me armás una ${PLATO_A.toLowerCase()}? la paso a buscar, soy Juani`);

    const pedido = core.elCompromiso(await core.foto());
    if (!pedido) {
      ctx.informe.omitir({
        protege: 'vender un plato baja las porciones posibles del otro que comparte materia prima',
        origen: 'insumos-y-recetas',
        porque: 'no se llegó a armar el pedido: no hay venta que descuente el insumo',
      });
      return;
    }
    await ctx.dueno.entrar();
    await ctx.dueno.confirmarConDemora(pedido.id, 20);
    ctx.transcripcion.dueno('confirma el pedido, y ahí se descuenta el insumo');

    const trasLaVenta = await core.foto();
    core.stock(trasLaVenta, PLATO_B, { restante: posibles - 1 }, {
      protege: 'vender una hamburguesa baja las porciones posibles de la OTRA: comparten el mismo medallón',
      origen: 'insumos-y-recetas · design §13, corolario',
    });

    // ── Y el bot no puede mentir sobre ninguno de los dos ───────────────────
    //
    // Se pide el plato que NO se vendió. El catálogo ya dice que queda uno
    // menos, y lo que se protege es que el bot lo lea de ahí en vez de suponer
    // que sigue habiendo de sobra.
    const otro = ctx.otroCliente({ sufijo: 'e', nombre: 'Sofía' });
    await otro.decir(`hola, cuántas ${PLATO_B.toLowerCase()} te quedan?`);

    otro.tools.llamo({
      tool: 'ver_catalogo',
      protege: 'si un ítem trae `restante`, quedan esas y podés decirlo; si NO trae el campo, no sabés cuántas hay',
      origen: 'SKILL.md · Quedan pocas porciones',
    });

    // ── Se vende el segundo: ahora los DOS quedan agotados ──────────────────
    await otro.decir(`dale, me llevo una. a nombre de Sofía, la retiro`);
    const suPedido = core.elCompromiso(await core.foto(), { telefono: otro.telefono });
    if (suPedido) {
      await ctx.dueno.confirmarConDemora(suPedido.id, 20);
      ctx.transcripcion.dueno('confirma el segundo pedido: se acaba el insumo');
    }

    const sinInsumo = await core.foto();
    core.stock(sinInsumo, PLATO_A, { agotado: true, restante: 0 }, {
      protege: 'sin materia prima, los dos platos quedan agotados a la vez: el catálogo no puede decir que hay de uno',
      origen: 'insumos-y-recetas · design §13, corolario',
    });
    core.stock(sinInsumo, PLATO_B, { agotado: true, restante: 0 }, {
      protege: 'el que comparte el insumo se agota junto con el otro, aunque nadie lo haya pedido',
      origen: 'insumos-y-recetas',
    });

    // Que el bot diga «se nos terminó hoy» y no «no lo tenemos» sobre un plato
    // agotado **por receta** es la frase que el design le encarga a este arnés:
    // el síntoma de una receta mal cargada es una frase del bot, y M1/M2 la
    // juzgan sobre esta transcripción.
    const tercero = ctx.otroCliente({ sufijo: 'f', nombre: 'Marcos' });
    await tercero.decir(`me das una ${PLATO_A.toLowerCase()}?`);

    const trasElTercero = await core.foto();
    core.exigir({
      ok: !core.elCompromiso(trasElTercero, { telefono: tercero.telefono }),
      protege: 'lo que se agotó no se ofrece y NO se toma, aunque se haya agotado por un insumo y no por un cupo',
      origen: 'SKILL.md regla 4 · design §13',
      esperado: 'ningún pedido armado con el plato agotado',
      llego: core.elCompromiso(trasElTercero, { telefono: tercero.telefono }) ? 'se armó igual' : 'no se armó',
    });
  },
};
