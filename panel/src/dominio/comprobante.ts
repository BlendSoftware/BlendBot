/**
 * Lo que necesita el comprobante impreso y no es pintura: el QR de AFIP y los
 * nombres de las cosas.
 *
 * El QR es el de la RG 4892: un JSON con los datos del comprobante, en base64,
 * colgado de https://www.afip.gob.ar/fe/qr/?p=… Lo arma el emisor (nosotros),
 * no ARCA — por eso se puede calcular acá con lo que ya devuelve el core.
 */

import type { ConfigFiscal } from '../api/tipos'

/** Factura C: la del monotributista, que no discrimina IVA. */
export const TIPO_FACTURA_C = 11

const TIPOS_COMPROBANTE: Record<number, string> = {
  1: 'Factura A',
  6: 'Factura B',
  11: 'Factura C',
  51: 'Factura M',
}

export function nombreTipoComprobante(tipo: number): string {
  return TIPOS_COMPROBANTE[tipo] ?? `Comprobante tipo ${tipo}`
}

/** Sin doc del receptor, AFIP espera tipo 99 y número 0 (consumidor final). */
const DOC_CONSUMIDOR_FINAL = 99

export interface DatosQR {
  cuit: string
  puntoVenta: number
  tipoComprobante: number
  numero: number
  /** YYYY-MM-DD, la fecha de emisión. */
  fecha: string
  importe: number
  receptorDocTipo?: number
  receptorDocNro?: string | null
  cae: string
}

/**
 * base64 de UTF-8. `btoa` sola rompe con cualquier byte >255, y una razón
 * social con acentos alcanza para romperla.
 */
function base64Utf8(texto: string): string {
  const bytes = new TextEncoder().encode(texto)
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario)
}

/** Sólo dígitos: el CUIT viaja como número, sin los guiones que se muestran. */
export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '')
}

/**
 * La URL que codifica el QR. Devuelve null si falta algo de lo obligatorio:
 * sin CAE ni número no hay comprobante que verificar, y un QR a medias es
 * peor que ninguno (escanea y da error).
 */
export function urlQrAfip(d: DatosQR): string | null {
  const cuit = Number(soloDigitos(d.cuit))
  if (!cuit || !d.cae || !d.numero || !d.fecha) return null

  const datos = {
    ver: 1,
    fecha: d.fecha,
    cuit,
    ptoVta: d.puntoVenta,
    tipoCmp: d.tipoComprobante,
    nroCmp: d.numero,
    importe: d.importe,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: d.receptorDocTipo ?? DOC_CONSUMIDOR_FINAL,
    nroDocRec: Number(soloDigitos(d.receptorDocNro ?? '')) || 0,
    tipoCodAut: 'E',
    codAut: Number(d.cae),
  }
  return `https://www.afip.gob.ar/fe/qr/?p=${base64Utf8(JSON.stringify(datos))}`
}

/** CUIT legible: 20-12345678-9. Si no tiene 11 dígitos, se muestra como vino. */
export function cuitVisible(cuit: string): string {
  const d = soloDigitos(cuit)
  if (d.length !== 11) return cuit
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}

const CONDICIONES: Record<string, string> = {
  monotributo: 'Responsable Monotributo',
  responsable_inscripto: 'Responsable Inscripto',
  exento: 'Exento',
}

export function condicionVisible(condicion: string | null): string {
  if (!condicion) return 'Responsable Monotributo'
  return CONDICIONES[condicion] ?? condicion
}

/**
 * Un comprobante emitido en homologación NO es válido: es el entorno de
 * pruebas de ARCA. El documento tiene que decirlo, o alguien lo entrega
 * pensando que factura.
 */
export function esPrueba(fiscal: ConfigFiscal | null): boolean {
  return fiscal?.modo === 'homologacion'
}
