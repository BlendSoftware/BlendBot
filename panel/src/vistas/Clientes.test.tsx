import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ClienteResumen } from '../api/tipos'
import { Clientes } from './Clientes'
import { ProveedorSesion } from '../contexto'
import { guardarSesion, reiniciarSesionParaTests } from '../api/sesion'

const { listarClientes, datosDelNegocio } = vi.hoisted(() => ({
  listarClientes: vi.fn(),
  datosDelNegocio: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  listarClientes,
  datosDelNegocio,
  // Los usa la rama de salud; en gastronomía no se llaman, pero el módulo tiene
  // que exportarlos igual porque Clientes.tsx los importa.
  clientePorTelefono: vi.fn(),
  actualizarCliente: vi.fn(),
  listarCompromisos: vi.fn(),
  traerAgenda: vi.fn(),
  salir: vi.fn(),
}))

function cliente(over: Partial<ClienteResumen> = {}): ClienteResumen {
  return {
    id: 'cl1',
    telefono: '5492611234567',
    nombre: 'Ana',
    cobertura_id: null,
    creado_en: '2026-08-20T20:00:00-03:00',
    cantidad_pedidos: 2,
    total_acumulado: '13000',
    ultimo_pedido: '2026-08-21T21:00:00-03:00',
    ...over,
  }
}

function montar() {
  const carga = { user_id: 'u1', username: 'dueño', rol: 'dueno', negocio_id: 'n1', type: 'access' }
  const b64 = btoa(JSON.stringify(carga)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  guardarSesion({ access_token: `cabecera.${b64}.firma`, refresh_token: 'r1' })

  return render(
    <MemoryRouter>
      <ProveedorSesion>
        <Clientes />
      </ProveedorSesion>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  reiniciarSesionParaTests()
  datosDelNegocio.mockResolvedValue({
    id: 'n1',
    nombre: 'Lo de Juani',
    vertical: 'gastronomia',
    timezone: 'America/Argentina/Mendoza',
    config: {},
    coberturas: [],
  })
})

describe('Clientes en gastronomía', () => {
  it('lista a todos los que pidieron con su nombre, teléfono y cantidad de pedidos', async () => {
    listarClientes.mockResolvedValue([
      cliente({ id: 'a', nombre: 'Ana', telefono: '5492611234567', cantidad_pedidos: 2 }),
      cliente({ id: 'b', nombre: 'Beto', telefono: '5492619876543', cantidad_pedidos: 1 }),
    ])
    montar()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Beto')).toBeInTheDocument()
    expect(screen.getByText('2 pedidos')).toBeInTheDocument()
    expect(screen.getByText('1 pedido')).toBeInTheDocument()
  })

  it('el cliente que todavía no tiene nombre se muestra por su teléfono, no anónimo', async () => {
    listarClientes.mockResolvedValue([
      cliente({ id: 'a', nombre: null, telefono: '5492611234567', cantidad_pedidos: 1 }),
    ])
    montar()

    expect(await screen.findByText('Sin nombre (4567)')).toBeInTheDocument()
  })

  it('sin nadie cargado lo dice a mano', async () => {
    listarClientes.mockResolvedValue([])
    montar()

    expect(await screen.findByText('Todavía no pidió nadie.')).toBeInTheDocument()
  })

  it('el buscador filtra por nombre', async () => {
    listarClientes.mockResolvedValue([
      cliente({ id: 'a', nombre: 'Ana', telefono: '5492611111111' }),
      cliente({ id: 'b', nombre: 'Beto', telefono: '5492619999999' }),
    ])
    montar()

    await screen.findByText('Ana')
    await userEvent.type(screen.getByPlaceholderText('Lucía o 2615551234'), 'bet')

    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.getByText('Beto')).toBeInTheDocument()
  })
})
