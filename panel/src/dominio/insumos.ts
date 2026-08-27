/**
 * Las cuentas y las frases de los insumos, fuera de las vistas.
 *
 * Dos reglas mandan acá y no se negocian:
 *
 * 1. **La unidad viaja pegada al número, siempre.** No hay conversión en
 *    ningún punto del sistema: la unidad la define el insumo y la receta la
 *    hereda. La única defensa contra cargar la carne en kilos y la receta en
 *    gramos —que apaga la cocina entera por un factor de mil, sin que el dueño
 *    tenga cómo darse cuenta— es que la pantalla diga "g" al lado de cada
 *    cantidad. Por eso no existe acá ninguna función que devuelva un número
 *    suelto para mostrar.
 *
 * 2. **Cuando un plato se apaga por receta, se nombra al insumo que lo apagó,
 *    con sus números.** Un plato que se apaga solo y no dice por qué es
 *    indistinguible de un bug, y el dueño lo arregla apagando la feature.
 */

import type { Insumo, InsumoLimitante, RecetaItem, TipoMovimiento, Unidad } from '../api/tipos'

const NUM = new Intl.NumberFormat('es-AR')

/**
 * Lo que va escrito al lado de un campo de cantidad. En plural porque ahí
 * etiqueta al campo, no a un valor: "cuánto hay · unidades".
 */
export function sufijo(unidad: Unidad): string {
  return unidad === 'unidad' ? 'unidades' : unidad
}

/** El nombre largo, para elegir la unidad al crear el insumo. */
export function nombreUnidad(unidad: Unidad): string {
  if (unidad === 'g') return 'gramos (g)'
  if (unidad === 'ml') return 'mililitros (ml)'
  return 'unidades'
}

export const UNIDADES: Unidad[] = ['g', 'ml', 'unidad']

/** '12000' + 'g' → '12.000 g'. Nunca devolvemos el número solo. */
export function cantidad(valor: number, unidad: Unidad): string {
  const n = NUM.format(valor)
  if (unidad === 'unidad') return valor === 1 ? `${n} unidad` : `${n} unidades`
  return `${n} ${unidad}`
}

/** 'a', 'b', 'c' → 'a, b y c'. */
export function unir(partes: string[]): string {
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0] ?? ''
  const ultimo = partes[partes.length - 1] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${ultimo}`
}

// ─── El insumo que apagó el plato ────────────────────────────────────────────

/**
 * "0 porciones — falta pan de papa (quedan 2 unidades, la receta pide 3 unidades)".
 *
 * No recibe la unidad por afuera: viene adentro del limitante, en la misma
 * respuesta del catálogo. Cruzarla contra la lista de insumos por nombre —que
 * es lo que había que hacer antes— se rompe con dos insumos homónimos o con un
 * rename entre dos lecturas, y ahí los números vuelven a quedar pelados, que es
 * el riesgo de las unidades entrando por la puerta de atrás.
 */
export function fraseLimitante(restante: number | null, limitante: InsumoLimitante): string {
  const hay = cantidad(limitante.stock, limitante.unidad)
  const pide = cantidad(limitante.pide_la_receta, limitante.unidad)

  if (restante === 0) {
    return `falta ${limitante.insumo} (quedan ${hay}, la receta pide ${pide})`
  }
  return `lo primero que se acaba es ${limitante.insumo} (quedan ${hay}, la receta pide ${pide} por porción)`
}

/** "0 porciones" / "1 porción" / "12 porciones". */
export function porciones(restante: number): string {
  return restante === 1 ? '1 porción' : `${NUM.format(restante)} porciones`
}

// ─── Insumos compartidos ─────────────────────────────────────────────────────

/** Un plato que lleva este insumo, y cuánto le pide por porción. */
export interface UsoDeInsumo {
  servicio_id: string
  servicio_nombre: string
  cantidad: number
}

/**
 * Da vuelta las recetas: de "qué lleva cada plato" a "en qué platos va cada
 * insumo".
 *
 * Es la vuelta que hace falta para mostrar la dependencia. Si la carne la usan
 * el bife y las empanadas, las porciones posibles de cada uno NO son
 * independientes: leen el mismo saldo. Mostrar "6 bifes / 20 empanadas" invita
 * a leer "26 platos", y cuando vendan 6 bifes y las empanadas bajen a 8 el
 * número va a parecer roto.
 */
export function usosPorInsumo(
  servicios: { id: string; nombre: string }[],
  recetas: Map<string, RecetaItem[]>,
): Map<string, UsoDeInsumo[]> {
  const salida = new Map<string, UsoDeInsumo[]>()
  for (const s of servicios) {
    for (const item of recetas.get(s.id) ?? []) {
      const lista = salida.get(item.insumo_id) ?? []
      lista.push({ servicio_id: s.id, servicio_nombre: s.nombre, cantidad: item.cantidad })
      salida.set(item.insumo_id, lista)
    }
  }
  return salida
}

/**
 * Qué platos dependen de este insumo, dicho como dependencia y nunca como dos
 * números que parezcan sumables.
 */
export function fraseUsos(insumo: Insumo, usos: UsoDeInsumo[]): string {
  if (usos.length === 0) {
    return 'Todavía no lo lleva ningún plato: por ahora es sólo un saldo anotado.'
  }
  const partes = usos.map((u) => `${u.servicio_nombre} (${cantidad(u.cantidad, insumo.unidad)})`)
  if (usos.length === 1) return `Va en ${partes[0]} por porción.`
  return `Va en ${unir(partes)}, por porción. Lo que se venda de uno le baja las porciones a los otros: sale del mismo saldo.`
}

/**
 * La misma dependencia, vista desde el plato: el limitante también está en
 * otras cartas y por eso estas porciones se mueven solas.
 */
export function fraseCompartidoDesdeElPlato(
  nombreInsumo: string,
  otrosPlatos: string[],
): string | null {
  if (otrosPlatos.length === 0) return null
  // "de ahí" y no "de esos": la lista puede tener uno o cinco platos y la frase
  // tiene que caer bien en los dos casos.
  return `Ojo: ${nombreInsumo} también va en ${unir(otrosPlatos)}. Lo que se venda de ahí baja estas porciones.`
}

// ─── La historia del saldo ───────────────────────────────────────────────────

/** Qué pasó, en criollo. Nada de "MOV_TYPE_CONSUMPTION". */
export function etiquetaMovimiento(tipo: TipoMovimiento): string {
  if (tipo === 'compra') return 'Entró mercadería'
  if (tipo === 'consumo') return 'Se usó en un pedido'
  if (tipo === 'devolucion') return 'Volvió de un pedido cancelado'
  return 'Corregido a mano'
}

/**
 * Cuánto movió, con su signo. El ajuste devuelve vacío a propósito: no es una
 * diferencia sino el saldo que alguien contó y escribió, y eso ya lo dice la
 * columna del saldo resultante. Poner "+ 11.500" ahí sería mentira.
 */
export function cantidadMovimiento(tipo: TipoMovimiento, valor: number, unidad: Unidad): string {
  if (tipo === 'ajuste') return ''
  if (tipo === 'consumo') return `− ${cantidad(valor, unidad)}`
  return `+ ${cantidad(valor, unidad)}`
}
