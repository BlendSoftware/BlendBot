import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Compromiso, Estado } from '../api/tipos'
import { Pedidos } from './Pedidos'
import { ProveedorSesion } from '../contexto'
import { guardarSesion, reiniciarSesionParaTests } from '../api/sesion'

const {
  listarCompromisos,
  listarServicios,
  transicionar,
  datosDelNegocio,
  listarConsultas,
  traerCobro,
  cobrar,
} = vi.hoisted(() => ({
  listarCompromisos: vi.fn(),
  listarServicios: vi.fn(),
  transicionar: vi.fn(),
  datosDelNegocio: vi.fn(),
  listarConsultas: vi.fn(),
  traerCobro: vi.fn(),
  cobrar: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  listarCompromisos,
  listarServicios,
  transicionar,
  datosDelNegocio,
  listarConsultas,
  // La columna "Para cobrar" monta BotonCobrar, que pregunta por el cobro.
  traerCobro,
  cobrar,
  salir: vi.fn(),
}))

function compromiso(estado: Estado, over: Partial<Compromiso> = {}): Compromiso {
  return {
    id: `c-${estado}`,
    negocio_id: 'n1',
    cliente_id: 'cl1',
    cliente_nombre: 'Juani',
    cliente_telefono: '5492611234567',
    recurso_id: null,
    tipo: 'pedido',
    estado,
    inicio: null,
    fin: null,
    demora_min: null,
    entrega: 'retira',
    direccion: null,
    total: '9500',
    origen: 'whatsapp',
    nota: null,
    creado_en: '2026-08-20T20:50:00-03:00',
    confirmado_en: null,
    cerrado_en: null,
    lineas: [{ id: 'l1', servicio_id: 's1', cantidad: 1, precio_unit: '9500', subtotal: '9500', nota: null }],
    ...over,
  }
}

/**
 * El tablero hace DOS consultas: los estados vivos sin filtro de fecha, y los
 * entregados acotados a hoy (la columna "Para cobrar"). El mock reparte según
 * los estados que pide cada una; con un mockResolvedValue plano cada pedido
 * saldría duplicado.
 */
function conPedidos(...lista: Compromiso[]) {
  listarCompromisos.mockImplementation((filtro: { estados?: Estado[] }) => {
    const pedidos = filtro.estados ?? []
    return Promise.resolve(lista.filter((c) => pedidos.includes(c.estado)))
  })
}

function montar() {
  const carga = { user_id: 'u1', username: 'quien', rol: 'dueno', negocio_id: 'n1', type: 'access' }
  const b64 = btoa(JSON.stringify(carga)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  guardarSesion({ access_token: `cabecera.${b64}.firma`, refresh_token: 'r1' })

  return render(
    <MemoryRouter>
      <ProveedorSesion>
        <Pedidos />
      </ProveedorSesion>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  reiniciarSesionParaTests()
  listarServicios.mockResolvedValue([
    { id: 's1', negocio_id: 'n1', categoria_id: null, nombre: 'Doble cheddar', descripcion: null, duracion_min: null, precio_base: '9500', disponible: true, activo: true },
  ])
  transicionar.mockResolvedValue(undefined)
  listarConsultas.mockResolvedValue([])
  // 404 es la respuesta normal de un pedido que todavía no se cobró.
  traerCobro.mockRejectedValue(new Error('no cobrado'))
  datosDelNegocio.mockResolvedValue({
    id: 'n1',
    nombre: 'Lo de Juani',
    vertical: 'gastronomia',
    timezone: 'America/Argentina/Mendoza',
    config: { demoras_sugeridas: [15, 25, 40] },
    coberturas: [],
  })
})

describe('el tablero de pedidos', () => {
  it('agrupa cada pedido en su columna por estado', async () => {
    conPedidos(
      compromiso('pendiente', { id: 'a' }),
      compromiso('en_curso', { id: 'b', confirmado_en: '2026-08-20T20:55:00-03:00', demora_min: 20 }),
      compromiso('listo', { id: 'c' }),
      compromiso('completado', { id: 'd' }),
    )
    montar()

    const pendientes = await screen.findByRole('region', { name: 'Pendientes' })
    const cocina = screen.getByRole('region', { name: 'En cocina' })
    const listos = screen.getByRole('region', { name: 'Listos' })
    const cobrar = screen.getByRole('region', { name: 'Para cobrar' })

    expect(within(pendientes).getByText('#A')).toBeInTheDocument()
    expect(within(cocina).getByText('#B')).toBeInTheDocument()
    expect(within(listos).getByText('#C')).toBeInTheDocument()
    // Entregado no desaparece del tablero: cae en "Para cobrar" hasta que se
    // cobra, que es desde donde se llega al comprobante.
    expect(within(cobrar).getByText('#D')).toBeInTheDocument()
  })

  it('confirmar un pedido con demora manda la transición con los minutos', async () => {
    conPedidos(compromiso('pendiente', { id: 'a' }))
    montar()

    await screen.findByText('#A')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await userEvent.click(screen.getByRole('button', { name: '25 min' }))

    expect(transicionar).toHaveBeenCalledWith('a', { estado: 'confirmado', demora_min: 25 })
  })

  it('sin pedidos abiertos lo dice a mano, no con un cartel genérico', async () => {
    conPedidos()
    montar()
    expect(await screen.findByText('Todavía no entró ningún pedido.')).toBeInTheDocument()
  })

  it('ignora lo que no sea un pedido: la agenda es de salud', async () => {
    conPedidos(
      compromiso('pendiente', { id: 'a' }),
      { ...compromiso('confirmado', { id: 'z' }), tipo: 'turno' },
    )
    montar()

    await screen.findByText('#A')
    expect(screen.queryByText('#Z')).not.toBeInTheDocument()
  })
})
