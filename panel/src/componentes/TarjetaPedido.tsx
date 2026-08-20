/**
 * La tarjeta del pedido en el tablero de cocina. Prima hermana de
 * TarjetaCompromiso: comparte la máquina de estados (dominio/estados.ts), el
 * color de fondo por estado y el selector de demora. Pero un pedido se
 * identifica por su número y sus ítems, no por el nombre del cliente, así que
 * la cabeza y el cuerpo son propios.
 */

import { useEffect, useState } from 'react'
import type { Estado, TipoEntrega } from '../api/tipos'
import { COLOR_ESTADO, TINTA_ESTADO, accionesPara, etiquetaEstado } from '../dominio/estados'
import { plata } from '../dominio/formato'
import { contadorDemora, type PedidoVista } from '../dominio/pedidos'
import { SelectorDemora } from './SelectorDemora'

interface Props {
  pedido: PedidoVista
  /** Presets de negocio.config.demoras_sugeridas. */
  demorasSugeridas: number[]
  alTransicionar: (estado: Estado, extra?: { demora_min?: number }) => Promise<void>
  /** Reloj inyectable: los tests no dependen de la hora de la máquina. */
  ahora?: Date
  /** El operador no ve la plata del día; en la cocina tampoco hace falta. */
  mostrarTotal?: boolean
  /** La comanda de cocina no muestra plata ni total, sólo qué cocinar. */
  soloCocina?: boolean
}

const ENTREGA: Record<TipoEntrega, { icono: string; texto: string }> = {
  delivery: { icono: '🛵', texto: 'Delivery' },
  retira: { icono: '🏃', texto: 'Retira' },
  en_local: { icono: '🍽️', texto: 'En el local' },
}

export function TarjetaPedido({
  pedido,
  demorasSugeridas,
  alTransicionar,
  ahora,
  mostrarTotal = true,
  soloCocina = false,
}: Props) {
  const [pidiendoDemora, setPidiendoDemora] = useState(false)
  const [enVuelo, setEnVuelo] = useState<Estado | null>(null)
  const [problema, setProblema] = useState('')
  const [tocada, setTocada] = useState(false)
  const [reloj, setReloj] = useState(() => ahora ?? new Date())

  useEffect(() => {
    if (ahora) {
      setReloj(ahora)
      return
    }
    const id = window.setInterval(() => setReloj(new Date()), 30000)
    return () => window.clearInterval(id)
  }, [ahora])

  const acciones = accionesPara(pedido.estado, 'pedido')
  const contador = contadorDemora(pedido, reloj)
  const pulsa = pedido.estado === 'pendiente' && !tocada
  const entrega = pedido.entrega ? ENTREGA[pedido.entrega] : null

  async function correr(estado: Estado, extra?: { demora_min?: number }) {
    setProblema('')
    setEnVuelo(estado)
    try {
      await alTransicionar(estado, extra)
      setPidiendoDemora(false)
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setEnVuelo(null)
    }
  }

  return (
    <article
      className={`turno pedido ${pulsa ? 'turno--late' : ''}`}
      style={{ background: COLOR_ESTADO[pedido.estado], color: TINTA_ESTADO[pedido.estado] }}
      onPointerDown={() => setTocada(true)}
      aria-label={`Pedido ${pedido.numero}, ${etiquetaEstado(pedido.estado, 'pedido')}`}
    >
      <header className="turno__cabeza pedido__cabeza">
        <span className="pedido__numero tabular">{pedido.numero}</span>
        {entrega && (
          <span className="pedido__entrega" title={entrega.texto}>
            <span aria-hidden="true">{entrega.icono}</span>
            <span className="pedido__entrega-texto">{entrega.texto}</span>
          </span>
        )}
      </header>

      <ul className="pedido__items">
        {pedido.items.map((it, i) => (
          <li key={i} className="pedido__item">
            <span className="pedido__cant tabular">{it.cantidad}×</span>
            <span className="pedido__nombre">{it.nombre}</span>
            {it.nota && <span className="pedido__mod">{it.nota}</span>}
          </li>
        ))}
      </ul>

      {pedido.entrega === 'delivery' && pedido.direccion && (
        <p className="pedido__dir">{pedido.direccion}</p>
      )}

      {pedido.nota && <p className="turno__nota">{pedido.nota}</p>}

      {(!soloCocina || contador) && (
        <p className="turno__pie">
          {!soloCocina && mostrarTotal && <span className="plata">{plata(pedido.total)}</span>}
          {contador && (
            <span
              className={`turno__contador tabular ${contador.vencido ? 'turno__contador--vencido' : ''}`}
            >
              {contador.texto}
            </span>
          )}
        </p>
      )}

      {problema && <p className="turno__problema">{problema}</p>}

      {acciones.length > 0 && (
        <div className="turno__acciones">
          {acciones.map((a) => (
            <button
              key={a.estado}
              type="button"
              className={`boton turno__accion turno__accion--${a.tono}`}
              disabled={enVuelo !== null}
              onClick={() => {
                if (a.pideDemora) {
                  setPidiendoDemora(true)
                  return
                }
                void correr(a.estado)
              }}
            >
              {enVuelo === a.estado ? 'Guardando' : a.etiqueta}
            </button>
          ))}
        </div>
      )}

      {pidiendoDemora && (
        <SelectorDemora
          sugeridas={demorasSugeridas}
          alElegir={(min) => void correr('confirmado', { demora_min: min })}
          alCerrar={() => setPidiendoDemora(false)}
        />
      )}
    </article>
  )
}
