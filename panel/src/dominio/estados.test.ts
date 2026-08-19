import { describe, expect, it } from 'vitest'
import type { Estado } from '../api/tipos'
import { TRANSICIONES, accionesPara, esTerminal, puedeTransicionar } from './estados'

/**
 * Copia literal del grafo de core/internal/model/estado.go. Si el core cambia
 * y esto no, el test se cae: es exactamente lo que queremos que pase.
 */
const GRAFO_DEL_CORE: Record<Estado, Estado[]> = {
  pendiente: ['confirmado', 'rechazado', 'cancelado', 'ausente'],
  confirmado: ['en_curso', 'cancelado', 'ausente'],
  en_curso: ['listo', 'completado'],
  listo: ['completado'],
  completado: [],
  rechazado: [],
  cancelado: [],
  ausente: [],
}

describe('máquina de estados', () => {
  it('es el mismo grafo que el core', () => {
    expect(TRANSICIONES).toEqual(GRAFO_DEL_CORE)
  })

  it('marca terminales lo que el core no deja mover', () => {
    expect(esTerminal('completado')).toBe(true)
    expect(esTerminal('rechazado')).toBe(true)
    expect(esTerminal('cancelado')).toBe(true)
    expect(esTerminal('ausente')).toBe(true)
    expect(esTerminal('pendiente')).toBe(false)
  })

  it('ausente sólo existe en un turno', () => {
    expect(puedeTransicionar('confirmado', 'ausente', 'turno')).toBe(true)
    expect(puedeTransicionar('confirmado', 'ausente', 'pedido')).toBe(false)
    expect(puedeTransicionar('confirmado', 'ausente', 'reserva')).toBe(false)
  })

  it('no ofrece un paso que el core rechazaría', () => {
    for (const estado of Object.keys(GRAFO_DEL_CORE) as Estado[]) {
      for (const tipo of ['turno', 'pedido', 'reserva'] as const) {
        for (const accion of accionesPara(estado, tipo)) {
          expect(GRAFO_DEL_CORE[estado]).toContain(accion.estado)
          if (accion.estado === 'ausente') expect(tipo).toBe('turno')
        }
      }
    }
  })

  it('un turno pendiente se confirma sin preguntar demora', () => {
    const confirmar = accionesPara('pendiente', 'turno').find((a) => a.estado === 'confirmado')
    expect(confirmar?.pideDemora).toBeUndefined()
  })

  it('un pedido pendiente pide la demora antes de confirmar', () => {
    const confirmar = accionesPara('pendiente', 'pedido').find((a) => a.estado === 'confirmado')
    expect(confirmar?.pideDemora).toBe(true)
  })

  it('un estado terminal no tiene botones', () => {
    expect(accionesPara('completado', 'turno')).toHaveLength(0)
    expect(accionesPara('ausente', 'turno')).toHaveLength(0)
    expect(accionesPara('cancelado', 'pedido')).toHaveLength(0)
  })
})
