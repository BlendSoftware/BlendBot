/**
 * Lo que se lee cuando se cobra. Dos reglas mandan acá:
 *
 * 1. La secretaria nunca lee jerga. No existe "CAE pending", no existe un 422:
 *    existe "Facturando…" y existe "Factura C emitida".
 * 2. El estado del comprobante es una tabla, no un if suelto en la vista: si
 *    mañana el core agrega un estado, se agrega acá y el test lo canta.
 */

import type { Cierre, Cobro, MedioPago, OrigenCompromiso, Plata } from '../api/tipos'

/** Los cinco del CHECK de la tabla `cobro`, en el orden en que se tocan. */
export const MEDIOS_PAGO: { medio: MedioPago; etiqueta: string }[] = [
  { medio: 'efectivo', etiqueta: 'Efectivo' },
  { medio: 'transferencia', etiqueta: 'Transferencia' },
  { medio: 'debito', etiqueta: 'Débito' },
  { medio: 'credito', etiqueta: 'Crédito' },
  { medio: 'qr', etiqueta: 'QR' },
]

export function etiquetaMedio(medio: MedioPago): string {
  return MEDIOS_PAGO.find((m) => m.medio === medio)?.etiqueta ?? medio
}

/** Cómo entró el compromiso, contado como lo cuenta el dueño. */
export function etiquetaOrigen(origen: OrigenCompromiso): string {
  switch (origen) {
    case 'whatsapp':
      return 'WhatsApp'
    case 'telefono':
      return 'Teléfono'
    case 'panel':
      return 'Cargados a mano'
  }
}

export type TonoFactura = 'espera' | 'bien' | 'problema' | 'apagado'

export interface EstadoFactura {
  texto: string
  detalle?: string
  tono: TonoFactura
  /** true mientras valga la pena volver a preguntar por este cobro. */
  esperando: boolean
}

/** LA tabla: un cobro entra, una frase sale. */
export function estadoFactura(cobro: Cobro): EstadoFactura {
  const c = cobro.comprobante

  if (!c) {
    return {
      texto: 'Cobrado, sin factura',
      detalle: 'Para que salga la factura hay que cargar los datos de ARCA del negocio.',
      tono: 'apagado',
      esperando: false,
    }
  }

  switch (c.estado) {
    case 'pendiente':
      return {
        texto: 'Facturando…',
        detalle: 'La factura se emite sola en unos segundos.',
        tono: 'espera',
        esperando: true,
      }
    case 'emitido':
      return {
        texto: c.numero_formateado
          ? `Factura C emitida N° ${c.numero_formateado}`
          : 'Factura C emitida',
        ...(c.cae ? { detalle: `CAE ${c.cae}` } : {}),
        tono: 'bien',
        esperando: false,
      }
    case 'error':
      // ultimo_error trae el texto de ARCA, que es para el soporte y no para
      // el mostrador. Acá se dice qué pasó y qué hacer, nada más.
      return {
        texto: 'La factura no salió',
        detalle: 'El cobro quedó guardado igual. Seguimos intentando; si no sale, revisá los datos de ARCA.',
        tono: 'problema',
        esperando: false,
      }
  }
}

/** Porcentaje entero para mostrar al lado de un número. 0 de 0 es 0. */
export function porcentaje(parte: number, total: number): number {
  if (!total) return 0
  return Math.round((parte / total) * 100)
}

/**
 * El corte por medio de pago viene como mapa y sin orden. Se ordena como la
 * botonera del cobro, así el ojo encuentra siempre el efectivo en el mismo
 * lugar, y se saltean los medios que nadie usó.
 */
export function cobradoPorMedio(cierre: Cierre): { medio: MedioPago; etiqueta: string; monto: Plata }[] {
  return MEDIOS_PAGO.filter((m) => cierre.por_medio_pago[m.medio] !== undefined).map((m) => ({
    medio: m.medio,
    etiqueta: m.etiqueta,
    monto: cierre.por_medio_pago[m.medio] as Plata,
  }))
}

const ORDEN_ORIGEN: OrigenCompromiso[] = ['whatsapp', 'telefono', 'panel']

/** Lo mismo para el corte por dónde entró: orden fijo y sin claves vacías. */
export function compromisosPorOrigen(
  cierre: Cierre,
): { origen: OrigenCompromiso; etiqueta: string; cantidad: number }[] {
  return ORDEN_ORIGEN.filter((o) => cierre.por_origen[o] !== undefined).map((o) => ({
    origen: o,
    etiqueta: etiquetaOrigen(o),
    cantidad: cierre.por_origen[o] as number,
  }))
}
