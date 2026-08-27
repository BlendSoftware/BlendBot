/**
 * El informe de una corrida: la fachada que usa el runner.
 *
 *   import { crearInforme } from './informe.js';
 *
 *   const informe = crearInforme({
 *     modelos: { bot: 'claude-…', juez: 'claude-…' },
 *     duenoModo: 'api',
 *     topeUsd: 1,
 *   });
 *
 *   const b = informe.escenario({ escenario: 'pedido-feliz', etiquetas: ['@rapido'], corrida });
 *   …                                  // ver arnes/informe/bitacora.js
 *   await informe.cerrarEscenario(b);  // escribe artefactos e imprime el bloque
 *
 *   process.exit(await informe.cerrar());
 *
 * Lo que decide, y por qué decide así:
 *
 * **1. Exit 1 (PRODUCTO) y exit 2 (ARNÉS ROTO) nunca se mezclan.** Rompen el
 * producto: una aserción de nivel 1 o 2, y una regla dura del nivel 3 condenada
 * con cita verificada. Rompen el arnés: cualquier `ErrorArnes` (falta una
 * credencial, el compose caído, sin `uv`, corte por presupuesto) y **todo
 * veredicto condenatorio sin cita**, que se descarta y marca esa regla como no
 * evaluable. Un arnés que dice rojo cuando en realidad se quedó sin una
 * dependencia entrena a desconfiar del rojo, y ese día el arnés murió.
 *
 * **2. Si pasan las dos cosas, gana el exit 2 — pero las fallas del producto se
 * imprimen igual.** Una corrida incompleta no se puede firmar: no sabemos qué
 * hubiera dicho lo que no llegó a correr, así que no se puede rotular
 * "PRODUCTO" como si el veredicto estuviera completo. Pero lo determinista que
 * ya falló, falló, y esconderlo sería la misma mentira al revés. Entonces se
 * imprimen las dos secciones y el cartel dice cuál es cuál. (El design §15 no
 * fija la precedencia; esta es la lectura conservadora: nunca acusar al
 * producto desde una corrida que no terminó.)
 *
 * **3. El costo puede no existir, y eso no es cero.** Hoy el bot lo sirve un
 * agente leyendo el `SKILL.md`, no la API (design §1). Imprimir `$0.00` ahí
 * dice "salió gratis" cuando lo cierto es "no hay número". Se imprime **sin
 * costo real** con esas palabras.
 *
 * **4. Lo que no se cubrió se nombra con nombre y apellido** (tarea 3.8). La
 * corrida desatendida no puede afirmar lo que sólo el guión del dueño en Chrome
 * afirma, y lo dice al final, una por una, con dónde se cubre. Una omisión
 * silenciosa es una mentira; una que se anuncia es una tarea.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ErrorArnes, RAIZ } from './entorno.js';
import { ACTORES_DEL_GASTO, crearBitacora, resolverVeredicto } from './informe/bitacora.js';
import { renderTranscripcion, reloj } from './informe/transcripcion-md.js';
import {
  AMARILLO, AVISO, CARTELES, CRUZ, FIN, FLECHA, GRIS, MANO, NEGRITA, PAUSA, ROJO, TILDE, TOOL, VERDE,
  etiquetaActor, imprimirFalla, nota, pieDeNivel, titulo,
} from './informe/consola.js';

/** `20260826-2312-a3f9`. Ordena solo y no se repite entre corridas del mismo minuto. */
function idDeCorrida(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const sello = `${fecha.getFullYear()}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}-${p(fecha.getHours())}${p(fecha.getMinutes())}`;
  const azar = Math.random().toString(16).slice(2, 6);
  return `${sello}-${azar}`;
}

