/**
 * 👤 El cliente — modo `libre`.
 *
 * El otro cliente, el de `arnes/cliente.js`, dice líneas escritas a mano y por
 * eso es determinista: es el lado fijo de la conversación en modo `guion`. Este
 * improvisa. Tiene una **persona** y un **objetivo**, y de ahí para adelante
 * escribe lo que se le canta, turno a turno, mirando lo que el local le
 * contesta.
 *
 * ── Para qué sirve, que es una sola cosa (design §2) ────────────────────────
 * **Genera candidatos a escenario del modo `guion`.** Nada más. El guion sólo
 * encuentra lo que alguien ya imaginó; el modo libre encuentra la frase que a
 * nadie se le ocurrió escribir —que es exactamente de dónde salieron las
 * correcciones del 18/08, con Juani haciendo de cliente a mano—. Cuando el modo
 * libre encuentra algo, **no se arregla el modo libre: se escribe el escenario
 * scripteado que lo captura para siempre**, y ese escenario es el que después
 * defiende contra la regresión.
 *
 * Por eso **nunca rompe el build**. Dos modelos improvisando no repiten una
 * corrida, y un chequeo que no repite y rompe el build se apaga en una semana —
 * y con él se apaga el modo `guion`, que sí sirve.
 *
 * ── Por qué esto NO es un guion con otro nombre ─────────────────────────────
 * Acá vale exactamente el mismo principio que en `actores/bot.js`, y por el
 * mismo motivo. **La decisión de qué dice el cliente no se escribe en este
 * archivo.** Un cliente con respuestas fijas es el modo `guion` con otro
 * nombre; llamarlo `libre` sería mentirle al que lea la salida, que es lo único
 * que un arnés no puede permitirse.
 *
 * Entonces la decisión vive afuera, en un **proveedor inyectable**, igual que
 * la del bot:
 *
 *   `proveedor/agente.js`    un agente Claude metido en el personaje, por el
 *                            buzón. **Es el único que improvisa de verdad**, y
 *                            por lo tanto el único cuyos hallazgos valen como
 *                            candidatos a escenario (`improvisa: true`).
 *   `proveedor/de-prueba.js` líneas fijas. **Ejercita la costura, no el
 *                            producto.** Sirve para probar que el bucle cuenta
 *                            los turnos, que el techo corta, que el protocolo
 *                            rechaza una respuesta mal formada — sin nadie en
 *                            el loop y sin gastar. Un hallazgo suyo no es un
 *                            hallazgo: es una línea que alguien escribió.
 *
 * `proveedor.improvisa` viaja en el reporte y en toda salida. Un informe de
 * modo libre que no dice quién hizo de cliente no vale nada: puede querer decir
 * "un modelo probó algo que a nadie se le había ocurrido" o "mis cuatro líneas
 * fijas siguen siendo cuatro líneas fijas".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL PROTOCOLO — `arnes/cliente-libre@1`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mismo mecanismo que `arnes/proveedor-agente@1` (el del bot) y a propósito:
 * quien ya contestó turnos del bot no tiene que aprender nada nuevo. Un turno
 * es un intercambio de dos JSON en un directorio.
 *
 *   <buzon>/SIGUIENTE.md                    ← qué hay que hacer AHORA, en prosa
 *   <buzon>/cliente-turno-03.pedido.json    ← lo escribe el ARNÉS
 *   <buzon>/cliente-turno-03.respuesta.json ← lo escribe el AGENTE
 *
 * ── `pedido.json` — qué recibe el que hace de cliente ───────────────────────
 *
 * {
 *   "protocolo": "arnes/cliente-libre@1",
 *   "corrida": "arnes-482910337",
 *   "turno": 3,
 *   "tope_de_turnos": 15,
 *   "instrucciones": "…",             // el contrato, en prosa, en CADA pedido
 *   "persona": {
 *     "quien_sos": "Tenés 34 años, estás volviendo del laburo y tenés hambre.",
 *     "como_escribis": "Corto, sin mayúsculas, con errores de tipeo. Sos parco.",
 *     "que_sabes": "Nunca pediste acá. No conocés la carta."
 *   },
 *   "objetivo": "Querés dos hamburguesas para retirar. Si no hay, algo parecido.",
 *   "conversacion": [                 // TODO lo que pasó, desde tu lado
 *     { "rol": "vos",   "texto": "hola" },
 *     { "rol": "local", "texto": "¡Hola! Soy el asistente…" }
 *   ],
 *   "responder_en": "/ruta/absoluta/cliente-turno-03.respuesta.json"
 * }
 *
 * ── `respuesta.json` — qué devuelve ─────────────────────────────────────────
 *
 * {
 *   "protocolo": "arnes/cliente-libre@1",
 *   "turno": 3,
 *   "texto": "dos dobles cheddar y unas papas, paso a buscarlo",
 *   "terminar": false,          // true = te vas de la conversación
 *   "motivo": null,             // por qué te fuiste (sólo si terminar)
 *   "raro": null,               // ← ver abajo: lo más valioso del modo libre
 *   "uso": null, "costo_usd": null
 * }
 *
 * ── Las reglas del intercambio ──────────────────────────────────────────────
 *
 *  1. **No salís del personaje.** No sos un tester, no estás probando nada, no
 *     sabés que hay un arnés. Sos alguien que le escribe a un local por
 *     WhatsApp. La única forma de que el modo libre encuentre la frase que
 *     nadie imaginó es que la escriba alguien que no está imaginando un test.
 *  2. **No ves el `SKILL.md` y es a propósito.** Un cliente que conoce el
 *     prompt del bot le esquiva a los agujeros sin querer, y ahí el modo libre
 *     deja de servir para lo único que sirve.
 *  3. **No ves ninguna aserción ni sabés qué se espera.** Lo mismo que la regla
 *     4 del protocolo del bot: el que sabe qué se espera te da la razón.
 *  4. **`terminar: true` cierra la conversación.** Se usa cuando ya lograste tu
 *     objetivo, o cuando en la vida real cerrarías el chat (te cansaste, no te
 *     entendieron tres veces, te fuiste a otro lado). Irse es un dato, no una
 *     falla: **por qué** te fuiste es la mitad del hallazgo, así que va en
 *     `motivo`.
 *  5. **`raro` es el campo que justifica el modo entero.** Si algo del local te
 *     resultó raro —contestó al lado, te prometió algo que no te podía
 *     prometer, te repreguntó lo que ya dijiste, te ofreció algo que no
 *     existía—, escribilo ahí en una línea, **como cliente**, sin diagnosticar.
 *     Eso es el candidato a escenario. Y sigue siendo un candidato: el arnés lo
 *     reporta, no lo asevera, porque una impresión de un cliente no puede poner
 *     nada en rojo.
 *  6. **Ni texto ni `terminar` = arnés roto**, no producto roto. Un cliente
 *     mudo por un buzón mal contestado no es un hallazgo.
 *
 * ── Cómo se ejercita ────────────────────────────────────────────────────────
 *
 *   1. `make arnes-libre` (o `ARNES_CLIENTE=agente node arnes/libre.js`).
 *   2. Abrir `<buzon>/SIGUIENTE.md`: dice qué leer y dónde contestar.
 *   3. Meterse en el personaje, escribir el `respuesta.json`.
 *   4. El arnés lo levanta solo y le manda el mensaje al bot por el webhook.
 *
 * Y la costura sin filesystem, para probar el bucle sin nadie en el loop:
 * `crearProveedorClienteAgente({ responder })` recibe el pedido y devuelve la
 * respuesta en proceso. Misma costura, sin la espera. **No improvisa**: sirve
 * para verificar el protocolo, jamás para juzgar al bot.
 */

