/**
 * presupuesto.js — qué gastó la corrida, y **qué no se sabe**.
 *
 * ── El cambio que obliga a escribir esto con cuidado ─────────────────────────
 * El design §10 daba por hecho que el `result` del stream del SDK trae uso y
 * costo, porque el bot iba por la API de Anthropic. **Ya no va** (design §1,
 * reescrita durante el apply): con el proveedor `agente`, los turnos los sirve
 * un agente Claude por el buzón, y ese agente **no reporta un costo en
 * dólares**. Con el proveedor `guion` directamente no corre ningún modelo.
 *
 * O sea que hay tres estados distintos y el arnés tiene que distinguirlos:
 *
 *   | Situación                     | Qué se reporta                            |
 *   |-------------------------------|-------------------------------------------|
 *   | `guion`, sin modelo           | `usd: null` — «no corrió ningún modelo»   |
 *   | `agente`, sin costo reportado | `usd: null` — «un agente, sin precio»     |
 *   | alguien reportó un costo      | `usd: <número>` y el desglose por actor   |
 *
 * Los dos primeros NO son cero: son "no hay factura", por motivos distintos.
 *
 * **Por qué esto importa y no es puntillismo:** `$0.00` se lee como *"salió
 * gratis"*. Si en realidad quiere decir *"no sé cuánto salió"*, el arnés está
 * mintiendo sobre lo único que el design §10 le pidió que no mienta — *"«cuesta
 * plata» sin número es una objeción que no se puede responder ni administrar"*.
 * Un cero inventado es peor que un "no sé", porque el "no sé" se puede
 * administrar y el cero falso se cree.
 *
 * Lo que **sí** se puede contar siempre, y por eso es la unidad principal ahora:
 *   - **turnos** por actor (bot / cliente / juez),
 *   - **pasos** del bot dentro de un turno (cada ida y vuelta con las tools),
 *   - **tokens**, cuando el proveedor los informa.
 *
 * ── Quién cuenta esto en voz alta ───────────────────────────────────────────
 * **Imprimir no es trabajo de acá.** El desglose de gasto de una corrida lo
 * arma `informe.js` a partir de lo que el runner le pasa con
 * `bitacora.gasto({ actor, usd, tokens, nota })`, y ahí `usd: null` ya sale
 * como *"sin costo real — lo sirvió un agente leyendo el SKILL.md"*. Este
 * módulo **acumula y corta**; `informe()` de acá queda para el mensaje del
 * corte, que tiene que poder explicarse solo cuando la corrida se muere a mitad
 * de camino y no llega a haber informe.
 *
 * Lo que sí tiene que viajar de acá para allá es la distinción de los tres
 * ceros: `estado().costoConocido` es lo que le dice al runner si mandar un
 * número o un `null`. Mandar `0` porque "total, no gastó" es exactamente el bug
 * que este archivo existe para no cometer.
 *
 * ── Cortar por presupuesto es ARNÉS ROTO, no producto roto ───────────────────
 * Se corta con exit 2 (design §15). Si el arnés se quedó sin plata a mitad de
 * una conversación, **no llegó a preguntarle nada al producto**: no tiene
 * veredicto que dar. Confundirlo con un rojo es cómo se entrena a la gente a
 * desconfiar del rojo.
 */

import { ErrorArnes } from './entorno.js';

/** Los tres que gastan. El juez y el cliente libre llegan en los grupos 5 y 7. */
export const ACTORES = ['bot', 'cliente', 'juez'];

/**
 * @param {object} [opts]
 * @param {number} [opts.topeUsd]      techo de gasto; `0` o `NaN` = sin techo
 * @param {string} [opts.proveedorBot] `guion` | `agente` — decide cómo se lee el cero
 */
