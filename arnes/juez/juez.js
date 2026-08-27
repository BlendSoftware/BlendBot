/**
 * juez.js — el nivel 3 del arnés: tres veredictos, mayoría, cita verificada.
 *
 * ── Lo que este archivo garantiza, y lo que no ───────────────────────────────
 *
 * GARANTIZA:
 *   · **Ciego.** El juez recibe la regla y la transcripción, y nada sobre lo
 *     que se esperaba (`protocolo.js`).
 *   · **Transcripción fija.** Los tres veredictos miran exactamente el mismo
 *     texto. No se vuelve a hablar con el bot para desempatar.
 *   · **Mayoría de 2 sobre 3.** Un veredicto solo es ruido barato de comprar.
 *   · **Cita verificada.** Una condena sin prueba en el texto del asistente se
 *     descarta, y si se descartan todas la regla queda `no_evaluable` →
 *     **arnés roto para esa regla**, jamás falla del producto.
 *   · **Caso negativo obligatorio.** Ninguna regla dura rompe la corrida sin
 *     haber demostrado antes, en esta misma corrida, que el juez condena su
 *     violación de ejemplo. Es lo único que detecta a un juez indulgente, que
 *     es la falla silenciosa y por eso la peor.
 *   · **Cuarentena manual.** Una regla aislada se evalúa y se reporta igual.
 *
 * NO GARANTIZA — y hay que decirlo fuerte:
 *   · **Que el juez corra sobre un modelo distinto del bot.** El spec lo pide
 *     ("El juez es un modelo distinto del bot, pinneado"). Con el bot servido
 *     por un agente Claude y el juez servido por otro agente Claude, el arnés
 *     no puede leer ni fijar el modelo de ninguno de los dos, así que **no lo
 *     garantiza**. Lo dice en `metadatos().independenciaDeModelo` y la salida
 *     de la corrida lo tiene que imprimir.
 *     Consecuencia concreta, sin maquillaje: si el modelo cree que "ya sale" no
 *     es prometer una demora, lo cree las dos veces —como bot y como juez— y R2
 *     nunca dispara. El caso negativo de cada regla es lo único que se
 *     interpone, y por eso es obligatorio.
 *     El modo `api` (`servidores/api.js`) sí garantiza la independencia, y ese
 *     es el día que este párrafo se borra.
 */

import { ErrorArnes } from '../entorno.js';
import { armarPedido, validarVeredicto } from './protocolo.js';
import { verificarCita } from './cita.js';
import { huella, revisarReglas } from './reglas/index.js';
import { enCuarentena, vigentes } from './cuarentena.js';

/** Tres. El spec lo fija y no es configurable por capricho. */
export const VEREDICTOS_POR_REGLA = 3;

/**
 * @typedef {object} Servidor  quien efectivamente juzga
 * @property {string} modo     `agente` | `api` | `de-prueba`
 * @property {string} modelo   la versión exacta, o por qué no se conoce
 * @property {{garantizada: boolean, motivo: string}} independenciaDeModelo
 * @property {(pedido: import('./protocolo.js').Pedido) => Promise<any>} servir
 */

/**
 * @param {object} opts
 * @param {Servidor} opts.servidor
 * @param {boolean} [opts.exigirCalibracion]  default true. Ver más abajo
 */
