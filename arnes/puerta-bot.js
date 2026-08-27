/**
 * Puerta de salida del grupo 2 — **`pedido-feliz`, niveles 1 y 2, dueño por API**.
 *
 *   node arnes/puerta-bot.js              ← ARNES_BOT=guion (default): gratis, sola
 *   ARNES_BOT=agente node arnes/puerta-bot.js   ← el bot lo sirve un agente Claude
 *
 * Recorre el Flujo A de `docs/FLUJOS.md` de punta a punta con el sistema real:
 * el cliente entra por el webhook firmado, el bot decide y **llama las tools de
 * verdad** contra el core, el dueño confirma con demora por la API, y todo se
 * asevera sobre el estado (nivel 1) y sobre las tools (nivel 2). Sin juez y sin
 * navegador: eso es de los grupos 3 y 5.
 *
 * ── Por qué esto está acá y no en `arnes/escenarios/` ───────────────────────
 * `arnes/escenarios/` es del grupo 6, que se escribe en paralelo. Esta puerta es
 * del grupo 2 y su trabajo es distinto: no es *el* escenario `pedido-feliz`, es
 * la prueba de que **el andamio del bot real funciona** — que `crearBot`
 * enchufa en `crearAgente` con las opciones de producción, que la transcripción
 * lee un `tool_use`, que el nivel 1 sabe leer el core en el turno correcto y que
 * el presupuesto cuenta. Cuando el grupo 6 escriba su `pedido-feliz`, esta
 * puerta se puede borrar o quedar como el humo del grupo.
 *
 * ── Qué quiere decir el verde, según con qué corriste ───────────────────────
 * Con `ARNES_BOT=guion` el verde dice **"el arnés funciona"** y nada más: las
 * respuestas del bot son fijas y comparten los puntos ciegos del prompt por
 * construcción. Con `ARNES_BOT=agente` el verde dice algo del bot. La salida lo
 * imprime siempre, verde o rojo, porque un arnés que dice verde sin decir con
 * qué proveedor corrió es peor que no tener arnés.
 *
 * En los dos casos las tools se ejecutan **de verdad** contra el core: el
 * compromiso que asevera el nivel 1 existe en la base, con sus líneas y su
 * total calculado por el motor. Lo scripteado es la decisión del bot, nunca el
 * sistema.
 *
 * Exit codes (design §15): 0 verde · 1 PRODUCTO · 2 ARNÉS ROTO.
 */

import process from 'node:process';

import { ErrorArnes, entorno } from './entorno.js';
import { preflight } from './preflight.js';
import { conGatewayDelComposeParado } from './compose.js';
import { crearGraphFalso } from './graph-falso.js';
import { crearCorrida } from './aislamiento.js';
import { cargarCarta, precioDe } from './carta.js';
import { levantarGateway } from './gateway-en-proceso.js';
import { crearCliente } from './cliente.js';
import { crearTranscripcion } from './transcripcion.js';
import { crearPresupuesto } from './presupuesto.js';
import { crearInforme } from './informe.js';
import { crearColectorDeAserciones } from './aserciones.js';
import { crearBot } from './actores/bot.js';
import { crearProveedorGuion } from './actores/proveedor/guion.js';
import { crearProveedorAgente } from './actores/proveedor/agente.js';

const ESCENARIO = 'pedido-feliz';

/** La demora que pone el dueño. Es la del documento: el local eligió 30. */
const DEMORA_MIN = 30;

/**
 * El total del Flujo A, **como lo dice el documento**: 8.900 + 4.500 = 13.400.
 *
 * Va como literal a propósito, y el porqué costó encontrarlo: antes esto era
 * `precioDe('Doble cheddar') + precioDe('Papas')`, derivado de la carta. Sonaba
 * mejor —un literal se desincroniza de la carta— pero volvía la aserción
 * TAUTOLÓGICA: el core carga esa misma carta, así que comparar su total contra
 * un número derivado de ella prueba que el core sabe sumar, no que el total sea
 * el que el producto promete. Se verificó sembrando la regresión: cambiar el
 * precio de 8.900 a 9.900 no movía una sola aserción.
 *
 * Con el literal, las dos cosas se aseveran de verdad:
 *   1. la carta del arnés dice lo que dice FLUJOS.md  (ANCLA, abajo)
 *   2. el total que calculó el core coincide con eso  (la aserción de siempre)
 * Si alguien toca la carta, cae la 1 y dice exactamente qué se movió.
 */
