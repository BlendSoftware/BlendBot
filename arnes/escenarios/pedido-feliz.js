/**
 * `pedido-feliz` — **el Flujo A entero, de "Hola" al aviso de confirmación.**
 *
 * Es la conversación que define el producto (`docs/FLUJOS.md`, Flujo A), la que
 * se prototipó a mano el 18/08 con Juani haciendo de cliente, y la que dejó
 * escritas las cuatro correcciones que hoy son reglas. Si sólo se pudiera
 * correr un escenario, es éste.
 *
 * Verifica el orden que el documento fija, y lo verifica **en el turno en que
 * tiene que pasar**, no al final:
 *
 *   armar ítems → el compromiso entra al panel PENDIENTE → pedir el nombre
 *   → avisar que espera confirmación → el local confirma con su demora
 *   → el cliente recibe el aviso → el local mueve a listo → otro aviso
 *
 * ── La mitad que ninguna otra suite del repo cruza ──────────────────────────
 * El aviso de vuelta. `docs/FLUJOS.md` lo dice sin vueltas: *"El aviso de vuelta
 * es la mitad del valor. Es la diferencia entre un bot que toma pedidos y un
 * sistema que atiende."* Ese aviso recorre panel → core → `LPUSH
 * salidas_whatsapp` → worker de salidas → outbox → Graph. Se asevera sobre lo
 * **recibido** en el Graph falso, nunca sobre lo encolado: leer la tabla del
 * core probaría que el core lo escribió, no que el cliente lo recibió.
 */

import { precioDe } from '../carta.js';

/** La demora que pone el dueño. Es la del documento: el local eligió 30. */
const DEMORA_MIN = 30;

/** El total del Flujo A. Sale de la carta sintética, no de un literal suelto. */
const TOTAL = precioDe('Doble cheddar') + precioDe('Papas');

/** La frase mal escrita. No es color: entender esto *es* la gracia del producto. */
const SUCIO = 'te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar';

