import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Stock } from './Stock'
import { ErrorApi } from '../api/cliente'

const { listarServicios, listarStock, setCupo, quitarCupo, listarInsumos, traerReceta } = vi.hoisted(
  () => ({
    listarServicios: vi.fn(),
    listarStock: vi.fn(),
    setCupo: vi.fn(),
    quitarCupo: vi.fn(),
    listarInsumos: vi.fn(),
    traerReceta: vi.fn(),
  }),
)

vi.mock('../api/endpoints', () => ({
  listarServicios,
  listarStock,
  setCupo,
  quitarCupo,
  listarInsumos,
  traerReceta,
}))

function servicio(id: string, nombre: string, disponible = true) {
  return {
    id,
    negocio_id: 'n1',
    categoria_id: null,
    nombre,
    descripcion: null,
    duracion_min: null,
    precio_base: '9500',
    disponible,
    activo: true,
  }
}

function cupo(servicioID: string, nombre: string, asignado: number, consumido: number) {
  const restante = Math.max(0, asignado - consumido)
  return {
    servicio_id: servicioID,
    servicio_nombre: nombre,
    asignado,
    consumido,
    restante,
    agotado: restante === 0,
    disponible: true,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarServicios.mockResolvedValue([servicio('s1', 'Milanesa'), servicio('s2', 'Empanadas')])
  listarStock.mockResolvedValue([])
  quitarCupo.mockResolvedValue(undefined)
  // La pestaña Insumos convive con la de Platos: sin estos dos, la carga
  // completa se cae y los casos de cupo pasarían por el camino de error.
  listarInsumos.mockResolvedValue([])
  traerReceta.mockResolvedValue([])
})

describe('stock del día', () => {
  it('un plato sin cupo cargado se muestra sin límite: el cupo es opt-in', async () => {
    render(<Stock />)

    expect(await screen.findByText('Milanesa')).toBeInTheDocument()
    expect(screen.getAllByText('sin límite')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '+ Ponerle cupo' })).toHaveLength(2)
  })

  it('muestra cuánto queda y cuánto se vendió', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 4)])
    render(<Stock />)

    expect(await screen.findByText(/6 de 10/)).toBeInTheDocument()
    expect(screen.getByText(/4 vendidas/)).toBeInTheDocument()
  })

  it('el singular de una vendida está bien escrito', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 3, 1)])
    render(<Stock />)

    expect(await screen.findByText(/1 vendida$/)).toBeInTheDocument()
  })

  it('subir el cupo manda el asignado nuevo, no el restante', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 4)])
    setCupo.mockResolvedValue(cupo('s1', 'Milanesa', 11, 4))
    render(<Stock />)

    await userEvent.click(await screen.findByRole('button', { name: 'Subir el cupo de Milanesa' }))

    expect(setCupo).toHaveBeenCalledWith('s1', 11)
  })

  it('no deja bajar el cupo por debajo de lo ya vendido', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 4, 4)])
    render(<Stock />)

    const bajar = await screen.findByRole('button', { name: 'Bajar el cupo de Milanesa' })
    expect(bajar).toBeDisabled()
  })

  it('el agotado se anuncia arriba, para verlo sin recorrer la lista', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 5, 5)])
    render(<Stock />)

    expect(await screen.findByText('1 agotado')).toBeInTheDocument()
  })

  it('sacar el cupo devuelve el plato a sin límite', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 2)])
    render(<Stock />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sin límite' }))

    expect(quitarCupo).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(screen.getAllByText('sin límite')).toHaveLength(2))
  })

  it('sin caja abierta lo explica, en vez de mostrar una lista vacía', async () => {
    listarStock.mockRejectedValue(new ErrorApi(409, 'sin jornada', 'Abrí la caja del día.'))
    render(<Stock />)

    expect(await screen.findByText('La caja del día está cerrada.')).toBeInTheDocument()
  })

  it('un plato apagado a mano lo dice: el interruptor le gana al cupo', async () => {
    listarServicios.mockResolvedValue([servicio('s1', 'Milanesa', false)])
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 0)])
    render(<Stock />)

    expect(await screen.findByText('apagado a mano en la carta')).toBeInTheDocument()
  })

  it('sin carta cargada no ofrece poner cupos sobre la nada', async () => {
    listarServicios.mockResolvedValue([])
    render(<Stock />)

    expect(await screen.findByText('Todavía no hay platos en la carta.')).toBeInTheDocument()
  })
})
