/**
 * escenarios/ — las conversaciones que el arnés defiende.
 *
 * ── Contra qué se asevera, y contra qué NO ───────────────────────────────────
 * Un escenario **prefiere el nivel más bajo que pueda expresar lo que quiere
 * proteger** (spec, design §6):
 *
 *   nivel 1 — el estado del core, por su API. Determinista. Rompe.
 *   nivel 2 — qué tools llamó el bot, con qué y en qué orden. Determinista. Rompe.
 *   nivel 3 — lo que el bot dijo, juzgado. No determinista. Rompen sólo las
 *             seis reglas duras del `SKILL.md`.
 *
 * Y sobre stock, contra el **contrato**, nunca contra la fuente del número
 * (design §13): `restante` y `agotado` de `GET /api/servicios`, **jamás**
 * `cupo_jornada`, ni recetas, ni insumos. `insumos-y-recetas` ya aterrizó y
 * agregó una segunda fuente del mismo número prometiendo que el contrato de
 * afuera no cambia; un escenario aseverado contra el contrato prueba **las dos
 * fuentes sin tocar una línea** y encima verifica esa promesa. Uno aseverado
 * contra la tabla habría que reescribirlo entero.
 *
 * ── Lo que un escenario necesita del resto del arnés ─────────────────────────
 * El contexto (`ctx`) que recibe `preparar` y `correr` está armado en
 * `correr.js` y viene de módulos de otros grupos. Está documentado como typedef
 * abajo: es el contrato entre este grupo y los demás.
 */

import pedidoFeliz from './pedido-feliz.js';
import seTermino from './se-termino.js';
import dosContraElUltimo from './dos-contra-el-ultimo.js';
import deliverySinDireccion from './delivery-sin-direccion.js';
import modificacionPorLinea from './modificacion-por-linea.js';
import consultaSinRespuesta from './consulta-sin-respuesta.js';
import reservaDeMesa from './reserva-de-mesa.js';
import cancelarEnCocina from './cancelar-en-cocina.js';
import insumoCompartido from './insumo-compartido.js';

/**
 * @typedef {object} Contexto  lo que un escenario recibe. Lo arma `correr.js`
 * @property {object} env       de `entorno()`
 * @property {object} corrida   de `crearCorrida()`: tokens, api, teléfonos
 * @property {object} carta     de `cargarCarta()`: `porNombre`, `platos`
 * @property {object} graph     el Graph falso — el teléfono del cliente
 * @property {object} gateway   el gateway en proceso
 * @property {object} cliente   👤 de `crearCliente()`
 * @property {object} transcripcion  de `crearTranscripcion()`
 * @property {object} informe   de `crearInforme()`: `anotar`, `omitir`, `cerrar`
 * @property {object} core      nivel 1: `foto`, `elCompromiso`, `campo`, `lineas`, `stock`, `consultas`, `cuantosCompromisos`, `exigir`
 * @property {object} tools     nivel 2: `llamo`, `noLlamo`, `argumentos`, `orden`
 * @property {object} dueno     🧑‍🍳 de `crearDuenoApi()` (o el de Chrome)
 * @property {(texto: string) => Promise<object>} decir
 *           el cliente dice algo, se espera el procesamiento y se anota lo que
 *           el teléfono recibió. Devuelve el mensaje recibido
 * @property {(t: string) => Promise<object>} decirSinRespuesta
 *           igual pero sin esperar respuesta (para el que sabe que no la habrá)
 * @property {(nombre: string) => object} plato  el plato de la carta, por nombre
 * @property {(texto: string) => void} nota  deja una nota en la línea de tiempo
 */

