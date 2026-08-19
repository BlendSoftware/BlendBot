import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { guardarSesion, reiniciarSesionParaTests } from './api/sesion'
import type { Rol } from './api/tipos'

vi.mock('./api/endpoints', () => ({
  entrar: vi.fn(),
  salir: vi.fn(),
  cambiarPassword: vi.fn(),
  datosDelNegocio: vi.fn().mockResolvedValue({
    id: 'n1',
    nombre: 'Consultorio Gómez',
    vertical: 'salud',
    timezone: 'America/Argentina/Mendoza',
    config: { demoras_sugeridas: [15, 30] },
    coberturas: [],
  }),
  traerAgenda: vi.fn().mockResolvedValue({
    fecha: '2026-08-21',
    timezone: 'America/Argentina/Mendoza',
    recursos: [],
    sin_recurso: [],
  }),
  transicionar: vi.fn(),
  listarServicios: vi.fn().mockResolvedValue([]),
  listarCategorias: vi.fn().mockResolvedValue([]),
  listarCoberturas: vi.fn().mockResolvedValue([]),
  listarRecursos: vi.fn().mockResolvedValue([]),
  listarCompromisos: vi.fn().mockResolvedValue([]),
  clientePorTelefono: vi.fn(),
  actualizarCliente: vi.fn(),
  listarNegocios: vi.fn().mockResolvedValue([]),
  altaNegocio: vi.fn(),
  actualizarNegocio: vi.fn(),
  rotarTokenAgente: vi.fn(),
  crearServicio: vi.fn(),
  actualizarServicio: vi.fn(),
  setDisponible: vi.fn(),
  listarPrecios: vi.fn().mockResolvedValue([]),
  fijarPrecio: vi.fn(),
  crearCategoria: vi.fn(),
  crearRecurso: vi.fn(),
  actualizarRecurso: vi.fn(),
  listarHorarios: vi.fn().mockResolvedValue([]),
  crearHorario: vi.fn(),
  borrarHorario: vi.fn(),
  listarExcepciones: vi.fn().mockResolvedValue([]),
  crearExcepcion: vi.fn(),
  borrarExcepcion: vi.fn(),
  crearCliente: vi.fn(),
  crearCobertura: vi.fn(),
}))

function tokenFalso(rol: Rol, negocioID = 'n1'): string {
  const carga = { user_id: 'u1', username: 'secretaria', rol, negocio_id: negocioID, type: 'access' }
  const b64 = btoa(JSON.stringify(carga)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `cabecera.${b64}.firma`
}

function entrarComo(rol: Rol, negocioID = 'n1') {
  guardarSesion({ access_token: tokenFalso(rol, negocioID), refresh_token: 'r1' })
}

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  reiniciarSesionParaTests()
})

describe('guard de rutas', () => {
  it('sin sesión manda al login', async () => {
    montar('/')
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('con sesión de operador entra a la agenda', async () => {
    entrarComo('operador')
    montar('/')
    expect(await screen.findByText('Consultorio Gómez')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Secciones del panel' })).toBeInTheDocument()
  })

  it('un operador no entra al panel de la plataforma', async () => {
    entrarComo('operador')
    montar('/admin')
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Negocios' })).not.toBeInTheDocument(),
    )
    expect(await screen.findByLabelText('Día siguiente')).toBeInTheDocument()
  })

  it('el admin de la plataforma cae en su propia pantalla', async () => {
    entrarComo('admin', '')
    montar('/')
    expect(await screen.findByRole('heading', { name: 'Negocios' })).toBeInTheDocument()
  })

  it('con contraseña provisoria no se pasa de la pantalla de cambio', async () => {
    entrarComo('operador')
    window.localStorage.setItem('copiloto.cambio-pendiente', '1')
    montar('/')
    expect(await screen.findByRole('heading', { name: 'Elegí una contraseña tuya' })).toBeInTheDocument()
  })
})