import { ErrorArnes } from '../../entorno.js';

/** El nombre del contrato. Viaja en cada pedido y en cada respuesta. */
export const PROTOCOLO_CLIENTE = 'arnes/cliente-libre@1';

/**
 * Techo de turnos del modo libre (design §2). Después se corta.
 *
 * No es un número mágico: es lo que separa "una conversación" de "dos modelos
 * hablando hasta que se acabe la plata". Cortar por techo **no es una falla**;
 * es el final normal de una conversación que no cerró, y el reporte lo dice
 * así.
 */
export const MAX_TURNOS = 15;

/**
 * Cuánto se espera a que el local conteste un turno.
 *
 * Un timeout acá **sí** es un hallazgo sobre el producto —el cliente escribió y
 * nadie le contestó— pero en modo libre se reporta, no rompe. Ver `libre.js`.
 */
const ESPERA_RESPUESTA_MS = 60_000;

/**
 * @param {object} opts
 * @param {object} opts.proveedor   quién decide qué dice el cliente (ver arriba)
 * @param {object} opts.cliente     el de `arnes/cliente.js`: la puerta real (webhook firmado)
 * @param {object} opts.graph       el Graph falso: el teléfono por donde llega la respuesta
 * @param {object} [opts.persona]   quién es este cliente
 * @param {string} [opts.objetivo]  qué quiere conseguir
 * @param {object} [opts.transcripcion]  para que la conversación quede en la línea de tiempo
 * @param {object} [opts.presupuesto]    para que el gasto del cliente se cuente aparte
 * @param {number} [opts.maxTurnos]
 * @param {number} [opts.esperaMs]
 * @param {(m: string) => void} [opts.registrar]
 */
