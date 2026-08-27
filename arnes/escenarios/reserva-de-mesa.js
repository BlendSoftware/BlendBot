/**
 * `reserva-de-mesa` — el Flujo D, y su contraste.
 *
 * Reservar una mesa **sí** ocupa agenda: `consultar_disponibilidad` y
 * `bloquear`, con el recurso `mesa` y capacidad por cubiertos (una mesa de 4 no
 * sirve para 6). Un pedido de comida **no**: la comida no ocupa agenda.
 *
 * ── El contraste es la mitad del escenario, y es la mitad que encuentra bugs ─
 * Aseverar que una reserva usa la agenda prueba poco: es lo que el `SKILL.md`
 * dice y es lo que un bot razonable hace. Lo que sí encuentra algo es la
 * ausencia: un bot que llama a `consultar_disponibilidad` para un pedido de
 * hamburguesas está gastando una tool, metiendo latencia y —peor— pudiendo
 * bloquear un hueco de mesa que nadie va a usar. Ese bug no se ve en la
 * conversación: se ve mirando qué tools llamó, y por eso el nivel 2 existe.
 *
 * ── Y el hueco bloqueado ────────────────────────────────────────────────────
 * *"El hueco se bloquea mientras completa los datos. Sin el `hold`, dos
 * personas sacan el mismo turno"* (`docs/FLUJOS.md`). La tercera mitad asevera
 * que un hueco ya tomado no se le ofrece al segundo cliente.
 */

/** Capacidad de la mesa del escenario. Cuatro, como el Flujo D. */
const CUBIERTOS = 4;

