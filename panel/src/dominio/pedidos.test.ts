import { describe, expect, it } from 'vitest'
import type { Compromiso, Estado } from '../api/tipos'
import {
  agruparPorColumna,
  aVista,
  columnaDe,
  contadorDemora,
  numeroCorto,
} from './pedidos'

function compromiso(over: Partial<Compromiso> = {}): Compromiso {
  return {
    id: '11111111-2222-3333-4444-5555aa66bb77',
    negocio_id: 'n1',
    cliente_id: 'cl1',
    cliente_nombre: 'Juani',
    cliente_telefono: '5492611234567',
    recurso_id: null,
    tipo: 'pedido',
    estado: 'pendiente' as Estado,
    inicio: null,
    fin: null,
    demora_min: null,
    entrega: 'retira',
    direccion: null,
    total: '9500',
    origen: 'whatsapp',
    nota: null,
    creado_en: '2026-08-20T20:50:00-03:00',
    confirmado_en: null,
    cerrado_en: null,
    lineas: [
      { id: 'l1', servicio_id: 's1', cantidad: 1, precio_unit: '9500', subtotal: '9500', nota: 'sin cebolla' },
    ],
    ...over,
  }
}

const nombre = (id: string) => ({ s1: 'Doble cheddar', s2: 'Papas' })[id] ?? 'Ítem'

describe('columnas del tablero', () => {
  it('mapea cada estado vivo a su columna; confirmado y en_curso van juntos a la cocina', () => {
    expect(columnaDe('pendiente')).toBe('pendientes')
    expect(columnaDe('confirmado')).toBe('cocina')
    expect(columnaDe('en_curso')).toBe('cocina')
    expect(columnaDe('listo')).toBe('listos')
  })

  it('entregado va a "Para cobrar": todavía falta la plata', () => {
    expect(columnaDe('completado')).toBe('cobrar')
  })

  it('lo que murió sin cobrarse no cae en ninguna columna', () => {
    expect(columnaDe('cancelado')).toBeNull()
    expect(columnaDe('rechazado')).toBeNull()
  })

  it('agrupa y ordena la cocina por demora que se vence primero', () => {
    const holgado = aVista(
      compromiso({
        id: 'a',
        estado: 'en_curso',
        confirmado_en: '2026-08-20T20:55:00-03:00',
        demora_min: 40,
      }),
      nombre,
    )
    const apurado = aVista(
      compromiso({
        id: 'b',
        estado: 'confirmado',
        confirmado_en: '2026-08-20T20:55:00-03:00',
        demora_min: 10,
      }),
      nombre,
    )
    const pend = aVista(compromiso({ id: 'c', estado: 'pendiente' }), nombre)
    const listo = aVista(compromiso({ id: 'd', estado: 'listo' }), nombre)

    const grupos = agruparPorColumna([holgado, apurado, pend, listo])

    expect(grupos.pendientes.map((p) => p.id)).toEqual(['c'])
    expect(grupos.listos.map((p) => p.id)).toEqual(['d'])
    // el de 10 min de demora vence antes que el de 40: sube en la columna.
    expect(grupos.cocina.map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('la tarjeta del pedido', () => {
  it('el número es corto, estable y sale de la cola del id', () => {
    expect(numeroCorto('11111111-2222-3333-4444-5555aa66bb77')).toBe('#BB77')
  })

  it('arma los ítems con nombre de la carta y la nota como modificador', () => {
    const v = aVista(
      compromiso({
        lineas: [
          { id: 'l1', servicio_id: 's1', cantidad: 2, precio_unit: '9500', subtotal: '19000', nota: 'sin cebolla' },
          { id: 'l2', servicio_id: 's2', cantidad: 1, precio_unit: '3000', subtotal: '3000', nota: null },
        ],
      }),
      nombre,
    )
    expect(v.items).toEqual([
      { cantidad: 2, nombre: 'Doble cheddar', nota: 'sin cebolla' },
      { cantidad: 1, nombre: 'Papas', nota: null },
    ])
  })

  it('el contador se pone en rojo cuando la demora prometida ya se pasó', () => {
    const v = aVista(
      compromiso({ estado: 'en_curso', confirmado_en: '2026-08-20T20:50:00-03:00', demora_min: 20 }),
      nombre,
    )
    const alDia = contadorDemora(v, new Date('2026-08-20T21:00:00-03:00'))
    expect(alDia).toEqual({ texto: '10 min', vencido: false })

    const pasado = contadorDemora(v, new Date('2026-08-20T21:18:00-03:00'))
    expect(pasado).toEqual({ texto: '+8 min', vencido: true })
  })

  it('un pedido sin confirmar todavía no tiene contador', () => {
    const v = aVista(compromiso({ estado: 'pendiente' }), nombre)
    expect(contadorDemora(v, new Date())).toBeNull()
  })
})
