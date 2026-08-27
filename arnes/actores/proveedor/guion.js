/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PROVEEDOR `guion` — SIRVE PARA PROBAR EL ARNÉS. JAMÁS PARA PROBAR EL BOT. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Respuestas fijas, escritas a mano, en el mismo repo que el prompt.
 *
 * ── Por qué esto NO prueba el bot, dicho sin maquillaje ─────────────────────
 * Un guion escrito por la misma cabeza que escribió el `SKILL.md` **comparte
 * sus puntos ciegos por construcción**. Sólo falla donde el que lo escribió ya
 * sabía que podía fallar — o sea, nunca donde importa. Si el prompt tiene un
 * agujero que su autor no ve, el guion tiene exactamente el mismo agujero, y la
 * corrida sale verde.
 *
 * Un verde con este proveedor quiere decir **"mis respuestas fijas siguen
 * siendo fijas"**. No quiere decir "el bot está bien". Confundir las dos cosas
 * es la única forma de que este arnés termine siendo peor que no tenerlo:
 * daría la sensación de estar protegido sin proteger nada.
 *
 * ── Entonces para qué existe ────────────────────────────────────────────────
 * Para probar **el arnés**, que también hay que probarlo y no se puede probar
 * con un bot no determinista:
 *   1. que un mensaje cruce webhook → tenant → agente → outbox → Graph falso,
 *   2. que las aserciones de nivel 2 sepan leer un `tool_use` y su resultado,
 *   3. que el nivel 1 lea el core en el turno correcto,
 *   4. que el presupuesto cuente turnos y pasos,
 *   5. que la puerta del grupo cierre **sin gastar y sin nadie en el loop**.
 *
 * Un guion **puede** traer el `resultado` de cada tool escrito al lado. Eso es
 * lo que le permite correr sin levantar el MCP: es un guion, no una simulación
 * del sistema. Si un guion no trae `resultado` y el bot corre con MCP, la tool
 * se ejecuta de verdad contra el core.
 *
 * `juzgaAlBot: false` es el campo que impide que una salida diga verde sobre el
 * producto con este proveedor.
 */

/**
 * @typedef {object} TurnoDelGuion
 * @property {string} [cuando]   una etiqueta humana de cuándo aplica este turno
 * @property {string} [texto]    lo que el bot le dice al cliente
 * @property {Array<{nombre:string, argumentos?:object, resultado?:any}>} [toolUse]
 *           tools a llamar. Con `resultado` no se levanta el MCP; sin él, se llama de verdad
 */

/**
 * Un proveedor que va soltando pasos de un libreto, en orden.
 *
 * Cada elemento de `pasos` es **un paso**, no un turno: si un paso trae
 * `toolUse`, el bucle de `bot.js` ejecuta las tools y vuelve a pedir el paso
 * siguiente. El turno cierra cuando un paso viene sin `toolUse`.
 *
 * @param {object} opts
 * @param {TurnoDelGuion[]} opts.pasos
 * @param {boolean} [opts.usaMcp]  true = las tools sin `resultado` se llaman de verdad
 */
export function crearProveedorGuion({ pasos, usaMcp = false }) {
  if (!Array.isArray(pasos) || !pasos.length) {
    throw new Error('crearProveedorGuion: el guion está vacío — no hay nada que decir');
  }

  let i = 0;
  const gastados = [];

  return {
    nombre: 'guion',
    /**
     * **El campo que evita la mentira.** Toda salida del arnés lo mira antes de
     * escribir "verde": con `false`, la corrida verificó el arnés y nada más.
     */
    juzgaAlBot: false,
    usaMcp,

    async turno(contexto) {
      if (i >= pasos.length) {
        // Que el guion se quede corto es un error del guion, no del bot.
        // Decirlo con el mensaje del cliente adentro ahorra tener que contar
        // pasos a mano para descubrir cuál faltó.
        throw new Error(
          `el guion se quedó sin pasos en el turno ${contexto.turno} ` +
          `(paso ${contexto.paso}, cliente dijo: ${JSON.stringify(contexto.mensajeDelCliente)?.slice(0, 120)}). ` +
          `Tiene ${pasos.length} pasos y ya se usaron todos.`,
        );
      }
      const paso = pasos[i++];
      gastados.push(paso);
      return {
        texto: paso.texto ?? '',
        toolUse: paso.toolUse ?? [],
        // Sin modelo no hay uso ni costo, y acá el cero **sí** es de verdad: no
        // corrió nada. `presupuesto.js` distingue este cero del "no se sabe"
        // del proveedor `agente`, que es un cero muy distinto.
        uso: null,
        costoUsd: null,
      };
    },

    /** Cuántos pasos del guion quedaron sin usar. Un guion largo de más miente igual. */
    get sobrantes() { return pasos.length - i; },
    get gastados() { return [...gastados]; },
  };
}
