import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cierre as CierreDTO } from '../api/tipos'
import { Cierre } from './Cierre'

const { traerCierre } = vi.hoisted(() => ({ traerCierre: vi.fn() }))

vi.mock('../api/endpoints', () => ({
  traerCierre,
  salir: vi.fn(),
}))

function dia(over: Partial<CierreDTO> = {}): CierreDTO {
  return {
    fecha: '2026-08-21',
    timezone: 'America/Argentina/Mendoza',
    compromisos: 34,
    completados: 31,
    cancelados: 2,
    ausentes: 1,
    cobros: 31,
    total_cobrado: '412700',
    ticket_promedio: '13312.90',
    por_medio_pago: { efectivo: '210000', transferencia: '150200', qr: '52500' },
    por_origen: { whatsapp: 28, telefono: 6 },
    comprobantes: { emitidos: 29, pendientes: 1, con_error: 1 },
    ...over,
  }
}

beforeEach(() => {
  traerCierre.mockReset()
})

describe('cierre del día', () => {
  it('muestra los números del día con plata formateada y el porcentaje por WhatsApp', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    expect(await screen.findByText('34')).toBeInTheDocument()
    expect(screen.getByText(/412\.700/)).toBeInTheDocument()
    expect(screen.getByText(/13\.312,90/)).toBeInTheDocument()

    // 28 de 34 compromisos entraron por WhatsApp.
    expect(screen.getByText('82% del día')).toBeInTheDocument()
  })

  it('desglosa por medio de pago con los nombres que usa el negocio', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    expect(await screen.findByText('Efectivo')).toBeInTheDocument()
    expect(screen.getByText('Transferencia')).toBeInTheDocument()
    expect(screen.getByText('QR')).toBeInTheDocument()
    expect(screen.getByText(/210\.000/)).toBeInTheDocument()

    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('Teléfono')).toBeInTheDocument()
  })

  it('cuenta los que no salieron: cancelados y los que no vinieron', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    expect(await screen.findByText('Cancelados')).toBeInTheDocument()
    expect(screen.getByText('No vinieron')).toBeInTheDocument()
    expect(screen.getByText(/turno se perdió sin aviso/)).toBeInTheDocument()
  })

  it('el estado de los comprobantes se lee sin jerga', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    expect(await screen.findByText('Factura C emitida')).toBeInTheDocument()
    expect(screen.getByText('Facturando…')).toBeInTheDocument()
    expect(screen.getByText('No salieron')).toBeInTheDocument()
    expect(screen.getByText(/revisá los datos de ARCA/)).toBeInTheDocument()
  })

  it('un día sin nada tiene su propia frase, no una tabla de ceros', async () => {
    traerCierre.mockResolvedValue(
      dia({
        compromisos: 0,
        completados: 0,
        cancelados: 0,
        ausentes: 0,
        cobros: 0,
        total_cobrado: '0',
        ticket_promedio: '0',
        por_medio_pago: {},
        por_origen: {},
        comprobantes: { emitidos: 0, pendientes: 0, con_error: 0 },
      }),
    )
    render(<Cierre />)

    expect(await screen.findByText('Este día no pasó nada todavía.')).toBeInTheDocument()
    expect(screen.queryByText('Cómo pagaron')).not.toBeInTheDocument()
  })

  it('sin cobros pero con día trabajado lo dice en vez de mostrar la lista vacía', async () => {
    traerCierre.mockResolvedValue(
      dia({ cobros: 0, total_cobrado: '0', ticket_promedio: '0', por_medio_pago: {} }),
    )
    render(<Cierre />)

    expect(await screen.findByText('Todavía no se cobró nada de este día.')).toBeInTheDocument()
  })

  it('la fecha se navega y cada día se le pide al core', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    await screen.findByText('34')
    const primera = String(traerCierre.mock.calls[0]?.[0])

    await userEvent.click(screen.getByLabelText('Día anterior'))

    await waitFor(() => expect(traerCierre).toHaveBeenCalledTimes(2))
    const segunda = String(traerCierre.mock.calls[1]?.[0])
    expect(segunda).not.toBe(primera)
    expect(segunda).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('si el core no contesta, la pantalla lo dice en criollo', async () => {
    traerCierre.mockRejectedValue(new Error('No hay conexión con el servidor. Probá de nuevo en un momento.'))
    render(<Cierre />)

    expect(
      await screen.findByText('No hay conexión con el servidor. Probá de nuevo en un momento.'),
    ).toBeInTheDocument()
  })
})
