/**
 * `transcripcion.md`: **la corrida como línea de tiempo**, no como booleano.
 *
 * Turno por turno, con quién habló, el reloj relativo y el texto; debajo de
 * cada turno del bot, las tools que llamó con sus argumentos y lo que le
 * devolvieron; debajo de cada turno del dueño, el gesto; y debajo de cualquiera
 * de los dos, lo que se aseveró **en ese turno** (design §14, tarea 4.1).
 *
 * *Por qué las tools van adentro del turno y no en un archivo aparte:* leer la
 * conversación y ver qué hizo el bot tienen que ser el mismo acto. Un
 * `tools.json` al lado obliga a cruzar dos archivos con la cabeza, de noche,
 * para contestar "¿consultó el catálogo antes de decir el precio?", que es
 * exactamente la pregunta por la que existe este arnés.
 *
 * Este módulo devuelve además el **mapa de líneas**: qué renglón del archivo le
 * corresponde a cada turno. De ahí sale el `transcripcion.md:41` de la línea de
 * falla, que es lo que convierte una falla en algo que se abre de un click en
 * vez de buscarse a ojo.
 */

import { ACTORES, NIVELES, resolverVeredicto } from './bitacora.js';

/** Tope del volcado de una tool dentro del .md. Lo entero vive en crudo.json. */
const TOPE_VOLCADO = 4000;

/** El reloj relativo: `+00:04.1`, y con horas si alguna vez hiciera falta. */
export function reloj(ms) {
  const total = Math.max(0, Math.round(ms));
  const decimas = Math.floor((total % 1000) / 100);
  const seg = Math.floor(total / 1000) % 60;
  const min = Math.floor(total / 60000) % 60;
  const hs = Math.floor(total / 3600000);
  const mm = String(min).padStart(2, '0');
  const ss = String(seg).padStart(2, '0');
  return hs ? `+${hs}:${mm}:${ss}.${decimas}` : `+${mm}:${ss}.${decimas}`;
}

/** JSON legible, recortado con aviso de dónde está el completo. */
function volcar(valor) {
  let texto;
  try { texto = JSON.stringify(valor, null, 2); } catch { texto = String(valor); }
  if (texto === undefined) texto = 'undefined';
  if (texto.length > TOPE_VOLCADO) {
    texto = `${texto.slice(0, TOPE_VOLCADO)}\n… recortado — completo en crudo.json`;
  }
  return texto;
}

/** El texto del turno como cita de markdown, respetando los saltos de línea. */
function comillado(texto) {
  if (!texto) return ['> *(sin texto)*'];
  return String(texto).split('\n').map((l) => `> ${l}`);
}

/**
 * Arma el archivo.
 *
 * @param {object} bitacora  la bitácora del escenario
 * @param {object} meta      lo que no sabe la bitácora: modelos, modo, corrida
 * @returns {{ texto: string, lineaDeTurno: Map<number, number> }}
 */
