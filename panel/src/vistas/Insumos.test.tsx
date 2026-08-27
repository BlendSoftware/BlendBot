/**
 * La libretita de la heladera: cuánto hay, de dónde salió el número y qué
 * platos dependen de él.
 *
 * ── LA TRAMPA DEL MOCK, QUE ACÁ YA MORDIÓ ────────────────────────────────────
 *
 * `vi.mock` con una factory que devuelve un objeto literal reemplaza el módulo
 * ENTERO: todo export que la vista importe y la factory no devuelva queda
 * `undefined`. Y como casi todas las llamadas de estas vistas viven adentro de
 * un `try`, el `undefined is not a function` cae en el `catch`, se convierte en
 * un cartel de problema y el test sigue verde sin haber ejercitado nada. Los 10
 * tests de `Stock.test.tsx` pasaron así un tiempo: por el camino de error.
 *
 * Dos defensas, y hacen falta las dos:
 *
 * 1. Cada test asevera algo que SÓLO existe en el camino bueno — el mensaje de
 *    éxito, la llamada al endpoint con sus argumentos — nunca "no explotó".
 * 2. El primer test de abajo compara lo que la vista importa contra lo que este
 *    archivo mockea. El día que alguien agregue un endpoint a `Insumos.tsx` y
 *    no lo mockee, falla acá y no en silencio.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Insumos } from './Insumos'
// El código fuente de la vista, como texto: lo lee el primer test para
// comparar lo que importa contra lo que esta suite mockea.
import fuente from './Insumos.tsx?raw'
import type { Insumo, MovimientoInsumo } from '../api/tipos'
import type { UsoDeInsumo } from '../dominio/insumos'

const endpoints = vi.hoisted(() => ({
  actualizarInsumo: vi.fn(),
  ajustarStock: vi.fn(),
  crearInsumo: vi.fn(),
  listarMovimientos: vi.fn(),
  registrarCompra: vi.fn(),
}))

vi.mock('../api/endpoints', () => endpoints)

function insumo(campos: Partial<Insumo> = {}): Insumo {
  return {
    id: 'i1',
    nombre: 'Carne picada',
    unidad: 'g',
    stock: 40000,
    stock_minimo: null,
    bajo_minimo: false,
    activo: true,
    ...campos,
  }
}

function movimiento(campos: Partial<MovimientoInsumo> = {}): MovimientoInsumo {
  return {
    id: 'm1',
    tipo: 'compra',
    cantidad: 20000,
    saldo_resultante: 40000,
    compromiso_id: null,
    motivo: null,
    creado_en: '2026-08-26T18:30:00-03:00',
    ...campos,
  }
}

const alRecargar = vi.fn(async () => {})
const alFallar = vi.fn()
const alBien = vi.fn()

function montar(insumos: Insumo[], usos: Map<string, UsoDeInsumo[]> = new Map()) {
  return render(
    <Insumos
      insumos={insumos}
      usos={usos}
      cargando={false}
      alRecargar={alRecargar}
      alFallar={alFallar}
      alBien={alBien}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  endpoints.listarMovimientos.mockResolvedValue([])
})

describe('el mock de esta suite', () => {
  it('cubre cada endpoint que la vista importa: uno nuevo no puede quedar en undefined', () => {
    const bloque = /import \{([^}]+)\} from '\.\.\/api\/endpoints'/.exec(fuente)
    const importados = (bloque?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    expect(importados.length).toBeGreaterThan(0)
    expect(importados.sort()).toEqual(Object.keys(endpoints).sort())
  })
})

describe('la materia prima del local', () => {
  it('sin insumos cargados explica para qué sirven, en vez de mostrar una lista vacía', () => {
    montar([])

    expect(screen.getByText('Todavía no cargaste ningún insumo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Cargar un insumo' })).toBeInTheDocument()
  })

  it('el saldo de cada insumo se lee con su unidad, nunca como un número suelto', () => {
    montar([insumo({ stock: 12000 })])

    expect(screen.getByText('12.000 g')).toBeInTheDocument()
  })
})

describe('el aviso de bajo mínimo', () => {
  it('el insumo que cayó abajo del mínimo aparece marcado y dice desde qué número avisa', () => {
    montar([insumo({ stock: 4200, stock_minimo: 5000, bajo_minimo: true })])

    expect(screen.getByText('Hay que reponer')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'te avisamos abajo de 5.000 g' }),
    ).toBeInTheDocument()
  })

  it('un insumo sin mínimo cargado no se marca aunque quede en 1: en blanco es "no me avises"', () => {
    montar([insumo({ stock: 1, stock_minimo: null, bajo_minimo: false })])

    expect(screen.getByText('1 g')).toBeInTheDocument()
    expect(screen.queryByText('Hay que reponer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sin aviso' })).toBeInTheDocument()
  })

  it('borrar el mínimo manda null y no cero: son dos cosas distintas', async () => {
    const i = insumo({ stock: 4200, stock_minimo: 5000, bajo_minimo: true })
    endpoints.actualizarInsumo.mockResolvedValue(i)
    montar([i])

    await userEvent.click(screen.getByRole('button', { name: 'te avisamos abajo de 5.000 g' }))
    await userEvent.clear(screen.getByRole('textbox', { name: /Avisame cuando baje de/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(endpoints.actualizarInsumo).toHaveBeenCalledWith('i1', {
        nombre: 'Carne picada',
        stock_minimo: null,
      }),
    )
    expect(alBien).toHaveBeenCalledWith('Carne picada: no te avisamos más.')
  })
})

describe('los insumos compartidos', () => {
  it('un insumo que va en dos platos se muestra como dependencia y no como dos números', () => {
    const usos = new Map<string, UsoDeInsumo[]>([
      [
        'i1',
        [
          { servicio_id: 's1', servicio_nombre: 'Bife', cantidad: 300 },
          { servicio_id: 's2', servicio_nombre: 'Empanadas', cantidad: 100 },
        ],
      ],
    ])
    montar([insumo()], usos)

    expect(
      screen.getByText(
        'Va en Bife (300 g) y Empanadas (100 g), por porción. Lo que se venda de uno le baja las porciones a los otros: sale del mismo saldo.',
      ),
    ).toBeInTheDocument()
    // Ni "6 bifes" ni "20 empanadas": las porciones posibles de los dos leen el
    // mismo saldo y mostrarlas al lado invita a sumarlas.
    expect(screen.queryByText(/porciones posibles/i)).not.toBeInTheDocument()
  })
})

describe('mover el saldo', () => {
  it('lo que entró se suma a lo que había, y la pantalla lo adelanta con unidad antes de guardar', async () => {
    endpoints.registrarCompra.mockResolvedValue(insumo({ stock: 60000 }))
    montar([insumo({ stock: 40000 })])

    await userEvent.click(screen.getByRole('button', { name: 'Entró mercadería' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Cuánto entró/ }), '20000')

    expect(screen.getByText(/Va a quedar en 60.000 g/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sumar al stock' }))

    await waitFor(() =>
      expect(endpoints.registrarCompra).toHaveBeenCalledWith('i1', {
        cantidad: 20000,
        motivo: null,
      }),
    )
    expect(alRecargar).toHaveBeenCalled()
    expect(alBien).toHaveBeenCalledWith('Carne picada: entraron 20.000 g.')
  })

  it('corregir manda el saldo que alguien contó, no la diferencia: mezclarlos duplica el stock', async () => {
    endpoints.ajustarStock.mockResolvedValue(insumo({ stock: 3200 }))
    montar([insumo({ stock: 40000 })])

    await userEvent.click(screen.getByRole('button', { name: 'Corregir' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Cuánto hay de verdad/ }), '3200')
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Por qué' }),
      'Conté la heladera',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Corregir el saldo' }))

    await waitFor(() =>
      expect(endpoints.ajustarStock).toHaveBeenCalledWith('i1', {
        stock: 3200,
        motivo: 'Conté la heladera',
      }),
    )
    expect(alBien).toHaveBeenCalledWith('Carne picada quedó en 3.200 g.')
  })

  it('la historia contesta "compré 20 kg, ¿por qué me quedan 3?": qué pasó, cuánto y en cuánto quedó', async () => {
    endpoints.listarMovimientos.mockResolvedValue([
      movimiento({ id: 'm2', tipo: 'consumo', cantidad: 400, saldo_resultante: 39600 }),
      movimiento(),
    ])
    montar([insumo()])

    await userEvent.click(screen.getByRole('button', { name: 'Movimientos' }))

    expect(await screen.findByText('Se usó en un pedido')).toBeInTheDocument()
    // La lista de movimientos, no la de insumos: "Entró mercadería" es también
    // el botón de la fila y sin acotar se confunden.
    const [, historia] = screen.getAllByRole('list')
    const filas = within(historia as HTMLElement).getAllByRole('listitem')

    expect(within(filas[0] as HTMLElement).getByText('− 400 g')).toBeInTheDocument()
    expect(within(filas[0] as HTMLElement).getByText('quedó en 39.600 g')).toBeInTheDocument()
    expect(within(filas[1] as HTMLElement).getByText('Entró mercadería')).toBeInTheDocument()
    expect(within(filas[1] as HTMLElement).getByText('+ 20.000 g')).toBeInTheDocument()
    expect(endpoints.listarMovimientos).toHaveBeenCalledWith('i1')
  })
})

describe('cargar un insumo nuevo', () => {
  it('la unidad se elige una sola vez acá, y los campos de cantidad la muestran al lado', async () => {
    endpoints.crearInsumo.mockResolvedValue(insumo({ nombre: 'Pan de papa', unidad: 'unidad' }))
    montar([])

    await userEvent.click(screen.getByRole('button', { name: '+ Cargar un insumo' }))

    await userEvent.type(screen.getByRole('textbox', { name: /Qué es/ }), 'Pan de papa')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Cómo lo medís/ }),
      'unidad',
    )

    // El sufijo sigue a la unidad elegida: la receta la va a heredar y nadie
    // convierte nada después.
    const sufijos = screen
      .getAllByText('unidades')
      .filter((e) => e.className === 'insumos__unidad')
    expect(sufijos).toHaveLength(2)

    await userEvent.type(screen.getByRole('textbox', { name: /Cuánto hay ahora/ }), '48')
    await userEvent.click(screen.getByRole('button', { name: 'Cargar' }))

    await waitFor(() =>
      expect(endpoints.crearInsumo).toHaveBeenCalledWith({
        nombre: 'Pan de papa',
        unidad: 'unidad',
        stock_inicial: 48,
        stock_minimo: null,
      }),
    )
    expect(alBien).toHaveBeenCalledWith('Pan de papa cargado.')
  })
})
