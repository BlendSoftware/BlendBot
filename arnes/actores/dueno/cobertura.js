/**
 * cobertura.js — **lo que la corrida desatendida NO cubrió**, con nombre y
 * apellido (tarea 3.8).
 *
 * Este archivo es la contracara del §9 del diseño. Ahí se decidió que el dueño
 * por navegador lo maneja un agente con Chrome siguiendo un guión escrito, en
 * vez de Playwright. La ganancia está escrita ahí y es real; el riesgo también,
 * y es uno solo:
 *
 *     que "no corre solo" se convierta en "no corre nunca".
 *
 * La única defensa contra eso es que la corrida automática **nombre lo que no
 * cubrió**. Una omisión silenciosa es una mentira; una omisión que se anuncia
 * es una tarea. Por eso esta lista no vive en un comentario ni en el README:
 * vive en un módulo que el actor dueño anota en la bitácora y que
 * `informe.js` imprime **siempre**, verde o roja.
 *
 * La forma de cada entrada es exactamente la que consume
 * `bitacora.omitida({ que, porque, comoSeCubre, origen })` de
 * `arnes/informe/bitacora.js`, así que se pasa entera sin traducir. Los campos
 * `id`, `guion` y `cardinal` son de acá y la bitácora los ignora.
 *
 * Regla para el que agregue una entrada: hay que poder contestar *"¿por qué la
 * API no alcanza?"* con una frase concreta y verificable. Si la respuesta es
 * "porque no lo probé", no es una omisión del modo `api`: es una aserción que
 * falta escribir en `api.js`. Esta lista se gana el derecho a crecer sólo con
 * cosas que **son render, no dato**.
 */

/**
 * @typedef {object} SoloNavegador
 * @property {string}  id           identificador estable, para poder citarlo
 * @property {string}  que          la aserción, en la frase humana que la origina
 * @property {string}  porque       por qué la API NO alcanza. Concreto y verificable.
 * @property {string}  comoSeCubre  qué hay que correr para afirmarla
 * @property {string}  origen       de dónde sale la promesa (documento y renglón)
 * @property {number}  guion        el paso de `arnes/dueno/guion.md` que la afirma
 * @property {boolean} cardinal     si es una de las dos que justifican el navegador
 */

/**
 * Las aserciones que **sólo** el guión del dueño en Chrome puede afirmar.
 *
 * Las dos marcadas `cardinal` son las que justifican que el navegador exista.
 * El resto se cae solo si el panel se rompe entero; las dos cardinales se caen
 * en silencio con el panel funcionando "casi bien", que es el caso peligroso.
 *
 * @type {SoloNavegador[]}
 */
