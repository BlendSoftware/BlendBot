import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Comprobante } from './Comprobante'
import { ErrorApi } from '../api/cliente'

const { miConfigFiscal, traerCobro, traerCompromiso, listarServicios } = vi.hoisted(() => ({
  miConfigFiscal: vi.fn(),
  traerCobro: vi.fn(),
  traerCompromiso: vi.fn(),
  listarServicios: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  miConfigFiscal,
  traerCobro,
  traerCompromiso,
  listarServicios,
  datosDelNegocio: vi.fn().mockResolvedValue(null),
}))

const FISCAL = {
  negocio_id: 'n1',
  cuit: '20123456789',
  razon_social: 'La Parrilla del Che SRL',
  condicion: 'monotributo',
  punto_venta: 1,
  modo: 'produccion',
  tiene_certificados: true,
  actualizado_en: '2026-08-25T10:00:00-03:00',
}

const COBRO = {
  id: 'cb1',
  compromiso_id: 'c1',
  medio_pago: 'efectivo',
  monto: '12700',
  cobrado_en: '2026-08-25T21:30:00-03:00',
  facturacion: 'Factura C emitida.',
  comprobante: {
    id: 'cp1',
    estado: 'emitido',
    tipo_cbte: 11,
    punto_venta: 1,
    numero: 123,
    numero_formateado: '0001-00000123',
    cae: '75123456789012',
    cae_vence: '2026-09-04',
    importe: '12700',
    intentos: 1,
    ultimo_error: null,
    emitido_en: '2026-08-25T21:30:05-03:00',
  },
}

const PEDIDO = {
  id: 'c1',
  negocio_id: 'n1',
  cliente_id: 'cl1',
  cliente_nombre: 'Marcela Funes',
  cliente_telefono: '2615551001',
  recurso_id: null,
  tipo: 'pedido',
  estado: 'completado',
  inicio: null,
  fin: null,
  demora_min: 30,
  entrega: 'delivery',
  direccion: 'San Martín 850',
  total: '12700',
  origen: 'whatsapp',
  nota: null,
  creado_en: '2026-08-25T21:00:00-03:00',
  confirmado_en: '2026-08-25T21:02:00-03:00',
  cerrado_en: null,
  lineas: [
    { id: 'l1', servicio_id: 's1', cantidad: 1, precio_unit: '9500', subtotal: '9500', nota: null },
    { id: 'l2', servicio_id: 's2', cantidad: 1, precio_unit: '3200', subtotal: '3200', nota: 'sin nueces' },
  ],
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/comprobante/c1']}>
      <Routes>
        <Route path="/comprobante/:compromisoID" element={<Comprobante />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  traerCobro.mockResolvedValue(COBRO)
  traerCompromiso.mockResolvedValue(PEDIDO)
  miConfigFiscal.mockResolvedValue(FISCAL)
  listarServicios.mockResolvedValue([
    { id: 's1', nombre: 'Tabla de fiambres' },
    { id: 's2', nombre: 'Helado (2 bochas)' },
  ])
})

describe('comprobante impreso', () => {
  it('lleva los datos fiscales del negocio, no sólo su nombre de fantasía', async () => {
    montar()

    expect(await screen.findByText('La Parrilla del Che SRL')).toBeInTheDocument()
    expect(screen.getByText(/CUIT 20-12345678-9/)).toBeInTheDocument()
    expect(screen.getByText(/Responsable Monotributo/)).toBeInTheDocument()
    expect(screen.getByText('Factura C')).toBeInTheDocument()
    expect(screen.getByText('0001-00000123')).toBeInTheDocument()
  })

  it('detalla los ítems con su nombre de la carta, no el uuid del servicio', async () => {
    montar()

    expect(await screen.findByText('Tabla de fiambres')).toBeInTheDocument()
    expect(screen.getByText(/Helado \(2 bochas\)/)).toBeInTheDocument()
    expect(screen.getByText(/sin nueces/)).toBeInTheDocument()
    expect(screen.queryByText('s1')).not.toBeInTheDocument()
  })

  it('muestra el CAE y su vencimiento cuando la factura salió', async () => {
    montar()

    expect(await screen.findByText('75123456789012')).toBeInTheDocument()
    expect(screen.getByText('2026-09-04')).toBeInTheDocument()
    expect(screen.getByTitle('QR de AFIP')).toBeInTheDocument()
  })

  it('sin factura emitida no inventa un QR ni un CAE', async () => {
    traerCobro.mockResolvedValue({
      ...COBRO,
      comprobante: null,
      facturacion: 'Este negocio todavia no tiene configuracion fiscal.',
    })
    montar()

    expect(await screen.findByText(/no una factura/)).toBeInTheDocument()
    expect(screen.queryByTitle('QR de AFIP')).not.toBeInTheDocument()
    expect(screen.queryByText('75123456789012')).not.toBeInTheDocument()
  })

  it('avisa cuando es de homologación: no tiene validez fiscal', async () => {
    miConfigFiscal.mockResolvedValue({ ...FISCAL, modo: 'homologacion' })
    montar()

    expect(await screen.findByText(/PRUEBA/)).toBeInTheDocument()
    expect(screen.getByText(/No tiene\s+validez fiscal/)).toBeInTheDocument()
  })

  it('sin datos fiscales cargados igual imprime el detalle del cobro', async () => {
    miConfigFiscal.mockRejectedValue(new ErrorApi(404, 'no hay', 'Eso ya no está.'))
    traerCobro.mockResolvedValue({ ...COBRO, comprobante: null, facturacion: 'Sin config fiscal.' })
    montar()

    expect(await screen.findByText('Marcela Funes')).toBeInTheDocument()
    expect(screen.queryByText(/CUIT/)).not.toBeInTheDocument()
  })

  it('un pedido que no se cobró lo dice, en vez de mostrar un papel vacío', async () => {
    traerCobro.mockRejectedValue(new ErrorApi(404, 'no hay', 'Eso ya no está.'))
    montar()

    expect(await screen.findByText(/todavía no se cobró/)).toBeInTheDocument()
  })
})
