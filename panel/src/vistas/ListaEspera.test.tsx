import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnotadoEnEspera } from '../api/tipos'
import { ErrorApi } from '../api/cliente'
import { ListaEspera } from './ListaEspera'

const {
  listarListaEspera,
  anotarEnListaEspera,
  quitarDeListaEspera,
  listarServicios,
  clientePorTelefono,
  crearCliente,
} = vi.hoisted(() => ({
  listarListaEspera: vi.fn(),
  anotarEnListaEspera: vi.fn(),
  quitarDeListaEspera: vi.fn(),
  listarServicios: vi.fn(),
  clientePorTelefono: vi.fn(),
  crearCliente: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  listarListaEspera,
  anotarEnListaEspera,
  quitarDeListaEspera,
  listarServicios,
  clientePorTelefono,
  crearCliente,
}))

function anotado(over: Partial<AnotadoEnEspera> = {}): AnotadoEnEspera {
  return {
    id: 'a1',
    negocio_id: 'n1',
    cliente_id: 'cl1',
    cliente_nombre: 'Juana Pérez',
    cliente_telefono: '2615551234',
    servicio_id: 's1',
    servicio_nombre: 'Consulta',
    nota: 'cualquier horario de mañana',
    creado_en: new Date().toISOString(),
    notificado_en: null,
    compromiso_ofrecido_id: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarListaEspera.mockResolvedValue([anotado()])
  listarServicios.mockResolvedValue([{ id: 's1', nombre: 'Consulta' }])
})

describe('lista de espera', () => {
  it('muestra a quién hay que llamar, con nombre y servicio en criollo', async () => {
    render(<ListaEspera />)

    expect(await screen.findByText('Juana Pérez')).toBeInTheDocument()
    // "Consulta" también es una opción del selector de alta: acá interesa la fila.
    expect(within(screen.getByRole('list')).getByText('Consulta')).toBeInTheDocument()
    expect(screen.getByText('anotado hoy')).toBeInTheDocument()
    expect(screen.getByText('cualquier horario de mañana')).toBeInTheDocument()
    // Ningún UUID a la vista.
    expect(screen.queryByText('cl1')).not.toBeInTheDocument()
  })

  it('a quien ya recibió la oferta se lo dice, para no llamarlo dos veces', async () => {
    listarListaEspera.mockResolvedValue([anotado({ notificado_en: '2026-08-20T10:00:00-03:00' })])
    render(<ListaEspera />)

    expect(await screen.findByText('ya le ofrecimos un horario')).toBeInTheDocument()
  })

  it('anotar a alguien ya cargado usa su ficha, no crea otra', async () => {
    clientePorTelefono.mockResolvedValue({ id: 'cl1', telefono: '2615551234' })
    anotarEnListaEspera.mockResolvedValue(anotado({ id: 'a2', cliente_nombre: 'Juana Pérez' }))
    render(<ListaEspera />)

    await screen.findByText('Juana Pérez')
    await userEvent.type(screen.getByLabelText('Teléfono'), '2615551234')
    await userEvent.selectOptions(screen.getByLabelText('Para qué'), 's1')
    await userEvent.click(screen.getByRole('button', { name: 'Anotar' }))

    await waitFor(() => expect(anotarEnListaEspera).toHaveBeenCalled())
    expect(crearCliente).not.toHaveBeenCalled()
    expect(anotarEnListaEspera).toHaveBeenCalledWith({
      cliente_id: 'cl1',
      servicio_id: 's1',
      nota: null,
    })
  })

  it('si el teléfono no está cargado, se crea la ficha con el nombre que dejó', async () => {
    clientePorTelefono.mockRejectedValue(new ErrorApi(404, 'no existe', 'Eso ya no está.'))
    crearCliente.mockResolvedValue({ id: 'cl9', telefono: '2615559999' })
    anotarEnListaEspera.mockResolvedValue(anotado({ id: 'a3' }))
    render(<ListaEspera />)

    await screen.findByText('Juana Pérez')
    await userEvent.type(screen.getByLabelText('Teléfono'), '2615559999')
    await userEvent.type(screen.getByLabelText('Nombre'), 'Marta Díaz')
    await userEvent.selectOptions(screen.getByLabelText('Para qué'), 's1')
    await userEvent.click(screen.getByRole('button', { name: 'Anotar' }))

    await waitFor(() =>
      expect(crearCliente).toHaveBeenCalledWith({ telefono: '2615559999', nombre: 'Marta Díaz' }),
    )
    expect(anotarEnListaEspera).toHaveBeenCalledWith({
      cliente_id: 'cl9',
      servicio_id: 's1',
      nota: null,
    })
  })

  it('sin teléfono o sin servicio no se anota a nadie', async () => {
    render(<ListaEspera />)
    await screen.findByText('Juana Pérez')

    expect(screen.getByRole('button', { name: 'Anotar' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Teléfono'), '2615551234')
    expect(screen.getByRole('button', { name: 'Anotar' })).toBeDisabled()
  })

  it('sacar pide confirmar antes de borrar, en el lugar', async () => {
    quitarDeListaEspera.mockResolvedValue(undefined)
    render(<ListaEspera />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sacar' }))
    expect(quitarDeListaEspera).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Sí, sacar' }))

    expect(quitarDeListaEspera).toHaveBeenCalledWith('a1')
    await waitFor(() => expect(screen.queryByText('Juana Pérez')).not.toBeInTheDocument())
  })

  it('si el borrado falla, la persona vuelve a la lista y se explica', async () => {
    quitarDeListaEspera.mockRejectedValue(new ErrorApi(0, 'red', 'No hay conexión con el servidor.'))
    render(<ListaEspera />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sacar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sí, sacar' }))

    expect(await screen.findByText('No hay conexión con el servidor.')).toBeInTheDocument()
    expect(screen.getByText('Juana Pérez')).toBeInTheDocument()
  })

  it('con la cola vacía dice qué hacer, sin cartel genérico', async () => {
    listarListaEspera.mockResolvedValue([])
    render(<ListaEspera />)

    expect(await screen.findByText('No hay nadie esperando.')).toBeInTheDocument()
  })
})
