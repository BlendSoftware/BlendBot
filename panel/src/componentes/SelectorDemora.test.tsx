import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectorDemora } from './SelectorDemora'

describe('SelectorDemora', () => {
  it('muestra los presets del negocio', () => {
    render(<SelectorDemora sugeridas={[15, 25, 40]} alElegir={vi.fn()} alCerrar={vi.fn()} />)
    expect(screen.getByRole('button', { name: '15 min' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '40 min' })).toBeInTheDocument()
  })

  it('un preset devuelve sus minutos', async () => {
    const elegir = vi.fn()
    render(<SelectorDemora sugeridas={[15, 25, 40]} alElegir={elegir} alCerrar={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '25 min' }))

    expect(elegir).toHaveBeenCalledWith(25)
  })

  // D8: los presets eran 15/25/40 y el local eligió 30. El campo libre no se negocia.
  it('acepta un valor libre que no está entre los presets', async () => {
    const elegir = vi.fn()
    render(<SelectorDemora sugeridas={[15, 25, 40]} alElegir={elegir} alCerrar={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Otra cantidad de minutos'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))

    expect(elegir).toHaveBeenCalledWith(30)
  })

  it('sin valor libre cargado, el botón no hace nada', () => {
    render(<SelectorDemora sugeridas={[15]} alElegir={vi.fn()} alCerrar={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Listo' })).toBeDisabled()
  })
})