export function crearPresupuesto({ topeUsd = 1.0, proveedorBot = 'guion' } = {}) {
  /** @type {Record<string, {turnos:number, pasos:number, entrada:number, salida:number, usd:number, conCosto:number, conTokens:number}>} */
  const porActor = {};
  for (const actor of ACTORES) porActor[actor] = nuevo();

  const tope = Number.isFinite(topeUsd) && topeUsd > 0 ? topeUsd : null;

  function nuevo() {
    return { turnos: 0, pasos: 0, entrada: 0, salida: 0, usd: 0, conCosto: 0, conTokens: 0 };
  }

  /**
   * Anota un turno (o un paso de un turno) de un actor.
   *
   * `costoUsd` y `uso` se aceptan como `null`/`undefined` **a propósito**: eso
   * es lo que va a llegar del proveedor `agente`, y tratarlo como `0` es
   * exactamente el bug que este archivo existe para no cometer. Un `null` suma
   * un paso y no suma un peso; sólo un número suma plata y marca `conCosto`.
   *
   * @param {'bot'|'cliente'|'juez'} actor
   * @param {object} [p]
   * @param {number|null} [p.costoUsd]
   * @param {{input_tokens?:number, output_tokens?:number}|null} [p.uso]
   * @param {boolean} [p.cierraTurno]  true = este paso cerró un turno del actor
   */
  function anotar(actor, { costoUsd = null, uso = null, cierraTurno = true } = {}) {
    const a = porActor[actor];
    if (!a) throw new Error(`presupuesto: actor desconocido «${actor}» (esperaba ${ACTORES.join('|')})`);

    a.pasos += 1;
    if (cierraTurno) a.turnos += 1;

    if (typeof costoUsd === 'number' && Number.isFinite(costoUsd)) {
      a.usd += costoUsd;
      a.conCosto += 1;
    }
    const entrada = Number(uso?.input_tokens);
    const salida = Number(uso?.output_tokens);
    if (Number.isFinite(entrada) || Number.isFinite(salida)) {
      a.entrada += Number.isFinite(entrada) ? entrada : 0;
      a.salida += Number.isFinite(salida) ? salida : 0;
      a.conTokens += 1;
    }

    verificar();
    return estado();
  }

  /** Lo gastado y —lo que más importa— si ese número quiere decir algo. */
  function estado() {
    const usd = ACTORES.reduce((s, a) => s + porActor[a].usd, 0);
    const conCosto = ACTORES.reduce((s, a) => s + porActor[a].conCosto, 0);
    const pasos = ACTORES.reduce((s, a) => s + porActor[a].pasos, 0);
    return {
      usd,
      /** ¿Algún paso reportó un costo real? Si no, `usd` es 0 por ignorancia. */
      costoConocido: conCosto > 0,
      /** Cuántos pasos hubo sin costo reportado: es el tamaño de lo que no se sabe. */
      pasosSinCosto: pasos - conCosto,
      pasos,
      tope,
      porActor: Object.fromEntries(ACTORES.map((a) => [a, { ...porActor[a] }])),
    };
  }

  /**
   * Corta la corrida si se pasó del techo. Con costo desconocido no puede
   * cortar y **eso también hay que decirlo**: el techo no está protegiendo
   * nada, y creer que sí es peor que saber que no.
   */
  function verificar() {
    if (!tope) return;
    const e = estado();
    if (!e.costoConocido) return;
    if (e.usd <= tope) return;
    throw new ErrorArnes(
      `ARNÉS CORTADO POR PRESUPUESTO: se gastó ${plata(e.usd)} y el tope es ${plata(tope)}`,
      '',
      ...lineasDeDesglose(e, proveedorBot),
      '',
      'Cortar por presupuesto NO es una falla del producto: la corrida no llegó a',
      'terminar de preguntar, así que no hay veredicto. Subí ARNES_TOPE_USD o achicá',
      'el escenario, y volvé a correr.',
    );
  }

  /**
   * El desglose en texto. En una corrida normal esto NO se imprime —lo hace
   * `informe.js` con lo que le llega por `bitacora.gasto`—; queda para el
   * mensaje del corte por presupuesto, que pasa antes de que haya informe.
   */
  function informe() {
    return lineasDeDesglose(estado(), proveedorBot).join('\n');
  }

  /**
   * Lo que hay que pasarle a `bitacora.gasto({...})`, por actor.
   *
   * **Nunca manda `0`.** Un número, cualquier número, se imprime como
   * `US$0.0000` y eso se lee *"salió gratis"*: dice que hubo una llamada que
   * costó cero, que es falso en los dos casos que existen hoy. Con `usd: null`
   * el informe imprime *"sin costo real — <nota>"* y la nota cuenta cuál de los
   * dos casos es:
   *
   *   `guion`   no corrió ningún modelo: las respuestas estaban escritas.
   *   `agente`  corrió un agente leyendo el SKILL.md, que no informa precio.
   *
   * Los dos son "no hay factura", por motivos distintos, y ninguno es cero.
   * Sólo se manda un número cuando alguien reportó uno de verdad.
   */
  function gastos() {
    const e = estado();
    return ACTORES
      .filter((actor) => e.porActor[actor].pasos > 0)
      .map((actor) => {
        const a = e.porActor[actor];
        return {
          actor,
          usd: a.conCosto ? a.usd : null,
          tokens: a.conTokens ? { entrada: a.entrada, salida: a.salida } : null,
          nota: a.conCosto
            ? null
            : (proveedorBot === 'guion'
              ? `${a.turnos} turno(s) con respuestas fijas (ARNES_BOT=guion): no corrió ningún modelo`
              : `${a.turnos} turno(s) en ${a.pasos} pasos — lo sirvió un agente leyendo agente/skills/gastronomia/SKILL.md, que no informa precio`),
        };
      });
  }

  return { anotar, estado, verificar, informe, gastos, get tope() { return tope; } };
}