/**
 * @typedef {object} Escenario
 * @property {string} id
 * @property {string} titulo   la frase humana de qué defiende
 * @property {string} origen   `docs/FLUJOS.md · Flujo A`
 * @property {string[]} tags   `@rapido` entra en `make arnes`
 * @property {{motivo: string, desbloquea: string}|null} pendiente
 *           un escenario cuyo requisito no aterrizó, escrito a mano. **Se lista
 *           igual, con su motivo, y NO cuenta como aprobado** (spec)
 * @property {(ctx: Contexto) => Promise<{motivo: string, desbloquea: string}|null>} [requisito]
 *           el pendiente **preguntado en vez de escrito**: devuelve el motivo
 *           si la capacidad de la que depende todavía no está, o `null` si ya
 *           está y el escenario corre. Es la respuesta al segundo scenario del
 *           spec —*"el pendiente deja de serlo solo"*—: un pendiente escrito a
 *           mano sobrevive a la capacidad que lo justificaba y se convierte en
 *           un test muerto que nadie extraña
 * @property {{id: string, config: object}} [negocioAlterno]
 *           un segundo negocio con otra config, para los escenarios que
 *           necesitan contrastar dos configuraciones (`acepta_delivery`). Llega
 *           como `ctx.alterno`, con su propio cliente y sus propios niveles
 * @property {string[]} reglas  qué reglas del nivel 3 se juzgan sobre esta
 *           transcripción. Sólo prohibiciones que este escenario puede violar
 * @property {object} [negocio] `{ config }` para `crearCorrida`
 * @property {Array|null} [guion]  el libreto del proveedor `guion`. Sirve para
 *           probar EL ARNÉS, jamás el bot: un guion escrito por la misma cabeza
 *           que el prompt comparte sus puntos ciegos por construcción. `null` =
 *           este escenario sólo corre con `ARNES_BOT=agente`
 * @property {(ctx: Contexto) => Promise<void>} [preparar]
 * @property {(ctx: Contexto) => Promise<void>} correr
 */

/** Todos, en el orden en que se leen. */
export const ESCENARIOS = [
  pedidoFeliz,
  seTermino,
  dosContraElUltimo,
  deliverySinDireccion,
  modificacionPorLinea,
  consultaSinRespuesta,
  reservaDeMesa,
  cancelarEnCocina,
  insumoCompartido,
];

/**
 * El conjunto `@rapido`: lo que entra en `make arnes`, antes de un release.
 *
 * El criterio es el de la tarea 2.7 —lo que cabe en el tiempo y el gasto de una
 * corrida antes de un release— y hoy son dos:
 *
 *   · `pedido-feliz`, porque **es la conversación que define el producto**. Si
 *     sólo se pudiera correr una cosa, es ésta.
 *   · `se-termino`, porque es el escenario que `stock-visible-al-agente`
 *     declaró y dejó sin verificar, y **acá se cubre o no se cubre en ningún
 *     lado**. No es comportamiento del core: es comportamiento del modelo, y
 *     esta es la única suite del repo que puede leerlo.
 *
 * Los demás corren en `make arnes-todo`. La lista se revisa cuando el 2.7
 * mida cuánto tarda y cuánto cuesta una conversación de punta a punta: si
 * `pedido-feliz` sale barato, entra `modificacion-por-linea`, que es nivel 1
 * puro y protege una regla que una regresión del prompt rompe sin que se note
 * en la conversación.
 */
export const RAPIDOS = ESCENARIOS.filter((e) => e.tags.includes('@rapido'));

/**
 * Los que se listan como pendientes **escritos a mano** y no cuentan como
 * aprobados. Hoy está vacío, y eso NO quiere decir que no haya pendientes: el
 * único que lo era —`insumo-compartido`— pregunta su requisito en tiempo de
 * corrida (`requisito()`) y se declara pendiente ahí si la capacidad no está.
 * Un pendiente preguntado se apaga solo el día correcto; uno escrito a mano se
 * queda para siempre.
 */
export const PENDIENTES = ESCENARIOS.filter((e) => e.pendiente);

/** Los que pueden declararse pendientes al correr, según el estado del sistema. */
export const CON_REQUISITO = ESCENARIOS.filter((e) => typeof e.requisito === 'function');

/** @param {string} id */
export function escenario(id) {
  const e = ESCENARIOS.find((x) => x.id === id);
  if (!e) throw new Error(`no existe el escenario «${id}». Hay: ${ESCENARIOS.map((x) => x.id).join(', ')}`);
  return e;
}

/**
 * Los escenarios que pide una selección.
 * @param {{tag?: string, ids?: string[]}} filtro
 */
export function seleccionar({ tag, ids } = {}) {
  if (ids?.length) return ids.map(escenario);
  if (tag) return ESCENARIOS.filter((e) => e.tags.includes(tag));
  return ESCENARIOS;
}
