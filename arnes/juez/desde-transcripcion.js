/**
 * desde-transcripcion.js — de la línea de tiempo del arnés a lo que ve el juez.
 *
 * La transcripción de `arnes/transcripcion.js` tiene una entrada por cada cosa
 * que pasó: lo que dijo el cliente, lo que el bot produjo, lo que el teléfono
 * recibió de verdad, el gesto del dueño. El juez no puede ver eso: tiene que
 * ver **una conversación**, y nada más.
 *
 * ── Tres decisiones que cambian lo que el juez juzga ─────────────────────────
 *
 * 1. **El "asistente" son los turnos del bot, más los avisos que el cliente
 *    recibió y que el bot no dijo.** Los turnos del bot son la fuente: es el
 *    texto que la bitácora ancla como `🤖 bot`, y anclar ahí es lo que hace que
 *    la cita del juez caiga en el renglón correcto de `transcripcion.md`. A eso
 *    se le suman los mensajes del Graph falso que **no** salieron de un turno
 *    del bot — el aviso proactivo que dispara el dueño desde el panel: desde el
 *    lado del cliente eso también es el local hablándole y tiene que poder
 *    juzgarse (R2 después de la confirmación, por ejemplo).
 *
 *    Lo que se pierde con esta elección, y hay que decirlo: si el outbox
 *    mutilara un mensaje entre el bot y el teléfono, el juez juzgaría el
 *    original y no lo que el cliente leyó. Ese bug es de nivel 1 —se ve
 *    comparando lo recibido con lo dicho— y no es trabajo del juez.
 *
 * 2. **Los gestos del dueño y las notas del sistema entran como `sistema`**,
 *    convertidos a hechos neutros ("el local confirmó el pedido con 30 minutos
 *    de demora"). Sin ellos R2 y R3 no son juzgables: no habría forma de saber
 *    dónde termina el "antes de que el local confirme". Son hechos de la
 *    corrida, no expectativas sobre el bot, y la diferencia hay que cuidarla —
 *    ver `hechos()` más abajo.
 *
 * 3. **La numeración es propia**, 1..n sobre las entradas que el juez ve. El
 *    juez cita un turno de SU numeración y `traducir()` lo devuelve al turno de
 *    la conversación que usa `docs/FLUJOS.md`, que es el que va en la línea de
 *    falla. Obligar a alguien a traducir entre dos numeraciones a las once de
 *    la noche es exactamente lo que este arnés vino a evitar.
 */

/**
 * @param {object} transcripcion  de `crearTranscripcion()`
 * @returns {{turnos: import('./protocolo.js').Turno[], mapa: Map<number, object>}}
 */
export function transcripcionParaElJuez(transcripcion) {
  const turnos = [];
  const mapa = new Map();

  // Lo que el bot dijo, para no contar dos veces el mismo texto cuando llega
  // por el teléfono. Un mensaje repetido le haría creer al juez que el bot
  // insistió, y "insistir" es la clase de cosa que un juez interpreta mal.
  const dichoPorElBot = new Set(
    transcripcion.turnos.filter((t) => t.actor === 'bot' && t.texto).map((t) => aplanar(t.texto)),
  );

  for (const t of transcripcion.turnos) {
    const armado = comoTurno(t, dichoPorElBot);
    if (!armado) continue;
    const n = turnos.length + 1;
    turnos.push({ turno: n, quien: armado.quien, texto: armado.texto });
    // `conv` es el turno de la conversación: el que dice "turno 4" en
    // FLUJOS.md. `entrada` es el número de evento de la bitácora, que es el que
    // ancla la cita en `transcripcion.md`.
    mapa.set(n, { conv: t.conv, entrada: t.n, actor: t.actor });
  }

  return { turnos, mapa };
}

function comoTurno(t, dichoPorElBot) {
  if (t.actor === 'cliente' && t.texto) {
    return { quien: 'cliente', texto: t.texto };
  }
  if (t.actor === 'bot' && t.texto) {
    return { quien: 'asistente', texto: t.texto };
  }
  if (t.actor === 'telefono') {
    // Sólo lo que el bot NO dijo: el aviso proactivo del panel. El resto ya
    // entró por el turno del bot.
    if (t.texto && !dichoPorElBot.has(aplanar(t.texto))) {
      return { quien: 'asistente', texto: t.texto };
    }
    // Una plantilla no es texto libre del bot: es un molde aprobado. Se muestra
    // para que la conversación se entienda, pero como sistema, para que el juez
    // no condene al asistente por una plantilla que no eligió.
    if (!t.texto && t.plantilla) {
      return {
        quien: 'sistema',
        texto: `(el cliente recibió la plantilla «${t.plantilla}» con ${JSON.stringify(t.variables ?? [])})`,
      };
    }
    return null;
  }
  if (t.actor === 'dueno' && t.texto) {
    return { quien: 'sistema', texto: `(el local, desde el panel: ${t.texto})` };
  }
  if (t.actor === 'sistema' && t.texto) {
    return { quien: 'sistema', texto: `(${t.texto})` };
  }
  return null;
}

