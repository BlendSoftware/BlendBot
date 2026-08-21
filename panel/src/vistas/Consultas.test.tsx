import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Consulta } from '../api/tipos'
import { Consultas } from './Consultas'

const { listarConsultas, responderConsulta } = vi.hoisted(() => ({
  listarConsultas: vi.fn(),
  responderConsulta: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({ listarConsultas, responderConsulta }))

function consulta(over: Partial<Consulta> = {}): Consulta {
  return {
    id: 'q1',
    negocio_id: 'n1',
    cliente_id: 'cl1',
    cliente_nombre: 'Ana',
    telefono: '5492611234567',
    pregunta: '¿Tienen opciones sin TACC?',
    respuesta: null,
    estado: 'pendiente',
    creado_en: '2026-08-21T20:30:00-03:00',
    respondida_en: null,
    ...over,
  }
}

beforeEach(() => {
  listarConsultas.mockReset()
  responderConsulta.mockReset()
})

describe('Consultas', () => {
  it('lista las preguntas pendientes con quién preguntó', async () => {
    listarConsultas.mockResolvedValue([
      consulta({ id: 'a', cliente_nombre: 'Ana', pregunta: '¿Abren los lunes?' }),
      consulta({ id: 'b', cliente_nombre: null, pregunta: '¿Hacen envíos a Godoy Cruz?' }),
    ])
    render(<Consultas />)

    expect(await screen.findByText('¿Abren los lunes?')).toBeInTheDocument()
    expect(screen.getByText('¿Hacen envíos a Godoy Cruz?')).toBeInTheDocument()
    // El que no dio nombre se muestra por su teléfono, no anónimo.
    expect(screen.getByText('Sin nombre (4567)')).toBeInTheDocument()
    expect(listarConsultas).toHaveBeenCalledWith('pendiente')
  })

  it('sin preguntas lo dice a mano', async () => {
    listarConsultas.mockResolvedValue([])
    render(<Consultas />)

    expect(await screen.findByText('No hay preguntas sin responder.')).toBeInTheDocument()
  })

  it('al responder manda la respuesta y saca la pregunta de la lista', async () => {
    listarConsultas.mockResolvedValue([consulta({ id: 'a', pregunta: '¿Tienen estacionamiento?' })])
    responderConsulta.mockResolvedValue(consulta({ id: 'a', estado: 'respondida' }))
    render(<Consultas />)

    await screen.findByText('¿Tienen estacionamiento?')
    await userEvent.type(
      screen.getByLabelText('Respuesta para Ana'),
      'Sí, sobre la calle de atrás.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))

    expect(responderConsulta).toHaveBeenCalledWith('a', 'Sí, sobre la calle de atrás.')
    expect(screen.queryByText('¿Tienen estacionamiento?')).not.toBeInTheDocument()
    expect(screen.getByText(/le avisamos a Ana/i)).toBeInTheDocument()
  })
})