export function crearInforme({
  modelos = {},
  // Quién sirvió al bot y si eso alcanza para juzgarlo. Con el proveedor
  // `guion` las respuestas son fijas y comparten los puntos ciegos del prompt
  // por construcción: ese verde dice "el arnés funciona", NO "el bot está bien".
  // Un verde que no aclara con qué proveedor corrió es peor que no tener arnés.
  proveedorBot = null,
  juzgaAlBot = true,
  duenoModo = null,
  topeUsd = null,
  modo = 'guion',
  dirSalida = path.join(RAIZ, 'arnes', 'salida'),
  corridaId = idDeCorrida(),
  ahora = () => Date.now(),
  escribir = true,
} = {}) {
  const t0 = ahora();
  // Del mismo reloj que todo lo demás: si `ahora` está congelado (el ejemplo),
  // el archivo sale byte por byte igual y un cambio de formato se ve en un diff.
  const arranco = new Date(t0).toISOString();
  const dir = path.join(dirSalida, corridaId);
  const bitacoras = [];
  // El mapa turno → renglón de `transcripcion.md`, calculado una vez al cerrar
  // cada escenario. Sin esto habría que renderizar el markdown de nuevo para
  // saber dónde citar, y la cita saldría de un archivo distinto del que se
  // escribió: la clase de desfasaje que hace que `transcripcion.md:41` apunte a
  // cualquier lado.
  const lineasPorEscenario = new Map();
  // Un escenario donde el arnés no pudo terminar NO es un escenario verde. Que
  // se cuente aparte es lo que evita el peor renglón posible del resumen: un
  // "1 verde" en una corrida que no llegó a mirar.
  const escenariosRotos = new Set();
  const omitidasDeLaCorrida = [];
  const gastosDeLaCorrida = [];
  /** @type {ErrorArnes[]} */
  const roturas = [];

  const meta = () => ({
    corridaId,
    arranco,
    duenoModo,
    modo,
    modeloBot: modelos.bot || null,
    modeloJuez: modelos.juez || null,
  });

  function dirDe(bitacora) {
    return path.join(dir, bitacora.escenario.replace(/[^\w.@-]+/g, '-'));
  }

  function guardar(destino, contenido) {
    if (!escribir) return destino;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    return destino;
  }

  /** Ruta linda para imprimir: relativa a la raíz del repo. */
  const relativa = (p) => path.relative(RAIZ, p) || p;

  // ── Qué falló, y de quién es la culpa ──────────────────────────────────────

  /**
   * Traduce una bitácora a fallas del producto y roturas del arnés, ya con el
   * renglón exacto de la transcripción. Es el único lugar donde se decide de
   * quién es la culpa, y por eso está solo y se lee entero.
   */
  function juzgar(bitacora, lineaDeTurno) {
    const producto = [];
    const roto = [];
    let noEvaluables = 0;
    const reportadas = []; // se ven, no rompen: matiz, cuarentena, `rompe: false`
    const ubic = (n) => (n && lineaDeTurno.get(n) ? `transcripcion.md:${lineaDeTurno.get(n)}` : null);

    for (const a of bitacora.aserciones) {
      if (a.ok) continue;
      const falla = {
        escenario: bitacora.escenario,
        turno: a.turno,
        actor: a.actor,
        codigo: `N${a.nivel}`,
        frase: a.que,
        esperado: a.esperado,
        llego: a.llego,
        pie: pieDeNivel(a.nivel),
        ubicacion: ubic(a.turno),
        origen: a.origen,
        extra: a.dondeMirar,
      };
      if (a.rompe === false) reportadas.push({ ...falla, porQueNoRompe: 'declarada como reporte, no como corte' });
      else producto.push(falla);
    }

    for (const v of bitacora.veredictos) {
      const r = resolverVeredicto(v, bitacora.eventos);
      const turno = r.turno;
      const base = {
        escenario: bitacora.escenario,
        turno,
        actor: 'bot',
        codigo: v.regla,
        frase: v.texto,
        cita: r.cita,
        ubicacion: ubic(turno),
        origen: v.origen,
      };

      if (r.noEvaluable) {
        noEvaluables += 1;
        // Condena sin prueba: no se le cobra al producto. Se le cobra al arnés.
        roto.push(new ErrorArnes(
          `la regla ${v.regla} «${v.texto}» quedó no evaluable en ${bitacora.escenario}`,
          `  ${r.motivo} (${r.proporcion} condenaron)`,
          '  Una condena sin cita verificable no puede poner nada en rojo.',
          '  Mirá los tres votos en veredictos.json y revisá el prompt del juez.',
        ));
        continue;
      }

      if (!r.condena) {
        if (v.confiable === false) {
          reportadas.push({
            ...base,
            pie: `absuelta ${r.proporcion} — pero la regla es NO CONFIABLE`,
            porQueNoRompe: 'el juez perdonó su caso negativo: esta regla no cuenta como verificada',
          });
        }
        continue;
      }

      const pie = `juez: ${r.proporcion}`;
      if (v.cuarentena) {
        reportadas.push({ ...base, pie: `${pie} · en cuarentena`, porQueNoRompe: `en cuarentena: ${v.cuarentena}` });
      } else if (!v.dura) {
        reportadas.push({ ...base, pie: `${pie} · regla de matiz`, porQueNoRompe: 'no es de las innegociables del SKILL.md' });
      } else if (v.confiable === false) {
        reportadas.push({ ...base, pie: `${pie} · regla NO CONFIABLE`, porQueNoRompe: 'el juez perdonó su caso negativo: no se le cree la condena' });
      } else {
        producto.push({ ...base, pie });
      }
    }

    if (bitacora.roto_) roto.push(bitacora.roto_);
    return { producto, roto, reportadas, noEvaluables };
  }

  // ── Impresión de un escenario, en vivo ─────────────────────────────────────

  /**
   * Los dos turnos de alrededor de la falla, en la consola.
   *
   * Es a propósito: si para entender la falla hay que abrir un archivo, la
   * salida ya falló. El archivo está para el detalle, no para lo mínimo.
   */
  function imprimirContexto(bitacora, turno) {
    if (!turno) return;
    const desde = Math.max(1, turno - 1);
    console.log(`  ${GRIS}    ── el turno, en contexto ──${FIN}`);
    for (let n = desde; n <= turno; n += 1) {
      const e = bitacora.eventos[n - 1];
      if (!e) continue;
      const texto = String(e.texto || '').replace(/\s+/g, ' ');
      const recorte = texto.length > 180 ? `${texto.slice(0, 180)}…` : texto;
      const marca = n === turno ? `${ROJO}${FLECHA}${FIN}` : ' '.repeat(FLECHA.length);
      console.log(`  ${GRIS}    ${marca} ${GRIS}turno ${n} · ${reloj(e.ms)} · ${etiquetaActor(e.actor)}: ${recorte || '(sin texto)'}${FIN}`);
      for (const t of e.tools) {
        console.log(`  ${GRIS}        ${TOOL} ${t.nombre}(${resumirArgs(t.argumentos)})${FIN}`);
      }
      for (const g of e.gestos) console.log(`  ${GRIS}        ${MANO} ${g.que}${FIN}`);
    }
  }

  function resumirArgs(args) {
    if (args == null) return '';
    let texto;
    try { texto = JSON.stringify(args); } catch { return '…'; }
    return texto.length > 90 ? `${texto.slice(0, 90)}…` : texto;
  }

  // ── API ────────────────────────────────────────────────────────────────────

  const informe = {
    corridaId,
    dir,

    /** Abre la bitácora de un escenario. Ver `arnes/informe/bitacora.js`. */
    escenario(opciones) {
      const b = crearBitacora({ ...opciones, ahora });
      bitacoras.push(b);
      return b;
    },

    /**
     * Cierra un escenario: escribe sus artefactos e imprime su bloque.
     * @returns {{ producto: object[], roto: Error[], dir: string }}
     */
    async cerrarEscenario(bitacora) {
      bitacora.cerrar();
      const destino = dirDe(bitacora);
      const { texto, lineaDeTurno } = renderTranscripcion(bitacora, meta());
      lineasPorEscenario.set(bitacora, lineaDeTurno);
      guardar(path.join(destino, 'transcripcion.md'), texto);

      // El estado del core SIEMPRE deja archivo, incluso cuando no se capturó:
      // un archivo que dice por qué está vacío es una tarea; un archivo ausente
      // es un agujero que nadie mira.
      guardar(path.join(destino, 'estado-core.json'), `${JSON.stringify(
        bitacora.estado
          ? { capturado: true, escenario: bitacora.escenario, ...bitacora.estado }
          : {
            capturado: false,
            escenario: bitacora.escenario,
            motivo: bitacora.pendiente_
              ? `el escenario está pendiente: ${bitacora.pendiente_}`
              : (bitacora.motivoSinEstado || 'el escenario no lo capturó y no dijo por qué'),
          },
        null, 2,
      )}\n`);

      if (bitacora.veredictos.length) {
        guardar(path.join(destino, 'veredictos.json'), `${JSON.stringify(
          bitacora.veredictos.map((v) => ({ ...v, resuelto: resolverVeredicto(v, bitacora.eventos) })),
          null, 2,
        )}\n`);
      }

      // Todo lo crudo, para el día que el .md recorte justo lo que hacía falta.
      guardar(path.join(destino, 'crudo.json'), `${JSON.stringify({
        ...meta(),
        escenario: bitacora.escenario,
        etiquetas: bitacora.etiquetas,
        corrida: bitacora.corrida,
        duracionMs: bitacora.duracionMs,
        eventos: bitacora.eventos,
        aserciones: bitacora.aserciones,
        veredictos: bitacora.veredictos,
        omitidas: bitacora.omitidas,
        gastos: bitacora.gastos,
      }, null, 2)}\n`);

      const { producto, roto, reportadas, noEvaluables } = juzgar(bitacora, lineaDeTurno);

      // Trace SÓLO del turno que falló. Un trace de todos los turnos es un log,
      // y un log es lo que este arnés existe para no tener que leer.
      const turnosFallados = [...new Set(producto.map((f) => f.turno).filter(Boolean))];
      for (const n of turnosFallados) {
        const e = bitacora.eventos[n - 1];
        if (!e) continue;
        guardar(path.join(destino, `trace-turno-${n}.json`), `${JSON.stringify({
          escenario: bitacora.escenario,
          turno: n,
          renglonEnTranscripcion: lineaDeTurno.get(n) || null,
          evento: e,
          contexto: {
            anterior: bitacora.eventos[n - 2] || null,
            siguiente: bitacora.eventos[n] || null,
          },
          fallas: producto.filter((f) => f.turno === n),
        }, null, 2)}\n`);
      }

      // ── El bloque en pantalla ───────────────────────────────────────────
      const verdes = bitacora.aserciones.filter((a) => a.ok).length;
      const porNivel = [1, 2, 3]
        .map((n) => [n, bitacora.aserciones.filter((a) => a.nivel === n).length])
        .filter(([, cuantas]) => cuantas > 0)
        .map(([n, cuantas]) => `nivel ${n}: ${cuantas}`)
        .join(' · ');
      const condenadas = producto.filter((f) => !f.codigo.startsWith('N')).length;

      titulo(`${bitacora.escenario}${bitacora.etiquetas?.length ? ` ${bitacora.etiquetas.join(' ')}` : ''} · ${reloj(bitacora.duracionMs)}`);
      if (bitacora.pendiente_) {
        console.log(`  ${AMARILLO}${PAUSA} pendiente${FIN} — ${bitacora.pendiente_}`);
        return { producto: [], roto: [], dir: destino };
      }
      console.log(`  ${VERDE}${TILDE}${FIN} ${verdes} de ${bitacora.aserciones.length} aserciones${porNivel ? ` (${porNivel})` : ''}`);
      if (bitacora.veredictos.length) {
        const evaluadas = bitacora.veredictos.length - noEvaluables;
        console.log(condenadas
          ? `  ${ROJO}${CRUZ}${FIN} ${condenadas} de ${evaluadas} reglas del dicho rompen la corrida`
          : `  ${VERDE}${TILDE}${FIN} ${evaluadas} reglas del dicho, ninguna rompe`);
        if (noEvaluables) {
          console.log(`  ${AMARILLO}${AVISO}${FIN} ${noEvaluables} regla${noEvaluables === 1 ? '' : 's'} quedó sin poder evaluarse — abajo`);
        }
      }

      // El contexto se imprime UNA vez por turno: dos fallas del mismo turno
      // son dos líneas de falla, no dos copias de la misma conversación.
      const contextoImpreso = new Set();
      for (const falla of producto) {
        imprimirFalla(falla);
        if (falla.turno && !contextoImpreso.has(falla.turno)) {
          contextoImpreso.add(falla.turno);
          imprimirContexto(bitacora, falla.turno);
        }
      }
      for (const r of reportadas) {
        console.log(`  ${AMARILLO}!${FIN} ${r.escenario} · ${r.turno ? `turno ${r.turno} · ` : ''}${etiquetaActor(r.actor)} · ${r.codigo} «${r.frase}»`);
        if (r.cita) console.log(`  ${GRIS}    dijo: ${JSON.stringify(r.cita)}${FIN}`);
        console.log(`  ${GRIS}    no rompe — ${r.porQueNoRompe}${[r.pie, r.ubicacion].filter(Boolean).join(' · ') ? ` · ${[r.pie, r.ubicacion].filter(Boolean).join(' · ')}` : ''}${FIN}`);
      }
      if (roto.length) escenariosRotos.add(bitacora.escenario);
      for (const r of roto) {
        console.log(`  ${AMARILLO}${CRUZ} arnés${FIN} ${r.message}`);
        for (const pista of r.pistas || []) console.log(`  ${GRIS}  ${pista}${FIN}`);
        roturas.push(r);
      }
      nota(`artefactos: ${relativa(destino)}/`);

      return { producto, roto, dir: destino };
    },

    /**
     * Una aserción que TODA la corrida deja sin cubrir (tarea 3.8). La típica:
     * lo que sólo el guión del dueño en Chrome puede afirmar.
     */
    omitida({ que, porque, comoSeCubre = null, origen = null }) {
      omitidasDeLaCorrida.push({ que, porque, comoSeCubre, origen });
    },

    /** Gasto a nivel corrida (lo que reporta `presupuesto.js`). */
    gasto({ actor, usd = null, tokens = null, nota: aclaracion = null }) {
      gastosDeLaCorrida.push({ actor, usd, tokens, nota: aclaracion });
    },

    /**
     * El arnés se rompió: exit 2 y ningún veredicto sobre el producto.
     * Acepta cualquier error; lo que no es `ErrorArnes` se envuelve, porque un
     * error inesperado del andamio tampoco es culpa del producto.
     */
    romper(err) {
      const e = (err instanceof ErrorArnes || err?.arnesRoto)
        ? err
        : new ErrorArnes(`se cayó el andamio: ${err?.message || err}`, err?.stack ? [String(err.stack)] : []);
      roturas.push(e);
      return e;
    },

    /**
     * Cierra la corrida: resumen, cartel y exit code.
     * @returns {Promise<number>} 0 verde · 1 PRODUCTO · 2 ARNÉS ROTO
     */
    async cerrar() {
      const lineas = [];
      const di = (t = '') => lineas.push(t);

      const corridos = bitacoras.filter((b) => !b.pendiente_);
      const pendientes = bitacoras.filter((b) => b.pendiente_);
      const todasLasFallas = [];
      const todasReportadas = [];
      let sinEvaluar = 0;
      for (const b of corridos) {
        // Si el runner se olvidó de `cerrarEscenario`, el mapa no existe: se
        // recalcula y se sigue. Perder el número de renglón no puede ser motivo
        // de que la corrida no reporte.
        const lineaDeTurno = lineasPorEscenario.get(b)
          || renderTranscripcion(b, meta()).lineaDeTurno;
        const { producto, reportadas, noEvaluables } = juzgar(b, lineaDeTurno);
        todasLasFallas.push(...producto);
        todasReportadas.push(...reportadas);
        sinEvaluar += noEvaluables;
      }

      const aserciones = corridos.flatMap((b) => b.aserciones);
      const verdes = aserciones.filter((a) => a.ok).length;
      const escenariosRojos = new Set(todasLasFallas.map((f) => f.escenario));

      const porNivel = [1, 2, 3]
        .map((n) => [n, aserciones.filter((a) => a.nivel === n).length])
        .filter(([, cuantas]) => cuantas > 0)
        .map(([n, cuantas]) => `nivel ${n}: ${cuantas}`)
        .join(' · ');

      di('── Resumen ─────────────────────────────────────────────────────────────');
      const rotosNoRojos = [...escenariosRotos].filter((e) => !escenariosRojos.has(e)).length;
      const enVerde = corridos.length - escenariosRojos.size - rotosNoRojos;
      di(`  escenarios: ${enVerde} ${pl(enVerde, 'verde', 'verdes')}` +
        ` · ${escenariosRojos.size} ${pl(escenariosRojos.size, 'rojo', 'rojos')}` +
        `${rotosNoRojos ? ` · ${rotosNoRojos} sin veredicto (arnés roto)` : ''}` +
        ` · ${pendientes.length} ${pl(pendientes.length, 'pendiente', 'pendientes')}`);
      // Las deterministas y las del juez se cuentan aparte a propósito: sumarlas
      // en un solo número mezcla lo que se puede repetir con lo que es un
      // juicio, y el que lee no sabe cuánto de ese rojo es opinión.
      const rojasDeterministas = todasLasFallas.filter((f) => f.codigo.startsWith('N')).length;
      const rojasDelDicho = todasLasFallas.length - rojasDeterministas;
      di(`  aserciones (deterministas): ${verdes} ${pl(verdes, 'verde', 'verdes')} · ${rojasDeterministas} ${pl(rojasDeterministas, 'roja', 'rojas')}${porNivel ? ` (${porNivel})` : ''}`);

      const veredictos = corridos.flatMap((b) => b.veredictos);
      if (veredictos.length) {
        const cuarentena = veredictos.filter((v) => v.cuarentena).length;
        const noConfiables = veredictos.filter((v) => v.confiable === false).length;
        di(`  reglas del dicho: ${veredictos.length - sinEvaluar} ${pl(veredictos.length - sinEvaluar, 'evaluada', 'evaluadas')}` +
          `${sinEvaluar ? ` · ${sinEvaluar} SIN evaluar (el juez no probó la condena)` : ''}` +
          ` · ${rojasDelDicho} ${pl(rojasDelDicho, 'condenada que rompe', 'condenadas que rompen')}` +
          ` · ${todasReportadas.length} ${pl(todasReportadas.length, 'reportada sin romper', 'reportadas sin romper')}` +
          `${cuarentena ? ` · ${cuarentena} en cuarentena` : ''}${noConfiables ? ` · ${noConfiables} NO ${pl(noConfiables, 'confiable', 'confiables')}` : ''}`);
      }

      // ── El cerebro con el que corrió (tarea 4.6) ────────────────────────
      di();
      di(`  modelo del bot:  ${modelos.bot || 'sin declarar — y eso hay que arreglarlo: un veredicto sin cerebro no se puede comparar'}`);
      di(`  modelo del juez: ${modelos.juez || 'no corrió juez en esta corrida'}`);
      if (proveedorBot) di(`  proveedor del bot: ${proveedorBot}`);
      if (duenoModo) di(`  actor dueño:     ${duenoModo}`);
      if (!juzgaAlBot) {
        di('    ⚠ este proveedor NO juzga al bot: las respuestas son fijas y comparten');
        di('      los puntos ciegos del prompt por construcción. Lo verificado acá es');
        di('      el ARNÉS. Para juzgar al bot: ARNES_BOT=agente.');
      }

      // ── Lo que costó, sin mentir con un cero ────────────────────────────
      di();
      di('  gasto:');
      const gastos = [...gastosDeLaCorrida, ...corridos.flatMap((b) => b.gastos)];
      if (!gastos.length) di('    nadie llamó a un modelo en esta corrida.');
      let saltarDesglose = !gastos.length;
      let totalConNumero = 0;
      let huboNumero = false;
      for (const actor of saltarDesglose ? [] : ACTORES_DEL_GASTO) {
        const suyos = gastos.filter((g) => g.actor === actor);
        if (!suyos.length) { di(`    ${actor.padEnd(8)} no participó de esta corrida`); continue; }
        const conNumero = suyos.filter((g) => typeof g.usd === 'number');
        if (!conNumero.length) {
          const aclaracion = suyos.find((g) => g.nota)?.nota;
          di(`    ${actor.padEnd(8)} sin costo real — ${aclaracion || 'no hubo llamada a la API que facturar'}`);
          continue;
        }
        const suma = conNumero.reduce((t, g) => t + g.usd, 0);
        huboNumero = true;
        totalConNumero += suma;
        di(`    ${actor.padEnd(8)} US$${suma.toFixed(4)}`);
      }
      if (huboNumero) {
        di(`    ${'total'.padEnd(8)} US$${totalConNumero.toFixed(4)}${topeUsd ? ` de un tope de US$${Number(topeUsd).toFixed(2)}` : ''}`);
      } else if (!saltarDesglose) {
        // La frase completa, y con estas palabras: `$0.00` se lee "salió
        // gratis" y lo cierto es "no sé".
        di('    ninguno de los actores dejó un costo real que sumar.');
        di('    NO es "salió gratis": es que no hubo factura que mirar.');
        di('    Hoy el bot lo sirve un agente leyendo el SKILL.md, no la API (design §1).');
      }

      // ── Lo que no se cubrió (tarea 3.8) ─────────────────────────────────
      const omitidas = [...omitidasDeLaCorrida, ...corridos.flatMap((b) => b.omitidas)];
      const vistas = new Set();
      const unicas = omitidas.filter((o) => (vistas.has(o.que) ? false : vistas.add(o.que)));
      if (unicas.length) {
        di();
        di(`  Lo que esta corrida NO cubrió (${unicas.length}):`);
        for (const o of unicas) {
          di(`    · ${o.que}`);
          di(`      por qué no: ${o.porque}`);
          if (o.comoSeCubre) di(`      cómo se cubre: ${o.comoSeCubre}`);
          if (o.origen) di(`      de: ${o.origen}`);
        }
        di('    Una omisión silenciosa es una mentira; ésta es una tarea.');
      }

      // ── Los pendientes (tarea 9.7) ──────────────────────────────────────
      if (pendientes.length) {
        di();
        di(`  Escenarios pendientes — NO cuentan como aprobados (${pendientes.length}):`);
        for (const b of pendientes) di(`    · ${b.escenario} — ${b.pendiente_}`);
      }

      // ── Dónde mirar ─────────────────────────────────────────────────────
      di();
      if (escribir) di(`  salida: ${relativa(dir)}/`);
      di(`  duró:   ${reloj(ahora() - t0)}`);

      // ── El desenlace ────────────────────────────────────────────────────
      // Una corrida que no corrió ni un escenario no es verde: no hay nada que
      // aprobar. Sale por exit 2, que es lo que significa "no hay veredicto".
      // Es el modo de falla más silencioso posible —un filtro de etiquetas que
      // no matchea nada devuelve 0 y todo el mundo lee "pasó"—.
      if (!corridos.length && !roturas.length) {
        roturas.push(new ErrorArnes(
          'no corrió ningún escenario',
          pendientes.length
            ? `  los ${pendientes.length} que había están pendientes, y un pendiente no aprueba nada`
            : '  revisá el filtro de etiquetas: si no matchea nada, un 0 se lee como "pasó"',
        ));
      }

      const hayProducto = todasLasFallas.length > 0;
      const hayRoto = roturas.length > 0;
      const exitCode = hayRoto ? 2 : (hayProducto ? 1 : 0);

      console.log('');
      for (const l of lineas) console.log(colorear(l));

      if (hayProducto) {
        console.log(`\n  ${NEGRITA}Fallas del producto (${todasLasFallas.length}):${FIN}`);
        for (const f of todasLasFallas) imprimirFalla(f);
      }

      if (hayRoto) {
        console.log(`\n  ${NEGRITA}${AMARILLO}Lo que rompió el arnés (${roturas.length}):${FIN}`);
        for (const r of roturas) {
          console.log(`  ${AMARILLO}${CRUZ}${FIN} ${r.message}`);
          // Las pistas vacías son los renglones en blanco que separan un
          // requisito del siguiente: se imprimen vacías, sin sangría fantasma.
          for (const pista of r.pistas || []) console.log(pista ? `  ${GRIS}    ${pista}${FIN}` : '');
        }
        // Lo verde de una corrida que no terminó no es un permiso para shippear.
        // Si no hubo nada verde, la frase sobra y sólo hace ruido.
        if (verdes > 0) {
          console.log(`\n  ${AMARILLO}${AVISO} Lo que quedó en verde acá arriba NO cuenta como aprobado: la corrida no terminó.${FIN}`);
        }
      }

      if (exitCode === 0) {
        CARTELES.verde(
          `${verdes} ${pl(verdes, 'aserción', 'aserciones')} en ${corridos.length} ${pl(corridos.length, 'escenario', 'escenarios')}` +
          `${juzgaAlBot ? '.' : ' — del ARNÉS, no del bot.'}` +
          // Un verde que se calla lo que no miró es un verde que miente.
          `${unicas.length ? ` Ojo: ${unicas.length} ${pl(unicas.length, 'aserción', 'aserciones')} sin cubrir, listadas arriba.` : ''}`,
        );
      } else if (exitCode === 1) {
        CARTELES.producto(
          `${todasLasFallas.length} ${pl(todasLasFallas.length, 'aserción roja', 'aserciones rojas')} en ` +
          `${escenariosRojos.size} ${pl(escenariosRojos.size, 'escenario', 'escenarios')}. Hay algo que arreglar en el sistema.`,
        );
      } else {
        CARTELES.arnes(
          hayProducto
            ? 'el arnés no pudo terminar: NO hay veredicto. Las fallas del producto de arriba son reales, pero el verde de esta corrida no vale.'
            : 'el arnés no pudo emitir veredicto. NO dice nada sobre el producto.',
        );
      }

      // El mismo texto, sin colores, al lado de los artefactos.
      guardar(path.join(dir, 'resumen.md'), [
        `# corrida ${corridaId}`,
        '',
        `**${['✓ VERDE · exit 0', '✗ PRODUCTO ROTO · exit 1', '✗ ARNÉS ROTO · exit 2'][exitCode]}**`,
        '',
        '```',
        ...lineas,
        '```',
        '',
        ...(hayProducto ? ['## Fallas del producto', '', '```', ...todasLasFallas.flatMap((f) => lineasPlanas(f)), '```', ''] : []),
        ...(hayRoto ? ['## Lo que rompió el arnés', '', '```', ...roturas.flatMap((r) => [`✗ ${r.message}`, ...(r.pistas || []).map((p) => `    ${p}`)]), '```', ''] : []),
      ].join('\n'));

      enlazarUltima(dirSalida, corridaId, escribir);
      return exitCode;
    },
  };

  return informe;
}

