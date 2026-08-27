/**
 * `modificacion-por-linea` — «dos, una sin panceta» son dos líneas.
 *
 * Es **nivel 1 puro** y por eso es de los escenarios más valiosos del arnés: la
 * regla que protege se rompe con una regresión del prompt **sin que se note en
 * la conversación**. El bot le lee al cliente "2 Doble cheddar, una sin
 * panceta", el cliente dice que sí, todo suena perfecto — y a la cocina le
 * llega una línea de cantidad 2 con una nota suelta y el cocinero no sabe cuál
 * es cuál. No hay frase que delate el bug; hay una tabla que lo muestra.
 *
 * `SKILL.md` · Modificaciones del ítem:
 *
 *   · *"Una modificación que aplica a una sola unidad separa la línea."*
 *     "2 La Birra, una sin panceta" → dos líneas, una con nota y otra sin.
 *   · *"Si aplica a todas las unidades, va en la misma línea con su cantidad."*
 *     "2 papas sin sal" → una línea, `cantidad: 2`, `nota: "sin sal"`.
 *   · *"La nota es operativa y breve… nada de horarios, apuros ni promesas."*
 *     Una instrucción de entrega va en la nota **del pedido**, no en la de un
 *     plato.
 *
 * Las tres son de estado. Ninguna necesita que nadie interprete prosa.
 */

const PLATO = 'Doble cheddar';
const GUARNICION = 'Papas';

export default {
  id: 'modificacion-por-linea',
  titulo: 'las modificaciones del plato llegan a la cocina en la línea correcta',
  origen: 'SKILL.md · Modificaciones del ítem',
  tags: [],
  pendiente: null,

  // El nivel 3 acá es casi todo ruido: la regla que importa es de estado. Sólo
  // se juzgan las dos que esta conversación puede violar de verdad.
  reglas: ['R1', 'R3'],
  guion: null,

  async correr(ctx) {
    const { core, tools } = ctx;

    // ── Una sola unidad modificada: se separa la línea ──────────────────────
    await ctx.decir(`hola, me das 2 ${PLATO.toLowerCase()}, una sin panceta? lo retiro`);

    const separadas = await core.foto();
    const pedido = core.elCompromiso(separadas);
    core.lineas(pedido, [
      { servicio: PLATO, cantidad: 1, nota: 'sin panceta' },
      { servicio: PLATO, cantidad: 1 },
    ], {
      protege: 'una modificación que aplica a una sola unidad separa la línea: así la cocina sabe cuál es cuál',
      origen: 'SKILL.md · Modificaciones del ítem',
    });

    // El `lineas()` de arriba compara el conjunto exacto, así que ya cubre "una
    // con nota y otra sin". Lo que se agrega es la forma de la nota: operativa
    // y breve. Se asevera que **no** trae horarios ni apuros, que es la parte
    // que el SKILL prohíbe explícitamente y la que se cuela sin que nadie mire.
    const notas = (pedido?.lineas ?? []).map((l) => l.nota).filter(Boolean);
    core.exigir({
      ok: notas.every((n) => !/\b\d{1,2}[:.]\d{2}\b|urgent|apur|r[aá]pido|lo antes/i.test(n)),
      protege: 'la nota de la línea es operativa y breve: qué sacar, qué agregar, punto de cocción. Nada de horarios ni apuros',
      origen: 'SKILL.md · Modificaciones del ítem',
      esperado: 'notas sin horarios ni apuros',
      llego: notas.length ? notas.join(' · ') : 'sin notas',
    });

    // Y que la modificación se le repita al cliente. No se asevera con qué
    // palabras —eso sería una obligación de estilo— sino que el ingrediente
    // aparezca: que el cliente pueda ver que se tomó bien antes de confirmar.
    const leido = ctx.recibidos().map((m) => m.texto ?? '').join('\n').toLowerCase();
    core.exigir({
      ok: leido.includes('panceta'),
      protege: 'repetile la modificación al leer el resumen: que vea que la tomaste bien antes de confirmar',
      origen: 'SKILL.md · Modificaciones del ítem',
      esperado: 'el resumen menciona la modificación',
      llego: leido.includes('panceta') ? 'la menciona' : 'no la menciona en ningún mensaje',
    });

    // ── La misma modificación para todas: una línea con cantidad ────────────
    await ctx.decir(`agregame 2 ${GUARNICION.toLowerCase()}, las dos sin sal`);

    const juntas = await core.foto();
    const conPapas = core.elCompromiso(juntas);
    const lineasDePapas = (conPapas?.lineas ?? []).filter(
      (l) => nombreDe(l, ctx) === GUARNICION,
    );
    core.exigir({
      ok: lineasDePapas.length === 1 && lineasDePapas[0].cantidad === 2 && Boolean(lineasDePapas[0].nota),
      protege: 'si la modificación aplica a todas las unidades, va en la misma línea con su cantidad',
      origen: 'SKILL.md · Modificaciones del ítem',
      esperado: `1 línea de ${GUARNICION} con cantidad 2 y su nota`,
      llego: lineasDePapas.length
        ? lineasDePapas.map((l) => `${l.cantidad}× (${l.nota ?? 'sin nota'})`).join(' + ')
        : `ninguna línea de ${GUARNICION}`,
    });

    // ── La instrucción de entrega NO va en la línea de un plato ─────────────
    await ctx.decir('ah, y avisame cuando esté que voy en moto. a nombre de Juani');

    const conNota = await core.foto();
    const final = core.elCompromiso(conNota);
    const notasDeLinea = (final?.lineas ?? []).map((l) => l.nota ?? '').join(' ').toLowerCase();
    core.exigir({
      ok: !/moto|avisame|timbre|porter[ií]a|cubiertos/.test(notasDeLinea),
      protege: 'las instrucciones de entrega van en la nota del PEDIDO, no en la nota de un plato: no la confundas',
      origen: 'SKILL.md · «Instrucciones de entrega… van en el campo nota de armar_compromiso»',
      esperado: 'ninguna nota de línea con instrucciones de entrega',
      llego: notasDeLinea || 'sin notas de línea',
    });

    tools.argumentos({
      tool: 'armar_compromiso',
      protege: 'la nota del pedido y la nota de la línea son dos campos distintos y se usan distinto',
      origen: 'SKILL.md · Modificaciones del ítem',
      comprobar: (args) => {
        const lineas = Array.isArray(args.lineas) ? args.lineas : [];
        const conNotaDeEntrega = lineas.find(
          (l) => /moto|avisame|timbre|porter[ií]a/i.test(String(l.nota ?? '')),
        );
        if (conNotaDeEntrega) {
          return `una línea lleva una instrucción de entrega en su nota: ${JSON.stringify(conNotaDeEntrega.nota)}`;
        }
        return true;
      },
    });
  },
};

/** El nombre del plato de una línea, traducido del `servicio_id`. */
function nombreDe(linea, ctx) {
  const plato = (ctx.carta.platos ?? []).find((p) => p.id === linea.servicio_id);
  return plato?.nombre ?? linea.servicio_id;
}
