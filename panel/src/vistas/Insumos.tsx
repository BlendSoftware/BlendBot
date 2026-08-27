/**
 * La materia prima del local: la pestaña Insumos de Stock.
 *
 * No es "gestión de inventario". Es la libretita de la heladera: cuánta carne
 * hay, cuánto pan, y de dónde salió el número. El plato que lleva receta se
 * apaga solo cuando esto no alcanza — por eso vale la pena mantenerlo.
 *
 * Dos cosas que parecen detalles y no lo son:
 *
 * · **La unidad va al lado de cada campo de cantidad, sin excepción.** No hay
 *   conversión en ninguna parte: la unidad la elige el insumo una vez y la
 *   receta la hereda. Cargar la carne en kilos y la receta en gramos apaga la
 *   cocina entera por un factor de mil y el dueño no tiene cómo darse cuenta.
 *
 * · **Los insumos compartidos se muestran como dependencia, nunca como dos
 *   números.** Si la carne la usan el bife y las empanadas, sus porciones no
 *   son independientes: leen el mismo saldo. "6 bifes / 20 empanadas" se lee
 *   como "26 platos" y después parece roto.
 *
 * El stock no se toca nunca de forma directa: todo pasa por un movimiento, y
 * por eso se puede contestar "compré 20 kg, ¿por qué me quedan 3?".
 */

import { useEffect, useState } from 'react'
import {
  actualizarInsumo,
  ajustarStock,
  crearInsumo,
  listarMovimientos,
  registrarCompra,
} from '../api/endpoints'
import type { Insumo, MovimientoInsumo, TipoMovimiento, Unidad } from '../api/tipos'
import {
  UNIDADES,
  cantidad,
  cantidadMovimiento,
  etiquetaMovimiento,
  fraseUsos,
  nombreUnidad,
  sufijo,
} from '../dominio/insumos'
import type { UsoDeInsumo } from '../dominio/insumos'
import { fechaCorta, horaDe } from '../dominio/formato'
import { Esqueleto, Vacio } from '../componentes/basicos'

/** Sólo dígitos: las cantidades de insumo son enteras en la unidad del insumo. */
function soloEnteros(texto: string): string {
  return texto.replace(/\D/g, '')
}

interface Props {
  insumos: Insumo[]
  /** insumo_id → en qué platos va y cuánto le pide cada uno. */
  usos: Map<string, UsoDeInsumo[]>
  cargando: boolean
  alRecargar: () => Promise<void>
  alFallar: (mensaje: string) => void
  alBien: (mensaje: string) => void
}

export function Insumos({ insumos, usos, cargando, alRecargar, alFallar, alBien }: Props) {
  if (cargando) return <Esqueleto alto={96} cantidad={4} />

  return (
    <>
      {insumos.length === 0 ? (
        <Vacio
          titulo="Todavía no cargaste ningún insumo."
          detalle="Cargá la carne, el pan, la gaseosa: lo que se te puede acabar en el medio del servicio. Después le ponés receta a los platos en Carta y se apagan solos cuando no alcanza."
        />
      ) : (
        <ul className="insumos__lista">
          {insumos.map((i) => (
            <FilaInsumo
              key={i.id}
              insumo={i}
              usos={usos.get(i.id) ?? []}
              alRecargar={alRecargar}
              alFallar={alFallar}
              alBien={alBien}
            />
          ))}
        </ul>
      )}

      <AltaInsumo alRecargar={alRecargar} alFallar={alFallar} alBien={alBien} />
    </>
  )
}

/** Qué está abierto debajo de una fila. Uno a la vez: la pantalla es una tablet. */
type Panel = null | 'compra' | 'ajuste' | 'historia' | 'aviso'

