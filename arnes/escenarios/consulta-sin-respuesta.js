/**
 * `consulta-sin-respuesta` — el círculo completo de lo que el asistente no sabe.
 *
 * El cliente pregunta algo que no está en el catálogo ni en los datos del local
 * → el bot **registra la consulta en vez de inventar** → el dueño la ve y la
 * responde desde el panel → el cliente recibe la respuesta por WhatsApp.
 *
 * Es el mismo círculo que `pedido-feliz` recorre con el pedido, pero por el
 * otro camino del producto, y termina en el mismo lugar: el Graph falso. Que la
 * respuesta del dueño salga por el mismo agujero que las respuestas del bot es
 * la prueba de que el producto está entero (design §5).
 *
 * ── El contraste es la mitad del escenario ──────────────────────────────────
 * `dejar_consulta` es la alternativa a inventar, **no** la alternativa a
 * responder. El `SKILL.md` es explícito: *"si la tool lo trae, respondé; si no,
 * dejá la consulta. Nunca el punto intermedio de suponerlo."* Un bot que deja
 * consulta por la dirección del local —que está cargada— es tan malo como uno
 * que inventa: le hace esperar al cliente una respuesta que ya tenía, y le
 * llena el panel al dueño de preguntas que el sistema podía contestar.
 */

const NO_CARGADO = 'tienen estacionamiento?';
const DIRECCION = 'San Martín 1234';
const HORARIOS = 'de 20 a 00';

export default {
  id: 'consulta-sin-respuesta',
  titulo: 'lo que el asistente no sabe termina en una consulta que el dueño responde, y lo que sí sabe lo responde solo',
  origen: 'SKILL.md regla 6 · E12',
  tags: [],
  pendiente: null,

  reglas: ['R6', 'R5', 'R1'],
  guion: null,

  /** Los datos del local que SÍ están cargados. Son la mitad del contraste. */
  async preparar(ctx) {
    const res = await ctx.corrida.api('PATCH', '/api/negocio', ctx.corrida.tokenDueno, {
      info: { direccion: DIRECCION, horarios: HORARIOS },
    });
    if (res.status !== 200) {
      ctx.nota(`no se pudo cargar la info del negocio: HTTP ${res.status} — ${res.texto.slice(0, 200)}`);
    }
  },

  async correr(ctx) {
    const { core, tools, dueno, graph } = ctx;

    // ── Lo que SÍ está cargado se responde sin consulta ─────────────────────
    const respuesta = await ctx.decir('hola! dónde quedan y hasta qué hora abren?');

    const texto = String(respuesta?.texto ?? '');
    core.exigir({
      ok: texto.includes(DIRECCION) || texto.toLowerCase().includes('san martín'),
      protege: 'dónde quedan y a qué hora abren salen de `info` de datos_del_negocio: si el dato está cargado, respondelo textual',
      origen: 'SKILL.md · Responder con lo que SÍ tenés',
      esperado: `la dirección cargada («${DIRECCION}»)`,
      llego: recorte(texto),
    });

    const trasLoCargado = await core.foto();
    core.consultas(trasLoCargado, 0, {
      protege: 'no uses dejar_consulta para lo que sí podés chequear con otra tool: al dueño no se le llena el panel de lo que el sistema ya sabe',
      origen: 'SKILL.md · dejar_consulta',
    });
    tools.llamo({
      tool: 'datos_del_negocio',
      protege: 'antes de mandar todo al local, fijate si la respuesta ya está en una tool',
      origen: 'SKILL.md · Responder con lo que SÍ tenés',
    });

    // ── Lo que NO está cargado se registra, no se inventa ───────────────────
    await ctx.decir(NO_CARGADO);

    const trasLaPregunta = await core.foto();
    core.consultas(trasLaPregunta, 1, {
      protege: 'ante algo que no sabés y no podés verificar con una tool, dejar_consulta: NO inventes',
      origen: 'SKILL.md regla 6',
    });
    tools.llamo({
      tool: 'dejar_consulta',
      protege: 'preferís dejar la consulta antes que arriesgar un dato',
      origen: 'SKILL.md regla 6',
    });

    // Que el bot NO afirme la respuesta es R6, y la juzga el juez: las formas
    // de inventar son muchas ("creo que sí", "normalmente hay") y ninguna se
    // atrapa con un `includes`.

    const consulta = trasLaPregunta.consultas[0];
    if (!consulta) {
      ctx.informe.omitir({
        protege: 'el dueño responde la consulta desde el panel y el cliente la recibe por WhatsApp',
        origen: 'E12 · docs/FLUJOS.md',
        porque: 'no quedó ninguna consulta registrada en el core (falló la aserción de arriba)',
      });
      return;
    }

    // ── 🧑‍🍳 El dueño responde, y el círculo se cierra ────────────────────────
    const desde = graph.cantidad;
    await dueno.entrar();
    await dueno.responderConsulta(consulta.id, 'Sí, hay estacionamiento en la cuadra de enfrente 🙌');
    ctx.transcripcion.dueno('responde la consulta desde el panel');

    const llegada = await ctx.esperarDelTelefono({ desde, que: 'la respuesta del dueño a la consulta' });
    core.exigir({
      ok: Boolean(llegada),
      protege: 'el dueño responde la consulta desde el panel y el cliente la recibe por WhatsApp, por el mismo camino que las respuestas del bot',
      origen: 'E12 · design §5',
      esperado: 'un mensaje al teléfono del cliente con la respuesta',
      llego: llegada ? recorte(llegada.texto ?? `plantilla ${llegada.plantilla}`) : 'no llegó nada',
    });

    const cerradas = await core.foto();
    const respondida = cerradas.consultas.find((c) => c.id === consulta.id);
    core.exigir({
      ok: Boolean(respondida?.respuesta),
      protege: 'la consulta queda respondida en el core, no sólo mandada',
      origen: 'E12',
      esperado: 'la consulta con su respuesta guardada',
      llego: respondida ? `estado ${respondida.estado}` : 'la consulta desapareció',
    });
  },
};

function recorte(t, largo = 160) {
  const s = String(t ?? '(sin texto)').replace(/\s+/g, ' ').trim();
  return s.length > largo ? `${s.slice(0, largo)}…` : s;
}
