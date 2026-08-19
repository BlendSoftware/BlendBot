/**
 * Espejo exacto de core/internal/model/estado.go. La UI nunca ofrece un botón
 * que el core vaya a rechazar: si el grafo cambia allá, cambia acá y el test
 * de la tabla lo canta.
 *
 * Regla de negocio que el grafo no expresa (vive en el service): AUSENTE sólo
 * aplica a un turno.
 */

import type { Estado, TipoCompromiso } from '../api/tipos'

export const TRANSICIONES: Record<Estado, Estado[]> = {
  pendiente: ['confirmado', 'rechazado', 'cancelado', 'ausente'],
  confirmado: ['en_curso', 'cancelado', 'ausente'],
  en_curso: ['listo', 'completado'],
  listo: ['completado'],
  completado: [],
  rechazado: [],
  cancelado: [],
  ausente: [],
}

export function puedeTransicionar(desde: Estado, hacia: Estado, tipo: TipoCompromiso): boolean {
  if (hacia === 'ausente' && tipo !== 'turno') return false
  return TRANSICIONES[desde].includes(hacia)
}

export function esTerminal(estado: Estado): boolean {
  return TRANSICIONES[estado].length === 0
}

export type Tono = 'primario' | 'neutro' | 'peligro'

export interface Accion {
  estado: Estado
  etiqueta: string
  tono: Tono
  /** Confirmar un pedido o una reserva promete una demora; un turno ya tiene hora. */
  pideDemora?: boolean
}

/** Los botones que se dibujan en la tarjeta, en el orden en que se tocan. */
export function accionesPara(estado: Estado, tipo: TipoCompromiso): Accion[] {
  const esTurno = tipo === 'turno'
  const acciones: Accion[] = []

  switch (estado) {
    case 'pendiente':
      acciones.push({
        estado: 'confirmado',
        etiqueta: 'Confirmar',
        tono: 'primario',
        ...(esTurno ? {} : { pideDemora: true }),
      })
      acciones.push({ estado: 'rechazado', etiqueta: 'Rechazar', tono: 'peligro' })
      if (esTurno) acciones.push({ estado: 'ausente', etiqueta: 'No vino', tono: 'neutro' })
      break
    case 'confirmado':
      acciones.push({
        estado: 'en_curso',
        etiqueta: esTurno ? 'Pasó' : 'Empezar',
        tono: 'primario',
      })
      if (esTurno) acciones.push({ estado: 'ausente', etiqueta: 'No vino', tono: 'neutro' })
      acciones.push({ estado: 'cancelado', etiqueta: 'Cancelar', tono: 'peligro' })
      break
    case 'en_curso':
      acciones.push({
        estado: 'completado',
        etiqueta: esTurno ? 'Terminó' : 'Entregado',
        tono: 'primario',
      })
      if (!esTurno) acciones.push({ estado: 'listo', etiqueta: 'Listo', tono: 'neutro' })
      break
    case 'listo':
      acciones.push({ estado: 'completado', etiqueta: 'Entregado', tono: 'primario' })
      break
    default:
      break
  }

  return acciones.filter((a) => puedeTransicionar(estado, a.estado, tipo))
}

/** Lo que se lee en pantalla. Nunca el valor crudo del enum. */
export function etiquetaEstado(estado: Estado, tipo: TipoCompromiso): string {
  switch (estado) {
    case 'pendiente':
      return 'sin confirmar'
    case 'confirmado':
      return 'confirmado'
    case 'en_curso':
      return tipo === 'turno' ? 'atendiendo' : 'en curso'
    case 'listo':
      return 'listo'
    case 'completado':
      return tipo === 'turno' ? 'atendido' : 'entregado'
    case 'rechazado':
      return 'rechazado'
    case 'cancelado':
      return 'cancelado'
    case 'ausente':
      return 'no vino'
  }
}

/** Fondo del bloque. El estado se lee de lejos por color, no por texto. */
export const COLOR_ESTADO: Record<Estado, string> = {
  pendiente: 'var(--pendiente)',
  confirmado: 'var(--confirmado)',
  en_curso: 'var(--en-curso)',
  listo: 'var(--listo)',
  completado: 'var(--panel)',
  rechazado: 'var(--panel)',
  cancelado: 'var(--panel)',
  ausente: 'var(--vencido)',
}

export const TINTA_ESTADO: Record<Estado, string> = {
  pendiente: 'var(--sobre-pendiente)',
  confirmado: 'var(--sobre-confirmado)',
  en_curso: 'var(--sobre-en-curso)',
  listo: 'var(--sobre-listo)',
  completado: 'var(--tinta-suave)',
  rechazado: 'var(--tinta-suave)',
  cancelado: 'var(--tinta-suave)',
  ausente: 'var(--sobre-vencido)',
}

/** Los estados que siguen ocupando la agenda del día. */
export const ESTADOS_VIVOS: Estado[] = ['pendiente', 'confirmado', 'en_curso', 'listo']