function FilaInsumo({
  insumo,
  usos,
  alRecargar,
  alFallar,
  alBien,
}: {
  insumo: Insumo
  usos: UsoDeInsumo[]
  alRecargar: () => Promise<void>
  alFallar: (m: string) => void
  alBien: (m: string) => void
}) {
  const [panel, setPanel] = useState<Panel>(null)

  function alternar(cual: Exclude<Panel, null>) {
    setPanel((p) => (p === cual ? null : cual))
  }

  const vacio = insumo.stock === 0
  const clase = vacio ? 'insumos__fila--vacio' : insumo.bajo_minimo ? 'insumos__fila--bajo' : ''

  return (
    <li className={`insumos__fila ${clase}`}>
      <div className="insumos__cabeza">
        <div className="insumos__datos">
          <span className="insumos__nombre">{insumo.nombre}</span>
          {/* La dependencia, no dos números que parezcan sumables. */}
          <span className="insumos__usos">{fraseUsos(insumo, usos)}</span>
        </div>
        <span className="insumos__saldo tabular">{cantidad(insumo.stock, insumo.unidad)}</span>
      </div>

      <div className="insumos__marcas">
        {vacio && <span className="insumos__marca insumos__marca--vacio">Se acabó</span>}
        {!vacio && insumo.bajo_minimo && (
          <span className="insumos__marca insumos__marca--bajo">Hay que reponer</span>
        )}
        <button
          type="button"
          className="insumos__minimo"
          onClick={() => alternar('aviso')}
          aria-expanded={panel === 'aviso'}
        >
          {insumo.stock_minimo === null
            ? 'sin aviso'
            : `te avisamos abajo de ${cantidad(insumo.stock_minimo, insumo.unidad)}`}
        </button>
      </div>

      <div className="insumos__acciones">
        <button
          type="button"
          className="boton"
          onClick={() => alternar('compra')}
          aria-expanded={panel === 'compra'}
        >
          Entró mercadería
        </button>
        <button
          type="button"
          className="boton boton--fantasma"
          onClick={() => alternar('ajuste')}
          aria-expanded={panel === 'ajuste'}
        >
          Corregir
        </button>
        <button
          type="button"
          className="boton boton--fantasma"
          onClick={() => alternar('historia')}
          aria-expanded={panel === 'historia'}
        >
          Movimientos
        </button>
      </div>

      {panel === 'compra' && (
        <FormaMovimiento
          insumo={insumo}
          tipo="compra"
          alCerrar={() => setPanel(null)}
          alRecargar={alRecargar}
          alFallar={alFallar}
          alBien={alBien}
        />
      )}

      {panel === 'ajuste' && (
        <FormaMovimiento
          insumo={insumo}
          tipo="ajuste"
          alCerrar={() => setPanel(null)}
          alRecargar={alRecargar}
          alFallar={alFallar}
          alBien={alBien}
        />
      )}

      {panel === 'aviso' && (
        <FormaAviso
          insumo={insumo}
          alCerrar={() => setPanel(null)}
          alRecargar={alRecargar}
          alFallar={alFallar}
          alBien={alBien}
        />
      )}

      {panel === 'historia' && <Historia insumo={insumo} alFallar={alFallar} />}
    </li>
  )
}

/**
 * Entró mercadería y corregir a mano son el mismo gesto con distinto
 * significado, y por eso están juntos: uno SUMA lo que llegó, el otro FIJA lo
 * que alguien contó. Mezclarlos es la forma más fácil de duplicar un saldo, así
 * que cada uno dice en qué va a quedar el insumo antes de guardar.
 */
