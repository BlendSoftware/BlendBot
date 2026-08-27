import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Stock } from './Stock'
import { ErrorApi } from '../api/cliente'

const { listarServicios, listarStock, setCupo, quitarCupo, listarInsumos, traerReceta } = vi.hoisted(
  () => ({
    listarServicios: vi.fn(),
    listarStock: vi.fn(),
    setCupo: vi.fn(),
    quitarCupo: vi.fn(),
    listarInsumos: vi.fn(),
    traerReceta: vi.fn(),
  }),
)

vi.mock('../api/endpoints', () => ({
  listarServicios,
  listarStock,
  setCupo,
  quitarCupo,
  listarInsumos,
  traerReceta,
}))

function servicio(id: string, nombre: string, disponible = true) {
  return {
    id,
    negocio_id: 'n1',
    categoria_id: null,
    nombre,
    descripcion: null,
    duracion_min: null,
    precio_base: '9500',
    disponible,
    activo: true,
  }
}

/**
 * Un plato que se controla por RECETA. Lo que lo distingue del que lleva cupo a
 * mano es que trae `limitante`: su presencia ES la forma de saber de dónde sale
 * el número, y el limitante trae su propia unidad para que ningún número de la
 * pantalla quede pelado.
 */
function platoConReceta(
  id: string,
  nombre: string,
  restante: number,
  limitante: { insumo: string; unidad: 'g' | 'ml' | 'unidad'; stock: number; pide_la_receta: number },
) {
  return { ...servicio(id, nombre), restante, agotado: restante === 0, limitante }
}

/** Una receta como la devuelve el core, ya resuelta para mostrar. */
function recetaDe(servicioID: string, items: { insumo_id: string; insumo_nombre: string; unidad: 'g' | 'ml' | 'unidad'; cantidad: number; stock: number }[]) {
  return {
    servicio_id: servicioID,
    tiene_receta: items.length > 0,
    items,
    porciones: null,
    insumo_limitante: '',
    stock_limitante: 0,
    pide_la_receta: 0,
  }
}

function cupo(servicioID: string, nombre: string, asignado: number, consumido: number) {
  const restante = Math.max(0, asignado - consumido)
  return {
    servicio_id: servicioID,
    servicio_nombre: nombre,
    asignado,
    consumido,
    restante,
    agotado: restante === 0,
    disponible: true,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarServicios.mockResolvedValue([servicio('s1', 'Milanesa'), servicio('s2', 'Empanadas')])
  listarStock.mockResolvedValue([])
  quitarCupo.mockResolvedValue(undefined)
  // La pestaña Insumos convive con la de Platos: sin estos dos, la carga
  // completa se cae y los casos de cupo pasarían por el camino de error.
  listarInsumos.mockResolvedValue([])
  // Un objeto Receta, no un array: la vista lee `.items`. Con `[]` el `?? []`
  // la salvaba, que es justo la clase de mock que deja pasar un test sin que
  // ejercite nada.
  traerReceta.mockResolvedValue(recetaDe('s1', []))
})

