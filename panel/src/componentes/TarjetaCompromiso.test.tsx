import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Estado, TipoCompromiso } from '../api/tipos'
import { TarjetaCompromiso } from './TarjetaCompromiso'
import type { DatosCompromiso } from './TarjetaCompromiso'

function datos(over: Partial<DatosCompromiso> = {}): DatosCompromiso {
  return {
    id: 'c1',
    tipo: 'turno' as TipoCompromiso,
    estado: 'pendiente' as Estado,
    inicio: '2026-08-21T09:30:00-03:00',
    fin: '2026-08-21T10:00:00-03:00',
    clienteNombre: 'Lucía Paz',
    clienteTelefono: '2615551234',
    total: '18500',
    nota: null,
    ...over,
  }
}

function pintar(over: Partial<DatosCompromiso> = {}, alTransicionar = vi.fn().mockResolvedValue(undefined)) {
  render(
    <TarjetaCompromiso
      datos={datos(over)}
      demorasSugeridas={[15, 25, 40]}
      alTransicionar={alTransicionar}
      ahora={new Date('2026-08-21T09:10:00-03:00')}
    />,
  )
  return alTransicionar
}

function botones(): string[] {
  return screen.getAllByRole('button').map((b) => b.textContent ?? '')
}

describe('TarjetaCompromiso', () => {
  it('un turno pendiente ofrece confirmar, rechazar y no vino', () => {
    pintar()
    expect(botones()).toEqual(['Confirmar', 'Rechazar', 'No vino'])
  })

  it('un pedido pendiente no ofrece no vino', () => {
    pintar({ tipo: 'pedido' })
    expect(botones()).toEqual(['Confirmar', 'Rechazar'])
  })

  it('un turno confirmado ofrece pasó, no vino y cancelar', () => {
    pintar({ estado: 'confirmado' })
    expect(botones()).toEqual(['Pasó', 'No vino', 'Cancelar'])
  })

  it('un turno en curso sólo se termina', () => {
    pintar({ estado: 'en_curso' })
    expect(botones()).toEqual(['Terminó'])
  })

  it('un pedido en curso puede quedar listo o entregado', () => {
    pintar({ tipo: 'pedido', estado: 'en_curso' })
    expect(botones()).toEqual(['Entregado', 'Listo'])
  })

  it('un turno terminado no tiene ninguna acción', () => {
    pintar({ estado: 'completado' })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('un turno que no vino tampoco', () => {
    pintar({ estado: 'ausente' })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('confirmar un turno manda la transición derecho, sin preguntar demora', async () => {
    const mover = pintar()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(mover).toHaveBeenCalledWith('confirmado', undefined)
  })

  it('confirmar un pedido abre el selector de demora y manda los minutos', async () => {
    const mover = pintar({ tipo: 'pedido' })

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await userEvent.click(screen.getByRole('button', { name: '25 min' }))

    expect(mover).toHaveBeenCalledWith('confirmado', { demora_min: 25 })
  })

  it('si el core dice que el horario se ocupó, la tarjeta lo cuenta', async () => {
    const mover = vi.fn().mockRejectedValue(new Error('Ese horario se acaba de ocupar.'))
    pintar({}, mover)

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Ese horario se acaba de ocupar.')).toBeInTheDocument()
  })

  it('el estado se lee en criollo, nunca el valor del enum', () => {
    pintar({ estado: 'pendiente' })
    expect(screen.getByText('sin confirmar')).toBeInTheDocument()
  })

  it('el contador se pone en rojo cuando la hora ya pasó', () => {
    render(
      <TarjetaCompromiso
        datos={datos({ inicio: '2026-08-21T09:00:00-03:00', estado: 'confirmado' })}
        demorasSugeridas={[15]}
        alTransicionar={vi.fn()}
        ahora={new Date('2026-08-21T09:12:00-03:00')}
      />,
    )
    const contador = screen.getByText('hace 12 min')
    expect(contador.className).toContain('turno__contador--vencido')
  })
})
