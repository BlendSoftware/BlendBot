/**
 * carta.js — la carta sintética del arnés.
 *
 * Es **la carta del Flujo A de `docs/FLUJOS.md`, textual**: los mismos nueve
 * platos, los mismos precios, las mismas tres categorías. No sale de ningún
 * local real y no sale de la base: está acá, versionada, y se carga por
 * `POST /api/servicios` al negocio que creó `aislamiento.js`.
 *
 * Por qué sintética y no la de un piloto: un escenario que depende de datos de
 * un local ajeno no es reproducible — cambian un precio y el arnés se pone rojo
 * por algo que no es el producto. Los precios de acá son parte del contrato de
 * los escenarios: `pedido-feliz` asevera que el total del resumen del bot es
 * $13.400, y ese número sale de 8.900 + 4.500.
 *
 * **Tocar un precio invalida los escenarios que lo citan.** Por eso la carta
 * lleva versión: si cambia, se sube la versión y se revisan los escenarios que
 * la usan. Una carta que muta en silencio convierte una falla del arnés en una
 * adivinanza.
 */

import { ErrorArnes } from './entorno.js';

/**
 * Versión de la carta. Subirla es un acto deliberado: quiere decir que algún
 * escenario que citaba un precio hay que revisarlo.
 */
export const VERSION_CARTA = 1;

/**
 * La carta, tal cual sale en el Flujo A. Los precios van como string porque el
 * core los recibe en `numeric(12,2)` y así viajan sin pasar por un float —
 * mismo criterio que `scripts/smoke.sh`, que postea `"precio_base":"8500"`.
 */
export const CARTA = {
  version: VERSION_CARTA,
  categorias: [
    {
      nombre: 'Hamburguesas',
      platos: [
        { nombre: 'Simple', precio: '6500' },
        { nombre: 'Doble cheddar', precio: '8900' },
        { nombre: 'Bacon & cheddar', precio: '9500' },
        { nombre: 'Veggie', precio: '7800' },
      ],
    },
    {
      nombre: 'Para compartir',
      platos: [
        { nombre: 'Papas', precio: '4500' },
        { nombre: 'Papas cheddar y bacon', precio: '5800' },
      ],
    },
    {
      nombre: 'Bebidas',
      platos: [
        { nombre: 'Gaseosa 500ml', precio: '2500' },
        { nombre: 'Agua', precio: '2000' },
        { nombre: 'Cerveza IPA', precio: '4800' },
      ],
    },
  ],
};

/**
 * Carga la carta en el negocio de la corrida.
 *
 * @param {(m: string, r: string, t?: string, c?: object) => Promise<{status:number,json:any,texto:string}>} api
 *        el cliente que devuelve `crearApi` (o `corrida.api`)
 * @param {string} tokenDueno  JWT del dueño: el catálogo es del panel, no del agente
 * @param {object} [carta]  por si un escenario quiere una carta propia
 * @returns {Promise<{version: number, platos: Array, porNombre: Record<string, object>, categorias: Record<string, string>}>}
 */
export async function cargarCarta(api, tokenDueno, carta = CARTA) {
  const categorias = {};
  const platos = [];
  const porNombre = {};

  for (const [i, cat] of carta.categorias.entries()) {
    // Las categorías existen para que la carta que el bot le lee al cliente
    // salga agrupada como en el documento, no como una lista plana de nueve
    // renglones. Es parte de lo que se prueba: "Mensajes cortos. Es WhatsApp".
    //
    // `orden` no es cosmético. `GET /api/categorias` lista por
    // `orden asc, nombre asc`: sin él las categorías salen alfabéticas
    // —Bebidas primero— y la carta deja de ser la del documento.
    //
    // Ojo con qué NO arregla: `GET /api/servicios` ordena por `nombre asc` y
    // nada más, así que los platos vienen alfabéticos igual y es el que arma la
    // carta el que tiene que agruparlos por su `categoria_id`. Aseverar el
    // orden de los platos contra el orden del documento fallaría siempre.
    const resCat = await api('POST', '/api/categorias', tokenDueno, { nombre: cat.nombre, orden: i });
    if (resCat.status !== 201) {
      throw new ErrorArnes(
        `no pude crear la categoría «${cat.nombre}»: HTTP ${resCat.status}`,
        `cuerpo: ${resCat.texto.slice(0, 300)}`,
      );
    }
    const categoriaId = resCat.json.id;
    categorias[cat.nombre] = categoriaId;

    for (const plato of cat.platos) {
      const res = await api('POST', '/api/servicios', tokenDueno, {
        nombre: plato.nombre,
        precio_base: plato.precio,
        categoria_id: categoriaId,
      });
      if (res.status !== 201) {
        throw new ErrorArnes(
          `no pude cargar «${plato.nombre}»: HTTP ${res.status}`,
          `cuerpo: ${res.texto.slice(0, 300)}`,
        );
      }
      const cargado = {
        id: res.json.id,
        nombre: plato.nombre,
        precio: plato.precio,
        categoria: cat.nombre,
        categoriaId,
      };
      platos.push(cargado);
      porNombre[plato.nombre] = cargado;
    }
  }

  return { version: carta.version, platos, porNombre, categorias };
}

/**
 * El precio de un plato, en centavos de nada: número, para poder sumar totales
 * en las aserciones sin pelear con el string del `numeric`.
 */
export function precioDe(nombre, carta = CARTA) {
  for (const cat of carta.categorias) {
    for (const plato of cat.platos) {
      if (plato.nombre === nombre) return Number(plato.precio);
    }
  }
  throw new ErrorArnes(`«${nombre}» no está en la carta sintética del arnés (v${carta.version})`);
}
