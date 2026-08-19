import { describe, expect, it } from 'vitest'
import type { Agenda } from '../api/tipos'
import { construirRejilla } from './rejilla'

function agenda(): Agenda {
  return {
    fecha: '2026-08-21',
    timezone: 'America/Argentina/Mendoza',
    recursos: [
      {
        recurso_id: 'r1',
        recurso_nombre: 'Dra. Gómez',
        horarios: [{ desde: '09:00', hasta: '12:00' }],
        turnos: [
          {
            compromiso_id: 'c1',
            inicio: '2026-08-21T09:00:00-03:00',
            fin: '2026-08-21T09:30:00-03:00',
            tipo: 'turno',
            estado: 'confirmado',
            cliente_id: 'cl1',
            cliente_nombre: 'Ana Ruiz',
            cliente_telefono: '2615550000',
            total: '15000',
            nota: null,
            cobrado: false,
            comprobante_estado: null,
          },
          {
            compromiso_id: 'c2',
            inicio: '2026-08-21T11:00:00-03:00',
            fin: '2026-08-21T12:00:00-03:00',
            tipo: 'turno',
            estado: 'pendiente',
            cliente_id: 'cl2',
            cliente_nombre: null,
            cliente_telefono: '2615551111',
            total: '20000',
            nota: null,
            cobrado: false,
            comprobante_estado: null,
          },
        ],
      },
    ],
    sin_recurso: [],
  }
}

describe('rejilla de la agenda', () => {
  it('arma el día entre el primer horario y el último', () => {
    const r = construirRejilla(agenda())
    expect(r.desdeMin).toBe(9 * 60)
    expect(r.hastaMin).toBe(12 * 60)
    expect(r.filas).toBe(6)
  })

  it('ubica cada turno en su franja y le da el alto de su duración', () => {
    const columna = construirRejilla(agenda()).columnas[0]!
    const turnos = columna.bloques.filter((b) => b.clase === 'turno')
    expect(turnos).toHaveLength(2)
    expect(turnos[0]).toMatchObject({ fila: 0, filas: 1 })
    expect(turnos[1]).toMatchObject({ fila: 4, filas: 2 })
  })

  it('deja ver el hueco libre y lo cuenta como plata por perder', () => {
    const columna = construirRejilla(agenda()).columnas[0]!
    const huecos = columna.bloques.filter((b) => b.clase === 'hueco')
    expect(huecos).toHaveLength(1)
    expect(huecos[0]).toMatchObject({ fila: 1, filas: 3, desdeMin: 9 * 60 + 30, hastaMin: 11 * 60 })
    expect(columna.minutosLibres).toBe(90)
  })

  it('un día sin nada no rompe la grilla', () => {
    const r = construirRejilla({
      fecha: '2026-08-22',
      timezone: 'America/Argentina/Mendoza',
      recursos: [{ recurso_id: 'r1', recurso_nombre: 'Dra. Gómez', horarios: [], turnos: [] }],
      sin_recurso: [],
    })
    expect(r.filas).toBeGreaterThan(0)
    expect(r.columnas[0]?.bloques).toHaveLength(0)
    expect(r.minutosLibres).toBe(0)
  })
})
