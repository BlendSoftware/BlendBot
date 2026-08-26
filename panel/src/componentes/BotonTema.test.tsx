import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BotonTema } from './BotonTema'
import { aplicarTema, olvidarTemaParaTests, temaGuardado } from '../dominio/tema'

beforeEach(() => {
  olvidarTemaParaTests()
})

describe('tema claro/oscuro', () => {
  it('arranca en claro: la escena de DESIGN.md es la tablet a la luz del día', () => {
    expect(temaGuardado()).toBe('claro')
  })

  it('aplicar el tema lo pinta en el <html> y lo recuerda', () => {
    aplicarTema('oscuro')

    expect(document.documentElement.dataset.tema).toBe('oscuro')
    expect(temaGuardado()).toBe('oscuro')
  })

  it('el botón alterna y deja el tema guardado para el próximo F5', async () => {
    render(<BotonTema />)

    await userEvent.click(screen.getByRole('button', { name: 'Pasar al tema oscuro' }))

    expect(document.documentElement.dataset.tema).toBe('oscuro')
    expect(temaGuardado()).toBe('oscuro')

    await userEvent.click(screen.getByRole('button', { name: 'Pasar al tema claro' }))

    expect(document.documentElement.dataset.tema).toBe('claro')
    expect(temaGuardado()).toBe('claro')
  })

  it('con el tema oscuro ya guardado, el botón abre ofreciendo volver al claro', () => {
    aplicarTema('oscuro')
    render(<BotonTema />)

    expect(screen.getByRole('button', { name: 'Pasar al tema claro' })).toBeInTheDocument()
  })
})
