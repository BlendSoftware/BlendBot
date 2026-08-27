/**
 * De qué está hecho un plato.
 *
 * ── LA TRAMPA DEL MOCK ───────────────────────────────────────────────────────
 *
 * `vi.mock` con factory reemplaza el módulo entero: lo que la vista importe y
 * la factory no devuelva queda `undefined`, y como la llamada vive adentro de
 * un `try`, el error se convierte en un cartel y el test queda verde sin haber
 * ejercitado nada. Por eso acá cada test asevera algo del camino BUENO —el
 * mensaje de éxito, el endpoint con sus argumentos, el texto que sólo aparece
 * con la receta ya cargada— y el primer test compara lo que la vista importa
 * contra lo que este archivo mockea.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorReceta } from './EditorReceta'
// El código fuente del editor, como texto: lo lee el primer test para comparar
// lo que importa contra lo que esta suite mockea.
import fuente from './EditorReceta.tsx?raw'
import { ErrorApi } from '../api/cliente'
import type { Insumo, LineaReceta, Receta } from '../api/tipos'

const endpoints = vi.hoisted(() => ({
  guardarReceta: vi.fn(),
  traerReceta: vi.fn(),
}))

vi.mock('../api/endpoints', () => endpoints)

const CARNE: Insumo = {
  id: 'carne',
  nombre: 'Carne picada',
  unidad: 'g',
  stock: 1800,
  stock_minimo: null,
  bajo_minimo: false,
  activo: true,
}

const PAN: Insumo = {
  id: 'pan',
  nombre: 'Pan de papa',
  unidad: 'unidad',
  stock: 12,
  stock_minimo: null,
  bajo_minimo: false,
  activo: true,
}

function linea(i: Insumo, cantidad: number): LineaReceta {
  return {
    insumo_id: i.id,
    insumo_nombre: i.nombre,
    unidad: i.unidad,
    cantidad,
    stock: i.stock,
  }
}

function receta(campos: Partial<Receta> = {}): Receta {
  return {
    servicio_id: 's1',
    tiene_receta: false,
    items: [],
    porciones: null,
    insumo_limitante: '',
    stock_limitante: 0,
    pide_la_receta: 0,
    ...campos,
  }
}

const alGuardar = vi.fn()
const alFallar = vi.fn()
const alExito = vi.fn()

function montar(insumos: Insumo[] = [CARNE, PAN]) {
  return render(
    <EditorReceta
      servicioID="s1"
      servicioNombre="Hamburguesa"
      insumos={insumos}
      alGuardar={alGuardar}
      alFallar={alFallar}
      alExito={alExito}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  endpoints.traerReceta.mockResolvedValue(receta())
})

describe('el mock de esta suite', () => {
  it('cubre cada endpoint que el editor importa: uno nuevo no puede quedar en undefined', () => {
    const bloque = /import \{([^}]+)\} from '\.\.\/api\/endpoints'/.exec(fuente)
    const importados = (bloque?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    expect(importados.length).toBeGreaterThan(0)
    expect(importados.sort()).toEqual(Object.keys(endpoints).sort())
  })
})

describe('la cantidad va en la unidad del insumo', () => {
  it('cada línea muestra la unidad de su insumo y cuánto hay de él, sin dos números pelados', async () => {
    endpoints.traerReceta.mockResolvedValue(
      receta({
        tiene_receta: true,
        items: [linea(CARNE, 150), linea(PAN, 1)],
        porciones: 12,
        insumo_limitante: 'Pan de papa',
        stock_limitante: 12,
        pide_la_receta: 1,
      }),
    )
    montar()

    const deLaCarne = await screen.findByLabelText('Cuánto lleva de Carne picada')
    expect(deLaCarne).toHaveValue('150')
    // La unidad, pegada al número que se escribe: sin ella, 150 puede ser
    // gramos o kilos y la diferencia apaga la cocina entera.
    const filaCarne = within(deLaCarne.closest('li') as HTMLElement)
    expect(filaCarne.getByText('g')).toBeInTheDocument()
    expect(filaCarne.getByText('hay 1.800 g')).toBeInTheDocument()

    const delPan = screen.getByLabelText('Cuánto lleva de Pan de papa')
    expect(delPan).toHaveValue('1')
    const filaPan = within(delPan.closest('li') as HTMLElement)
    expect(filaPan.getByText('unidades')).toBeInTheDocument()
    expect(filaPan.getByText('hay 12 unidades')).toBeInTheDocument()
  })

  it('no hay dónde elegir unidad: la única lista es la de insumos, y el sufijo sigue al elegido', async () => {
    montar()

    const listas = await screen.findAllByRole('combobox')
    expect(listas).toHaveLength(1)
    expect(listas[0]).toHaveAccessibleName(/Qué lleva/)

    // Sin insumo elegido no se inventa una unidad.
    expect(screen.getByText('—')).toBeInTheDocument()

    await userEvent.selectOptions(listas[0] as HTMLElement, 'pan')
    expect(screen.getByText('unidades')).toBeInTheDocument()

    await userEvent.selectOptions(listas[0] as HTMLElement, 'carne')
    expect(screen.getByText('g')).toBeInTheDocument()
  })
})

describe('armar la receta', () => {
  it('un insumo que ya está en la receta no se ofrece de nuevo: aparece una sola vez por plato', async () => {
    endpoints.traerReceta.mockResolvedValue(
      receta({ tiene_receta: true, items: [linea(CARNE, 150)], porciones: 12, insumo_limitante: 'Carne picada' }),
    )
    montar()

    expect(await screen.findByLabelText('Cuánto lleva de Carne picada')).toBeInTheDocument()
    const lista = screen.getByRole('combobox')

    expect(within(lista).queryByRole('option', { name: 'Carne picada' })).not.toBeInTheDocument()
    expect(within(lista).getByRole('option', { name: 'Pan de papa' })).toBeInTheDocument()
  })

  it('guardar manda la receta entera: la lista que va es la que queda', async () => {
    endpoints.traerReceta.mockResolvedValue(
      receta({ tiene_receta: true, items: [linea(CARNE, 150)] }),
    )
    endpoints.guardarReceta.mockResolvedValue(
      receta({
        tiene_receta: true,
        items: [linea(CARNE, 150), linea(PAN, 1)],
        porciones: 12,
        insumo_limitante: 'Pan de papa',
      }),
    )
    montar()

    await userEvent.selectOptions(await screen.findByRole('combobox'), 'pan')
    await userEvent.type(screen.getByRole('textbox', { name: /Cuánto, por porción/ }), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar la receta' }))

    await waitFor(() =>
      expect(endpoints.guardarReceta).toHaveBeenCalledWith('s1', [
        { insumo_id: 'carne', cantidad: 150 },
        { insumo_id: 'pan', cantidad: 1 },
      ]),
    )
    expect(alExito).toHaveBeenCalledWith('Receta de Hamburguesa guardada.')
  })

  it('sin insumos cargados manda a cargarlos, en vez de ofrecer una receta imposible', () => {
    montar([])

    expect(screen.getByText(/Andá a Stock → Insumos/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar la receta' })).not.toBeInTheDocument()
  })
})

describe('la receta vacía no apaga el plato', () => {
  it('sacar la última línea avisa que el plato vuelve a ser ilimitado, no que se apaga', async () => {
    endpoints.traerReceta.mockResolvedValue(
      receta({ tiene_receta: true, items: [linea(CARNE, 150)], porciones: 12, insumo_limitante: 'Carne picada' }),
    )
    endpoints.guardarReceta.mockResolvedValue(receta())
    montar()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sacar Carne picada de la receta' }),
    )

    expect(
      screen.getByText('Sin líneas, este plato vuelve a ser ilimitado: vaciar la receta no lo apaga.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar la receta' }))

    await waitFor(() => expect(endpoints.guardarReceta).toHaveBeenCalledWith('s1', []))
    expect(alExito).toHaveBeenCalledWith(
      'Hamburguesa vuelve a estar sin límite: se le vació la receta.',
    )
  })
})

describe('receta o cupo del día, nunca los dos', () => {
  it('el rechazo dice cuál de los dos hay que sacar, y no "conflicto"', async () => {
    endpoints.traerReceta.mockResolvedValue(receta())
    endpoints.guardarReceta.mockRejectedValue(
      new ErrorApi(409, 'el servicio tiene cupo del dia cargado', 'Eso ya está tomado.'),
    )
    montar()

    await userEvent.selectOptions(await screen.findByRole('combobox'), 'pan')
    await userEvent.type(screen.getByRole('textbox', { name: /Cuánto, por porción/ }), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar la receta' }))

    await waitFor(() =>
      expect(alFallar).toHaveBeenCalledWith(
        'Hamburguesa tiene cupo del día cargado en Stock. Sacale el cupo y después ponele receta: manda uno de los dos, nunca los dos juntos.',
      ),
    )
  })
})

describe('lo que la receta guardada da hoy', () => {
  it('dice cuántas porciones salen y nombra al insumo que se acaba primero', async () => {
    endpoints.traerReceta.mockResolvedValue(
      receta({
        tiene_receta: true,
        items: [linea(CARNE, 150), linea(PAN, 1)],
        porciones: 12,
        insumo_limitante: 'Pan de papa',
        stock_limitante: 12,
        pide_la_receta: 1,
      }),
    )
    montar()

    expect(
      await screen.findByText(
        /Con lo que hay ahora salen 12 porciones — lo primero que se acaba es Pan de papa/,
      ),
    ).toBeInTheDocument()
  })

  it('con cambios sin guardar esconde el número: hasta entonces habla de la receta vieja', async () => {
    endpoints.traerReceta.mockResolvedValue(
      receta({
        tiene_receta: true,
        items: [linea(PAN, 1)],
        porciones: 12,
        insumo_limitante: 'Pan de papa',
        stock_limitante: 12,
        pide_la_receta: 1,
      }),
    )
    montar()

    const campo = await screen.findByLabelText('Cuánto lleva de Pan de papa')
    await userEvent.type(campo, '2')

    expect(screen.queryByText(/Con lo que hay ahora salen/)).not.toBeInTheDocument()
  })
})