/** Singular o plural. Un "1 escenarios" en la última línea desprolija todo. */
function pl(n, singular, plural) {
  return n === 1 ? singular : plural;
}

/** Colorea el resumen sin repetirlo: la marca del renglón decide el color. */
function colorear(linea) {
  if (/^\s*·/.test(linea) || /^\s{4,}/.test(linea)) return `${GRIS}${linea}${FIN}`;
  if (linea.startsWith('──')) return `${NEGRITA}${linea}${FIN}`;
  return linea;
}

/** Las líneas de una falla, sin colores, para el `resumen.md`. */
function lineasPlanas(f) {
  const turno = f.turno ? `turno ${f.turno}` : 'sin turno';
  const salida = [`✗ ${f.escenario} · ${turno} · ${f.actor} · ${f.codigo} «${f.frase}»`];
  if (f.cita) salida.push(`    dijo: ${JSON.stringify(f.cita)}`);
  if (f.esperado !== undefined) salida.push(`    esperaba: ${plano(f.esperado)}`);
  if (f.llego !== undefined) salida.push(`    llegó:    ${plano(f.llego)}`);
  const pie = [f.pie, f.ubicacion, f.origen, f.extra].filter(Boolean).join(' · ');
  if (pie) salida.push(`    ${pie}`);
  return salida;
}

function plano(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * `arnes/salida/ultima` → la corrida que se acaba de hacer.
 *
 * Es una comodidad chica con un efecto grande: "mirá arnes/salida/ultima/" es
 * una instrucción que se puede dar por teléfono; el id con el sello de tiempo,
 * no. Si el sistema de archivos no banca symlinks, se deja pasar en silencio:
 * es un lujo, no un requisito.
 */
function enlazarUltima(dirSalida, corridaId, escribir) {
  if (!escribir) return;
  const enlace = path.join(dirSalida, 'ultima');
  try {
    fs.rmSync(enlace, { force: true, recursive: false });
    fs.symlinkSync(corridaId, enlace, 'dir');
  } catch { /* un symlink de menos no invalida nada */ }
}

export { crearBitacora } from './informe/bitacora.js';
