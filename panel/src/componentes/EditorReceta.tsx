/**
 * De qué está hecho un plato. Se edita en Carta, colgado del plato, porque es
 * ahí donde el dueño piensa "de qué está hecha la hamburguesa" — en Stock
 * piensa "en qué se me va la carne", que es la otra vuelta de lo mismo.
 *
 * La regla que no se toca: **la cantidad va en la unidad del insumo y acá no se
 * elige unidad ninguna.** La unidad se decidió al crear el insumo y la receta
 * la hereda; no hay conversión en ningún punto del sistema. Cargar la carne en
 * kilos y la receta en gramos apaga la cocina entera por un factor de mil y el
 * dueño no tiene forma de darse cuenta de que ese es el problema. Por eso la
 * unidad se muestra al lado de cada cantidad y cambia sola con el insumo
 * elegido.
 *
 * Las cantidades son POR PORCIÓN: el descuento al confirmar multiplica por las
 * unidades pedidas.
 */

import { useEffect, useState } from 'react'
import { guardarReceta, traerReceta } from '../api/endpoints'
import { ErrorApi } from '../api/cliente'
import type { Insumo, LineaReceta, Receta, RecetaItem } from '../api/tipos'
import { cantidad, porciones, sufijo } from '../dominio/insumos'
import { Esqueleto } from './basicos'

function soloEnteros(texto: string): string {
  return texto.replace(/\D/g, '')
}

interface Props {
  servicioID: string
  servicioNombre: string
  /** La materia prima cargada del negocio. Sin insumos no hay receta posible. */
  insumos: Insumo[]
  alGuardar: (items: RecetaItem[]) => void
  alFallar: (mensaje: string) => void
  alExito: (mensaje: string) => void
}