export function crearJuez({ servidor, exigirCalibracion = true }) {
  if (typeof servidor?.servir !== 'function') {
    throw new ErrorArnes('el juez no tiene con qué juzgar: falta `servidor.servir`');
  }

  const problemas = revisarReglas();
  if (problemas.length) {
    // Una regla mal escrita —una obligación de estilo colada como prohibición,
    // o una sin caso negativo— es arnés roto, no producto roto. Y se ve antes
    // de gastar el primer veredicto.
    throw new ErrorArnes('hay reglas mal escritas', ...problemas.map((p) => `· ${p}`));
  }

  /** reglaId → { confiable, huella, veredictos } */
  const confiabilidad = new Map();

  /** Los tres veredictos de una regla sobre una transcripción, ya verificados. */
  async function pedirTres(regla, transcripcion, hechos) {
    const veredictos = [];
    for (let i = 0; i < VEREDICTOS_POR_REGLA; i += 1) {
      // Un pedido NUEVO por veredicto: id distinto, y ninguno sabe de los
      // otros. Si compartieran el pedido, el segundo podría ver el primero.
      const pedido = armarPedido(regla, transcripcion, hechos);
      let crudo;
      try {
        crudo = await servidor.servir(pedido);
      } catch (err) {
        veredictos.push({
          n: i + 1, valido: false, veredicto: null, cita: null, turno: null,
          motivoDescarte: `el juez no contestó: ${err?.message || err}`,
        });
        continue;
      }

      const forma = validarVeredicto(crudo);
      if (!forma.ok) {
        veredictos.push({
          n: i + 1, valido: false, veredicto: null, cita: null, turno: null,
          motivoDescarte: forma.motivo, crudo,
        });
        continue;
      }

      const v = forma.veredicto;
      if (v.veredicto === 'no_viola') {
        veredictos.push({
          n: i + 1, valido: true, veredicto: 'no_viola', cita: null, turno: null,
          motivo: v.motivo,
        });
        continue;
      }

      // Condena: la prueba se verifica contra el texto. Ésta es la regla de oro.
      const prueba = verificarCita(v.cita, v.turno, transcripcion);
      if (!prueba.ok) {
        veredictos.push({
          n: i + 1, valido: false, veredicto: 'viola', cita: v.cita, turno: v.turno,
          motivoDescarte: prueba.motivo, motivo: v.motivo,
        });
        continue;
      }
      veredictos.push({
        n: i + 1, valido: true, veredicto: 'viola',
        cita: prueba.textual, turno: prueba.turno,
        turnoCorregido: Boolean(prueba.turnoCorregido),
        motivo: v.motivo,
      });
    }
    return veredictos;
  }

  /**
   * Resuelve los tres veredictos en un resultado.
   *
   * Las cuentas, escritas para que se puedan discutir:
   *   · **condenas válidas ≥ 2** → `viola`. "Válida" quiere decir con cita que
   *     aparece en un mensaje del asistente. Una condena sin prueba NO suma
   *     para la mayoría (spec: "dos o tres veredictos condenan **con cita**").
   *   · si quedan **menos de 2 veredictos utilizables** → `no_evaluable`, o sea
   *     arnés roto para esta regla. No hay veredicto sobre el producto.
   *   · si no → `no_viola`. Si hubo una condena válida suelta, queda anotada
   *     como **disidencia**: una regla que empieza a discrepar seguido es una
   *     regla mal escrita, y sólo se ve si se guarda.
   */
  function resolver(veredictos) {
    const utilizables = veredictos.filter((v) => v.valido);
    const condenas = utilizables.filter((v) => v.veredicto === 'viola');
    const descartados = veredictos.filter((v) => !v.valido);

    if (condenas.length >= 2) {
      return {
        resultado: 'viola',
        proporcion: `${condenas.length}/${VEREDICTOS_POR_REGLA}`,
        cita: { textual: condenas[0].cita, turno: condenas[0].turno },
        disidencia: utilizables.length - condenas.length,
        descartados: descartados.length,
      };
    }
    if (utilizables.length < 2) {
      return {
        resultado: 'no_evaluable',
        proporcion: `${utilizables.length}/${VEREDICTOS_POR_REGLA} utilizables`,
        cita: null,
        disidencia: 0,
        descartados: descartados.length,
        motivo: descartados.map((d) => d.motivoDescarte).join(' · ') || 'el juez no dejó ningún veredicto utilizable',
      };
    }
    return {
      resultado: 'no_viola',
      proporcion: `${condenas.length}/${VEREDICTOS_POR_REGLA}`,
      cita: condenas[0] ? { textual: condenas[0].cita, turno: condenas[0].turno } : null,
      disidencia: condenas.length,
      descartados: descartados.length,
    };
  }

  /**
   * Calibración: cada regla contra **su caso negativo**, la transcripción de
   * ejemplo que sí la viola. El juez tiene que condenarla.
   *
   * Si la perdona, la regla queda **no confiable**: no rompe nada aunque
   * condene, y un escenario que la tenía en verde NO la cuenta como verificada
   * (spec "El juez perdona el caso negativo"). Un verde que salió de un juez
   * que nunca condena es peor que no tener juez, porque además da tranquilidad.
   *
   * `cache` permite reusar la calibración de una corrida anterior, pero sólo si
   * coincide la **huella de la regla** y el modelo del juez: editar el
   * enunciado invalida la calibración, que es lo que tiene que pasar.
   *
   * @param {object} [opts]
   * @param {import('./reglas/index.js').Regla[]} [opts.reglas]
   * @param {object} [opts.cache]  lo que devolvió una calibración anterior
   * @param {(linea: string) => void} [opts.avisar]
   */
  async function calibrar({ reglas, cache = null, avisar = () => {} } = {}) {
    const lista = reglas || (await import('./reglas/index.js')).REGLAS;
    const entradas = [];

    for (const regla of lista) {
      const h = huella(regla);
      const previa = cache?.entradas?.find(
        (e) => e.regla === regla.id && e.huella === h && e.modeloJuez === servidor.modelo,
      );
      if (previa) {
        confiabilidad.set(regla.id, { confiable: previa.confiable, huella: h, reusada: true });
        entradas.push({ ...previa, reusada: true });
        continue;
      }

      const caso = regla.casoNegativo;
      avisar(`calibrando ${regla.id} contra su caso negativo: ${caso.descripcion}`);
      const veredictos = await pedirTres(regla, caso.transcripcion, caso.hechos || []);
      const res = resolver(veredictos);
      const confiable = res.resultado === 'viola';

      confiabilidad.set(regla.id, { confiable, huella: h, reusada: false });
      entradas.push({
        regla: regla.id,
        titulo: regla.titulo,
        huella: h,
        modeloJuez: servidor.modelo,
        modoJuez: servidor.modo,
        fecha: new Date().toISOString(),
        confiable,
        proporcion: res.proporcion,
        // Cuando el juez perdona su propio caso negativo, lo que hay que leer
        // es POR QUÉ lo perdonó. Ahí está si la regla está mal escrita o si el
        // juez es un colador.
        veredictos: veredictos.map(limpiar),
      });
    }

    return { modeloJuez: servidor.modelo, modoJuez: servidor.modo, entradas };
  }

  /**
   * Evalúa un conjunto de reglas sobre UNA transcripción ya fija.
   *
   * @param {object} opts
   * @param {import('./reglas/index.js').Regla[]} opts.reglas
   * @param {import('./protocolo.js').Turno[]} opts.transcripcion
   * @param {string[]} [opts.hechos]  los hechos neutros que las reglas piden
   * @returns {Promise<ResultadoRegla[]>}
   */
  async function evaluar({ reglas, transcripcion, hechos = [] }) {
    if (exigirCalibracion) {
      const sinCalibrar = reglas.filter((r) => !confiabilidad.has(r.id));
      if (sinCalibrar.length) {
        throw new ErrorArnes(
          `hay reglas sin calibrar: ${sinCalibrar.map((r) => r.id).join(', ')}`,
          'Una regla que no demostró que el juez condena su caso negativo no puede poner nada en rojo',
          'ni en verde: un juez indulgente daría verde para siempre y nadie se enteraría.',
          '',
          'Corré `juez.calibrar()` antes de `juez.evaluar()`, o pasá `exigirCalibracion: false`',
          'sabiendo que ninguna regla va a romper la corrida.',
        );
      }
    }

    const resultados = [];
    for (const regla of reglas) {
      const veredictos = await pedirTres(regla, transcripcion, hechos);
      const res = resolver(veredictos);
      const cal = confiabilidad.get(regla.id) || { confiable: null };
      const aislada = enCuarentena(regla.id);

      // Rompe SÓLO si: es de las seis duras del SKILL, la mayoría condenó con
      // prueba, la regla demostró ser confiable, y nadie la puso en cuarentena.
      const rompe = Boolean(
        regla.dura && res.resultado === 'viola' && cal.confiable === true && !aislada,
      );

      // `verificada` es lo que un escenario puede contar como protegido. Una
      // regla en verde con el juez sin calibrar, o con el caso negativo
      // perdonado, NO cuenta: el verde no significa nada.
      const verificada = res.resultado !== 'no_evaluable' && cal.confiable === true;

      resultados.push({
        regla: {
          id: regla.id, titulo: regla.titulo, origen: regla.origen, dura: regla.dura,
        },
        resultado: res.resultado,
        proporcion: res.proporcion,
        cita: res.cita,
        motivo: res.motivo,
        disidencia: res.disidencia,
        descartados: res.descartados,
        confiable: cal.confiable,
        cuarentena: aislada,
        rompe,
        verificada,
        // Un veredicto que no se pudo verificar es el arnés, no el producto
        // (design §15: "el juez no devolvió cita" → exit 2).
        arnesRoto: res.resultado === 'no_evaluable',
        veredictos: veredictos.map(limpiar),
      });
    }
    return resultados;
  }

  return {
    calibrar,
    evaluar,

    /**
     * Lo que la salida de la corrida tiene que imprimir sobre el juez (tarea
     * 4.6 del grupo de salida). Incluye el hueco: quien lea la corrida tiene
     * que poder saber si la independencia de modelo estuvo garantizada.
     */
    metadatos() {
      return {
        modo: servidor.modo,
        modelo: servidor.modelo,
        veredictosPorRegla: VEREDICTOS_POR_REGLA,
        independenciaDeModelo: servidor.independenciaDeModelo,
        cuarentenaVigente: vigentes().map((e) => ({ regla: e.regla, motivo: e.motivo, desde: e.desde })),
        confiabilidad: [...confiabilidad.entries()].map(([id, c]) => ({
          regla: id, confiable: c.confiable, reusada: Boolean(c.reusada),
        })),
      };
    },
  };
}

