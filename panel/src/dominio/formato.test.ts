import { describe, expect, it } from 'vitest'
import { finDelDiaEnZona, inicioDelDiaEnZona } from './formato'

// Una ausencia se guarda en la zona del NEGOCIO, no en la del navegador que la
// carga, y cubre el día entero. Antes se construía con `new Date('...T00:00:00')`
// —zona del navegador— y cerraba a las 23:59, dejando el último minuto del día
// fuera de la ausencia (H12).
describe('rangos de un día en la zona del negocio', () => {
  it('arranca a la medianoche del negocio, con su offset', () => {
    expect(inicioDelDiaEnZona('2026-08-21', 'America/Argentina/Mendoza')).toBe(
      '2026-08-21T00:00:00-03:00',
    )
  })

  it('cierra a la medianoche del día siguiente, no a las 23:59', () => {
    const fin = finDelDiaEnZona('2026-08-21', 'America/Argentina/Mendoza')
    expect(fin).toBe('2026-08-22T00:00:00-03:00')
    expect(fin).not.toContain('23:59')
  })

  it('el rango cubre el último minuto del día', () => {
    const desde = new Date(inicioDelDiaEnZona('2026-08-21', 'America/Argentina/Mendoza'))
    const hasta = new Date(finDelDiaEnZona('2026-08-21', 'America/Argentina/Mendoza'))
    const ultimoTurno = new Date('2026-08-21T23:59:30-03:00')
    expect(ultimoTurno >= desde && ultimoTurno < hasta).toBe(true)
  })

  it('usa la zona del negocio y no la del navegador', () => {
    // Dos zonas distintas para el mismo día calendario dan instantes distintos:
    // si se ignorara el parámetro, saldrían iguales.
    const mendoza = inicioDelDiaEnZona('2026-08-21', 'America/Argentina/Mendoza')
    const madrid = inicioDelDiaEnZona('2026-08-21', 'Europe/Madrid')
    expect(mendoza).not.toBe(madrid)
    expect(madrid).toBe('2026-08-21T00:00:00+02:00') // verano europeo
  })

  it('respeta el horario de verano del día que se pide', () => {
    // Madrid: +01:00 en invierno, +02:00 en verano. El offset no es de la zona,
    // es de la zona EN ESE DÍA.
    expect(inicioDelDiaEnZona('2026-01-15', 'Europe/Madrid')).toBe('2026-01-15T00:00:00+01:00')
    expect(inicioDelDiaEnZona('2026-07-15', 'Europe/Madrid')).toBe('2026-07-15T00:00:00+02:00')
  })
})
