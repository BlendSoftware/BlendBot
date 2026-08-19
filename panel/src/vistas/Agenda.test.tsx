import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Agenda as AgendaDTO, Rol } from '../api/tipos'
import { Agenda } from './Agenda'
import { ProveedorSesion } from '../contexto'
import { guardarSesion, reiniciarSesionParaTests } from '../api/sesion'

const { traerAgenda, traerCobro, listarListaEspera, datosDelNegocio } = vi.hoisted(() => ({
  traerAgenda: vi.fn(),
  traerCobro: vi.fn(),
  listarListaEspera: vi.fn(),
  datosDelNegocio: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  traerAgenda,
  traerCobro,
  listarListaEspera,
  datosDelNegocio,
  transicionar: vi.fn(),
  cobrar: vi.fn(),
}))

function agenda(over: Partial<AgendaDTO> = {}): AgendaDTO {
  return {
    fecha: '2026-08-21',
    timezone: 'America/Argentina/Mendoza',
    recursos: [
      {
        recurso_id: 'r1',
        recurso_nombre: 'Dra. Gómez',
        horarios: [{ desde: '09:00', hasta: '11:00' }],
        turnos: [
          {
            compromiso_id: 'c1',
            inicio: '2026-08-21T09:00:00-03:00',
            fin: '2026-08-21T09:30:00-03:00',
            tipo: 'turno',
            estado: 'completado',
            cliente_id: 'cl1',
            cliente_nombre: 'Ana Ruiz',
            cliente_telefono: '2615550000',
            total: '18500',
            nota: null,
            cobrado: true,
            comprobante_estado: 'emitido',
          },
        ],
      },
    ],
    sin_recurso: [],
    ...over,
  }
}

function montar(rol: Rol) {
  const carga = { user_id: 'u1', username: 'quien', rol, negocio_id: 'n1', type: 'access' }
  const b64 = btoa(JSON.stringify(carga)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  guardarSesion({ access_token: `cabecera.${b64}.firma`, refresh_token: 'r1' })

  return render(
    <MemoryRouter>
      <ProveedorSesion>
        <Agenda />
      </ProveedorSesion>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  reiniciarSesionParaTests()
  traerAgenda.mockResolvedValue(agenda())
  traerCobro.mockRejectedValue(new Error('no debería preguntarse'))
  listarListaEspera.mockResolvedValue([])
  datosDelNegocio.mockResolvedValue({
    id: 'n1',
    nombre: 'Consultorio Gómez',
    vertical: 'salud',
    timezone: 'America/Argentina/Mendoza',
    config: {},
    coberturas: [],
  })
})

describe('la agenda', () => {
  it('el estado del cobro viene con el turno: no se pregunta uno por uno', async () => {
    montar('dueno')

    expect(await screen.findByText('Factura C emitida')).toBeInTheDocument()
    expect(screen.getByText('Cobrado')).toBeInTheDocument()
    // El GET /api/cobros/:id por turno es justo lo que este contrato evita.
    expect(traerCobro).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Cobrar' })).not.toBeInTheDocument()
  })

  it('el dueño ve la plata del turno', async () => {
    montar('dueno')
    expect(await screen.findByText(/18\.500/)).toBeInTheDocument()
  })

  it('el operador atiende el mismo turno sin ver la plata', async () => {
    montar('operador')

    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/18\.500/)).not.toBeInTheDocument())
  })

  it('el hueco libre lleva a la lista de espera cuando hay gente anotada', async () => {
    listarListaEspera.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    montar('dueno')

    const link = await screen.findByRole('link', { name: '2 esperando' })
    expect(link).toHaveAttribute('href', '/lista-espera')
  })

  it('sin nadie esperando el hueco no dice nada de más', async () => {
    montar('dueno')

    expect(await screen.findByText(/libre ·/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /esperando/ })).not.toBeInTheDocument()
  })
})
