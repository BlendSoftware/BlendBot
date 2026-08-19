import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CambiarPassword } from './CambiarPassword'
import { ProveedorSesion } from '../contexto'

describe('CambiarPassword', () => {
  it('renderiza sin reventar', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/cambiar-password']}>
        <ProveedorSesion>
          <CambiarPassword />
        </ProveedorSesion>
      </MemoryRouter>,
    )
    expect(container.querySelector('form')).toBeTruthy()
  })
})
