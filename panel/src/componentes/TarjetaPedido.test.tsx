import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PedidoVista } from '../dominio/pedidos'
import { TarjetaPedido } from './TarjetaPedido'

function pedido(over: Partial<PedidoVista> = {}): PedidoVista {
  return {
    id: 'p1',
    numero: '#48',
    estado: 'pendiente',
    total: '9500',
    entrega: 'delivery',
    direccion: 'San Martín 1234',
    demoraMin: null,
    confirmadoEn: null,
    creadoEn: '2026-08-20T20:50:00-03:00',
    nota: null,
    items: [
      { cantidad: 2, nombre: 'Doble cheddar', nota: 'sin cebolla' },
      { cantidad: 1, nombre: 'Papas', nota: null },
    ],
    ...over,
  }
}

function pintar(over: Partial<PedidoVista> = {}, alTransicionar = vi.fn().mockResolvedValue(undefined)) {
  render(
    <TarjetaPedido
      pedido={pedido(over)}
      demorasSugeridas={[15, 25, 40]}
      alTransicionar={alTransicionar}
      ahora={new Date('2026-08-20T21:00:00-03:00')}
    />,
  )
  return alTransicionar
}

describe('TarjetaPedido', () => {
  it('muestra número, ítems y el modificador de la línea', () => {
    pintar()
    expect(screen.getByText('#48')).toBeInTheDocument()
    expect(screen.getByText('Doble cheddar')).toBeInTheDocument()
    expect(screen.getByText('sin cebolla')).toBeInTheDocument()
  })

  it('un delivery muestra el tipo de entrega y la dirección', () => {
    pintar({ estado: 'confirmado', confirmadoEn: '2026-08-20T20:55:00-03:00', demoraMin: 20 })
    expect(screen.getByText('Delivery')).toBeInTheDocument()
    expect(screen.getByText('San Martín 1234')).toBeInTheDocument()
  })

  it('un pedido que retira no muestra dirección de delivery', () => {
    pintar({ entrega: 'retira', direccion: null })
    expect(screen.getByText('Retira')).toBeInTheDocument()
    expect(screen.queryByText('San Martín 1234')).not.toBeInTheDocument()
  })

  it('un pedido pendiente ofrece confirmar y rechazar, sin no vino', () => {
    pintar()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Confirmar', 'Rechazar'])
  })

  it('confirmar abre el selector de demora y manda los minutos elegidos', async () => {
    const mover = pintar()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await userEvent.click(screen.getByRole('button', { name: '25 min' }))
    expect(mover).toHaveBeenCalledWith('confirmado', { demora_min: 25 })
  })

  it('el campo libre del selector también confirma con esos minutos', async () => {
    const mover = pintar()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await userEvent.type(screen.getByLabelText('Otra cantidad de minutos'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(mover).toHaveBeenCalledWith('confirmado', { demora_min: 30 })
  })

  it('en cocina el contador se pone rojo cuando la demora ya se pasó', () => {
    render(
      <TarjetaPedido
        pedido={pedido({
          estado: 'en_curso',
          confirmadoEn: '2026-08-20T20:50:00-03:00',
          demoraMin: 5,
        })}
        demorasSugeridas={[15]}
        alTransicionar={vi.fn()}
        ahora={new Date('2026-08-20T21:00:00-03:00')}
      />,
    )
    const contador = screen.getByText('+5 min')
    expect(contador.className).toContain('turno__contador--vencido')
  })

  it('en modo comanda no muestra la plata: la cocina no cobra', () => {
    render(
      <TarjetaPedido
        pedido={pedido({ estado: 'en_curso', confirmadoEn: '2026-08-20T20:55:00-03:00', demoraMin: 20 })}
        demorasSugeridas={[15]}
        alTransicionar={vi.fn()}
        ahora={new Date('2026-08-20T21:00:00-03:00')}
        soloCocina
      />,
    )
    expect(screen.queryByText(/9\.500/)).not.toBeInTheDocument()
    expect(screen.getByText('Doble cheddar')).toBeInTheDocument()
  })
})