export function EditorReceta({
  servicioID,
  servicioNombre,
  insumos,
  alGuardar,
  alFallar,
  alExito,
}: Props) {
  // Las líneas vienen ya resueltas del core —nombre, unidad y stock del
  // insumo— así que acá no se cruza nada con nada: la unidad que se muestra al
  // lado de cada cantidad es la del insumo, de primera mano.
  const [items, setItems] = useState<LineaReceta[] | null>(null)
  const [derivado, setDerivado] = useState<Receta | null>(null)
  const [elegido, setElegido] = useState('')
  const [cuanto, setCuanto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [sucia, setSucia] = useState(false)

  useEffect(() => {
    let vivo = true
    traerReceta(servicioID)
      .then((r) => {
        if (!vivo) return
        setItems(r.items)
        setDerivado(r)
        setSucia(false)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setItems([])
        alFallar(e instanceof Error ? e.message : 'No se pudo traer la receta.')
      })
    return () => {
      vivo = false
    }
  }, [servicioID, alFallar])

  if (insumos.length === 0) {
    return (
      <p className="receta__vacio">
        Todavía no cargaste insumos. Andá a Stock → Insumos, cargá la carne, el pan y lo que se te
        pueda acabar, y volvé a ponerle la receta a este plato.
      </p>
    )
  }

  if (items === null) return <Esqueleto alto={44} cantidad={2} />

  // Un insumo aparece una sola vez por receta: si ya está, se le cambia la
  // cantidad en su línea en vez de agregar una segunda que contradiga a la
  // primera.
  const disponibles = insumos.filter((i) => !items.some((it) => it.insumo_id === i.id))
  const insumoElegido = insumos.find((i) => i.id === elegido)

  function agregar() {
    if (!insumoElegido || cuanto === '' || Number(cuanto) <= 0) return
    setItems([
      ...(items ?? []),
      {
        insumo_id: insumoElegido.id,
        insumo_nombre: insumoElegido.nombre,
        unidad: insumoElegido.unidad,
        cantidad: Number(cuanto),
        stock: insumoElegido.stock,
      },
    ])
    setElegido('')
    setCuanto('')
    setSucia(true)
  }

  function cambiar(insumoID: string, valor: string) {
    setItems((l) =>
      (l ?? []).map((it) =>
        it.insumo_id === insumoID ? { ...it, cantidad: valor === '' ? 0 : Number(valor) } : it,
      ),
    )
    setSucia(true)
  }

  function sacar(insumoID: string) {
    setItems((l) => (l ?? []).filter((it) => it.insumo_id !== insumoID))
    setSucia(true)
  }

  async function guardar() {
    const lista: RecetaItem[] = (items ?? [])
      .filter((it) => it.cantidad > 0)
      .map((it) => ({ insumo_id: it.insumo_id, cantidad: it.cantidad }))
    setGuardando(true)
    try {
      const guardada = await guardarReceta(servicioID, lista)
      setItems(guardada.items)
      setDerivado(guardada)
      setSucia(false)
      alGuardar(lista)
      alExito(
        lista.length === 0
          ? `${servicioNombre} vuelve a estar sin límite: se le vació la receta.`
          : `Receta de ${servicioNombre} guardada.`,
      )
    } catch (e) {
      // Un plato tiene receta O cupo del día, nunca los dos: si tuviera los dos
      // habría que inventar una precedencia, y el dueño se preguntaría "¿por
      // qué dice 3 si cargué 10?" en el peor momento. El rechazo dice cuál hay
      // que sacar, no "conflicto".
      if (
        e instanceof ErrorApi &&
        (e.estado === 409 || e.estado === 422) &&
        e.detalle.toLowerCase().includes('cupo')
      ) {
        alFallar(
          `${servicioNombre} tiene cupo del día cargado en Stock. Sacale el cupo y después ponele receta: manda uno de los dos, nunca los dos juntos.`,
        )
      } else {
        alFallar(e instanceof Error ? e.message : 'No se pudo guardar la receta.')
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="receta">
      <p className="receta__bajada">
        De qué está hecho un plato. Con esto el asistente sabe cuántos puede vender sin
        preguntarle a nadie, y deja de ofrecerlo cuando el ingrediente que falta se termina.
      </p>

      {items.length > 0 && (
        <ul className="receta__lista">
          {items.map((it) => (
            <li key={it.insumo_id} className="receta__fila">
              <span className="receta__nombre">{it.insumo_nombre}</span>
              <span className="receta__conunidad">
                <input
                  className="entrada tabular receta__entrada"
                  inputMode="numeric"
                  value={it.cantidad === 0 ? '' : String(it.cantidad)}
                  onChange={(e) => cambiar(it.insumo_id, soloEnteros(e.target.value))}
                  aria-label={`Cuánto lleva de ${it.insumo_nombre}`}
                />
                {/* La unidad del INSUMO, siempre pegada al número. */}
                <span className="receta__unidad">{sufijo(it.unidad)}</span>
              </span>
              {/* Cuánto hay hoy, al lado de cuánto pide: acá se ve de una que
                  40 g de cheddar contra 200 g en la heladera dan cinco
                  hamburguesas y no cincuenta. */}
              <span className="receta__hay">hay {cantidad(it.stock, it.unidad)}</span>
              <button
                type="button"
                className="boton boton--fantasma"
                onClick={() => sacar(it.insumo_id)}
                aria-label={`Sacar ${it.insumo_nombre} de la receta`}
              >
                Sacar
              </button>
            </li>
          ))}
        </ul>
      )}

      {disponibles.length > 0 && (
        <div className="receta__agregar">
          <label className="campo receta__campo-insumo">
            <span>Qué lleva</span>
            <select
              className="entrada"
              value={elegido}
              onChange={(e) => setElegido(e.target.value)}
            >
              <option value="">Elegí un insumo</option>
              {disponibles.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span>Cuánto, por porción</span>
            <span className="receta__conunidad">
              <input
                className="entrada tabular receta__entrada"
                inputMode="numeric"
                value={cuanto}
                onChange={(e) => setCuanto(soloEnteros(e.target.value))}
                placeholder="0"
                disabled={!insumoElegido}
              />
              <span className="receta__unidad">
                {insumoElegido ? sufijo(insumoElegido.unidad) : '—'}
              </span>
            </span>
          </label>

          <button
            type="button"
            className="boton"
            onClick={agregar}
            disabled={!insumoElegido || cuanto === '' || Number(cuanto) <= 0}
          >
            Agregar
          </button>
        </div>
      )}

      <p className="receta__pista">
        La cantidad va en la unidad del insumo y no se convierte: si la carne está cargada en
        gramos, acá se escribe en gramos. Es por porción — si la hamburguesa lleva dos medallones,
        poné 2.
      </p>

      <div className="receta__acciones">
        <button
          type="button"
          className="boton boton--primario"
          onClick={() => void guardar()}
          disabled={guardando || !sucia}
        >
          {guardando ? 'Guardando' : 'Guardar la receta'}
        </button>
        {items.length === 0 && (
          <span className="receta__pista">
            Sin líneas, este plato vuelve a ser ilimitado: vaciar la receta no lo apaga.
          </span>
        )}
        {/* Lo que la receta guardada da HOY. Se calcula del stock al vuelo, no
            se guarda en ningún lado: un número guardado se desincroniza del
            stock que lo originó, y un stock que miente con confianza es peor
            que no tener stock. Se esconde mientras hay cambios sin guardar,
            porque hasta entonces habla de la receta vieja. */}
        {!sucia && derivado?.tiene_receta && derivado.porciones !== null && (
          <span className="receta__pista">
            Con lo que hay ahora salen {porciones(derivado.porciones)} — lo primero que se acaba es{' '}
            {derivado.insumo_limitante}.
          </span>
        )}
      </div>
    </div>
  )
}