describe('stock del día', () => {
  it('un plato sin cupo cargado se muestra sin límite: el cupo es opt-in', async () => {
    render(<Stock />)

    expect(await screen.findByText('Milanesa')).toBeInTheDocument()
    expect(screen.getAllByText('sin límite')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '+ Ponerle cupo' })).toHaveLength(2)
  })

  it('muestra cuánto queda y cuánto se vendió', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 4)])
    render(<Stock />)

    expect(await screen.findByText(/6 de 10/)).toBeInTheDocument()
    expect(screen.getByText(/4 vendidas/)).toBeInTheDocument()
  })

  it('el singular de una vendida está bien escrito', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 3, 1)])
    render(<Stock />)

    expect(await screen.findByText(/1 vendida$/)).toBeInTheDocument()
  })

  it('subir el cupo manda el asignado nuevo, no el restante', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 4)])
    setCupo.mockResolvedValue(cupo('s1', 'Milanesa', 11, 4))
    render(<Stock />)

    await userEvent.click(await screen.findByRole('button', { name: 'Subir el cupo de Milanesa' }))

    expect(setCupo).toHaveBeenCalledWith('s1', 11)
  })

  it('no deja bajar el cupo por debajo de lo ya vendido', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 4, 4)])
    render(<Stock />)

    const bajar = await screen.findByRole('button', { name: 'Bajar el cupo de Milanesa' })
    expect(bajar).toBeDisabled()
  })

  it('el agotado se anuncia arriba, para verlo sin recorrer la lista', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 5, 5)])
    render(<Stock />)

    expect(await screen.findByText('1 agotado')).toBeInTheDocument()
  })

  it('sacar el cupo devuelve el plato a sin límite', async () => {
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 2)])
    render(<Stock />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sin límite' }))

    expect(quitarCupo).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(screen.getAllByText('sin límite')).toHaveLength(2))
  })

  it('sin caja abierta lo explica, en vez de mostrar una lista vacía', async () => {
    listarStock.mockRejectedValue(new ErrorApi(409, 'sin jornada', 'Abrí la caja del día.'))
    render(<Stock />)

    expect(await screen.findByText('La caja del día está cerrada.')).toBeInTheDocument()
  })

  it('un plato apagado a mano lo dice: el interruptor le gana al cupo', async () => {
    listarServicios.mockResolvedValue([servicio('s1', 'Milanesa', false)])
    listarStock.mockResolvedValue([cupo('s1', 'Milanesa', 10, 0)])
    render(<Stock />)

    expect(await screen.findByText('apagado a mano en la carta')).toBeInTheDocument()
  })

  it('sin carta cargada no ofrece poner cupos sobre la nada', async () => {
    listarServicios.mockResolvedValue([])
    render(<Stock />)

    expect(await screen.findByText('Todavía no hay platos en la carta.')).toBeInTheDocument()
  })
})

describe('los platos que se controlan por receta', () => {
  it('el plato que se apagó nombra al insumo que lo apagó, con sus números y su unidad', async () => {
    listarServicios.mockResolvedValue([
      platoConReceta('s1', 'Hamburguesa', 0, {
        insumo: 'Pan de papa',
        unidad: 'unidad',
        stock: 2,
        pide_la_receta: 3,
      }),
    ])
    render(<Stock />)

    expect(
      await screen.findByText(
        '0 porciones — falta Pan de papa (quedan 2 unidades, la receta pide 3 unidades)',
      ),
    ).toBeInTheDocument()
  })

  it('no le ofrece ponerle cupo: el core lo rechazaría y quedaría un error en vez de una explicación', async () => {
    listarServicios.mockResolvedValue([
      platoConReceta('s1', 'Hamburguesa', 6, {
        insumo: 'Carne picada',
        unidad: 'g',
        stock: 1800,
        pide_la_receta: 300,
      }),
      servicio('s2', 'Milanesa'),
    ])
    render(<Stock />)

    expect(
      await screen.findByText('Se controla por receta · se edita en Carta'),
    ).toBeInTheDocument()
    // El de cupo a mano sí lo ofrece: el botón que falta es el del plato con
    // receta, no el botón entero.
    expect(screen.getAllByRole('button', { name: '+ Ponerle cupo' })).toHaveLength(1)
  })

  it('si el limitante también va en otro plato lo avisa: estas porciones se mueven solas', async () => {
    const carne = {
      insumo_id: 'carne',
      insumo_nombre: 'Carne picada',
      unidad: 'g' as const,
      cantidad: 300,
      stock: 1800,
    }
    listarServicios.mockResolvedValue([
      platoConReceta('s1', 'Bife', 6, {
        insumo: 'Carne picada',
        unidad: 'g',
        stock: 1800,
        pide_la_receta: 300,
      }),
      platoConReceta('s2', 'Empanadas', 18, {
        insumo: 'Carne picada',
        unidad: 'g',
        stock: 1800,
        pide_la_receta: 100,
      }),
    ])
    traerReceta.mockImplementation(async (id: string) =>
      recetaDe(id, [{ ...carne, cantidad: id === 's1' ? 300 : 100 }]),
    )
    render(<Stock />)

    expect(
      await screen.findByText(
        'Ojo: Carne picada también va en Empanadas. Lo que se venda de ahí baja estas porciones.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Ojo: Carne picada también va en Bife. Lo que se venda de ahí baja estas porciones.',
      ),
    ).toBeInTheDocument()
    // Los dos números están, pero cada uno con su explicación de por qué se
    // mueve: en ningún lado quedan uno al lado del otro invitando a sumarse.
    expect(screen.queryByText(/24 platos|6 \+ 18/)).not.toBeInTheDocument()
  })
})
