/**
 * El tablero de cocina agrupa los pedidos vivos en tres columnas. El motor no
 * se toca (E10): esto sólo reordena y presenta lo que ya devuelve el core.
 *
 * Mapa de columnas: un pedido confirmado ya está en la cocina aunque nadie haya
 * apretado "Empezar", así que PENDIENTES = pendiente, EN COCINA = confirmado +
 * en_curso, LISTOS = listo. Los estados terminales caen solos del tablero.
 */

import type { Compromiso, Estado, TipoEntrega } from '../api/tipos'

export type Columna = 'pendientes' | 'cocina' | 'listos' | 'cobrar'

export const COLUMNAS: Columna[] = ['pendientes', 'cocina', 'listos', 'cobrar']

export const TITULO_COLUMNA: Record<Columna, string> = {
  pendientes: 'Pendientes',
  cocina: 'En cocina',
  listos: 'Listos',
  cobrar: 'Para cobrar',
}

const COLUMNA_DE_ESTADO: Partial<Record<Estado, Columna>> = {
  pendiente: 'pendientes',
  confirmado: 'cocina',
  en_curso: 'cocina',
  listo: 'listos',
  // Entregado no es el final: falta la plata. Sin esta columna la tarjeta
  // desaparecía del tablero sin haberse cobrado nunca, y no había desde dónde
  // llegar al comprobante.
  completado: 'cobrar',
}

export function columnaDe(estado: Estado): Columna | null {
  return COLUMNA_DE_ESTADO[estado] ?? null
}

export interface ItemPedido {
  cantidad: number
  nombre: string
  /** El modificador viaja en la nota de la línea ("sin cebolla"). */
  nota: string | null
}

export interface PedidoVista {
  id: string
  /** Referencia corta para cantar en la cocina. */
  numero: string
  /** De quién es el pedido: el nombre puede faltar, el teléfono no. */
  clienteNombre: string | null
  clienteTelefono: string
  estado: Estado
  total: string
  entrega: TipoEntrega | null
  direccion: string | null
  demoraMin: number | null
  confirmadoEn: string | null
  creadoEn: string
  nota: string | null
  items: ItemPedido[]
}

/**
 * Número que se lee de un vistazo y se canta en la cocina. Sale de la cola del
 * id: es estable (no se re-numera cuando un pedido sale) y el mismo pedido se
 * llama igual en el tablero y en la comanda. TODO: cuando el core dé un número
 * de pedido del día, usar ese.
 */
export function numeroCorto(id: string): string {
  const hex = id.replace(/[^0-9a-fA-F]/g, '')
  const cola = (hex || id).slice(-4).toUpperCase()
  return `#${cola}`
}

export function itemsDe(
  compromiso: Compromiso,
  nombreDeServicio: (servicioID: string) => string,
): ItemPedido[] {
  return compromiso.lineas.map((l) => ({
    cantidad: l.cantidad,
    nombre: nombreDeServicio(l.servicio_id),
    nota: l.nota,
  }))
}

export function aVista(
  compromiso: Compromiso,
  nombreDeServicio: (servicioID: string) => string,
): PedidoVista {
  return {
    id: compromiso.id,
    numero: numeroCorto(compromiso.id),
    clienteNombre: compromiso.cliente_nombre,
    clienteTelefono: compromiso.cliente_telefono,
    estado: compromiso.estado,
    total: compromiso.total,
    entrega: compromiso.entrega,
    direccion: compromiso.direccion,
    demoraMin: compromiso.demora_min,
    confirmadoEn: compromiso.confirmado_en,
    creadoEn: compromiso.creado_en,
    nota: compromiso.nota,
    items: itemsDe(compromiso, nombreDeServicio),
  }
}

/** Instante en que se vence la demora prometida, en ms. Sin demora, nunca. */
export function plazoLimite(pedido: PedidoVista): number {
  if (!pedido.confirmadoEn || pedido.demoraMin == null) return Number.POSITIVE_INFINITY
  const base = Date.parse(pedido.confirmadoEn)
  if (Number.isNaN(base)) return Number.POSITIVE_INFINITY
  return base + pedido.demoraMin * 60000
}

/** El contador de la cocina: minutos que faltan, en rojo cuando ya se pasó. */
export function contadorDemora(
  pedido: PedidoVista,
  ahora: Date,
): { texto: string; vencido: boolean } | null {
  if (!pedido.confirmadoEn || pedido.demoraMin == null) return null
  const limite = plazoLimite(pedido)
  if (!Number.isFinite(limite)) return null
  const m = Math.round((limite - ahora.getTime()) / 60000)
  return m >= 0 ? { texto: `${m} min`, vencido: false } : { texto: `+${Math.abs(m)} min`, vencido: true }
}

function porCreado(a: PedidoVista, b: PedidoVista): number {
  return Date.parse(a.creadoEn) - Date.parse(b.creadoEn)
}

/**
 * Reparte los pedidos en las tres columnas. Los que están en cocina se ordenan
 * por cuánto les queda de demora: el que está por vencer (o ya vencido) sube.
 * El resto, por orden de llegada: primero el que espera hace más.
 */
export function agruparPorColumna(pedidos: PedidoVista[]): Record<Columna, PedidoVista[]> {
  const grupos: Record<Columna, PedidoVista[]> = {
    pendientes: [],
    cocina: [],
    listos: [],
    cobrar: [],
  }
  for (const p of pedidos) {
    const col = columnaDe(p.estado)
    if (col) grupos[col].push(p)
  }
  grupos.pendientes.sort(porCreado)
  grupos.listos.sort(porCreado)
  grupos.cocina.sort((a, b) => plazoLimite(a) - plazoLimite(b) || porCreado(a, b))
  // Para cobrar va al revés que el resto: el que se acaba de entregar es el que
  // se está cobrando ahora, así que va arriba.
  grupos.cobrar.sort((a, b) => porCreado(b, a))
  return grupos
}
