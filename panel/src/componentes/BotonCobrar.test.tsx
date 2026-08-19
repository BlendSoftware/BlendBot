import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cobro, EstadoComprobante } from '../api/tipos'
import { BotonCobrar } from './BotonCobrar'

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  })
}

function cobro(estado: EstadoComprobante | null, over: Partial<Cobro> = {}): Cobro {
  return {
    id: 'co1',
    compromiso_id: 'c1',
    medio_pago: 'efectivo',
    monto: '18500',
    cobrado_en: '2026-08-21T11:05:00-03:00',
    facturacion: 'Facturando…',
    comprobante:
      estado === null
        ? null
        : {
            id: 'cb1',
            estado,
            tipo_cbte: 11,
            punto_venta: 1,
            numero: estado === 'emitido' ? 123 : null,
            numero_formateado: estado === 'emitido' ? '0001-00000123' : null,
            cae: estado === 'emitido' ? '75123456789012' : null,
            cae_vence: estado === 'emitido' ? '2026-09-05' : null,
            importe: '18500',
            intentos: 0,
            ultimo_error: null,
            emitido_en: null,
          },
    ...over,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('cobrar desde la tarjeta', () => {
  it('el popover ofrece los cinco medios y el elegido va a POST /api/cobros', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(json(201, cobro('pendiente', { medio_pago: 'transferencia' })))
    vi.stubGlobal('fetch', fetchFalso)

    render(<BotonCobrar compromisoID="c1" total="18500" cobroInicial={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    const popover = screen.getByRole('group', { name: 'Con qué pagó' })
    expect(
      Array.from(popover.querySelectorAll('button')).map((b) => b.textContent),
    ).toEqual(['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'QR'])

    await userEvent.click(screen.getByRole('button', { name: 'Transferencia' }))

    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const [ruta, opciones] = fetchFalso.mock.calls[0] as [string, RequestInit]
    expect(ruta).toBe('/api/cobros')
    expect(opciones.method).toBe('POST')
    expect(JSON.parse(String(opciones.body))).toEqual({
      compromiso_id: 'c1',
      medio_pago: 'transferencia',
    })

    // Cobrado: el popover se va y en su lugar queda el estado de la factura.
    expect(await screen.findByText('Facturando…')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Con qué pagó' })).not.toBeInTheDocument()
  })

  it('cobrar dos veces el mismo turno se cuenta como lo que es, sin códigos', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(json(409, { detail: 'el compromiso ya fue cobrado' }))
    vi.stubGlobal('fetch', fetchFalso)

    render(<BotonCobrar compromisoID="c1" total="18500" cobroInicial={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Efectivo' }))

    expect(await screen.findByText('Este turno ya lo cobraron.')).toBeInTheDocument()
    expect(screen.queryByText(/409/)).not.toBeInTheDocument()
  })

  it('cuando la factura sale, muestra el número de la Factura C', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(201, cobro('emitido'))))

    render(<BotonCobrar compromisoID="c1" total="18500" cobroInicial={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Efectivo' }))

    expect(await screen.findByText('Factura C emitida N° 0001-00000123')).toBeInTheDocument()
    expect(screen.getByText('CAE 75123456789012')).toBeInTheDocument()
  })

  it('sin datos de ARCA se cobra igual y se explica por qué no hay factura', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(201, cobro(null))))

    render(<BotonCobrar compromisoID="c1" total="18500" cobroInicial={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Efectivo' }))

    expect(await screen.findByText('Cobrado, sin factura')).toBeInTheDocument()
  })

  it('mientras la factura está en camino vuelve a preguntar hasta que sale', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(json(200, cobro('pendiente')))
      .mockResolvedValue(json(200, cobro('emitido')))
    vi.stubGlobal('fetch', fetchFalso)

    render(<BotonCobrar compromisoID="c1" total="18500" refrescoMs={10} />)

    expect(await screen.findByText('Facturando…')).toBeInTheDocument()
    expect(String(fetchFalso.mock.calls[0]?.[0])).toBe('/api/cobros/c1')

    expect(await screen.findByText('Factura C emitida N° 0001-00000123')).toBeInTheDocument()
  })

  it('un turno que ya estaba cobrado no vuelve a ofrecer el botón', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, cobro('emitido'))))

    render(<BotonCobrar compromisoID="c1" total="18500" />)

    expect(await screen.findByText('Factura C emitida N° 0001-00000123')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cobrar' })).not.toBeInTheDocument(),
    )
  })
})
