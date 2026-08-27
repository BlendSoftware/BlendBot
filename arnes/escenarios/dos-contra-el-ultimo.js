/**
 * `dos-contra-el-ultimo` — dos clientes, un solo plato, y el que gana es el
 * primero que el local confirma.
 *
 * Los dos pedidos se arman **antes** de que el local confirme ninguno, que es
 * como pasa en el mostrador: dos personas escriben con un minuto de diferencia
 * y la cocina mira el panel cuando puede. En ese hueco el stock todavía alcanza
 * para los dos, y la pregunta que este escenario contesta es qué pasa cuando el
 * local va a confirmar el segundo.
 *
 * ── Qué protege, y qué NO ───────────────────────────────────────────────────
 * Protege que el sistema **no venda dos veces el último plato** y que el
 * segundo cliente no se quede con una promesa. Lo que NO hace es aseverar en
 * qué momento se descuenta el stock: eso es del core y ya lo cubren sus tests.
 * Acá lo único que se mira es el contrato —`restante`/`agotado` de
 * `GET /api/servicios`— y qué le llegó a cada teléfono.
 *
 * ── Por qué no tiene guion ──────────────────────────────────────────────────
 * `guion: null`: dos clientes intercalados no se pueden servir con un libreto
 * lineal sin escribir un despachador que el proveedor `guion` no tiene, y que
 * no probaría nada del producto. Corre con `ARNES_BOT=agente`.
 */

const ULTIMO = 'Bacon & cheddar';

export default {
  id: 'dos-contra-el-ultimo',
  titulo: 'el último plato se lo lleva el primero que el local confirma, y el segundo no se queda con una promesa',
  origen: 'docs/FLUJOS.md · casos borde, «dos personas piden el mismo último turno»',
  tags: [],
  pendiente: null,

  reglas: ['R2', 'R3', 'R4', 'M2', 'M3'],
  guion: null,

  async preparar(ctx) {
    const { corrida, carta } = ctx;
    await corrida.api('POST', '/api/jornada/abrir', corrida.tokenDueno, {});
    // Cupo 1: queda exactamente uno. Es el número que hace interesante al
    // escenario; con dos, los dos pedidos entran y no se prueba nada.
    const res = await corrida.api('PUT', '/api/stock/cupos', corrida.tokenDueno, {
      servicio_id: carta.porNombre[ULTIMO].id,
      asignado: 1,
    });
    if (res.status !== 200) ctx.nota(`no se pudo poner el cupo de ${ULTIMO} en 1: HTTP ${res.status}`);
  },

  async correr(ctx) {
    const { core, dueno, corrida } = ctx;
    const segundo = ctx.otroCliente({ sufijo: 'b', nombre: 'Sofía' });

    // ── Los dos arman su pedido, antes de que el local mire ─────────────────
    await ctx.decir(`hola, me das una ${ULTIMO.toLowerCase()}? la paso a buscar. soy Juani`);
    await segundo.decir(`buenas, quiero una ${ULTIMO.toLowerCase()} para retirar, a nombre de Sofía`);

    const armados = await core.foto();
    const dePrimero = core.elCompromiso(armados, { telefono: corrida.telefonoCliente });
    const deSegundo = core.elCompromiso(armados, { telefono: segundo.telefono });

    core.exigir({
      ok: Boolean(dePrimero),
      protege: 'el pedido entra al panel apenas hay ítems, también cuando hay dos clientes a la vez',
      origen: 'docs/FLUJOS.md · «Entra apenas hay ítems»',
      esperado: 'un compromiso del primer cliente',
      llego: dePrimero ? dePrimero.estado : 'ninguno',
    });

    // ── 🧑‍🍳 El local confirma los dos ────────────────────────────────────────
    await dueno.entrar();
    const primeroOk = await confirmar(dueno, dePrimero, 25);
    const segundoOk = await confirmar(dueno, deSegundo, 25);
    ctx.transcripcion.dueno('confirma los dos pedidos, uno atrás del otro');

    const tras = await core.foto();
    const p1 = core.elCompromiso(tras, { telefono: corrida.telefonoCliente });
    const p2 = core.elCompromiso(tras, { telefono: segundo.telefono });

    core.campo(p1, 'estado', 'confirmado', {
      protege: 'el primero que el local confirma se lleva el último plato',
      origen: 'docs/FLUJOS.md · casos borde, «el hold gana»',
    });
    core.exigir({
      ok: !segundoOk || p2?.estado !== 'confirmado',
      protege: 'el segundo NO se confirma: no se vende dos veces el último plato',
      origen: 'docs/FLUJOS.md · casos borde',
      esperado: 'el segundo pedido sin confirmar',
      llego: p2 ? `estado ${p2.estado}` : 'no hay segundo pedido',
    });

    // El stock, por el contrato. Después de confirmar el primero no queda
    // ninguno, y eso vale igual venga el número de un cupo o de una receta.
    core.stock(tras, ULTIMO, { agotado: true, restante: 0 }, {
      protege: 'vendido el último, el catálogo lo informa agotado — venga el número de un cupo manual o de una receta',
      origen: 'design §13 · el contrato del catálogo',
    });

    // ── Y lo que el segundo cliente leyó ────────────────────────────────────
    // Que no se le prometa el plato es lo que este escenario protege del lado
    // de la conversación. Las formas de prometerlo son muchas —"ya te lo
    // guardo", "queda reservada", "en un rato lo tenés"— y por eso el juicio
    // fino lo hacen R2/R3/M2 sobre la transcripción, no un regex acá.
    const suyos = segundo.recibidos();
    core.exigir({
      ok: suyos.length > 0,
      protege: 'el segundo cliente recibe una respuesta: no se lo deja hablando solo',
      origen: 'docs/FLUJOS.md · «El aviso de vuelta es la mitad del valor»',
      esperado: 'al menos un mensaje al segundo teléfono',
      llego: `${suyos.length} mensajes`,
    });
  },
};

async function confirmar(dueno, compromiso, minutos) {
  if (!compromiso) return false;
  try {
    await dueno.confirmarConDemora(compromiso.id, minutos);
    return true;
  } catch {
    // Que el core se niegue a confirmar el segundo es **el resultado correcto**,
    // no un error del arnés: significa que no dejó vender dos veces lo mismo.
    // Se anota que no pudo y la aserción de arriba lee el estado real.
    return false;
  }
}