export function renderTranscripcion(bitacora, meta = {}) {
  /** @type {string[]} */
  const L = [];
  /** @type {Map<number, number>} */
  const lineaDeTurno = new Map();
  const push = (...lineas) => L.push(...lineas);

  // ── Encabezado ─────────────────────────────────────────────────────────────
  push(`# ${bitacora.escenario}`, '');
  if (bitacora.etiquetas?.length) push(`\`${bitacora.etiquetas.join('` `')}\``, '');

  const c = bitacora.corrida || {};
  push('| | |', '|---|---|');
  if (meta.corridaId) push(`| corrida | \`${meta.corridaId}\` |`);
  if (meta.arranco) push(`| arrancó | ${meta.arranco} |`);
  push(`| duró | ${reloj(bitacora.duracionMs)} |`);
  if (c.negocioId != null) push(`| negocio | \`${c.negocioId}\` |`);
  if (c.waPhoneId) push(`| wa_phone_id | \`${c.waPhoneId}\` |`);
  if (c.telefonoCliente) push(`| teléfono del cliente | \`${c.telefonoCliente}\` |`);
  // El cerebro con el que corrió, siempre (tarea 4.6). Un veredicto sin saber
  // con qué modelo se produjo no se puede discutir ni comparar con la corrida
  // anterior.
  push(`| modelo del bot | ${meta.modeloBot || '*sin declarar*'} |`);
  push(`| modelo del juez | ${meta.modeloJuez || '*no corrió juez*'} |`);
  if (meta.duenoModo) push(`| actor dueño | \`${meta.duenoModo}\` |`);
  push('');

  // ── La línea de tiempo ─────────────────────────────────────────────────────
  push('## Línea de tiempo', '');

  const porTurno = new Map();
  for (const a of bitacora.aserciones) {
    if (!a.turno) continue;
    if (!porTurno.has(a.turno)) porTurno.set(a.turno, []);
    porTurno.get(a.turno).push(a);
  }

  for (const e of bitacora.eventos) {
    const actor = ACTORES[e.actor] || ACTORES.sistema;
    lineaDeTurno.set(e.n, L.length + 1); // 1-based: el renglón del encabezado
    push(`### turno ${e.n} · ${reloj(e.ms)} · ${actor.emoji} ${actor.nombre}`, '');
    if (e.actor === 'sistema' && !e.texto) push('*(sin texto)*', '');
    else push(...comillado(e.texto), '');

    for (const t of e.tools) {
      push(`- 🔧 \`${t.nombre}\` · ${reloj(t.ms)}`);
      push('  - argumentos:', '', '  ```json', ...volcar(t.argumentos).split('\n').map((l) => `  ${l}`), '  ```', '');
      if (t.error) {
        push('  - **la tool devolvió error**:', '', '  ```', ...String(t.error).split('\n').map((l) => `  ${l}`), '  ```', '');
      } else {
        push('  - resultado:', '', '  ```json', ...volcar(t.resultado).split('\n').map((l) => `  ${l}`), '  ```', '');
      }
    }

    for (const g of e.gestos) {
      push(`- 🖐 **gesto**: ${g.que}`);
      if (g.detalle != null) {
        push('  - con:', '', '  ```json', ...volcar(g.detalle).split('\n').map((l) => `  ${l}`), '  ```', '');
      }
      if (g.captura) push(`  - captura: \`${g.captura}\``, '');
    }

    const evidenciaSuelta = e.evidencia.filter((ev) => !e.gestos.some((g) => g.captura === ev.archivo));
    for (const ev of evidenciaSuelta) {
      // La evidencia es evidencia, nunca aserción: se guarda para mirarla, no
      // para comparar píxeles (design §9, tarea 3.6).
      push(`- 📎 evidencia: \`${ev.archivo}\`${ev.descripcion ? ` — ${ev.descripcion}` : ''}`, '');
    }

    for (const a of porTurno.get(e.n) || []) {
      const marca = a.ok ? '✓' : '✗';
      const nivel = NIVELES[a.nivel]?.nombre || a.nivel;
      push(`- ${marca} *(nivel ${a.nivel} · ${nivel})* ${a.que}`);
      if (!a.ok) {
        if (a.esperado !== undefined) push(`  - esperaba: \`${volcarInline(a.esperado)}\``);
        if (a.llego !== undefined) push(`  - llegó: \`${volcarInline(a.llego)}\``);
        if (a.origen) push(`  - de: ${a.origen}`);
      }
      push('');
    }
  }

  // ── Lo que dijo el juez ────────────────────────────────────────────────────
  if (bitacora.veredictos.length) {
    push('## Lo que dijo el juez', '');
    push('> Tres veredictos por regla sobre esta misma transcripción, ya fija.', '');
    for (const v of bitacora.veredictos) {
      const r = resolverVeredicto(v, bitacora.eventos);
      const estado = r.noEvaluable ? '⚠️ no evaluable' : (r.condena ? '✗ condenada' : '✓ absuelta');
      const etiquetas = [
        v.dura ? 'dura (rompe)' : 'de matiz (reporta)',
        v.cuarentena ? `en cuarentena: ${v.cuarentena}` : null,
        v.confiable === false ? 'NO CONFIABLE: el juez perdonó su caso negativo' : null,
      ].filter(Boolean);
      push(`### ${v.regla} «${v.texto}» — ${estado} (${r.proporcion})`, '');
      push(`- ${etiquetas.join(' · ')}`);
      if (v.origen) push(`- origen: ${v.origen}`);
      if (r.motivo) push(`- **descartada**: ${r.motivo}`);
      push('');
      for (const [i, voto] of v.votos.entries()) {
        const cual = voto.condena ? 'condena' : 'absuelve';
        push(`- voto ${i + 1}: **${cual}**${voto.turno ? ` · turno ${voto.turno}` : ''}`);
        if (voto.cita) push(`  - cita: ${JSON.stringify(voto.cita)}`);
        if (voto.razon) push(`  - razón: ${voto.razon}`);
      }
      push('');
    }
  }

  // ── Lo que no se cubrió ────────────────────────────────────────────────────
  if (bitacora.omitidas.length) {
    push('## Lo que esta corrida NO cubrió', '');
    push('> Una omisión silenciosa es una mentira; una que se anuncia es una tarea.', '');
    for (const o of bitacora.omitidas) {
      push(`- **${o.que}**`);
      push(`  - por qué no: ${o.porque}`);
      if (o.comoSeCubre) push(`  - cómo se cubre: ${o.comoSeCubre}`);
      if (o.origen) push(`  - de: ${o.origen}`);
    }
    push('');
  }

  // ── El estado del core ─────────────────────────────────────────────────────
  push('## Estado del core al cerrar', '');
  if (bitacora.estado) {
    push('Completo en `estado-core.json`. Resumen:', '');
    for (const [clave, valor] of Object.entries(bitacora.estado)) {
      const cuantos = Array.isArray(valor) ? `${valor.length}` : (valor == null ? '—' : '1');
      push(`- \`${clave}\`: ${cuantos}`);
    }
  } else {
    push(`*No se capturó.* ${bitacora.motivoSinEstado || 'El escenario no dijo por qué, que es un agujero en sí mismo.'}`);
  }
  push('');

  return { texto: `${L.join('\n')}\n`, lineaDeTurno };
}

/** Igual que `volcar` pero en una línea, para meter en un renglón de lista. */
function volcarInline(valor) {
  if (typeof valor === 'string') return valor;
  try { return JSON.stringify(valor); } catch { return String(valor); }
}