export default {
  id: 'reserva-de-mesa',
  titulo: 'la reserva de mesa recorre el camino de la agenda, y un pedido de comida no lo toca',
  origen: 'docs/FLUJOS.md · Flujo D · SKILL.md · Las tools',
  tags: [],
  pendiente: null,

  reglas: ['R2', 'R3', 'R5'],
  guion: null,

  /** La mesa y sus horarios. Sin recurso ni horario no hay agenda que consultar. */
  async preparar(ctx) {
    const { corrida } = ctx;
    const token = corrida.tokenDueno;

    const recurso = await corrida.api('POST', '/api/recursos', token, {
      tipo: 'mesa',
      nombre: 'Mesa 1',
      capacidad: CUBIERTOS,
    });
    if (recurso.status !== 201) {
      ctx.nota(`no se pudo crear la mesa: HTTP ${recurso.status} — ${recurso.texto.slice(0, 200)}`);
      return;
    }
    ctx.mesaId = recurso.json.id;

    // Todos los días de 20 a 00, que es el horario del local del documento.
    // Todos los días y no sólo uno para que el escenario no dependa de qué día
    // se corra: un arnés que falla los martes es un arnés que se apaga.
    for (let dia = 0; dia <= 6; dia += 1) {
      const h = await corrida.api('POST', `/api/recursos/${ctx.mesaId}/horarios`, token, {
        dia_semana: dia,
        desde: '20:00',
        hasta: '23:59',
      });
      if (h.status !== 201 && h.status !== 200) {
        ctx.nota(`no se pudo cargar el horario del día ${dia}: HTTP ${h.status}`);
        break;
      }
    }
  },

  async correr(ctx) {
    const { core, tools } = ctx;

    if (!ctx.mesaId) {
      ctx.informe.omitir({
        protege: 'una reserva de mesa consulta disponibilidad y bloquea el hueco elegido',
        origen: 'docs/FLUJOS.md · Flujo D',
        porque: 'no se pudo dar de alta la mesa ni sus horarios en la preparación',
      });
      return;
    }

    // ── La reserva ──────────────────────────────────────────────────────────
    await ctx.decir('hola, quiero reservar una mesa para el sábado a la noche');
    await ctx.decir(String(CUBIERTOS));
    await ctx.decir('la primera que tengas, a nombre de Juani');

    tools.llamo({
      tool: 'consultar_disponibilidad',
      protege: 'reservar una mesa sí ocupa agenda: ahí usás consultar_disponibilidad y bloquear',
      origen: 'SKILL.md · Reserva de mesa (Flujo D)',
    });
    tools.llamo({
      tool: 'bloquear',
      protege: 'el hueco se bloquea mientras el cliente completa los datos: sin el hold, dos personas sacan la misma mesa',
      origen: 'docs/FLUJOS.md · «El hueco se bloquea mientras completa los datos»',
    });
    tools.orden({
      secuencia: ['consultar_disponibilidad', 'bloquear'],
      protege: 'primero se consulta el hueco y después se bloquea el que el cliente eligió, no al revés',
      origen: 'SKILL.md · Las tools',
    });
    tools.argumentos({
      tool: 'bloquear',
      protege: 'copiá `inicio`/`fin` del hueco que devolvió disponibilidad: no los inventes',
      origen: 'SKILL.md · bloquear',
      comprobar: (args) => (args.inicio && args.fin ? true : 'bloquear se llamó sin inicio o sin fin'),
    });

    const reservado = await core.foto();
    const reserva = core.elCompromiso(reservado);
    core.campo(reserva, 'tipo', 'reserva', {
      protege: 'una reserva de mesa entra al panel como reserva, no como pedido',
      origen: 'docs/FLUJOS.md · Flujo D, «mismo motor, recurso mesa»',
    });
    core.exigir({
      ok: Boolean(reserva?.inicio),
      protege: 'el compromiso queda con el horario que el cliente eligió',
      origen: 'docs/FLUJOS.md · Flujo D',
      esperado: 'un inicio cargado',
      llego: reserva?.inicio ?? 'sin horario',
    });

    // ── El contraste: un pedido de comida NO toca la agenda ─────────────────
    //
    // Corre en su propia conversación, con otro cliente, porque una sesión que
    // ya reservó una mesa tiene `consultar_disponibilidad` en su historial y la
    // ausencia no se podría aseverar.
    const otro = ctx.otroCliente({ sufijo: 'c', nombre: 'Sofía' });
    await otro.decir('hola, me armás una doble cheddar y unas papas? paso a buscarlo');

    otro.tools.noLlamo({
      tool: 'consultar_disponibilidad',
      protege: 'para pedidos de comida consultar_disponibilidad no se usa: la comida no ocupa agenda',
      origen: 'SKILL.md · Las tools',
    });
    otro.tools.noLlamo({
      tool: 'bloquear',
      protege: 'un pedido de comida no bloquea nada: bloquear es sólo al reservar una mesa',
      origen: 'SKILL.md · Las tools',
    });
    otro.tools.llamo({
      tool: 'armar_compromiso',
      protege: 'un pedido de comida se arma con armar_compromiso y entra al panel, sin pasar por la agenda',
      origen: 'SKILL.md · El flujo del pedido',
    });

    // ── El hueco bloqueado no se ofrece dos veces ───────────────────────────
    const tercero = ctx.otroCliente({ sufijo: 'd', nombre: 'Marcos' });
    await tercero.decir(`hola, tenés mesa para ${CUBIERTOS} el sábado a la noche?`);

    const trasElTercero = await core.foto();
    const suya = core.elCompromiso(trasElTercero, { telefono: tercero.telefono });
    core.exigir({
      ok: !suya || suya.inicio !== reserva?.inicio,
      protege: 'el hueco ya bloqueado no se le ofrece a otro: no se promete una mesa que no está',
      origen: 'docs/FLUJOS.md · casos borde, «el hold gana. El segundo ve el hueco ya ocupado»',
      esperado: 'el segundo cliente no queda con el mismo horario',
      llego: suya?.inicio ? `también quedó a las ${suya.inicio}` : 'no quedó con ese horario',
    });
  },
};
