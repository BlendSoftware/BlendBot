/**
 * escenarios/correr.js — arma el mundo de cada escenario y lo corre.
 *
 *   node arnes/escenarios/correr.js --listar
 *   node arnes/escenarios/correr.js --tag=@rapido
 *   node arnes/escenarios/correr.js pedido-feliz se-termino
 *   ARNES_BOT=agente node arnes/escenarios/correr.js --tag=@rapido
 *
 * Cada escenario corre **en su propio negocio** (design §12): sufijo al azar,
 * alta, carta sintética, token de agente rotado y tenant en memoria. Correrlo
 * diez veces deja diez parrillas de prueba y ningún error, y dos corridas
 * simultáneas no se pisan el stock.
 *
 * ── Qué hace este archivo y qué NO ──────────────────────────────────────────
 * Arma el contexto y encadena: preparación → conversación → aserciones de nivel
 * 1 y 2 → **juez** sobre la transcripción ya fija → resumen. Lo que NO hace es
 * decidir qué se asevera: eso vive en cada escenario, que es donde se puede
 * leer al lado de la frase de `FLUJOS.md` que lo justifica.
 *
 * ── El orden del juez no es un detalle ──────────────────────────────────────
 * El juez se calibra **antes** de emitir un solo veredicto sobre el producto, y
 * se calibra contra los casos negativos de las reglas. Una regla que no
 * demostró que el juez condena su violación de ejemplo no puede poner nada en
 * rojo ni en verde: un juez indulgente daría verde para siempre y nadie se
 * enteraría, que es la falla silenciosa y por eso la peor (design, riesgo
 * espejo).
 *
 * Exit codes (design §15): 0 verde · 1 PRODUCTO · 2 ARNÉS ROTO.
 */

import process from 'node:process';

import { ErrorArnes, entorno, leerEnv } from '../entorno.js';
import { conGatewayDelComposeParado } from '../compose.js';
import { crearGraphFalso } from '../graph-falso.js';
import { crearCorrida } from '../aislamiento.js';
import { cargarCarta } from '../carta.js';
import { levantarGateway } from '../gateway-en-proceso.js';
import { crearCliente } from '../cliente.js';
import { crearTranscripcion } from '../transcripcion.js';
import { crearPresupuesto } from '../presupuesto.js';
import { crearInforme } from '../informe.js';
import { crearColectorDeAserciones, nivel2 } from '../aserciones.js';
import { crearBot } from '../actores/bot.js';
import { crearProveedorGuion } from '../actores/proveedor/guion.js';
import { crearProveedorAgente } from '../actores/proveedor/agente.js';
import { crearDuenoApi } from '../actores/dueno/api.js';

import { ESCENARIOS, seleccionar } from './index.js';
import { crearJuez, informeDeVeredictos } from '../juez/juez.js';
import { reglas as reglasPorId } from '../juez/reglas/index.js';
import { servidorDelEntorno } from '../juez/calibrar.js';
import { transcripcionParaElJuez, hechosDeLaCorrida } from '../juez/desde-transcripcion.js';

const color = process.stdout.isTTY;
const VERDE = color ? '\x1b[32m' : '';
const ROJO = color ? '\x1b[31m' : '';
const AMARILLO = color ? '\x1b[33m' : '';
const GRIS = color ? '\x1b[90m' : '';
const NEGRITA = color ? '\x1b[1m' : '';
const FIN = color ? '\x1b[0m' : '';

const ESPERA_RESPUESTA_MS = 45000;

// ═══════════════════════════════════════════════════════════════════════════
//  El mundo de un escenario
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Levanta un negocio, su gateway en proceso y su cliente. Devuelve las piezas
 * que un escenario usa, más `cerrar()`.
 */
