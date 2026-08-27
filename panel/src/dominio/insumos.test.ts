import { describe, expect, it } from 'vitest'
import type { Insumo, InsumoLimitante, RecetaItem } from '../api/tipos'
import {
  cantidad,
  cantidadMovimiento,
  fraseCompartidoDesdeElPlato,
  fraseLimitante,
  fraseUsos,
  porciones,
  sufijo,
  usosPorInsumo,
} from './insumos'

function limitante(campos: Partial<InsumoLimitante> = {}): InsumoLimitante {
  return { insumo: 'Pan de papa', unidad: 'unidad', stock: 2, pide_la_receta: 3, ...campos }
}

function insumo(campos: Partial<Insumo> = {}): Insumo {
  return {
    id: 'i1',
    nombre: 'Carne picada',
    unidad: 'g',
    stock: 40000,
    stock_minimo: null,
    bajo_minimo: false,
    activo: true,
    ...campos,
  }
}

describe('la unidad viaja pegada al número', () => {
  it('un saldo en gramos se lee con su unidad y con los miles separados', () => {
    expect(cantidad(12000, 'g')).toBe('12.000 g')
  })

  it('una sola unidad se dice en singular y ninguna otra cantidad hereda ese singular', () => {
    expect(cantidad(1, 'unidad')).toBe('1 unidad')
    expect(cantidad(0, 'unidad')).toBe('0 unidades')
    expect(cantidad(3, 'unidad')).toBe('3 unidades')
  })

  it('la etiqueta que va al lado de un campo de cantidad dice la unidad del insumo', () => {
    expect(sufijo('unidad')).toBe('unidades')
    expect(sufijo('g')).toBe('g')
    expect(sufijo('ml')).toBe('ml')
  })
})

describe('el insumo que apagó el plato', () => {
  it('el plato agotado nombra al insumo que faltó, y sus dos números salen con unidad', () => {
    const frase = fraseLimitante(0, limitante())

    expect(frase).toBe('falta Pan de papa (quedan 2 unidades, la receta pide 3 unidades)')
  })

  it('el plato que todavía se vende también nombra al que se va a acabar primero, con unidad', () => {
    const frase = fraseLimitante(6, limitante({ insumo: 'Carne picada', unidad: 'g', stock: 1800, pide_la_receta: 300 }))

    expect(frase).toBe(
      'lo primero que se acaba es Carne picada (quedan 1.800 g, la receta pide 300 g por porción)',
    )
  })

  it('ningún número de la frase queda pelado, sea cual sea la unidad del insumo', () => {
    // La defensa contra cargar la carne en kilos y la receta en gramos es que la
    // pantalla diga la unidad al lado de cada cantidad. Un "quedan 2, la receta
    // pide 3" apaga la cocina por un factor de mil sin que el dueño se entere.
    for (const u of ['g', 'ml', 'unidad'] as const) {
      for (const restante of [0, 4]) {
        const frase = fraseLimitante(restante, limitante({ unidad: u, stock: 2, pide_la_receta: 3 }))

        expect(frase).not.toMatch(/quedan 2,/)
        expect(frase).toContain(`quedan ${cantidad(2, u)}`)
        expect(frase).toContain(`pide ${cantidad(3, u)}`)
      }
    }
  })

  it('un plato ilimitado no tiene limitante y por eso su restante no se lee como cero', () => {
    // `restante: null` es "no lleva cuenta"; sólo el 0 es "lleva cuenta y no
    // queda", y sólo ese dice "falta".
    expect(fraseLimitante(null, limitante())).toContain('lo primero que se acaba es')
    expect(fraseLimitante(null, limitante())).not.toContain('falta')
  })

  it('las porciones se dicen en singular cuando queda una sola', () => {
    expect(porciones(0)).toBe('0 porciones')
    expect(porciones(1)).toBe('1 porción')
    expect(porciones(1200)).toBe('1.200 porciones')
  })
})

describe('los insumos compartidos se muestran como dependencia', () => {
  it('da vuelta las recetas: de qué lleva cada plato a en qué platos va cada insumo', () => {
    const recetas = new Map<string, RecetaItem[]>([
      ['s1', [{ insumo_id: 'carne', cantidad: 300 }]],
      ['s2', [{ insumo_id: 'carne', cantidad: 100 }, { insumo_id: 'tapa', cantidad: 12 }]],
    ])

    const usos = usosPorInsumo(
      [
        { id: 's1', nombre: 'Bife' },
        { id: 's2', nombre: 'Empanadas' },
      ],
      recetas,
    )

    expect(usos.get('carne')).toEqual([
      { servicio_id: 's1', servicio_nombre: 'Bife', cantidad: 300 },
      { servicio_id: 's2', servicio_nombre: 'Empanadas', cantidad: 100 },
    ])
    expect(usos.get('tapa')).toHaveLength(1)
  })

  it('un insumo que va en dos platos avisa que salen del mismo saldo y no muestra porciones sumables', () => {
    const frase = fraseUsos(insumo(), [
      { servicio_id: 's1', servicio_nombre: 'Bife', cantidad: 300 },
      { servicio_id: 's2', servicio_nombre: 'Empanadas', cantidad: 100 },
    ])

    expect(frase).toBe(
      'Va en Bife (300 g) y Empanadas (100 g), por porción. Lo que se venda de uno le baja las porciones a los otros: sale del mismo saldo.',
    )
    // Lo que dice son cantidades por porción, no porciones posibles: nada acá
    // invita a leer "6 bifes / 20 empanadas" como "26 platos".
    expect(frase).not.toMatch(/porciones posibles|\d+ bifes/i)
  })

  it('un insumo que va en un solo plato no arrastra la advertencia de saldo compartido', () => {
    const frase = fraseUsos(insumo(), [
      { servicio_id: 's1', servicio_nombre: 'Bife', cantidad: 300 },
    ])

    expect(frase).toBe('Va en Bife (300 g) por porción.')
    expect(frase).not.toContain('mismo saldo')
  })

  it('un insumo que todavía no lleva ningún plato lo dice, en vez de mostrar una lista vacía', () => {
    expect(fraseUsos(insumo(), [])).toBe(
      'Todavía no lo lleva ningún plato: por ahora es sólo un saldo anotado.',
    )
  })

  it('desde el plato, el limitante compartido explica por qué estas porciones se mueven solas', () => {
    expect(fraseCompartidoDesdeElPlato('Carne picada', ['Empanadas', 'Pastel de papa'])).toBe(
      'Ojo: Carne picada también va en Empanadas y Pastel de papa. Lo que se venda de ahí baja estas porciones.',
    )
  })

  it('un limitante que no comparte con nadie no dice nada: la advertencia sería ruido', () => {
    expect(fraseCompartidoDesdeElPlato('Carne picada', [])).toBeNull()
  })
})

describe('la historia del saldo', () => {
  it('lo que entró y lo que salió llevan su signo y su unidad', () => {
    expect(cantidadMovimiento('compra', 20000, 'g')).toBe('+ 20.000 g')
    expect(cantidadMovimiento('devolucion', 3, 'unidad')).toBe('+ 3 unidades')
    expect(cantidadMovimiento('consumo', 400, 'g')).toBe('− 400 g')
  })

  it('el ajuste no muestra un signo: no es una diferencia sino el saldo que alguien contó', () => {
    expect(cantidadMovimiento('ajuste', 11500, 'g')).toBe('')
  })
})