const TOTAL_DEL_DOCUMENTO = 13400;

/** Lo mismo, pero derivado de la carta que se le carga al core. */
const TOTAL = precioDe('Doble cheddar') + precioDe('Papas');

// El ancla. Corre antes que cualquier conversación: si la carta se desvió del
// documento, todo lo que siga estaría midiendo contra una referencia movida.
if (TOTAL !== TOTAL_DEL_DOCUMENTO) {
  throw new ErrorArnes(
    `la carta del arnés dice $${TOTAL} y FLUJOS.md dice $${TOTAL_DEL_DOCUMENTO}`,
    'arnes/carta.js se desvió del Flujo A. Arreglá la carta, o actualizá ' +
    'TOTAL_DEL_DOCUMENTO acá si el documento cambió a propósito.',
  );
}

// ── El guion: la DECISIÓN del bot, no el sistema ────────────────────────────
//
// Cada paso es una ida y vuelta. Un paso con `toolUse` hace que `bot.js` llame
// la tool DE VERDAD contra el MCP y vuelva a pedir el paso siguiente con el
// resultado adentro; un paso sin `toolUse` cierra el turno y ese texto sale por
// WhatsApp.
//
// Los textos están sacados del Flujo A. **No se aseveran** —el nivel 3 es del
// grupo 5 y las obligaciones de estilo no se aseveran nunca (spec)—; están para
// que la transcripción se pueda leer.
const GUION_PEDIDO_FELIZ = [
  // Turno 1 — «Hola»
  { toolUse: [{ nombre: 'datos_del_negocio', argumentos: {} }] },
  { texto: '🍔 ¡Hola! Soy el asistente del local. ¿Qué necesitás?\n 1 Hacer un pedido\n 2 Reservar mesa\n 3 Ver la carta' },

  // Turno 2 — «hacer un pedido»
  { toolUse: [{ nombre: 'ver_catalogo', argumentos: {} }] },
  { texto: '¡Buenísimo! Te paso la carta 👇\n\nHamburguesas\nSimple $6.500\nDoble cheddar $8.900\nBacon & cheddar $9.500\n\nPara compartir\nPapas $4.500\n\nDecime qué te sirvo. Escribilo como te salga, yo lo armo 😉' },

  // Turno 3 — «te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar»
  //
  // Acá pasa lo que defiende la mitad de las aserciones: el pedido entra al
  // panel APENAS hay ítems, con la entrega ya puesta (el cliente dijo "lo paso
  // a buscar": repreguntarle si es delivery sería repreguntar lo ya dicho).
  {
    toolUse: [{
      nombre: 'armar_compromiso',
      argumentos: {
        lineas: [{ servicio: 'doble cheddar' }, { servicio: 'papas' }],
        entrega: 'retira',
      },
    }],
  },
  { texto: `¡Listo! Te lo armo así:\n 1× Doble cheddar $8.900\n 1× Papas $4.500\n ─────────────\n Total $${TOTAL.toLocaleString('es-AR')}\n\n 🏃 Retirás por el local\n\n¿A nombre de quién?` },

  // Turno 4 — «Juani». Dos pasos: primero el resumen, después el OK del
  // cliente. El SKILL.md es explícito en que no se confirma sin ese OK.
  { toolUse: [{ nombre: 'confirmar', argumentos: { nombre: 'Juani' } }] },
  { toolUse: [{ nombre: 'confirmar', argumentos: { nombre: 'Juani', confirmado: true } }] },
  { texto: 'Gracias Juani 🙌\nYa le pasé el pedido al local. En un minuto te confirmo la demora.' },
];

