import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { NegocioDatos } from '../api/tipos'
import { Tablero } from './Tablero'

const { useSesion } = vi.hoisted(() => ({ useSesion: vi.fn() }))

vi.mock('../contexto', () => ({ useSesion }))
vi.mock('./Agenda', () => ({ Agenda: () => <div>AGENDA DE SALUD</div> }))
vi.mock('./Pedidos', () => ({ Pedidos: () => <div>TABLERO DE PEDIDOS</div> }))

function sesion(vertical: NegocioDatos['vertical'] | null) {
  useSesion.mockReturnValue({
    claims: { rol: 'dueno' },
    negocio: vertical ? { id: 'n1', nombre: 'x', vertical, timezone: 'tz', config: {}, coberturas: [] } : null,
    demorasSugeridas: [15, 25, 40],
    vePlata: true,
    recargarNegocio: () => {},
  })
}

describe('la bifurcación por vertical', () => {
  it('gastronomía ve el tablero de pedidos, no la agenda', () => {
    sesion('gastronomia')
    render(<Tablero />)
    expect(screen.getByText('TABLERO DE PEDIDOS')).toBeInTheDocument()
    expect(screen.queryByText('AGENDA DE SALUD')).not.toBeInTheDocument()
  })

  it('salud sigue viendo la agenda de siempre', () => {
    sesion('salud')
    render(<Tablero />)
    expect(screen.getByText('AGENDA DE SALUD')).toBeInTheDocument()
    expect(screen.queryByText('TABLERO DE PEDIDOS')).not.toBeInTheDocument()
  })

  it('mientras el negocio no cargó no arriesga mostrar la vista equivocada', () => {
    sesion(null)
    render(<Tablero />)
    expect(screen.queryByText('AGENDA DE SALUD')).not.toBeInTheDocument()
    expect(screen.queryByText('TABLERO DE PEDIDOS')).not.toBeInTheDocument()
  })
})