export function crearClienteLibre({
  proveedor,
  cliente,
  graph,
  persona = PERSONA_POR_DEFECTO,
  objetivo = OBJETIVO_POR_DEFECTO,
  transcripcion = null,
  presupuesto = null,
  maxTurnos = MAX_TURNOS,
  esperaMs = ESPERA_RESPUESTA_MS,
  registrar = (m) => console.log(m),
}) {
  if (typeof proveedor?.turno !== 'function') {
    throw new Error(
      'crearClienteLibre: falta el proveedor. El cliente libre NO se escribe acá — se elige ' +
      'con ARNES_CLIENTE (agente | de-prueba). Ver actores/cliente/proveedor/.',
    );
  }
  if (typeof cliente?.decir !== 'function') throw new Error('crearClienteLibre: falta el cliente del webhook');
  if (typeof graph?.esperarMensaje !== 'function') throw new Error('crearClienteLibre: falta el Graph falso');

  /** La conversación como la ve el cliente: `vos` / `local`. Es lo único que ve. */
  const conversacion = [];
  /** Lo que el cliente marcó como raro, turno por turno. El entregable del modo. */
  const rarezas = [];
  /** Turnos donde el local no contestó. Se reportan, no rompen. */
  const silencios = [];

  let turnos = 0;
  let cierre = null; // { motivo, quien: 'cliente'|'techo'|'silencio' }

  /**
   * Corre la conversación entera y devuelve el reporte.
   *
   * El bucle es de una sola pieza a propósito: quién habla, cuándo se corta y
   * cómo se cuenta es una sola decisión y se lee entera.
   */
  async function conversar() {
    while (turnos < maxTurnos) {
      turnos += 1;

      const respuesta = await proveedor.turno({
        turno: turnos,
        topeDeTurnos: maxTurnos,
        persona,
        objetivo,
        conversacion: conversacion.map((c) => ({ ...c })),
      });

      presupuesto?.anotar('cliente', {
        costoUsd: respuesta.costoUsd ?? null,
        uso: respuesta.uso ?? null,
        cierraTurno: true,
      });

      if (respuesta.raro) {
        rarezas.push({ turno: turnos, que: respuesta.raro });
        registrar(`   🔎 turno ${turnos} — al cliente le resultó raro: ${respuesta.raro}`);
      }

      if (respuesta.terminar && !respuesta.texto) {
        cierre = { quien: 'cliente', motivo: respuesta.motivo || 'se fue sin decir por qué' };
        break;
      }

      // ── Habla el cliente ───────────────────────────────────────────────
      conversacion.push({ rol: 'vos', texto: respuesta.texto });
      transcripcion?.cliente(respuesta.texto);
      registrar(`   👤 ${respuesta.texto}`);

      const desde = graph.cantidad;
      await cliente.decir(respuesta.texto);

      // ── Contesta el local ──────────────────────────────────────────────
      let recibidos = [];
      try {
        await graph.esperarMensaje({ telefono: cliente.telefono, desde, timeoutMs: esperaMs });
        recibidos = graph.recibidos({ telefono: cliente.telefono }).filter((m) => m.indice >= desde);
      } catch (err) {
        // El cliente escribió y nadie le contestó. Es un hallazgo sobre el
        // producto y **no rompe**: en modo libre nada rompe. Que quede escrito
        // con el turno y el texto es lo que permite escribir después el
        // escenario en modo `guion` que sí va a romper.
        silencios.push({ turno: turnos, texto: respuesta.texto, detalle: err.message });
        registrar(`   ⚠ turno ${turnos} — el local no contestó en ${Math.round(esperaMs / 1000)}s`);
        cierre = { quien: 'silencio', motivo: 'el local dejó de contestar' };
        break;
      }

      for (const m of recibidos) {
        const texto = textoDe(m);
        conversacion.push({ rol: 'local', texto });
        transcripcion?.recibido(m);
        registrar(`   🤖 ${texto}`);
      }

      if (respuesta.terminar) {
        cierre = { quien: 'cliente', motivo: respuesta.motivo || 'consiguió lo que quería' };
        break;
      }
    }

    if (!cierre) {
      // El techo. NO es una falla: es el final normal de una conversación que
      // no cerró sola, y llamarlo falla sería el primer paso para que alguien
      // "arregle" el modo libre subiéndole el número.
      cierre = { quien: 'techo', motivo: `se llegó al techo de ${maxTurnos} turnos` };
    }

    return reporte();
  }

  function reporte() {
    return {
      /** Quién hizo de cliente, y si eso improvisa de verdad. Va en toda salida. */
      proveedor: proveedor.nombre ?? 'sin-nombre',
      improvisa: proveedor.improvisa === true,
      persona,
      objetivo,
      turnos,
      maxTurnos,
      cierre,
      conversacion,
      /** Los candidatos a escenario. El entregable del modo libre. */
      rarezas,
      silencios,
    };
  }

  return {
    nombre: 'cliente-libre',
    get turnos() { return turnos; },
    get conversacion() { return conversacion.map((c) => ({ ...c })); },
    conversar,
    reporte,
    async cerrar() {
      await proveedor.cerrar?.();
    },
  };
}