function aplanar(t) {
  return String(t).replace(/\s+/g, ' ').trim();
}

/**
 * El turno de la conversación (el de `FLUJOS.md`) detrás del turno que citó el
 * juez. Es lo que hace que la línea de falla diga «turno 4» y no «turno 9».
 */
export function traducirTurno(mapa, turnoDelJuez) {
  return mapa.get(turnoDelJuez)?.conv ?? turnoDelJuez;
}

// ── Los hechos ───────────────────────────────────────────────────────────────

/**
 * Los hechos neutros que las reglas piden (`regla.contexto`).
 *
 * **La línea que no se cruza:** un hecho dice qué hay cargado en el sistema del
 * local. NUNCA dice qué se espera del bot. "La carta tiene Doble cheddar a
 * $8.900" es un hecho; "esperamos que no invente el precio" sería una pista y
 * convertiría al juez en un sí-señor. Si al escribir un hecho aparece la
 * palabra "debería", está mal escrito.
 *
 * Todo sale del **contrato** del core, no de la fuente del número (design §13):
 * `restante` y `agotado` de `GET /api/servicios`, nunca `cupo_jornada` ni
 * recetas. Así el mismo hecho vale cuando el número venga de un insumo.
 *
 * @param {object} p
 * @param {object} p.foto        de `nivel1().foto()`
 * @param {object} [p.negocio]   el cuerpo de `GET /api/negocio`, si se leyó
 * @param {{confirmado: boolean, demoraMin?: number, turno?: number}} [p.confirmacion]
 * @returns {string[]}
 */
export function hechosDeLaCorrida({ foto, negocio = null, confirmacion = null }) {
  const hechos = [];

  const vendibles = foto.servicios.filter((s) => s.disponible !== false && !s.agotado);
  const agotados = foto.servicios.filter((s) => s.agotado);
  const apagados = foto.servicios.filter((s) => s.disponible === false);

  if (vendibles.length) {
    hechos.push(`carta: vendibles hoy — ${vendibles.map((s) => `${s.nombre} $${Math.round(Number(s.precio_base))}`).join(' · ')}`);
  }
  const conDescripcion = foto.servicios.filter((s) => s.descripcion);
  hechos.push(conDescripcion.length
    ? `carta: los únicos platos con descripción cargada son — ${conDescripcion.map((s) => `${s.nombre}: "${s.descripcion}"`).join(' · ')}`
    : 'carta: ningún plato tiene descripción cargada en el sistema');
  hechos.push('carta: no hay ninguna promoción, combo ni descuento cargado en el sistema del local');

  // `agotados` y `apagados` son dos "no" distintos y el arnés existe en buena
  // parte para proteger esa diferencia. Van como dos hechos separados.
  hechos.push(agotados.length
    ? `agotados: hoy se terminaron — ${agotados.map((s) => s.nombre).join(' · ')}. El local sí los tiene, pero no queda ninguno`
    : 'agotados: hoy no se terminó ningún plato');
  if (apagados.length) {
    hechos.push(`apagados: el local apagó a mano — ${apagados.map((s) => s.nombre).join(' · ')}. Eso no lo tienen`);
  }

  const info = negocio?.info ?? {};
  const cargados = ['direccion', 'horarios', 'telefono', 'notas'].filter((k) => info[k]);
  const faltantes = ['direccion', 'horarios', 'telefono', 'notas'].filter((k) => !info[k]);
  hechos.push(
    `datos: el local tiene cargado ${cargados.length ? cargados.map((k) => `${k} "${info[k]}"`).join(' · ') : 'sólo su nombre'}` +
    (faltantes.length ? `. NO tiene cargado: ${faltantes.join(', ')}` : ''),
  );

  if (confirmacion?.confirmado) {
    hechos.push(
      `confirmacion: el local confirmó el pedido desde el panel` +
      (confirmacion.turno ? ` en el turno ${confirmacion.turno}` : '') +
      (confirmacion.demoraMin != null ? `, con ${confirmacion.demoraMin} minutos de demora` : ''),
    );
  } else {
    hechos.push('confirmacion: el local NO confirmó el pedido en ningún momento de esta conversación');
  }

  return hechos;
}