async function levantarMundo({ env, graph, escenario, proveedor, transcripcion, presupuesto, colector, bitacora, config }) {
  const corrida = await crearCorrida({ env, config });
  const carta = await cargarCarta(corrida.api, corrida.tokenDueno);
  const bot = crearBot({ proveedor, transcripcion, presupuesto });
  const gateway = await levantarGateway({
    tenant: corrida.tenant(),
    graphUrl: graph.url,
    coreUrl: env.coreUrl,
    queryFn: bot.queryFn,
  });
  const core = colector.nivel1({ corrida, carta });
  const tools = colector.nivel2(transcripcion);
  const dueno = crearDuenoApi({ corrida, escenario, env, bitacora });

  return {
    corrida, carta, gateway, core, tools, dueno,
    async cerrar() {
      await bot?.cerrar();
      await gateway?.cerrar();
    },
  };
}

/**
 * Un cliente con sus atajos: decir, esperar lo que le llegó, leer lo recibido.
 *
 * `decir()` espera **dos cosas distintas** y las dos hacen falta:
 *   1. `gateway.esperar()` — que el procesamiento asincrónico del webhook
 *      termine. Sin esto el assert siguiente corre contra una carrera.
 *   2. el próximo mensaje en el Graph falso — que el outbox lo haya entregado.
 *
 * Un timeout esperando la respuesta es **falla del producto**, no del arnés: el
 * cliente escribió y nadie le contestó. Por eso no se traga.
 */