export default {
  id: 'pedido-feliz',
  titulo: 'el pedido validado se recorre entero, de «Hola» al aviso de confirmación',
  origen: 'docs/FLUJOS.md · Flujo A',
  tags: ['@rapido'],
  pendiente: null,

  // Las cinco que esta conversación puede violar. R4/R5 no entran: acá no hay
  // nada agotado ni nada fuera de carta, y una regla que no puede disparar sólo
  // agrega veredictos que cuestan y no protegen nada.
  reglas: ['R1', 'R2', 'R3', 'R6', 'M4'],

  guion: [
    // Turno 1 — «Hola»
    { toolUse: [{ nombre: 'datos_del_negocio', argumentos: {} }] },
    { texto: '🍔 ¡Hola! Soy el asistente del local, atiendo las 24hs.\n¿Qué necesitás?\n 1 Hacer un pedido\n 2 Reservar mesa\n 3 Ver la carta' },

    // Turno 2 — «hacer un pedido»
    { toolUse: [{ nombre: 'ver_catalogo', argumentos: {} }] },
    { texto: '¡Buenísimo! Te paso la carta 👇\n\nHamburguesas\nSimple $6.500\nDoble cheddar $8.900\nBacon & cheddar $9.500\nVeggie $7.800\n\nPara compartir\nPapas $4.500\nPapas cheddar y bacon $5.800\n\nDecime qué te sirvo y las cantidades. Escribilo como te salga, yo lo armo 😉' },

    // Turno 3 — el pedido sucio. El compromiso entra al panel ACÁ.
    {
      toolUse: [{
        nombre: 'armar_compromiso',
        argumentos: { lineas: [{ servicio: 'doble cheddar' }, { servicio: 'papas' }], entrega: 'retira' },
      }],
    },
    { texto: `¡Listo! Te lo armo así:\n 1× Doble cheddar $8.900\n 1× Papas $4.500\n ─────────────\n Total $${TOTAL.toLocaleString('es-AR')}\n\n 🏃 Retirás por el local\n\n(Las papas te las puse comunes. Si las querés con cheddar y bacon son $1.300 más, avisame.)\n\n¿A nombre de quién?` },

    // Turno 4 — el nombre. Primero el resumen, después el OK.
    { toolUse: [{ nombre: 'confirmar', argumentos: { nombre: 'Juani' } }] },
    { toolUse: [{ nombre: 'confirmar', argumentos: { nombre: 'Juani', confirmado: true } }] },
    { texto: 'Gracias Juani 🙌\nYa le pasé el pedido al local. En un minuto te confirmo la demora.' },
  ],

  async correr(ctx) {
    const { core, tools, informe, dueno, corrida, graph } = ctx;

    // ── Turnos 1 y 2 ────────────────────────────────────────────────────────
    await ctx.decir('Hola');
    await ctx.decir('hacer un pedido');

    // El reloj, primera mitad: el cliente todavía no dictó nada, así que en el
    // panel del local no puede haber un pedido. Un pedido fantasma acá no se
    // vería al final —habría un compromiso y parecería bien—, y por eso se
    // asevera en este turno y no en otro.
    const antes = await core.foto();
    core.cuantosCompromisos(antes, {
      esperado: 0,
      protege: 'el pedido entra al panel apenas hay ítems — antes no hay nada que la cocina tenga que ver',
      origen: 'docs/FLUJOS.md · «Entra apenas hay ítems»',
    });

    // ── Turno 3: el pedido mal escrito ──────────────────────────────────────
    await ctx.decir(SUCIO);

    const alDictar = await core.foto();
    const entro = core.cuantosCompromisos(alDictar, {
      esperado: 1,
      protege: 'el pedido entra al panel apenas hay ítems: la cocina lo ve venir mientras el cliente todavía escribe',
      origen: 'docs/FLUJOS.md · Flujo A, «acá el compromiso YA entró al panel como PENDIENTE»',
    });

    // Las que dependen de que exista el compromiso se OMITEN si no existe. Cinco
    // rojos con una sola causa se leen como "está todo roto" cuando lo que hay
    // es un bug; una omitida no cuenta como aprobada y dice de qué depende.
    if (entro) {
      const pedido = core.elCompromiso(alDictar);
      core.campo(pedido, 'estado', 'pendiente', {
        protege: 'vos NO confirmás el pedido solo: la cocina se satura y sólo el local sabe si puede',
        origen: 'SKILL.md regla 3',
      });
      core.campo(pedido, 'cliente_nombre', null, {
        protege: 'el pedido entra al panel ANTES de saber el nombre, no después',
        origen: 'SKILL.md · «el pedido ya entró al panel al llamar a armar_compromiso»',
      });
      core.campo(pedido, 'entrega', 'retira', {
        protege: 'nunca repreguntes lo que ya te dijeron: si escribió «lo paso a buscar», ya sabés que retira',
        origen: 'docs/FLUJOS.md · principio 3',
      });
      core.lineas(pedido, [
        { servicio: 'Doble cheddar', cantidad: 1 },
        { servicio: 'Papas', cantidad: 1 },
      ], {
        protege: 'entendé lo que escribió como te lo escribió: «hhhamburguesa doble cheddar yunas paps» son dos ítems de la carta',
        origen: 'docs/FLUJOS.md · principio 2',
      });
      core.campo(pedido, 'total', TOTAL, {
        protege: 'el total del pedido es la suma de los precios cargados, no un número que el bot estime',
        origen: 'SKILL.md regla 1',
      });
    } else {
      for (const [protege, origen] of [
        ['vos NO confirmás el pedido solo: la cocina se satura y sólo el local sabe si puede', 'SKILL.md regla 3'],
        ['el pedido entra al panel ANTES de saber el nombre, no después', 'SKILL.md · El flujo del pedido'],
        ['nunca repreguntes lo que ya te dijeron: si escribió «lo paso a buscar», ya sabés que retira', 'docs/FLUJOS.md · principio 3'],
        ['entendé lo que escribió como te lo escribió: «hhhamburguesa doble cheddar yunas paps» son dos ítems de la carta', 'docs/FLUJOS.md · principio 2'],
        ['el total del pedido es la suma de los precios cargados, no un número que el bot estime', 'SKILL.md regla 1'],
      ]) {
        informe.omitir({
          protege, origen, turno: ctx.transcripcion.turnoActual,
          porque: 'no hay compromiso en el panel en este turno (falló la aserción de arriba)',
        });
      }
    }

    // ── Turno 4: el nombre y el cierre ──────────────────────────────────────
    await ctx.decir('Juani');

    const alCerrar = await core.foto();
    const cerrado = core.elCompromiso(alCerrar);
    core.campo(cerrado, 'estado', 'pendiente', {
      protege: 'el bot no confirma solo: con confirmacion humana el pedido queda PENDIENTE y lo confirma el local',
      origen: 'SKILL.md regla 3',
    });
    core.campo(cerrado, 'cliente_nombre', 'Juani', {
      protege: 'el nombre que dio el cliente queda en el pedido que ve la cocina',
      origen: 'docs/FLUJOS.md · Flujo A',
    });
    core.campo(cerrado, 'demora_min', null, {
      protege: 'nunca prometas una demora: la demora la pone el local desde el panel, no vos',
      origen: 'SKILL.md regla 2',
    });

    // «El total del resumen es el total del core». La mitad de esto es nivel 1
    // —el total del compromiso— y la otra mitad es que el número que el bot
    // dijo sea ese. Lo segundo se asevera sobre el TEXTO recibido, porque es lo
    // que el cliente leyó, y se hace acá y no en el juez: buscar un número
    // exacto en un texto es determinista y no necesita opinión de nadie.
    const conNumero = ctx.recibidos().some((m) => tieneElTotal(m.texto, cerrado?.total));
    core.exigir({
      ok: conNumero,
      protege: 'el total que el bot le lee al cliente es el total del compromiso en el core, no uno estimado',
      origen: 'docs/FLUJOS.md · principio 6, «confirma el resumen antes de cerrar, siempre con el total»',
      esperado: `algún mensaje con el total $${Math.round(Number(cerrado?.total ?? TOTAL))}`,
      llego: conNumero ? 'lo dijo' : 'ningún mensaje del bot trae ese número',
    });

    // ── Nivel 2 ─────────────────────────────────────────────────────────────
    tools.orden({
      secuencia: ['datos_del_negocio', 'ver_catalogo', 'armar_compromiso', 'confirmar'],
      protege: 'el orden del pedido: datos del negocio → carta → armar (entra al panel) → confirmar',
      origen: 'SKILL.md · El flujo del pedido',
    });
    tools.argumentos({
      tool: 'armar_compromiso',
      protege: 'pasá `entrega` si el cliente ya lo dijo, y NO se lo vuelvas a preguntar',
      origen: 'SKILL.md · armar_compromiso',
      comprobar: (args) => {
        if (args.entrega !== 'retira') return `entrega = ${JSON.stringify(args.entrega)}, esperaba "retira"`;
        if (args.direccion) return `mandó dirección (${args.direccion}) en un pedido que se retira`;
        return true;
      },
    });
    tools.argumentos({
      tool: 'confirmar',
      protege: 'llamala primero SIN confirmado (resumen) y recién con el sí del cliente, confirmado=true',
      origen: 'SKILL.md · confirmar',
      indice: 0,
      comprobar: (args) => (args.confirmado === true
        ? 'la primera llamada a confirmar vino con confirmado=true: cerró sin leerle el resumen'
        : true),
    });
    tools.noLlamo({
      tool: 'consultar_disponibilidad',
      protege: 'consultar_disponibilidad es sólo para reservar mesa: la comida no ocupa agenda',
      origen: 'SKILL.md · Las tools',
    });
    tools.noLlamo({
      tool: 'bloquear',
      protege: 'bloquear es sólo al reservar una mesa; para pedidos no va',
      origen: 'SKILL.md · Las tools',
    });

    // ── 🧑‍🍳 El local confirma, y el círculo se cierra ────────────────────────
    const desde = graph.cantidad;
    await dueno.entrar();
    await dueno.confirmarConDemora(cerrado.id, DEMORA_MIN);
    ctx.transcripcion.dueno(`confirma el pedido con ${DEMORA_MIN} min de demora`);

    const confirmado = await core.foto();
    const conDemora = core.elCompromiso(confirmado);
    core.campo(conDemora, 'estado', 'confirmado', {
      protege: 'el local confirma el pedido desde el panel, y recién ahí queda confirmado',
      origen: 'docs/FLUJOS.md · «el local: CONFIRMAR + demora»',
    });
    core.campo(conDemora, 'demora_min', DEMORA_MIN, {
      protege: 'la demora la pone el local y queda guardada con el pedido',
      origen: 'docs/FLUJOS.md · «el local confirma con 30 min desde el panel»',
    });

    // El aviso, **sobre lo recibido**. Que llegue por el mismo agujero que las
    // respuestas del bot es la prueba de que el producto está entero: si el
    // arnés lo leyera de la tabla del core estaría verificando que el core lo
    // escribió, no que el cliente lo recibió (design §5).
    const aviso = await ctx.esperarDelTelefono({ desde, que: 'el aviso de que el local confirmó' });
    core.exigir({
      ok: Boolean(aviso),
      protege: 'el aviso de vuelta es la mitad del valor: es la diferencia entre un bot que toma pedidos y un sistema que atiende',
      origen: 'docs/FLUJOS.md · «cada cambio dispara aviso por WhatsApp»',
      esperado: 'un mensaje al teléfono del cliente',
      llego: aviso ? 'llegó' : 'no llegó ninguno',
    });
    core.exigir({
      ok: Boolean(aviso) && mencionaLaDemora(aviso, DEMORA_MIN, corrida.timezone),
      protege: 'el número que el bot dice después de la confirmación es el que puso el local',
      origen: 'SKILL.md regla 2 · «recién cuando el local confirma con su demora se lo decís al cliente»',
      esperado: `un mensaje con ${DEMORA_MIN} minutos o la hora resultante`,
      llego: aviso ? recorte(aviso.texto ?? `plantilla ${aviso.plantilla}`) : 'sin mensaje',
    });

    // ── Y el cambio de estado ───────────────────────────────────────────────
    const desdeListo = graph.cantidad;
    await dueno.marcarListo(cerrado.id);
    ctx.transcripcion.dueno('mueve el pedido a listo');
    const avisoListo = await ctx.esperarDelTelefono({ desde: desdeListo, que: 'el aviso de que el pedido está listo' });
    core.exigir({
      ok: Boolean(avisoListo),
      protege: 'cada cambio de estado dispara un aviso por WhatsApp: EN_COCINA → LISTO → ENTREGADO',
      origen: 'docs/FLUJOS.md · «El orden que quedó»',
      esperado: 'un aviso más al teléfono del cliente',
      llego: avisoListo ? 'llegó' : 'no llegó',
    });
  },
};