// ── Cómo se cuenta esto en voz alta ─────────────────────────────────────────

function plata(n) {
  return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
}

function miles(n) {
  return n.toLocaleString('es-AR');
}

/**
 * El renglón que decide si el arnés miente o no.
 *
 * Tres casos, tres frases distintas. La del medio es la que no existía en el
 * design y es la que hace falta ahora.
 */
function lineaDelCosto(e, proveedorBot) {
  if (e.costoConocido) {
    const parcial = e.pasosSinCosto
      ? ` (${e.pasosSinCosto} de ${e.pasos} pasos no reportaron costo: el total es un piso, no el total)`
      : '';
    return `  costo: ${plata(e.usd)}${parcial}`;
  }
  if (proveedorBot === 'guion') {
    return '  costo: $0.00 — y es un cero de verdad: con ARNES_BOT=guion no corre ningún modelo';
  }
  return (
    `  costo: NO SE SABE — ninguno de los ${e.pasos} paso${e.pasos === 1 ? '' : 's'} reportó costo en dólares.\n` +
    '         El proveedor `agente` sirve los turnos desde un agente Claude, que no\n' +
    '         informa precio. NO se imprime $0.00 porque eso se lee como "salió gratis"\n' +
    '         cuando lo que pasa es que no hay número. Lo que sí se sabe está abajo.'
  );
}

function lineasDeDesglose(e, proveedorBot) {
  const lineas = [`── Presupuesto de la corrida (proveedor de bot: ${proveedorBot})`];
  lineas.push(lineaDelCosto(e, proveedorBot));

  if (e.tope) {
    lineas.push(
      e.costoConocido
        ? `  tope:  ${plata(e.tope)} (ARNES_TOPE_USD)`
        : `  tope:  ${plata(e.tope)} (ARNES_TOPE_USD) — sin costo reportado NO puede cortar: hoy no protege nada`,
    );
  } else {
    lineas.push('  tope:  sin techo (ARNES_TOPE_USD=0)');
  }

  // Lo que siempre se puede contar. Con `agente` esta es LA unidad: si un
  // cambio en el SKILL.md duplica los pasos por conversación, se ve acá.
  for (const actor of ACTORES) {
    const a = e.porActor[actor];
    if (!a.pasos) continue;
    const partes = [`${a.turnos} turno${a.turnos === 1 ? '' : 's'}`];
    if (a.pasos !== a.turnos) partes.push(`${a.pasos} pasos con tools`);
    if (a.conTokens) {
      partes.push(`${miles(a.entrada)} tok entrada · ${miles(a.salida)} tok salida`);
    } else {
      partes.push('tokens: no reportados');
    }
    if (a.conCosto) partes.push(plata(a.usd));
    lineas.push(`  ${actor.padEnd(7)} ${partes.join(' · ')}`);
  }

  return lineas;
}