/**
 * El objeto que va a `veredictos.json` (tarea 5.5). Lo escribe el grupo de la
 * salida; acá se arma para que los tres veredictos queden guardados enteros,
 * **no sólo el resultado**: una regla que empieza a discrepar seguido sólo se
 * detecta si se guardó la discrepancia.
 */
export function informeDeVeredictos({ escenario, metadatos, resultados }) {
  return {
    escenario,
    juez: metadatos,
    reglas: resultados,
    resumen: resumir(resultados),
  };
}

/** @param {ResultadoRegla[]} resultados */
export function resumir(resultados) {
  return {
    evaluadas: resultados.length,
    violadas: resultados.filter((r) => r.resultado === 'viola').length,
    rompen: resultados.filter((r) => r.rompe).map((r) => r.regla.id),
    noEvaluables: resultados.filter((r) => r.arnesRoto).map((r) => r.regla.id),
    noConfiables: resultados.filter((r) => r.confiable === false).map((r) => r.regla.id),
    enCuarentena: resultados.filter((r) => r.cuarentena).map((r) => r.regla.id),
    conDisidencia: resultados.filter((r) => r.resultado === 'no_viola' && r.disidencia > 0)
      .map((r) => r.regla.id),
  };
}

/** Sin el `crudo`, que puede ser un texto largo y no aporta a la lectura. */
function limpiar(v) {
  const { crudo, ...resto } = v;
  return crudo === undefined ? resto : { ...resto, crudo: String(crudo).slice(0, 400) };
}

/**
 * @typedef {object} ResultadoRegla
 * @property {{id: string, titulo: string, origen: string, dura: boolean}} regla
 * @property {'viola'|'no_viola'|'no_evaluable'} resultado
 * @property {string} proporcion       "2/3"
 * @property {{textual: string, turno: number}|null} cita
 * @property {number} disidencia
 * @property {number} descartados
 * @property {boolean|null} confiable  del caso negativo
 * @property {object|null} cuarentena
 * @property {boolean} rompe           si rotula la corrida como PRODUCTO
 * @property {boolean} verificada      si el escenario puede contarla como protegida
 * @property {boolean} arnesRoto       si no hubo veredicto utilizable
 * @property {object[]} veredictos     los tres, enteros
 */