/**
 * ¿El texto trae el total? Se comparan los dígitos, sin puntos ni comas: el bot
 * escribe "$13.400" y el core devuelve "13400.00". Aseverar el formato sería
 * aseverar una obligación de estilo, que es justo lo que no se hace.
 */
function tieneElTotal(texto, total) {
  if (!texto || total == null) return false;
  const soloDigitos = String(texto).replace(/[.\s,]/g, '');
  return soloDigitos.includes(String(Math.round(Number(total))));
}

/**
 * ¿El aviso trae la demora o la hora resultante?
 *
 * Se acepta **cualquiera de las dos** a propósito: el `SKILL.md` dice "esa
 * demora o la hora resultante", y exigir una forma puntual sería una obligación
 * de estilo. Lo que se protege es que el número salga del local.
 */
function mencionaLaDemora(mensaje, demoraMin) {
  const texto = mensaje?.texto ?? '';
  if (texto.includes(String(demoraMin))) return true;
  // Una hora cualquiera (21:15, 21.15) también cuenta: es la demora expresada
  // como momento. Que el número sea el correcto lo garantiza el nivel 1, que ya
  // asevera que `demora_min` del compromiso es el que puso el dueño.
  if (/\b\d{1,2}[:.]\d{2}\b/.test(texto)) return true;
  // Las plantillas llevan el número en las variables, no en el cuerpo.
  return (mensaje?.variables ?? []).some((v) => String(v).includes(String(demoraMin)));
}

function recorte(t, largo = 120) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > largo ? `${s.slice(0, largo)}…` : s;
}
