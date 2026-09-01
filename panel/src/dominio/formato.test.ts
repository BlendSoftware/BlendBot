import { describe, expect, it } from 'vitest'
import { finDelDiaEnZona, horaDe, inicioDelDiaEnZona, minutosDe } from './formato'

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

// El otro lado del contrato de la capability `hora-local` del core.
//
// `horaDe` corta el string sin convertir husos, y eso es correcto SIEMPRE Y
// CUANDO el core mande la hora ya en la zona del negocio. Ese contrato vivía
// sólo en un comentario; acá queda fijado en un test, que es lo que evita que
// alguien "arregle" horaDe agregándole una conversión el día que vea un `Z`.
describe('horaDe respeta el contrato: el core ya localizó', () => {
  it('lee la hora de pared del string, sin convertir el huso', () => {
    // 20:22 en Buenos Aires. El navegador puede estar en cualquier lado: el
    // dueño y su encargado tienen que ver el mismo número.
    expect(horaDe('2026-08-31T20:22:38.933379-03:00')).toBe('20:22')
  })

  it('no convierte a la zona del navegador', () => {
    // El mismo instante expresado en +05:30. Si horaDe convirtiera, devolvería
    // otra cosa según dónde corra el test.
    expect(horaDe('2026-09-01T04:52:38+05:30')).toBe('04:52')
  })

  it('una hora en Z se muestra tal cual, que es por qué el core no debe mandarla', () => {
    // Este es el bug que la capability `hora-local` eliminó del core: una
    // consulta hecha 20:22 en Mendoza viajaba como 23:22Z y el panel mostraba
    // 23:22. El panel nunca estuvo mal; el core mandaba mal.
    expect(horaDe('2026-08-31T23:22:38.933379Z')).toBe('23:22')
  })

  it('minutosDe lee el mismo string con el mismo criterio', () => {
    expect(minutosDe('2026-08-31T20:22:38-03:00')).toBe(20 * 60 + 22)
  })
})
