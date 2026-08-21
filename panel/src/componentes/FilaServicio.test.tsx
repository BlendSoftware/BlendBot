import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Servicio } from '../api/tipos'
import { FilaServicio } from './FilaServicio'

function servicio(over: Partial<Servicio> = {}): Servicio {
  return {
    id: 's1',
    negocio_id: 'n1',
    categoria_id: 'c1',
    nombre: 'Clásica cheddar',
    descripcion: null,
    duracion_min: null,
    precio_base: '8900',
    disponible: true,
    activo: true,
    ...over,
  }
}

const noop = async () => {}

describe('FilaServicio', () => {
  it('sin clubes cargados no cuelga el "Precios por club" que sólo abre a un vacío', () => {
    render(
      <FilaServicio
        servicio={servicio()}
        alCambiarDisponible={noop}
        alGuardar={noop}
        alFallar={vi.fn()}
        expandida={false}
        alExpandir={vi.fn()}
        hayClubes={false}
      >
        <p>precios</p>
      </FilaServicio>,
    )

    expect(screen.queryByRole('button', { name: 'Precios por club' })).not.toBeInTheDocument()
    // El plato y su precio siguen ahí; lo que se va es sólo el expander muerto.
    expect(screen.getByText('Clásica cheddar')).toBeInTheDocument()
  })

  it('con clubes cargados sí ofrece ver los precios por club', () => {
    render(
      <FilaServicio
        servicio={servicio()}
        alCambiarDisponible={noop}
        alGuardar={noop}
        alFallar={vi.fn()}
        expandida={false}
        alExpandir={vi.fn()}
        hayClubes
      >
        <p>precios</p>
      </FilaServicio>,
    )

    expect(screen.getByRole('button', { name: 'Precios por club' })).toBeInTheDocument()
  })

  it('muestra lo que lleva el plato cuando tiene descripción', () => {
    render(
      <FilaServicio
        servicio={servicio({ descripcion: 'Medallón, cheddar y panceta' })}
        alCambiarDisponible={noop}
        alGuardar={noop}
        alFallar={vi.fn()}
        expandida={false}
        alExpandir={vi.fn()}
        hayClubes={false}
      />,
    )

    expect(screen.getByText('Medallón, cheddar y panceta')).toBeInTheDocument()
  })

  it('al editar guarda la descripción y manda null cuando se deja vacía', async () => {
    const alGuardar = vi.fn(async () => {})
    render(
      <FilaServicio
        servicio={servicio({ descripcion: 'algo viejo' })}
        alCambiarDisponible={noop}
        alGuardar={alGuardar}
        alFallar={vi.fn()}
        expandida={false}
        alExpandir={vi.fn()}
        hayClubes={false}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Clásica cheddar/ }))
    const campo = screen.getByLabelText('Lo que lleva')
    await userEvent.clear(campo)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(alGuardar).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Clásica cheddar', descripcion: null }),
    )
  })
})