// ── La corrida ───────────────────────────────────────────────────────────────

async function correr({ env, informe, presupuesto, proveedor }) {
  const graph = crearGraphFalso();
  await graph.escuchar();

  let gateway = null;
  let bot = null;
  let b = null;
  try {
    console.log('\n⚙️  Aislamiento — el negocio de esta corrida');
    const corrida = await crearCorrida({ env });
    console.log(`   negocio ${corrida.negocioId} · wa_phone_id ${corrida.waPhoneId} · cliente ${corrida.telefonoCliente}`);
    const carta = await cargarCarta(corrida.api, corrida.tokenDueno);
    console.log(`   carta v${carta.version} cargada: ${carta.platos.length} platos`);

    // La bitácora se abre acá y no antes porque quiere los ids del aislamiento:
    // sin ellos, mirar la base al día siguiente para entender una falla obliga a
    // adivinar cuál de las diez parrillas de prueba era la de esta corrida.
    b = informe.escenario({
      escenario: ESCENARIO,
      etiquetas: ['@rapido'],
      corrida: {
        negocioId: corrida.negocioId,
        waPhoneId: corrida.waPhoneId,
        telefonoCliente: corrida.telefonoCliente,
      },
    });
    b.sistema(`negocio creado, carta v${carta.version} cargada (${carta.platos.length} platos), token de agente rotado (cop_…)`);

    const transcripcion = crearTranscripcion({
      escenario: ESCENARIO,
      proveedorBot: proveedor.nombre,
      modelo: env.modelo || null,
      bitacora: b,
    });

    bot = crearBot({ proveedor, transcripcion, presupuesto });
    gateway = await levantarGateway({
      tenant: corrida.tenant(),
      graphUrl: graph.url,
      coreUrl: env.coreUrl,
      queryFn: bot.queryFn,
    });
    console.log(`   gateway del arnés en ${gateway.url} · redis ${gateway.config.redisUrl}`);

    const cliente = crearCliente({ gateway, telefono: corrida.telefonoCliente, nombre: 'Juani' });
    const colector = crearColectorDeAserciones(b, transcripcion);
    const core = colector.nivel1({ corrida, carta });
    const tools = colector.nivel2();

    // ── Turnos 1 y 2 ────────────────────────────────────────────────────────
    console.log(`\n👤 → 🤖  la conversación del Flujo A (bot: ${proveedor.nombre})`);
    transcripcion.cliente('Hola');
    await cliente.decir('Hola');
    transcripcion.recibido(await graph.esperarMensaje({ telefono: corrida.telefonoCliente }));

    transcripcion.cliente('hacer un pedido');
    await cliente.decir('hacer un pedido');
    transcripcion.recibido(await graph.esperarMensaje({ telefono: corrida.telefonoCliente, desde: graph.cantidad }));

    // **Aseverable en cualquier turno, no sólo al final.** Acá el cliente
    // todavía no dictó nada, así que en el panel del local no puede haber un
    // pedido. Si apareciera, el bug es "el bot arma pedidos fantasma" y al
    // final de la conversación no se vería: habría un compromiso y parecería
    // bien.
    const antesDePedir = await core.foto();
    core.cuantosCompromisos(antesDePedir, {
      esperado: 0,
      protege: 'el pedido entra al panel apenas hay ítems — antes no hay nada que la cocina tenga que ver',
      origen: 'docs/FLUJOS.md · «Entra apenas hay ítems»',
    });

    // ── Turno 3: el pedido sucio ────────────────────────────────────────────
    const SUCIO = 'te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar';
    transcripcion.cliente(SUCIO);
    await cliente.decir(SUCIO);
    transcripcion.recibido(await graph.esperarMensaje({ telefono: corrida.telefonoCliente, desde: graph.cantidad }));

    // El turno del reloj: el compromiso YA tiene que existir, PENDIENTE, y el
    // cliente todavía no dio el nombre. Las dos mitades importan.
    const alDictar = await core.foto();
    const entroTemprano = core.cuantosCompromisos(alDictar, {
      esperado: 1,
      protege: 'el pedido entra al panel apenas hay ítems: la cocina lo ve venir mientras el cliente todavía escribe',
      origen: 'docs/FLUJOS.md · Flujo A, «acá el compromiso YA entró al panel como PENDIENTE»',
    });

    // Las tres que siguen dependen de que exista el compromiso. Si no existe,
    // se OMITEN en vez de fallar: cinco rojos con una sola causa se leen como
    // "está todo roto" cuando lo que hay es un bug. Una omitida no cuenta como
    // aprobada, se reporta con su motivo.
    if (entroTemprano.ok) {
      const pedido = core.elCompromiso(alDictar);
      core.campo(pedido, 'estado', 'pendiente', {
        protege: 'vos NO confirmás el pedido solo: la cocina se satura y sólo el local sabe si puede',
        origen: 'SKILL.md regla 3',
      });
      core.campo(pedido, 'cliente_nombre', null, {
        protege: 'el pedido entra al panel ANTES de saber el nombre, no después',
        origen: 'SKILL.md · «el pedido ya entró al panel al llamar a armar_compromiso, antes de saber el nombre»',
      });
    } else {
      for (const p of [
        ['vos NO confirmás el pedido solo: la cocina se satura y sólo el local sabe si puede', 'SKILL.md regla 3'],
        ['el pedido entra al panel ANTES de saber el nombre, no después', 'SKILL.md · El flujo del pedido'],
      ]) {
        colector.omitir({
          protege: p[0], origen: p[1],
          porque: 'no hay compromiso en el panel en este turno: falló la aserción de la que depende',
          comoSeCubre: 'se evalúa sola en cuanto el pedido entre al panel apenas hay ítems',
        });
      }
    }

    // ── Turno 4: el nombre y el cierre ──────────────────────────────────────
    transcripcion.cliente('Juani');
    await cliente.decir('Juani');
    transcripcion.recibido(await graph.esperarMensaje({ telefono: corrida.telefonoCliente, desde: graph.cantidad }));

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

    // El CONTENIDO del pedido se asevera acá y no en el turno 3 a propósito:
    // qué pidió y cuánto sale es cierto en cuanto el pedido existe, y no
    // depende de cuándo entró al panel. Mezclar las dos cosas hace que un bug
    // de "cuándo" se disfrace de bug de "qué", que es la clase de falla que
    // manda a leer el código equivocado.
    core.campo(cerrado, 'entrega', 'retira', {
      protege: 'nunca repreguntes lo que ya te dijeron: si escribió «lo paso a buscar», ya sabés que retira',
      origen: 'SKILL.md · Cómo hablás',
    });
    core.campo(cerrado, 'total', TOTAL, {
      protege: 'nunca inventes un precio: sale de ver_catalogo textual o no se dice',
      origen: 'SKILL.md regla 1',
    });
    core.lineas(cerrado, [
      { servicio: 'Doble cheddar', cantidad: 1 },
      { servicio: 'Papas', cantidad: 1 },
    ], {
      protege: 'entendé lo que escribió como te lo escribió: «hhhamburguesa doble cheddar yunas paps» son dos ítems de la carta',
      origen: 'docs/FLUJOS.md · principio 2, «la gracia del LLM es entender eso»',
    });

    // ── Nivel 2: qué tools llamó, y cuáles NO ───────────────────────────────
    console.log('\n🤖 Nivel 2 — las tools que llamó el bot');
    tools.llamo({
      tool: 'datos_del_negocio',
      protege: 'arrancá siempre por datos_del_negocio: de ahí sale quién confirma el pedido',
      origen: 'SKILL.md · Las tools',
    });
    tools.llamo({
      tool: 'ver_catalogo',
      protege: 'los precios que le decís al cliente salen de ver_catalogo TAL CUAL: no se estiman ni se redondean',
      origen: 'SKILL.md regla 1',
    });
    tools.llamo({
      tool: 'armar_compromiso',
      protege: 'llamala apenas tengas claro qué pidió, aunque falten datos: así la cocina lo ve venir',
      origen: 'SKILL.md · El flujo del pedido',
    });
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
        if (!Array.isArray(args.lineas) || args.lineas.length !== 2) {
          return `esperaba 2 líneas, llegaron ${args.lineas?.length ?? 0}`;
        }
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
    tools.noLlamo({
      tool: 'dejar_consulta',
      protege: 'dejar_consulta es para lo que NO podés chequear con otra tool — un pedido normal no deja consultas',
      origen: 'SKILL.md regla 6',
    });

    // ── 🧑‍🍳 El dueño, por la API (modo `api`) ────────────────────────────────
    //
    // Es el gesto mínimo que necesita esta puerta. El actor dueño completo —con
    // sus dos implementaciones detrás de la misma interfaz— es la tarea 3.1, y
    // cuando exista este bloque se reemplaza por una llamada a `dueno.confirmar()`.
    //
    // Lo que este modo NO puede afirmar, y por eso el grupo 3 existe: que el
    // campo libre de la demora esté en la pantalla. `PATCH /estado
    // {"demora_min": 30}` pasa con o sin campo libre, y D8 dice que sin campo
    // libre "el producto miente".
    console.log('\n🧑‍🍳 El dueño confirma con demora (modo api)');
    transcripcion.dueno(`confirma el pedido con ${DEMORA_MIN} min de demora`);
    const patch = await corrida.api(
      'PATCH', `/api/compromisos/${cerrado.id}/estado`, corrida.tokenDueno,
      { estado: 'confirmado', demora_min: DEMORA_MIN },
    );
    if (patch.status !== 200) {
      throw new ErrorArnes(
        `el dueño no pudo confirmar el pedido: HTTP ${patch.status}`,
        `cuerpo: ${patch.texto.slice(0, 300)}`,
      );
    }

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

    // El aviso de vuelta al cliente —«la mitad del valor» de FLUJOS.md— es la
    // tarea 3.7 y se asevera sobre lo RECIBIDO en el Graph falso, nunca sobre lo
    // encolado. Acá no se asevera, y por eso se nombra abajo en "lo que esta
    // corrida NO cubrió": una omisión que se anuncia es una tarea; una que se
    // calla es una mentira.

    // El estado del core al cerrar, para `estado-core.json`: es lo que permite
    // volver a mirar qué había sin tener que reproducir la corrida.
    const fin = await core.foto();
    b.estadoCore({ compromisos: fin.compromisos, stock: fin.servicios, consultas: fin.consultas, cobros: [] });

    // El gasto va por la bitácora, y `usd: null` significa "no sé" — nunca 0.
    for (const g of presupuesto.gastos()) b.gasto(g);

    return { corrida, graph, transcripcion };
  } finally {
    await bot?.cerrar();
    await gateway?.cerrar();
    await graph.cerrar();
    if (b) await informe.cerrarEscenario(b);
  }
}

// ── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Lo que esta corrida **no pudo** afirmar, con nombre y apellido (tarea 3.8).
 *
 * Se declara arriba del `informe` y no adentro de un `if`, para que no pueda
 * quedarse afuera de una corrida que salió verde: una omisión silenciosa es una
 * mentira, y la mentira más cómoda es la que sólo aparece cuando algo falla.
 */
const NO_CUBIERTO = [
  {
    que: 'el campo libre de la demora existe en la pantalla del dueño y acepta un valor que no es ningún preset',
    porque: 'por API un PATCH con demora_min pasa igual, exista el campo o no',
    comoSeCubre: 'ARNES_DUENO=navegador — un agente ejecuta arnes/dueno/guion.md (tarea 3.4)',
    origen: 'D8: sin campo libre "el producto miente"',
  },
  {
    que: 'el pedido aparece en la pantalla del dueño sin recargar, mientras el cliente todavía escribe',
    porque: 'es render, no dato: por API el compromiso existe igual aunque la vista no se actualice',
    comoSeCubre: 'ARNES_DUENO=navegador — arnes/dueno/guion.md (tarea 3.5)',
    origen: 'FLUJOS.md flujo A — "La cocina lo ve venir mientras el tipo todavía escribe"',
  },
  {
    que: 'el aviso de vuelta al cliente llega al Graph falso con la demora que puso el dueño',
    porque: 'esta puerta es del grupo 2 y cierra en el estado del core, no en el círculo completo',
    comoSeCubre: 'tarea 3.7 — se asevera sobre lo RECIBIDO en el Graph falso, nunca sobre lo encolado',
    origen: 'FLUJOS.md — "El aviso de vuelta es la mitad del valor"',
  },
  {
    que: 'las seis reglas duras del SKILL.md sobre lo que el bot DIJO',
    porque: 'el nivel 3 necesita un juez y el juez es del grupo 5',
    comoSeCubre: 'grupo 5 — una regla por llamada, tres veredictos, cita textual obligatoria',
    origen: 'SKILL.md · Las reglas duras',
  },
];