export const SOLO_NAVEGADOR = [
  {
    id: 'campo-libre-demora',
    cardinal: true,
    guion: 6,
    que: 'El campo libre de la demora existe en la pantalla y confirma con un valor que no es ninguno de los presets.',
    porque:
      'PATCH /api/compromisos/:id/estado {"demora_min": 33} pasa con el campo libre y sin él: ' +
      'el core no sabe qué se dibujó. Sólo el DOM defiende esa decisión de producto.',
    comoSeCubre: 'arnes/dueno/guion.md, paso 6, con un agente manejando Chrome.',
    origen: 'D8 · panel/src/componentes/SelectorDemora.tsx: «si el campo libre no está, el producto miente».',
  },
  {
    id: 'pedido-aparece-sin-recargar',
    cardinal: true,
    guion: 5,
    que: 'El pedido aparece en la pantalla del dueño mientras el cliente todavía está escribiendo, sin que nadie recargue nada.',
    porque:
      'Por API se verifica que el REGISTRO existe. Que el dueño lo VEA es otra afirmación: ' +
      'depende del refresco de usarPedidos y del render del tablero. Son dos cosas distintas ' +
      'y el producto vende la segunda.',
    comoSeCubre: 'arnes/dueno/guion.md, paso 5, con la ventana de Chrome adelante (gotcha 1).',
    origen: 'docs/FLUJOS.md · «la cocina ve el pedido mientras el cliente todavía está escribiendo».',
  },
  {
    id: 'presets-del-negocio-dibujados',
    cardinal: false,
    guion: 6,
    que: 'Los presets de demora del config del negocio se dibujan como botones, y son los del negocio, no los del código.',
    porque: 'La API devuelve config.demoras_sugeridas; que el selector los pinte es del panel.',
    comoSeCubre: 'arnes/dueno/guion.md, paso 6.',
    origen: 'panel/src/contexto.tsx · negocio.config.demoras_sugeridas, con [15, 25, 40] de fallback.',
  },
  {
    id: 'tarjeta-muestra-items-y-notas',
    cardinal: false,
    guion: 5,
    que: 'La tarjeta del pedido muestra los ítems con su cantidad y su modificación («sin panceta»), y la dirección si es delivery.',
    porque:
      'Por API se lee el JSON de las líneas. Que el dueño pueda leer QUÉ cocinar de un vistazo ' +
      'es lo que hace que la cocina funcione, y eso es render.',
    comoSeCubre: 'arnes/dueno/guion.md, paso 5.',
    origen: 'panel/src/componentes/TarjetaPedido.tsx · la lista de ítems con su nota.',
  },
  {
    id: 'tarjeta-cambia-de-columna',
    cardinal: false,
    guion: 7,
    que: 'Al confirmar, la tarjeta se mueve de «Pendientes» a «En cocina» sin recargar, y el contador de la demora arranca.',
    porque:
      'El core devuelve el estado nuevo; el movimiento de columna y el contador contra la demora ' +
      'prometida los calcula el panel (agruparPorColumna y contadorDemora).',
    comoSeCubre: 'arnes/dueno/guion.md, paso 7.',
    origen: 'panel/src/dominio/pedidos.ts · las columnas y el contador de la demora.',
  },
  {
    id: 'cambio-de-contrasena-obligatorio',
    cardinal: false,
    guion: 3,
    que: 'El panel no deja pasar de la pantalla de cambio de contraseña en el primer ingreso.',
    porque:
      'Por API, el flag must_change_password se lee y se cambia con dos POST. Que la pantalla ' +
      'sea una puerta y no un cartel lo decide el guard de las rutas. Y OJO: hoy el guión ' +
      'TAMPOCO la puede afirmar, porque crearCorrida() cambia la contraseña temporal por API ' +
      'antes de llamarlo y no la devuelve.',
    comoSeCubre:
      'arnes/dueno/guion.md, paso 3, y sólo cuando la corrida entregue la contraseña provisoria. ' +
      'Hasta entonces el guión la reporta como NO EVALUABLE en vez de darla por buena.',
    origen: 'panel/src/App.tsx · «con contraseña temporal sin cambiar no se pasa de la pantalla de cambio».',
  },
  {
    id: 'aviso-de-consultas-pendientes',
    cardinal: false,
    guion: 9,
    que: 'La franja de preguntas sin responder aparece sola en el tablero con su número, y lleva a la pantalla de Preguntas.',
    porque:
      'Por API se listan las consultas pendientes. Que el dueño se ENTERE sin ir a buscarlas ' +
      'es el principio 5 («un pendiente reclama atención hasta que alguien lo toca») y es render.',
    comoSeCubre: 'arnes/dueno/guion.md, pasos 9 y 10.',
    origen: 'panel/src/componentes/AccesoConsultas.tsx · la franja que sólo aparece cuando hay pendientes.',
  },
  {
    id: 'consulta-se-va-al-responder',
    cardinal: false,
    guion: 11,
    que: 'Al responder, la pregunta se va de la lista y queda el mensaje de que no hay ninguna sin responder.',
    porque: 'El PATCH devuelve la consulta respondida; que salga de la vista es del panel.',
    comoSeCubre: 'arnes/dueno/guion.md, paso 11.',
    origen: 'panel/src/vistas/Consultas.tsx · «apenas se responde, la pregunta se va de la lista».',
  },
];

/** Una entrada por su id. Explota temprano si alguien renombró y dejó una llamada colgada. */
export function soloNavegador(id) {
  const item = SOLO_NAVEGADOR.find((s) => s.id === id);
  if (!item) {
    throw new Error(`no existe la aserción sólo-navegador «${id}» en cobertura.js`);
  }
  return item;
}

/** Los dos que justifican que el navegador exista. */
export function cardinales() {
  return SOLO_NAVEGADOR.filter((s) => s.cardinal);
}

/**
 * Anota una omisión en la bitácora del escenario (o en el informe de la
 * corrida: los dos exponen `.omitida()` con la misma forma).
 *
 * Se le pasa el objeto entero: `que`, `porque`, `comoSeCubre` y `origen` son
 * los cuatro campos que `informe.js` imprime al final de toda corrida.
 *
 * @param {{omitida: Function}} destino  una bitácora de escenario o el informe
 * @param {string} id  el id de `SOLO_NAVEGADOR`
 */
export function anotarOmitida(destino, id) {
  const { que, porque, comoSeCubre, origen } = soloNavegador(id);
  destino.omitida({ que, porque, comoSeCubre, origen });
  return id;
}

/**
 * Anota **todas** las omisiones de una vez, a nivel corrida.
 *
 * Es la red de seguridad de la tarea 3.8: aunque un escenario no llegue a
 * ejecutar el gesto que anotaría su omisión —porque falló antes, o porque ese
 * escenario no toca el panel—, la corrida igual nombra lo que no cubrió. El día
 * peligroso no es el que termina en rojo: es el que termina todo verde y
 * alguien concluye que el panel quedó probado.
 *
 * `informe.js` deduplica por `que`, así que llamar a esto además de los
 * `anotarOmitida` de cada gesto no imprime nada dos veces.
 *
 * @param {{omitida: Function}} informe
 * @param {{modo?: 'api'|'navegador'}} [opts]
 */
export function anotarTodasLasOmisiones(informe, { modo = 'api' } = {}) {
  // Con el dueño en el navegador estas aserciones SÍ se afirmaron: anunciarlas
  // como omitidas sería mentir al revés, y una lista que también miente cuando
  // todo se cubrió es una lista que se aprende a ignorar.
  if (modo === 'navegador') return [];
  return SOLO_NAVEGADOR.map((s) => anotarOmitida(informe, s.id));
}
