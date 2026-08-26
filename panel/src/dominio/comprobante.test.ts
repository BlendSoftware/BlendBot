import { describe, expect, it } from 'vitest'
import {
  condicionVisible,
  cuitVisible,
  esPrueba,
  nombreTipoComprobante,
  urlQrAfip,
} from './comprobante'
import type { ConfigFiscal } from '../api/tipos'

const QR_OK = {
  cuit: '20-12345678-9',
  puntoVenta: 1,
  tipoComprobante: 11,
  numero: 123,
  fecha: '2026-08-25',
  importe: 12700,
  cae: '75123456789012',
}

function cargaDelQr(url: string): Record<string, unknown> {
  const b64 = url.split('?p=')[1] ?? ''
  const binario = atob(b64)
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

describe('QR de AFIP', () => {
  it('codifica los datos del comprobante como pide la RG 4892', () => {
    const url = urlQrAfip(QR_OK)
    expect(url).toContain('https://www.afip.gob.ar/fe/qr/?p=')

    const carga = cargaDelQr(url!)
    expect(carga).toMatchObject({
      ver: 1,
      fecha: '2026-08-25',
      cuit: 20123456789, // sin guiones y como número
      ptoVta: 1,
      tipoCmp: 11,
      nroCmp: 123,
      importe: 12700,
      moneda: 'PES',
      ctz: 1,
      tipoCodAut: 'E',
      codAut: 75123456789012,
    })
  })

  it('sin documento del cliente va como consumidor final', () => {
    const carga = cargaDelQr(urlQrAfip(QR_OK)!)
    expect(carga.tipoDocRec).toBe(99)
    expect(carga.nroDocRec).toBe(0)
  })

  it('con DNI del cliente lo lleva', () => {
    const carga = cargaDelQr(
      urlQrAfip({ ...QR_OK, receptorDocTipo: 96, receptorDocNro: '30.123.456' })!,
    )
    expect(carga.tipoDocRec).toBe(96)
    expect(carga.nroDocRec).toBe(30123456)
  })

  it('sin CAE no hay QR: uno a medias escanea y da error', () => {
    expect(urlQrAfip({ ...QR_OK, cae: '' })).toBeNull()
    expect(urlQrAfip({ ...QR_OK, numero: 0 })).toBeNull()
    expect(urlQrAfip({ ...QR_OK, cuit: '' })).toBeNull()
  })

  it('aguanta una razón social con acentos sin romper el base64', () => {
    // btoa() sola explota con cualquier byte > 255; el encoder pasa por UTF-8.
    expect(() => urlQrAfip({ ...QR_OK, receptorDocNro: 'ñÁ' })).not.toThrow()
  })
})

describe('datos del emisor', () => {
  it('formatea el CUIT como se imprime', () => {
    expect(cuitVisible('20123456789')).toBe('20-12345678-9')
    expect(cuitVisible('20-12345678-9')).toBe('20-12345678-9')
  })

  it('un CUIT incompleto se muestra tal cual, sin inventar formato', () => {
    expect(cuitVisible('2012345')).toBe('2012345')
  })

  it('traduce la condición frente al IVA', () => {
    expect(condicionVisible('monotributo')).toBe('Responsable Monotributo')
    expect(condicionVisible(null)).toBe('Responsable Monotributo')
    expect(condicionVisible('otra_cosa')).toBe('otra_cosa')
  })

  it('nombra el tipo de comprobante', () => {
    expect(nombreTipoComprobante(11)).toBe('Factura C')
    expect(nombreTipoComprobante(6)).toBe('Factura B')
    expect(nombreTipoComprobante(999)).toBe('Comprobante tipo 999')
  })
})

describe('modo homologación', () => {
  const base: ConfigFiscal = {
    negocio_id: 'n1',
    cuit: '20123456789',
    razon_social: 'La Parrilla',
    condicion: 'monotributo',
    punto_venta: 1,
    modo: 'homologacion',
    tiene_certificados: true,
    actualizado_en: '2026-08-25T10:00:00-03:00',
  }

  it('homologación es prueba: el papel tiene que decirlo', () => {
    expect(esPrueba(base)).toBe(true)
  })

  it('producción no', () => {
    expect(esPrueba({ ...base, modo: 'produccion' })).toBe(false)
  })

  it('sin config fiscal tampoco: no hay factura de la que avisar', () => {
    expect(esPrueba(null)).toBe(false)
  })
})