function elegirProveedor(env) {
  if (env.botProveedor === 'agente') {
    return crearProveedorAgente({
      buzon: env.buzon,
      corrida: ESCENARIO,
      timeoutMs: env.buzonTimeoutMs,
    });
  }
  // El guion corre CON el MCP real: lo scripteado es la decisión del bot, nunca
  // el sistema. Sin esto el nivel 1 no tendría nada que leer —no habría
  // compromiso en el core— y la puerta se estaría probando a sí misma.
  return crearProveedorGuion({ pasos: GUION_PEDIDO_FELIZ, usaMcp: true });
}

async function main() {
  const env = entorno();
  console.log('Arnés · puerta del grupo 2 — el bot real y las aserciones deterministas');

  await preflight();

  const proveedor = elegirProveedor(env);
  const presupuesto = crearPresupuesto({ topeUsd: env.topeUsd, proveedorBot: proveedor.nombre });
  const informe = crearInforme({
    modelos: { bot: env.modelo || '(default de gateway/src/config.js)' },
    // Los dos campos que impiden leer un verde del andamio como un verde del
    // producto. Con `guion` el cartel de arriba cambia y lo dice.
    proveedorBot: proveedor.nombre,
    juzgaAlBot: proveedor.juzgaAlBot,
    duenoModo: 'api',
    topeUsd: presupuesto.tope,
    modo: 'guion',
  });

  for (const o of NO_CUBIERTO) informe.omitida(o);

  try {
    await conGatewayDelComposeParado(() => correr({ env, informe, presupuesto, proveedor }));
  } catch (err) {
    // Un `ErrorArnes` no es una falla del producto: se anota como rotura y la
    // corrida sale por exit 2 sin afirmar nada del sistema (design §15). El
    // informe imprime igual lo determinista que ya había fallado, porque eso
    // falló de verdad; esconderlo sería la misma mentira al revés.
    if (err instanceof ErrorArnes || err?.arnesRoto) informe.romper(err);
    else throw err;
  }

  process.exit(await informe.cerrar());
}

main().catch((err) => {
  const tty = process.stdout.isTTY;
  const ROJO = tty ? '\x1b[31m' : '';
  const NEGRITA = tty ? '\x1b[1m' : '';
  const FIN = tty ? '\x1b[0m' : '';
  if (err instanceof ErrorArnes || err?.arnesRoto) {
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${err.message}`);
    for (const pista of err.pistas || []) console.error(`    ${pista}`);
  } else {
    console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — se cayó la corrida: ${err?.stack || err}`);
  }
  console.error('\n  No hay veredicto sobre el producto: el arnés no llegó a terminar de preguntar.');
  process.exit(2);
});
