/**
 * La tarjeta del pedido en el tablero de cocina. Prima hermana de
 * TarjetaCompromiso: comparte la máquina de estados (dominio/estados.ts), el
 * color de fondo por estado y el selector de demora. Muestra el nombre del
 * cliente arriba —el dueño quiere ver de quién es cada pedido— y abajo su
 * número y sus ítems; la cabeza y el cuerpo son propios.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Estado, TipoEntrega } from '../api/tipos'
import { COLOR_ESTADO, TINTA_ESTADO, accionesPara, etiquetaEstado } from '../dominio/estados'
import { nombreVisible, plata } from '../dominio/formato'
import { contadorDemora, type PedidoVista } from '../dominio/pedidos'
import { BotonCobrar } from './BotonCobrar'
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

/* Mismo lenguaje de ícono que la barra inferior: trazo, no emoji — así el
   badge de entrega no desentona con el resto del panel. */
const trazoEntrega = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function IconoDelivery() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" {...trazoEntrega}>
      <path d="M14 17V7a2 2 0 0 0-2-2H4a1 1 0 0 0-1 1v10.5a.5.5 0 0 0 .5.5H5" />
      <path d="M14 17h5.5a.5.5 0 0 0 .5-.5v-3.1a1 1 0 0 0-.22-.62L17 9h-3" />
      <circle cx="7.5" cy="17" r="2" />
      <circle cx="16.5" cy="17" r="2" />
    </svg>
  )
}

function IconoRetira() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" {...trazoEntrega}>
      <path d="M6 3.5 4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7l-2-3.5Z" />
      <path d="M4 7h16" />
      <path d="M15 10.5a3 3 0 0 1-6 0" />
    </svg>
  )
}

function IconoEnLocal() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" {...trazoEntrega}>
      <path d="M3 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2" />
      <path d="M6 2v20" />
      <path d="M18 2a4 4 0 0 0-4 4v5a2 2 0 0 0 2 2h2Zm0 0v18" />
    </svg>
  )
}

const ENTREGA: Record<TipoEntrega, { icono: ReactNode; texto: string }> = {
  delivery: { icono: <IconoDelivery />, texto: 'Delivery' },
  retira: { icono: <IconoRetira />, texto: 'Retira' },
  en_local: { icono: <IconoEnLocal />, texto: 'En el local' },
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
      style={
        {
          '--turno-color': COLOR_ESTADO[pedido.estado],
          '--turno-tinta': TINTA_ESTADO[pedido.estado],
        } as React.CSSProperties
      }
      onPointerDown={() => setTocada(true)}
      aria-label={`Pedido ${pedido.numero} de ${nombreVisible(pedido.clienteNombre, pedido.clienteTelefono)}, ${etiquetaEstado(pedido.estado, 'pedido')}`}
    >
      <header className="turno__cabeza pedido__cabeza">
        <span className="pedido__numero tabular">{pedido.numero}</span>
        <span className="pedido__cliente">
          {nombreVisible(pedido.clienteNombre, pedido.clienteTelefono)}
        </span>
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
            <span className="pedido__cant tabular" aria-hidden="true">
              {it.cantidad}
            </span>
            <span className="solo-lectores">{it.cantidad} ×</span>
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

      {/* Entregado no es el final: falta cobrarlo. Y una vez cobrado, es desde
          acá que se llega al comprobante. En la comanda de cocina no va: ahí
          no se toca plata. */}
      {!soloCocina && pedido.estado === 'completado' && (
        <BotonCobrar compromisoID={pedido.id} total={pedido.total} />
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
