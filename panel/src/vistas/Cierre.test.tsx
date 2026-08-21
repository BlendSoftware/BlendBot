import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cierre as CierreDTO, JornadaActual, Reporte } from '../api/tipos'
import { Cierre } from './Cierre'

const { traerCierre, jornadaActual, abrirJornada, cerrarJornada, traerReportes } = vi.hoisted(() => ({
  traerCierre: vi.fn(),
  jornadaActual: vi.fn(),
  abrirJornada: vi.fn(),
  cerrarJornada: vi.fn(),
  traerReportes: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  traerCierre,
  jornadaActual,
  abrirJornada,
  cerrarJornada,
  traerReportes,
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
    vendido: '420000',
    cobros: 31,
    total_cobrado: '412700',
    ticket_promedio: '13312.90',
    por_medio_pago: { efectivo: '210000', transferencia: '150200', qr: '52500' },
    por_origen: { whatsapp: 28, telefono: 6 },
    comprobantes: { emitidos: 29, pendientes: 1, con_error: 1 },
    ...over,
  }
}

function caja(over: Partial<JornadaActual> = {}): JornadaActual {
  return { abierta: false, jornada: null, ...over }
}

function informe(over: Partial<Reporte> = {}): Reporte {
  return {
    rango: 'semanal',
    desde: '2026-08-15',
    hasta: '2026-08-21',
    timezone: 'America/Argentina/Mendoza',
    dias: [
      { fecha: '2026-08-20', vendido: '305000', cobrado: '290000' },
      { fecha: '2026-08-21', vendido: '118000', cobrado: '101000' },
    ],
    total_vendido: '423000',
    total_cobrado: '391000',
    ...over,
  }
}

beforeEach(() => {
  traerCierre.mockReset()
  jornadaActual.mockReset()
  abrirJornada.mockReset()
  cerrarJornada.mockReset()
  traerReportes.mockReset()
  // Defaults que casi todos los tests comparten: caja cerrada y un informe.
  jornadaActual.mockResolvedValue(caja())
  traerReportes.mockResolvedValue(informe())
  abrirJornada.mockResolvedValue({})
  cerrarJornada.mockResolvedValue({})
})

describe('cierre del día', () => {
  it('muestra lo vendido grande, con lo cobrado, lo entregado y el ticket', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    // Vendido es el número que faltaba: lo entregado, se haya cobrado o no.
    // Aparece en el número grande y también en el resumen de la barra del día.
    expect(await screen.findByText('Vendido')).toBeInTheDocument()
    expect(screen.getAllByText(/420\.000/).length).toBeGreaterThan(0)
    expect(screen.getByText(/412\.700/)).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument() // entregados
    expect(screen.getByText(/13\.312,90/)).toBeInTheDocument()
    // 28 de 34 compromisos entraron por WhatsApp.
    expect(screen.getByText('82% por WhatsApp')).toBeInTheDocument()
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
        vendido: '0',
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

    expect(await screen.findByText('Todavía no se cobró nada de este día por caja.')).toBeInTheDocument()
  })

  it('la fecha se navega y cada día se le pide al core', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    await screen.findByText('Vendido')
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

describe('la caja del día', () => {
  it('con la caja cerrada ofrece abrir el día', async () => {
    traerCierre.mockResolvedValue(dia())
    jornadaActual.mockResolvedValue(caja({ abierta: false }))
    render(<Cierre />)

    const abrir = await screen.findByRole('button', { name: 'Abrir día' })
    await userEvent.click(abrir)

    await waitFor(() => expect(abrirJornada).toHaveBeenCalledTimes(1))
    // Después de abrir se relee la jornada para reflejar el nuevo estado.
    await waitFor(() => expect(jornadaActual).toHaveBeenCalledTimes(2))
  })

  it('con la caja abierta muestra desde cuándo y deja cerrarla', async () => {
    traerCierre.mockResolvedValue(dia())
    jornadaActual.mockResolvedValue(
      caja({
        abierta: true,
        jornada: {
          id: 'j1',
          negocio_id: 'n1',
          abierta: true,
          abierta_en: '2026-08-21T09:00:00-03:00',
          cerrada_en: null,
          abierta_por: 'u1',
          cerrada_por: null,
        },
      }),
    )
    render(<Cierre />)

    expect(await screen.findByText('Caja abierta')).toBeInTheDocument()
    // El botón de cerrar pide confirmación en el lugar antes de disparar.
    const cerrar = screen.getByRole('button', { name: 'Cerrar día' })
    await userEvent.click(cerrar)
    await userEvent.click(screen.getByRole('button', { name: 'Sí, cerrar el día' }))

    await waitFor(() => expect(cerrarJornada).toHaveBeenCalledTimes(1))
  })
})

describe('el informe por día', () => {
  it('dibuja los totales de la semana y cambia a mensual cuando se toca', async () => {
    traerCierre.mockResolvedValue(dia())
    render(<Cierre />)

    // Arranca en semanal.
    await waitFor(() => expect(traerReportes).toHaveBeenCalledWith('semanal'))
    expect(await screen.findByText('Cómo viene la cosa')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'El mes' }))
    await waitFor(() => expect(traerReportes).toHaveBeenCalledWith('mensual'))
  })

  it('un día en $0 no deja ni el asomo de barra entre días con ventas', async () => {
    traerCierre.mockResolvedValue(dia())
    traerReportes.mockResolvedValue(
      informe({
        dias: [
          { fecha: '2026-08-20', vendido: '0', cobrado: '0' },
          { fecha: '2026-08-21', vendido: '118000', cobrado: '101000' },
        ],
        total_vendido: '118000',
        total_cobrado: '101000',
      }),
    )
    const { container } = render(<Cierre />)

    await screen.findByText('Cómo viene la cosa')
    const rellenos = container.querySelectorAll<HTMLElement>('.informe__relleno')
    expect(rellenos).toHaveLength(2)
    // El día en $0 apaga el min-width de 2px del CSS: nada de nub que se lea como plata.
    expect(rellenos[0]?.style.width).toBe('0%')
    expect(rellenos[0]?.style.minWidth).toBe('0')
    // El día con ventas conserva su ancho proporcional, sin tocar el min-width.
    expect(rellenos[1]?.style.width).toBe('100%')
    expect(rellenos[1]?.style.minWidth).toBe('')
  })

  it('sin ventas en el período lo dice en vez de barras vacías', async () => {
    traerCierre.mockResolvedValue(dia())
    traerReportes.mockResolvedValue(
      informe({ dias: [{ fecha: '2026-08-21', vendido: '0', cobrado: '0' }], total_vendido: '0', total_cobrado: '0' }),
    )
    render(<Cierre />)

    expect(await screen.findByText(/Todavía no hay ventas en este período/)).toBeInTheDocument()
  })
})
