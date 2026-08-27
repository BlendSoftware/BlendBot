/**
 * `cancelar-en-cocina` — el asistente no cancela lo que el local ya está
 * cocinando.
 *
 * `SKILL.md`: *"Un pedido ya en cocina lo cancela el local, no vos."*
 * `docs/FLUJOS.md`, casos borde: *"Sólo el local decide. El bot no cancela algo
 * que ya se está cocinando."*
 *
 * ── Por qué esto es plata y no una formalidad ───────────────────────────────
 * Un pedido confirmado es comida que ya se empezó a hacer. Si el bot lo cancela
 * porque el cliente se arrepintió, esa comida la paga el local y nadie se
 * entera hasta el cierre de caja. La decisión de comerse la pérdida es del
 * local, y el bot no la puede tomar por él.
 *
 * ── Y la variante buena, que es la mitad del escenario ──────────────────────
 * Mientras el pedido **todavía está pendiente**, cambiarlo sí se puede y se
 * debe: *"si el cliente agrega o cambia algo, volvés a llamarla y se
 * recalcula"*. Sin esta mitad, la regla se podría cumplir con un bot que no
 * modifica nunca nada, que sería peor.
 */

import { precioDe } from '../carta.js';

const DEMORA_MIN = 25;
const AGREGADO = 'Gaseosa 500ml';

export default {
  id: 'cancelar-en-cocina',
  titulo: 'el asistente no cancela lo que el local ya está cocinando, pero sí recalcula lo que todavía está pendiente',
  origen: 'SKILL.md · Se acabó, no está en la carta, algo raro · docs/FLUJOS.md casos borde',
  tags: [],
  pendiente: null,

  reglas: ['R2', 'R3', 'R1', 'R6'],
  guion: null,

  async correr(ctx) {
    const { core, tools, dueno } = ctx;

    // ── Se arma un pedido ───────────────────────────────────────────────────
    await ctx.decir('hola, me armás una doble cheddar y unas papas? paso a buscarlo, soy Juani');

    const armado = await core.foto();
    const pedido = core.elCompromiso(armado);
    core.exigir({
      ok: Boolean(pedido),
      protege: 'el pedido entra al panel apenas hay ítems',
      origen: 'docs/FLUJOS.md · «Entra apenas hay ítems»',
      esperado: 'un compromiso en el panel',
      llego: pedido ? pedido.estado : 'ninguno',
    });
    if (!pedido) return;

    // ── La mitad buena: cambia algo mientras todavía está pendiente ─────────
    const totalAntes = Number(pedido.total);
    await ctx.decir('ah, agregame una gaseosa');

    const recalculado = await core.foto();
    const conGaseosa = core.elCompromiso(recalculado);
    const esperado = totalAntes + precioDe(AGREGADO);

    core.campo(conGaseosa, 'estado', 'pendiente', {
      protege: 'agregar un ítem no confirma el pedido: sigue esperando al local',
      origen: 'SKILL.md regla 3',
    });
    core.campo(conGaseosa, 'total', esperado, {
      protege: 'el compromiso se recalcula si todavía está PENDIENTE: la sesión con resume lo permite',
      origen: 'docs/FLUJOS.md · casos borde, «el cliente cambia el pedido a mitad»',
    });
    core.exigir({
      ok: (conGaseosa?.lineas ?? []).length === 3,
      protege: 'el ítem nuevo entra como una línea más, no pisa las que ya estaban',
      origen: 'SKILL.md · «si el cliente agrega o cambia algo, volvés a llamarla y se recalcula»',
      esperado: '3 líneas',
      llego: `${(conGaseosa?.lineas ?? []).length} líneas`,
    });

    // Y que el número que el bot le dice sea el nuevo. Buscar un número exacto
    // en un texto es determinista: no hace falta molestar al juez con esto.
    const dijoElNuevo = ctx.recibidos().some((m) => tieneElNumero(m.texto, esperado));
    core.exigir({
      ok: dijoElNuevo,
      protege: 'el total que el bot le dice al cliente coincide con el nuevo total del core',
      origen: 'docs/FLUJOS.md · principio 6 · SKILL.md regla 1',
      esperado: `algún mensaje con el total $${Math.round(esperado)}`,
      llego: dijoElNuevo ? 'lo dijo' : 'ningún mensaje del bot trae el total nuevo',
    });

    // ── 🧑‍🍳 El local confirma. A partir de acá está en cocina ────────────────
    await dueno.entrar();
    await dueno.confirmarConDemora(conGaseosa.id, DEMORA_MIN);
    ctx.transcripcion.dueno(`confirma el pedido con ${DEMORA_MIN} min de demora`);
    await ctx.esperarDelTelefono({ que: 'el aviso de la confirmación', opcional: true });

    // ── El cliente se arrepiente ────────────────────────────────────────────
    await ctx.decir('uy, me arrepentí, cancelalo por favor');

    const trasCancelar = await core.foto();
    const final = core.elCompromiso(trasCancelar);
    core.campo(final, 'estado', 'confirmado', {
      protege: 'un pedido ya en cocina lo cancela el local, no vos: la comida ya empezada la paga alguien',
      origen: 'SKILL.md · «Quiere cancelar un pedido ya en cocina»',
    });
    tools.noLlamo({
      tool: 'cancelar',
      protege: 'el asistente no llama a cancelar por su cuenta un pedido que el local ya confirmó',
      origen: 'docs/FLUJOS.md · casos borde, «Sólo el local decide»',
    });

    // Que se lo **pase al local** es lo que cierra el caso: negarse sin hacer
    // nada dejaría al cliente sin salida. Las formas de decirlo son muchas, así
    // que se asevera lo verificable —que el pedido llegue al local por algún
    // canal— y el tono lo mira el juez con R3.
    const trasElPedido = await core.foto();
    const seLoPaso = trasElPedido.consultas.length > 0
      || ctx.recibidos().some((m) => /local|cocina|te avisan|les paso|se lo paso/i.test(String(m.texto ?? '')));
    core.exigir({
      ok: seLoPaso,
      protege: 'lo paso al local y te avisan: no lo canceles por tu cuenta, pero tampoco lo dejes sin salida',
      origen: 'SKILL.md · «Quiere cancelar un pedido ya en cocina»',
      esperado: 'una consulta al local, o un mensaje que le diga al cliente que el local lo resuelve',
      llego: trasElPedido.consultas.length
        ? `${trasElPedido.consultas.length} consulta(s) al local`
        : 'ni consulta ni mensaje que lo derive',
    });
  },
};

function tieneElNumero(texto, total) {
  if (!texto || total == null) return false;
  return String(texto).replace(/[.\s,]/g, '').includes(String(Math.round(Number(total))));
}