/**
 * Traduce lo que recibió el Graph falso a lo que el cliente "leyó".
 *
 * Una plantilla no la lee nadie como plantilla: en el teléfono se ve el texto
 * ya armado. Si un día el aviso proactivo llega como plantilla, el cliente
 * libre tiene que poder seguir la conversación igual, no quedarse mudo porque
 * `texto` vino en `null`.
 */
function textoDe(mensaje) {
  if (mensaje?.texto) return mensaje.texto;
  if (mensaje?.plantilla) {
    const vars = (mensaje.variables ?? []).join(' · ');
    return `[${mensaje.plantilla}]${vars ? ` ${vars}` : ''}`;
  }
  return '(el local mandó algo que este teléfono no supo mostrar)';
}

// ── La persona por defecto ───────────────────────────────────────────────────
//
// Es la del prototipado del 18/08, que es de donde salieron las correcciones
// que hoy son reglas del SKILL.md: alguien con hambre, apurado, que escribe
// como escribe la gente. No es "un usuario"; es este.

export const PERSONA_POR_DEFECTO = {
  quien_sos: 'Tenés 34 años, volvés del laburo en Mendoza, son las nueve de la noche y tenés hambre.',
  como_escribis:
    'Corto y al toque. Minúsculas, sin puntuación, con errores de tipeo que no corregís. ' +
    'Sos parco: no saludás de más ni explicás de más. Si algo no te cierra, lo decís de una.',
  que_sabes: 'Nunca pediste en este local. No conocés la carta ni los precios.',
};

export const OBJETIVO_POR_DEFECTO =
  'Querés cenar algo rápido y pasarlo a buscar vos. Tenés una idea vaga de lo que querés, ' +
  'no un pedido armado. Te decidís sobre la marcha con lo que te vayan diciendo.';

// ── Validación de la respuesta del proveedor ────────────────────────────────

/**
 * Valida y normaliza lo que devolvió el proveedor.
 *
 * Vive acá, exportada, porque los dos proveedores la usan y porque es la
 * definición ejecutable del protocolo: si esto no la acepta, la respuesta no
 * cumple, y punto. Todo lo que se rechaza es **arnés roto** (exit 2), nunca
 * hallazgo: un cliente que no habló porque el buzón se contestó mal no es un
 * cliente que se quedó sin qué decir.
 */
export function leerRespuestaDelCliente(crudo, pedido, donde) {
  const r = crudo ?? {};
  const problemas = [];

  if (r.protocolo && r.protocolo !== PROTOCOLO_CLIENTE) {
    problemas.push(`\`protocolo\` dice «${r.protocolo}» y este arnés habla «${PROTOCOLO_CLIENTE}»`);
  }
  if (r.turno !== undefined && Number(r.turno) !== Number(pedido.turno)) {
    problemas.push(`es la respuesta del turno ${r.turno} y se pidió la del ${pedido.turno}`);
  }
  if (r.texto !== undefined && r.texto !== null && typeof r.texto !== 'string') {
    problemas.push('`texto` tiene que ser un string (o faltar)');
  }
  if (r.terminar !== undefined && typeof r.terminar !== 'boolean') {
    problemas.push('`terminar` tiene que ser true o false');
  }

  const texto = typeof r.texto === 'string' ? r.texto.trim() : '';
  const terminar = r.terminar === true;
  if (!problemas.length && !texto && !terminar) {
    problemas.push('no trae `texto` y tampoco `terminar: true`: el cliente ni habló ni se fue');
  }

  if (problemas.length) {
    throw new ErrorArnes(
      `la respuesta del cliente libre al turno ${pedido.turno} no cumple el protocolo`,
      `archivo: ${donde}`,
      '',
      ...problemas.map((p) => `  · ${p}`),
      '',
      'Esto es arnés roto, no un hallazgo: el turno nunca se llegó a decir, así que no hay',
      'nada que mirar del producto. Corregí el archivo y volvé a correr.',
    );
  }

  return {
    texto,
    terminar,
    motivo: typeof r.motivo === 'string' && r.motivo.trim() ? r.motivo.trim() : null,
    raro: typeof r.raro === 'string' && r.raro.trim() ? r.raro.trim() : null,
    uso: r.uso ?? null,
    costoUsd: typeof r.costo_usd === 'number' ? r.costo_usd : null,
  };
}
