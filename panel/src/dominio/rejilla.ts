/**
 * La agenda es una grilla: filas de media hora, una columna por profesional.
 * Acá se calcula, sin React de por medio, dónde cae cada turno y dónde queda
 * un hueco libre (principio 8: un hueco es plata por perderse).
 */

import type { Agenda, AgendaRecurso, TurnoAgenda } from '../api/tipos'
import { minutosDe, minutosDeHHMM } from './formato'

export const PASO_MIN = 30
const VENTANA_POR_DEFECTO = { desde: 8 * 60, hasta: 20 * 60 }

export interface BloqueTurno {
  clase: 'turno'
  turno: TurnoAgenda
  fila: number
  filas: number
  desdeMin: number
  hastaMin: number
}

export interface BloqueHueco {
  clase: 'hueco'
  fila: number
  filas: number
  desdeMin: number
  hastaMin: number
}

export type Bloque = BloqueTurno | BloqueHueco

export interface ColumnaAgenda {
  recursoID: string
  recursoNombre: string
  bloques: Bloque[]
  minutosLibres: number
}

export interface Rejilla {
  desdeMin: number
  hastaMin: number
  paso: number
  filas: number
  columnas: ColumnaAgenda[]
  /** Etiquetas del canal de horas, una por fila. */
  horas: { fila: number; minutos: number; enPunto: boolean }[]
  minutosLibres: number
  hayAlgo: boolean
}

function duracionDe(turno: TurnoAgenda, paso: number): number {
  const desde = minutosDe(turno.inicio)
  if (!turno.fin) return paso
  const hasta = minutosDe(turno.fin)
  return hasta > desde ? hasta - desde : paso
}

function ventana(agenda: Agenda, paso: number): { desde: number; hasta: number } {
  const inicios: number[] = []
  const finales: number[] = []

  for (const r of agenda.recursos) {
    for (const f of r.horarios) {
      inicios.push(minutosDeHHMM(f.desde))
      finales.push(minutosDeHHMM(f.hasta))
    }
    for (const t of r.turnos) {
      const d = minutosDe(t.inicio)
      inicios.push(d)
      finales.push(d + duracionDe(t, paso))
    }
  }

  if (inicios.length === 0 || finales.length === 0) {
    return { desde: VENTANA_POR_DEFECTO.desde, hasta: VENTANA_POR_DEFECTO.hasta }
  }

  const desde = Math.floor(Math.min(...inicios) / paso) * paso
  const hasta = Math.ceil(Math.max(...finales) / paso) * paso
  return { desde, hasta: Math.max(hasta, desde + paso) }
}

function bloquesDeRecurso(
  recurso: AgendaRecurso,
  desdeMin: number,
  filas: number,
  paso: number,
): { bloques: Bloque[]; minutosLibres: number } {
  const ocupada = new Array<boolean>(filas).fill(false)
  const trabaja = new Array<boolean>(filas).fill(false)

  for (const franja of recurso.horarios) {
    const d = Math.max(0, Math.floor((minutosDeHHMM(franja.desde) - desdeMin) / paso))
    const h = Math.min(filas, Math.ceil((minutosDeHHMM(franja.hasta) - desdeMin) / paso))
    for (let i = d; i < h; i++) trabaja[i] = true
  }

  const bloques: Bloque[] = []
  const turnos = [...recurso.turnos].sort((a, b) => minutosDe(a.inicio) - minutosDe(b.inicio))

  for (const turno of turnos) {
    const inicio = minutosDe(turno.inicio)
    const dur = duracionDe(turno, paso)
    const fila = Math.max(0, Math.floor((inicio - desdeMin) / paso))
    const filaFin = Math.min(filas, Math.max(fila + 1, Math.ceil((inicio + dur - desdeMin) / paso)))
    for (let i = fila; i < filaFin; i++) ocupada[i] = true
    bloques.push({
      clase: 'turno',
      turno,
      fila,
      filas: Math.max(1, filaFin - fila),
      desdeMin: inicio,
      hastaMin: inicio + dur,
    })
  }

  // Huecos: filas declaradas de trabajo que nadie ocupa, unidas de a corridas.
  let libres = 0
  let corrida = -1
  const cerrar = (hasta: number) => {
    if (corrida < 0) return
    const cantidad = hasta - corrida
    bloques.push({
      clase: 'hueco',
      fila: corrida,
      filas: cantidad,
      desdeMin: desdeMin + corrida * paso,
      hastaMin: desdeMin + hasta * paso,
    })
    libres += cantidad * paso
    corrida = -1
  }

  for (let i = 0; i < filas; i++) {
    const libre = trabaja[i] && !ocupada[i]
    if (libre && corrida < 0) corrida = i
    if (!libre) cerrar(i)
  }
  cerrar(filas)

  bloques.sort((a, b) => a.fila - b.fila)
  return { bloques, minutosLibres: libres }
}

export function construirRejilla(agenda: Agenda, paso: number = PASO_MIN): Rejilla {
  const { desde, hasta } = ventana(agenda, paso)
  const filas = Math.max(1, Math.round((hasta - desde) / paso))

  const columnas: ColumnaAgenda[] = agenda.recursos.map((r) => {
    const { bloques, minutosLibres } = bloquesDeRecurso(r, desde, filas, paso)
    return {
      recursoID: r.recurso_id,
      recursoNombre: r.recurso_nombre,
      bloques,
      minutosLibres,
    }
  })

  const horas = Array.from({ length: filas }, (_, i) => ({
    fila: i,
    minutos: desde + i * paso,
    enPunto: (desde + i * paso) % 60 === 0,
  }))

  const hayAlgo =
    agenda.recursos.some((r) => r.turnos.length > 0 || r.horarios.length > 0) ||
    agenda.sin_recurso.length > 0

  return {
    desdeMin: desde,
    hastaMin: hasta,
    paso,
    filas,
    columnas,
    horas,
    minutosLibres: columnas.reduce((t, c) => t + c.minutosLibres, 0),
    hayAlgo,
  }
}
