import { describe, expect, it } from 'vitest'
import type { Cierre, Cobro, Comprobante, EstadoComprobante } from '../api/tipos'
import {
  MEDIOS_PAGO,
  cobradoPorMedio,
  compromisosPorOrigen,
  estadoFactura,
  etiquetaMedio,
  porcentaje,
} from './cobros'

function cobro(over: Partial<Cobro> = {}): Cobro {
  return {
    id: 'co1',
    compromiso_id: 'c1',
    medio_pago: 'efectivo',
    monto: '18500',
    cobrado_en: '2026-08-21T11:05:00-03:00',
    comprobante: null,
    facturacion: 'Este negocio todavia no tiene configuracion fiscal, asi que no se emite factura.',
    ...over,
  }
}

function conComprobante(estado: EstadoComprobante, over: Partial<Comprobante> = {}): Cobro {
  return cobro({
    comprobante: {
      id: 'cb1',
      estado,
      tipo_cbte: 11,
      punto_venta: 1,
      numero: null,
      numero_formateado: null,
      cae: null,
      cae_vence: null,
      importe: '18500',
      intentos: 0,
      ultimo_error: null,
      emitido_en: null,
      ...over,
    },
  })
}

describe('estado de la factura', () => {
  it('cobrado sin datos de ARCA: se cobró igual y se dice por qué no hay factura', () => {
    const f = estadoFactura(cobro())
    expect(f.texto).toBe('Cobrado, sin factura')
    expect(f.detalle).toContain('ARCA')
    expect(f.esperando).toBe(false)
  })

  it('mientras el comprobante está pendiente dice que se está facturando y se sigue preguntando', () => {
    const f = estadoFactura(conComprobante('pendiente'))
    expect(f.texto).toBe('Facturando…')
    expect(f.tono).toBe('espera')
    expect(f.esperando).toBe(true)
  })

  it('emitida muestra el número impreso y el CAE, y deja de preguntar', () => {
    const f = estadoFactura(
      conComprobante('emitido', {
        numero: 123,
        numero_formateado: '0001-00000123',
        cae: '75123456789012',
      }),
    )
    expect(f.texto).toBe('Factura C emitida N° 0001-00000123')
    expect(f.detalle).toBe('CAE 75123456789012')
    expect(f.tono).toBe('bien')
    expect(f.esperando).toBe(false)
  })

  it('con error no se lee ningún código de ARCA, se lee que el cobro quedó guardado', () => {
    const f = estadoFactura(
      conComprobante('error', { intentos: 10, ultimo_error: 'sidecar HTTP 422: CUIT rechazado por WSFEv1' }),
    )
    expect(f.texto).toBe('La factura no salió')
    // El texto de ARCA es para el soporte: no se filtra a la pantalla.
    expect(`${f.texto} ${f.detalle ?? ''}`).not.toContain('WSFEv1')
    expect(f.detalle).toContain('El cobro quedó guardado')
    expect(f.tono).toBe('problema')
  })

  // La tabla entera: ningún estado del core puede dejar la tarjeta muda ni
  // filtrar jerga a la pantalla.
  it.each([
    ['pendiente' as EstadoComprobante],
    ['emitido' as EstadoComprobante],
    ['error' as EstadoComprobante],
  ])('el estado %s se cuenta en criollo', (estado) => {
    const f = estadoFactura(conComprobante(estado))
    expect(f.texto.length).toBeGreaterThan(0)
    expect(f.texto.toLowerCase()).not.toContain('cae pending')
    expect(f.texto).not.toMatch(/\b(pendiente|emitido|error)\b/)
  })
})

describe('piezas del cobro', () => {
  it('los cinco medios de pago del core están y se leen en castellano', () => {
    expect(MEDIOS_PAGO.map((m) => m.medio)).toEqual([
      'efectivo',
      'transferencia',
      'debito',
      'credito',
      'qr',
    ])
    expect(etiquetaMedio('debito')).toBe('Débito')
    expect(etiquetaMedio('qr')).toBe('QR')
  })

  it('el porcentaje redondea y un día sin nada no divide por cero', () => {
    expect(porcentaje(28, 34)).toBe(82)
    expect(porcentaje(0, 0)).toBe(0)
  })
})

describe('cortes del cierre', () => {
  // El core manda mapas sin orden y sólo con lo que tuvo movimiento. La
  // pantalla necesita orden fijo: el ojo busca el efectivo siempre en el mismo
  // renglón.
  const cierre = {
    por_medio_pago: { qr: '52500', efectivo: '210000' },
    por_origen: { panel: 1, whatsapp: 28 },
  } as Cierre

  it('los medios de pago salen en el orden de la botonera y sin los que no se usaron', () => {
    expect(cobradoPorMedio(cierre).map((m) => m.medio)).toEqual(['efectivo', 'qr'])
    expect(cobradoPorMedio(cierre)[0]?.monto).toBe('210000')
  })

  it('los orígenes salen con WhatsApp primero, que es el que importa', () => {
    expect(compromisosPorOrigen(cierre).map((o) => o.etiqueta)).toEqual(['WhatsApp', 'Cargados a mano'])
  })

  it('un día sin movimiento no inventa filas', () => {
    const vacio = { por_medio_pago: {}, por_origen: {} } as Cierre
    expect(cobradoPorMedio(vacio)).toEqual([])
    expect(compromisosPorOrigen(vacio)).toEqual([])
  })
})