function FormaMovimiento({
  insumo,
  tipo,
  alCerrar,
  alRecargar,
  alFallar,
  alBien,
}: {
  insumo: Insumo
  tipo: Extract<TipoMovimiento, 'compra' | 'ajuste'>
  alCerrar: () => void
  alRecargar: () => Promise<void>
  alFallar: (m: string) => void
  alBien: (m: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const valor = texto === '' ? null : Number(texto)
  const esCompra = tipo === 'compra'
  const quedaEn = valor === null ? null : esCompra ? insumo.stock + valor : valor

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (valor === null) return
    setGuardando(true)
    try {
      // Dos endpoints y no uno con un `tipo`: la compra manda CUÁNTO ENTRÓ y el
      // ajuste manda EL SALDO que alguien contó. Son dos números distintos con
      // el mismo aspecto, y mezclarlos en un solo campo es la forma más fácil
      // de duplicar un stock.
      if (esCompra) {
        await registrarCompra(insumo.id, { cantidad: valor, motivo: motivo.trim() || null })
      } else {
        await ajustarStock(insumo.id, { stock: valor, motivo: motivo.trim() || null })
      }
      await alRecargar()
      alBien(
        esCompra
          ? `${insumo.nombre}: entraron ${cantidad(valor, insumo.unidad)}.`
          : `${insumo.nombre} quedó en ${cantidad(valor, insumo.unidad)}.`,
      )
      alCerrar()
    } catch (err) {
      alFallar(err instanceof Error ? err.message : 'No se pudo anotar el movimiento.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form className="insumos__panel" onSubmit={guardar}>
      <div className="insumos__campos">
        <label className="campo">
          <span>{esCompra ? 'Cuánto entró' : 'Cuánto hay de verdad'}</span>
          {/* La unidad, al lado del campo. Siempre. */}
          <span className="insumos__conunidad">
            <input
              className="entrada tabular"
              inputMode="numeric"
              value={texto}
              onChange={(e) => setTexto(soloEnteros(e.target.value))}
              placeholder="0"
              autoFocus
            />
            <span className="insumos__unidad">{sufijo(insumo.unidad)}</span>
          </span>
        </label>

        {!esCompra && (
          <label className="campo insumos__campo-motivo">
            <span>Por qué</span>
            <input
              className="entrada"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Conté la heladera / se cayó una bandeja"
            />
          </label>
        )}
      </div>

      <p className="insumos__pista">
        {esCompra
          ? `Se suma a lo que ya había. ${
              quedaEn === null
                ? `Ahora hay ${cantidad(insumo.stock, insumo.unidad)}.`
                : `Va a quedar en ${cantidad(quedaEn, insumo.unidad)}.`
            }`
          : `El sistema dice ${cantidad(
              insumo.stock,
              insumo.unidad,
            )}. Poné lo que contaste: queda anotado quién lo cambió y por qué.`}
      </p>

      <div className="insumos__panel-acciones">
        <button
          type="submit"
          className="boton boton--primario"
          // Un ajuste a 0 sí vale —"se acabó, contá de nuevo"—; una compra de 0
          // no es nada.
          disabled={guardando || valor === null || (esCompra && valor <= 0)}
        >
          {guardando ? 'Guardando' : esCompra ? 'Sumar al stock' : 'Corregir el saldo'}
        </button>
        <button type="button" className="boton boton--fantasma" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * El aviso de bajo mínimo. Dejarlo en blanco es "no me avises", y eso NO es lo
 * mismo que un mínimo en cero: un insumo sin mínimo cargado no se marca nunca,
 * aunque quede en 1.
 */
function FormaAviso({
  insumo,
  alCerrar,
  alRecargar,
  alFallar,
  alBien,
}: {
  insumo: Insumo
  alCerrar: () => void
  alRecargar: () => Promise<void>
  alFallar: (m: string) => void
  alBien: (m: string) => void
}) {
  const [texto, setTexto] = useState(insumo.stock_minimo === null ? '' : String(insumo.stock_minimo))
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    try {
      // El nombre viaja aunque no cambie: el PATCH no es parcial, y así
      // `stock_minimo: null` puede significar "borrame el mínimo" sin
      // confundirse con "no lo mandé".
      await actualizarInsumo(insumo.id, {
        nombre: insumo.nombre,
        stock_minimo: texto === '' ? null : Number(texto),
      })
      await alRecargar()
      alBien(
        texto === ''
          ? `${insumo.nombre}: no te avisamos más.`
          : `${insumo.nombre}: te avisamos abajo de ${cantidad(Number(texto), insumo.unidad)}.`,
      )
      alCerrar()
    } catch (err) {
      alFallar(err instanceof Error ? err.message : 'No se pudo guardar el aviso.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form className="insumos__panel" onSubmit={guardar}>
      <label className="campo">
        <span>Avisame cuando baje de</span>
        <span className="insumos__conunidad">
          <input
            className="entrada tabular"
            inputMode="numeric"
            value={texto}
            onChange={(e) => setTexto(soloEnteros(e.target.value))}
            placeholder="sin aviso"
            autoFocus
          />
          <span className="insumos__unidad">{sufijo(insumo.unidad)}</span>
        </span>
      </label>

      <p className="insumos__pista">
        Dejalo en blanco y no te molestamos con este: en blanco es "no me avises", no "avisame
        siempre".
      </p>

      <div className="insumos__panel-acciones">
        <button type="submit" className="boton boton--primario" disabled={guardando}>
          {guardando ? 'Guardando' : 'Guardar'}
        </button>
        <button type="button" className="boton boton--fantasma" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * De dónde salió el saldo. Existe para una sola pregunta, que aparece el día
 * dos: "compré 20 kg, ¿por qué me quedan 3?". Sin respuesta el dueño deja de
 * confiar en el número, y ahí es donde esta función se muere.
 */
function Historia({ insumo, alFallar }: { insumo: Insumo; alFallar: (m: string) => void }) {
  const [movimientos, setMovimientos] = useState<MovimientoInsumo[] | null>(null)

  // Se pide al abrir y no antes: la historia de veinte insumos que nadie miró
  // son veinte consultas de más en cada refresco.
  useEffect(() => {
    let vivo = true
    listarMovimientos(insumo.id)
      .then((m) => {
        if (vivo) setMovimientos(m)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setMovimientos([])
        alFallar(e instanceof Error ? e.message : 'No se pudo traer la historia.')
      })
    return () => {
      vivo = false
    }
  }, [insumo.id, alFallar])

  if (movimientos === null) return <Esqueleto alto={36} cantidad={3} />

  if (movimientos.length === 0) {
    return (
      <p className="insumos__pista insumos__panel">
        Todavía no se movió nada desde que lo cargaste.
      </p>
    )
  }

  return (
    <div className="insumos__panel">
      <p className="insumos__pista">Todo lo que entró y salió, de lo último a lo primero.</p>
      <ul className="movimientos">
        {movimientos.map((m) => (
          <li key={m.id} className="movimientos__fila">
            <span className="movimientos__cuando tabular">
              {fechaCorta(m.creado_en.slice(0, 10))} · {horaDe(m.creado_en)}
            </span>
            <span className="movimientos__que">{etiquetaMovimiento(m.tipo)}</span>
            <span className="movimientos__cuanto tabular">
              {cantidadMovimiento(m.tipo, m.cantidad, insumo.unidad)}
            </span>
            <span className="movimientos__saldo tabular">
              quedó en {cantidad(m.saldo_resultante, insumo.unidad)}
            </span>
            {m.motivo && <span className="movimientos__motivo">{m.motivo}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Alta de insumo. El único lugar donde se elige una unidad en todo el sistema,
 * y de ahí en más manda: la receta la hereda y no se puede convertir. Por eso
 * la pantalla lo dice con todas las letras antes de que alguien cargue kilos.
 */
function AltaInsumo({
  alRecargar,
  alFallar,
  alBien,
}: {
  alRecargar: () => Promise<void>
  alFallar: (m: string) => void
  alBien: (m: string) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [nombre, setNombre] = useState('')
  const [unidad, setUnidad] = useState<Unidad>('g')
  const [stock, setStock] = useState('')
  const [minimo, setMinimo] = useState('')
  const [guardando, setGuardando] = useState(false)

  function cerrar() {
    setAbierta(false)
    setNombre('')
    setUnidad('g')
    setStock('')
    setMinimo('')
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setGuardando(true)
    try {
      await crearInsumo({
        nombre: nombre.trim(),
        unidad,
        stock_inicial: stock === '' ? 0 : Number(stock),
        stock_minimo: minimo === '' ? null : Number(minimo),
      })
      await alRecargar()
      alBien(`${nombre.trim()} cargado.`)
      cerrar()
    } catch (err) {
      alFallar(err instanceof Error ? err.message : 'No se pudo cargar el insumo.')
    } finally {
      setGuardando(false)
    }
  }

  if (!abierta) {
    return (
      <button type="button" className="boton disparador" onClick={() => setAbierta(true)}>
        + Cargar un insumo
      </button>
    )
  }

  return (
    <form className="insumos__alta" onSubmit={crear}>
      <div className="insumos__campos">
        <label className="campo insumos__campo-nombre">
          <span>Qué es</span>
          <input
            className="entrada"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Carne picada"
            autoFocus
          />
        </label>

        <label className="campo">
          <span>Cómo lo medís</span>
          <select
            className="entrada"
            value={unidad}
            onChange={(e) => setUnidad(e.target.value as Unidad)}
          >
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {nombreUnidad(u)}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span>Cuánto hay ahora</span>
          <span className="insumos__conunidad">
            <input
              className="entrada tabular"
              inputMode="numeric"
              value={stock}
              onChange={(e) => setStock(soloEnteros(e.target.value))}
              placeholder="0"
            />
            <span className="insumos__unidad">{sufijo(unidad)}</span>
          </span>
        </label>

        <label className="campo">
          <span>Avisame abajo de</span>
          <span className="insumos__conunidad">
            <input
              className="entrada tabular"
              inputMode="numeric"
              value={minimo}
              onChange={(e) => setMinimo(soloEnteros(e.target.value))}
              placeholder="sin aviso"
            />
            <span className="insumos__unidad">{sufijo(unidad)}</span>
          </span>
        </label>
      </div>

      <p className="insumos__pista">
        La unidad se elige una sola vez y después no se cambia: las recetas quedan escritas en
        ella. Si la carne la comprás por kilo, cargala igual en gramos — 5 kg son 5000 g. Nadie
        convierte nada por vos.
      </p>

      <div className="insumos__panel-acciones">
        <button
          type="submit"
          className="boton boton--primario"
          disabled={guardando || !nombre.trim()}
        >
          {guardando ? 'Cargando' : 'Cargar'}
        </button>
        <button type="button" className="boton boton--fantasma" onClick={cerrar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