function atarCliente({ gateway, graph, telefono, nombre, transcripcion, core, tools }) {
  const cliente = crearCliente({ gateway, telefono, nombre });
  /** El índice del Graph desde el que empieza lo de ESTE teléfono. */
  const mios = [];

  async function decir(texto) {
    const desde = graph.cantidad;
    transcripcion.cliente(texto);
    await cliente.decir(texto);
    const recibido = await graph.esperarMensaje({ telefono, desde, timeoutMs: ESPERA_RESPUESTA_MS });
    transcripcion.recibido(recibido);
    mios.push(recibido);
    return recibido;
  }

  /**
   * Espera algo que NO es respuesta a un mensaje del cliente: el aviso que
   * dispara el dueño desde el panel. `opcional` lo vuelve tolerante para los
   * escenarios donde el aviso no es lo que se está probando.
   */
  async function esperarDelTelefono({ desde = graph.cantidad, que = 'un mensaje', opcional = false, timeoutMs = ESPERA_RESPUESTA_MS } = {}) {
    try {
      const m = await graph.esperarMensaje({ telefono, desde, timeoutMs });
      transcripcion.recibido(m);
      mios.push(m);
      return m;
    } catch (err) {
      if (opcional) return null;
      // No se convierte en ErrorArnes: que el cliente no reciba el aviso es
      // justamente lo que el escenario vino a detectar. Se devuelve null y la
      // aserción del escenario lo reporta como falla del producto.
      console.log(`  ${GRIS}(no llegó ${que}: ${err.message})${FIN}`);
      return null;
    }
  }

  return {
    telefono: String(telefono),
    decir,
    esperarDelTelefono,
    recibidos: () => [...mios],
    core,
    tools,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Correr un escenario
// ═══════════════════════════════════════════════════════════════════════════

async function correrEscenario(esc, { env, juez, proveedorDe, informe }) {
  console.log(`\n${NEGRITA}━━ ${esc.id}${FIN} ${GRIS}· ${esc.titulo}${FIN}`);
  console.log(`   ${GRIS}${esc.origen}${FIN}`);

  const proveedor = proveedorDe(esc);
  if (!proveedor) {
    // No cuenta como aprobado y se anuncia con nombre y apellido: una omisión
    // silenciosa es una mentira; una que se anuncia es una tarea.
    informe.omitida({
      que: `el escenario ${esc.id} — ${esc.titulo}`,
      porque: 'no tiene guion para el proveedor `guion` y esta corrida no usó un bot real',
      comoSeCubre: 'ARNES_BOT=agente node arnes/escenarios/correr.js ' + esc.id,
    });
    console.log(`  ${AMARILLO}○ sin correr${FIN} — este escenario no tiene guion y sólo corre con ARNES_BOT=agente`);
    return { id: esc.id, estado: 'sin-correr', motivo: 'no tiene guion; corre con ARNES_BOT=agente' };
  }

  const presupuesto = crearPresupuesto({ proveedorBot: proveedor.nombre });
  const bitacora = informe.escenario({
    escenario: esc.id,
    etiquetas: esc.tags,
  });
  const transcripcion = crearTranscripcion({
    escenario: esc.id,
    proveedorBot: proveedor.nombre,
    bitacora,
  });
  const colector = crearColectorDeAserciones(bitacora, transcripcion);

  const graph = crearGraphFalso();
  await graph.escuchar();

  const mundos = [];
  try {
    const mundo = await levantarMundo({
      env, graph, escenario: esc.id, proveedor, transcripcion, presupuesto, colector,
      // La bitácora del escenario, no una suelta: sin esto, todo lo que el
      // dueño asevera se anota en un objeto que nadie imprime y la corrida
      // sale verde sin haber mirado nada de lo suyo.
      bitacora,
      config: esc.negocio?.config,
    });
    mundos.push(mundo);
    console.log(`   ${GRIS}negocio ${mundo.corrida.negocioId} · carta v${mundo.carta.version} · bot: ${proveedor.nombre}${FIN}`);

    const notas = [];
    const principal = atarCliente({
      gateway: mundo.gateway, graph, telefono: mundo.corrida.telefonoCliente,
      nombre: 'Juani', transcripcion, core: mundo.core, tools: mundo.tools,
    });

    /** @type {import('./index.js').Contexto} */
    const ctx = {
      env,
      corrida: mundo.corrida,
      carta: mundo.carta,
      graph,
      gateway: mundo.gateway,
      transcripcion,
      // Los escenarios lo llaman `informe`, y lo que necesitan de él es
      // `omitir`: anotar lo que no se pudo evaluar y de qué depende.
      informe: colector,
      core: mundo.core,
      tools: mundo.tools,
      dueno: mundo.dueno,
      presupuesto,
      decir: principal.decir,
      esperarDelTelefono: principal.esperarDelTelefono,
      recibidos: principal.recibidos,
      plato: (nombre) => mundo.carta.porNombre[nombre],
      nota(texto) {
        notas.push(texto);
        transcripcion.sistema(texto);
        console.log(`   ${GRIS}· ${texto}${FIN}`);
      },
      /**
       * Un segundo cliente del MISMO negocio, con su propio teléfono. Es lo que
       * necesitan `dos-contra-el-ultimo` y el contraste de `reserva-de-mesa`:
       * una sesión limpia, para poder aseverar una ausencia de tools que en la
       * sesión del primero ya no sería cierta.
       */
      otroCliente({ sufijo = 'b', nombre = null } = {}) {
        const telefono = `${mundo.corrida.telefonoCliente}${sufijo.charCodeAt(0) % 10}`;
        return atarCliente({
          gateway: mundo.gateway, graph, telefono, nombre, transcripcion,
          core: mundo.core, tools: nivel2(transcripcion, colector),
        });
      },
      alterno: null,
    };

    // ── ¿El escenario se puede correr hoy? ──────────────────────────────────
    const pendiente = esc.pendiente || (esc.requisito ? await esc.requisito(ctx) : null);
    if (pendiente) {
      // Un pendiente **se lista con su motivo y NO cuenta como aprobado**. Un
      // pendiente que se saltea en silencio es un test muerto que nadie va a
      // extrañar (spec).
      bitacora.marcarPendiente(`${pendiente.motivo} — lo desbloquea: ${pendiente.desbloquea}`);
      console.log(`  ${AMARILLO}○ PENDIENTE${FIN} — ${pendiente.motivo}`);
      console.log(`     ${GRIS}lo desbloquea: ${pendiente.desbloquea}${FIN}`);
      await informe.cerrarEscenario(bitacora);
      return { id: esc.id, estado: 'pendiente', motivo: pendiente.motivo, desbloquea: pendiente.desbloquea };
    }

    // ── El negocio alterno, si el escenario lo pide ──────────────────────────
    if (esc.negocioAlterno) {
      const otro = await levantarMundo({
        env, graph, escenario: `${esc.id}/${esc.negocioAlterno.id}`, proveedor,
        transcripcion, presupuesto, colector, config: esc.negocioAlterno.config,
      });
      mundos.push(otro);
      const suCliente = atarCliente({
        gateway: otro.gateway, graph, telefono: otro.corrida.telefonoCliente,
        nombre: 'Juani', transcripcion, core: otro.core, tools: otro.tools,
      });
      ctx.alterno = { ...suCliente, corrida: otro.corrida, carta: otro.carta, dueno: otro.dueno };
      console.log(`   ${GRIS}negocio alterno «${esc.negocioAlterno.id}»: ${otro.corrida.negocioId}${FIN}`);
    }

    // ── Preparación y conversación ──────────────────────────────────────────
    if (esc.preparar) await esc.preparar(ctx);
    await esc.correr(ctx);

    // ── El estado del core al cerrar, para `estado-core.json` ───────────────
    const cierre = await mundo.core.foto();
    bitacora.estadoCore({
      compromisos: cierre.compromisos,
      // El stock, por el **contrato**: `restante`/`agotado` de /api/servicios.
      // Nunca `cupo_jornada` ni recetas (design §13).
      stock: cierre.servicios.map((s) => ({
        nombre: s.nombre, restante: s.restante ?? null, agotado: Boolean(s.agotado), disponible: s.disponible !== false,
      })),
      consultas: cierre.consultas,
    });

    // ── Nivel 3, sobre la transcripción YA FIJA ─────────────────────────────
    await juzgar({ esc, ctx, juez, mundo, bitacora, cierre });

    // El gasto por actor, para el desglose de la corrida. Va aunque sea cero:
    // "no gastó" y "no se sabe cuánto gastó" son dos cosas distintas y
    // `presupuesto.js` ya las distingue con `costoConocido`.
    const gasto = presupuesto.estado();
    for (const [actor, g] of Object.entries(gasto.porActor)) {
      if (g.pasos || g.usd) {
        bitacora.gasto({ actor, usd: g.usd, tokens: (g.entrada ?? 0) + (g.salida ?? 0) });
      }
    }

    const { producto } = await informe.cerrarEscenario(bitacora);
    return {
      id: esc.id,
      estado: producto.length ? 'producto' : 'verde',
      fallas: producto.length,
      notas,
    };
  } finally {
    for (const m of mundos) await m.cerrar();
    await graph.cerrar();
  }
}

/**
 * El nivel 3. Se corre al final y sobre la conversación ya terminada: la
 * transcripción está fija antes del primer veredicto, y los tres veredictos de
 * cada regla miran exactamente el mismo texto.
 */
async function juzgar({ esc, ctx, juez, mundo, bitacora, cierre }) {
  if (!juez || !esc.reglas?.length) return null;

  const { turnos, mapa } = transcripcionParaElJuez(ctx.transcripcion);
  if (!turnos.length) return null;

  // Los hechos: qué hay cargado en el sistema del local. Salen del **contrato**
  // del core, nunca de la fuente del número (design §13). Son hechos, jamás
  // expectativas: ver `hechosDeLaCorrida`.
  const neg = await mundo.corrida.api('GET', '/api/negocio', mundo.corrida.tokenDueno);
  const confirmado = cierre.compromisos.find((c) => c.estado === 'confirmado');
  const hechos = hechosDeLaCorrida({
    foto: cierre,
    negocio: neg.status === 200 ? neg.json : null,
    confirmacion: confirmado
      ? { confirmado: true, demoraMin: confirmado.demora_min }
      : { confirmado: false },
  });

  console.log(`\n  ${GRIS}🧑‍⚖️  nivel 3 — ${esc.reglas.length} reglas sobre ${turnos.length} turnos ya fijos${FIN}`);
  const resultados = await juez.evaluar({
    reglas: reglasPorId(esc.reglas),
    transcripcion: turnos,
    hechos,
  });

  // Los TRES votos van a la bitácora, no el resultado: `informe.js` resuelve la
  // mayoría y la cita de su lado, y `veredictos.json` guarda los tres enteros.
  // Una regla que empieza a discrepar seguido es una regla mal escrita, y eso
  // sólo se ve si se guardó la discrepancia (spec).
  for (const r of resultados) {
    bitacora.veredicto({
      regla: r.regla.id,
      texto: r.regla.titulo,
      origen: r.regla.origen,
      dura: r.regla.dura,
      cuarentena: r.cuarentena ? `${r.cuarentena.motivo} (desde ${r.cuarentena.desde}, ${r.cuarentena.quien})` : null,
      confiable: r.confiable === true,
      votos: r.veredictos.map((v) => ({
        condena: v.veredicto === 'viola',
        // Una condena descartada por su cita viaja **sin cita**: así del otro
        // lado se cuenta como lo que es, un voto sin prueba, y no como una
        // condena buena.
        cita: v.valido && v.veredicto === 'viola' ? v.cita : null,
        turno: v.valido && v.turno ? entradaDe(mapa, v.turno) : null,
        razon: v.motivoDescarte ? `descartado: ${v.motivoDescarte}` : (v.motivo ?? null),
      })),
    });
  }

  return informeDeVeredictos({
    escenario: esc.id,
    metadatos: juez.metadatos(),
    resultados,
  });
}

/** El número de evento de la bitácora detrás del turno que citó el juez. */
function entradaDe(mapa, turnoDelJuez) {
  return mapa.get(turnoDelJuez)?.entrada ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Entrada
// ═══════════════════════════════════════════════════════════════════════════

function listar() {
  console.log(`${NEGRITA}Escenarios del arnés${FIN}\n`);
  for (const e of ESCENARIOS) {
    const marcas = [
      e.tags.includes('@rapido') ? `${VERDE}@rapido${FIN}` : null,
      e.pendiente ? `${AMARILLO}@pendiente${FIN}` : null,
      e.requisito ? `${GRIS}(pregunta su requisito al correr)${FIN}` : null,
      e.guion ? null : `${GRIS}sólo con ARNES_BOT=agente${FIN}`,
    ].filter(Boolean).join(' · ');
    console.log(`  ${NEGRITA}${e.id}${FIN} ${marcas}`);
    console.log(`     ${e.titulo}`);
    console.log(`     ${GRIS}${e.origen} · nivel 3: ${e.reglas.join(', ') || 'ninguna'}${FIN}`);
    if (e.pendiente) console.log(`     ${AMARILLO}pendiente: ${e.pendiente.motivo}${FIN}`);
    console.log('');
  }
  console.log(`${GRIS}@rapido es lo que corre en \`make arnes\`, antes de un release.${FIN}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--listar')) { listar(); process.exit(0); }

  const tag = (args.find((a) => a.startsWith('--tag=')) || '').slice('--tag='.length) || null;
  const ids = args.filter((a) => !a.startsWith('--'));
  const elegidos = seleccionar({ tag, ids: ids.length ? ids : null });
  if (!elegidos.length) throw new ErrorArnes(`no hay escenarios para ${tag || ids.join(', ')}`);

  const env = entorno();
  const modoBot = (leerEnv('ARNES_BOT', 'guion')).toLowerCase();

  console.log(`${NEGRITA}Arnés · escenarios${FIN} ${GRIS}(${elegidos.map((e) => e.id).join(', ')})${FIN}`);

  // El juez, y su calibración, ANTES de emitir un veredicto sobre el producto.
  const servidor = await servidorDelEntorno();
  let juez = null;
  let calibracion = null;
  if (servidor) {
    juez = crearJuez({ servidor });
    console.log(`\n🧑‍⚖️  juez: modo ${servidor.modo} · modelo ${servidor.modelo}`);
    if (!servidor.independenciaDeModelo.garantizada) {
      console.log(`${AMARILLO}⚠ independencia de modelo entre el bot y el juez: SIN GARANTÍA${FIN}`);
      console.log(`  ${GRIS}${servidor.independenciaDeModelo.motivo}${FIN}`);
    }
    // Calibrar SOLO las reglas que esta selección va a usar. Calibrar las diez
    // cuando se corre un escenario que usa cinco es pagar treinta veredictos de
    // más por nada.
    const usadas = [...new Set(elegidos.flatMap((e) => e.reglas ?? []))];
    calibracion = await juez.calibrar({
      reglas: reglasPorId(usadas),
      avisar: (l) => console.log(`  ${GRIS}· ${l}${FIN}`),
    });
    const flojas = calibracion.entradas.filter((e) => !e.confiable);
    if (flojas.length) {
      console.log(`${AMARILLO}⚠ ${flojas.length} regla(s) no confiables (${flojas.map((e) => e.regla).join(', ')}): se evalúan y se reportan, pero no rompen ni cuentan como verificadas.${FIN}`);
    }
  } else {
    console.log(`\n${AMARILLO}🧑‍⚖️  sin juez (ARNES_JUEZ=ninguno): esta corrida NO verifica el nivel 3.${FIN}`);
  }

  const informe = crearInforme({
    modo: 'guion',
    proveedorBot: modoBot,
    juzgaAlBot: modoBot === 'agente',
    duenoModo: 'api',
    modelos: {
      // Con el bot servido por un agente, el arnés **no puede leer la versión
      // del modelo**. Se dice así en vez de dejarlo en blanco: un veredicto sin
      // saber con qué cerebro se produjo no se puede comparar con el de la
      // corrida anterior, y esa limitación es parte del resultado.
      bot: modoBot === 'agente' ? 'agente Claude — el arnés no puede leer la versión' : null,
      juez: servidor?.modelo ?? null,
    },
  });

  const resultados = [];
  await conGatewayDelComposeParado(async () => {
    const proveedorDe = (esc) => {
      if (modoBot === 'agente') return crearProveedorAgente({ escenario: esc.id });
      if (!esc.guion) return null;
      // `usaMcp: true`: los guiones del arnés NO traen `resultado` escrito al
      // lado de cada tool, así que las tools se ejecutan **de verdad** contra el
      // MCP y el core. Lo scripteado es la decisión del bot, nunca el sistema:
      // el compromiso que asevera el nivel 1 existe en la base, con su total
      // calculado por el motor. Un guion con resultados escritos probaría el
      // guion.
      return crearProveedorGuion({ pasos: esc.guion, usaMcp: true });
    };
    for (const esc of elegidos) {
      try {
        resultados.push(await correrEscenario(esc, { env, juez, proveedorDe, informe }));
      } catch (err) {
        // Un escenario que explota NO tumba a los demás, y **no cuenta como
        // verde**: se rotula arnés roto y se sigue. Que una corrida de seis
        // escenarios no reporte nada porque el tercero se cayó es la peor forma
        // de perder la información de los otros cinco.
        informe.romper(err);
        console.log(`  ${ROJO}✗ ARNÉS ROTO en ${esc.id}${FIN} — ${err?.message || err}`);
        resultados.push({ id: esc.id, estado: 'arnes-roto', motivo: String(err?.message || err) });
      }
    }
  });

  loQueNoSeCubrio(informe, resultados, { juez, elegidos });
  if (juez) imprimirCierre({ calibracion, juez });
  return informe.cerrar();
}

/**
 * Lo que esta corrida NO verificó, con nombre y apellido. Es lo único que evita
 * que "no corre solo" se convierta en "no corre nunca" (design §9).
 */
function loQueNoSeCubrio(informe, resultados, { juez, elegidos } = {}) {
  // Sin juez no hay nivel 3, y cada regla que se dejó de mirar se nombra. Un
  // verde sin juez que no dice qué no miró está afirmando sobre el texto del
  // bot sin haberlo leído.
  if (!juez) {
    const usadas = [...new Set((elegidos ?? []).flatMap((e) => e.reglas ?? []))];
    for (const r of reglasPorId(usadas)) {
      informe.omitida({
        que: `la regla del dicho ${r.id} — «${r.titulo}»`,
        porque: 'esta corrida se pidió sin juez (ARNES_JUEZ=ninguno): no se evaluó el nivel 3',
        comoSeCubre: 'ARNES_JUEZ=agente, con un agente atendiendo el buzón del juez',
        origen: r.origen,
      });
    }
  }

  for (const r of resultados.filter((x) => x.estado === 'pendiente')) {
    informe.omitida({
      que: `el escenario ${r.id}`,
      porque: r.motivo,
      comoSeCubre: `lo desbloquea: ${r.desbloquea}`,
    });
  }
  // Las dos que sólo el guión del dueño en Chrome puede afirmar. Van SIEMPRE,
  // aunque todo esté verde: una corrida desatendida que no las nombra está
  // diciendo que cubrió el panel, y no lo cubrió.
  informe.omitida({
    que: 'que el campo libre de la demora exista y funcione en la pantalla del dueño',
    porque: 'PATCH /estado {"demora_min": 30} pasa con o sin campo libre, y D8 dice que sin campo libre «el producto miente»',
    comoSeCubre: 'el guión de arnes/dueno/guion.md, ejecutado por un agente con Chrome',
    origen: 'DECISIONES.md D8',
  });
  informe.omitida({
    que: 'que el pedido aparezca en la pantalla del dueño sin recargar, mientras el cliente todavía escribe',
    porque: 'es render, no dato: por API el compromiso existe igual',
    comoSeCubre: 'el guión de arnes/dueno/guion.md, ejecutado por un agente con Chrome',
    origen: 'docs/FLUJOS.md · «la cocina lo ve venir mientras el tipo todavía escribe»',
  });
}

/** Lo del juez que la salida general no sabe: su calibración y su hueco. */
function imprimirCierre({ calibracion, juez }) {
  const meta = juez.metadatos();
  const flojas = calibracion.entradas.filter((e) => !e.confiable).map((e) => e.regla);
  console.log('');
  console.log(`  calibración del juez: ${calibracion.entradas.length - flojas.length}/${calibracion.entradas.length} reglas condenan su caso negativo` +
    (flojas.length ? ` — NO CONFIABLES: ${flojas.join(', ')}` : ''));
  if (!meta.independenciaDeModelo.garantizada) {
    console.log(`  ${AMARILLO}⚠ independencia de modelo entre el bot y el juez: SIN GARANTÍA${FIN}`);
    console.log(`    ${GRIS}${meta.independenciaDeModelo.motivo}${FIN}`);
  }
  if (meta.cuarentenaVigente.length) {
    console.log(`  en cuarentena (se reportan, no rompen): ${meta.cuarentenaVigente.map((c) => `${c.regla} — ${c.motivo}`).join(' · ')}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('correr.js')) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      if (err instanceof ErrorArnes || err?.arnesRoto) {
        console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — ${err.message}`);
        for (const p of err.pistas || []) console.error(`    ${p}`);
        console.error('\n  No hay veredicto sobre el producto.');
        process.exit(2);
      }
      console.error(`\n${ROJO}${NEGRITA}✗ ARNÉS ROTO${FIN} — se cayó la corrida: ${err?.stack || err}`);
      process.exit(2);
    });
}
