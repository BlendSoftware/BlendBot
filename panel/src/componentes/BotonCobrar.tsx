/**
 * Cobrar es un toque y un medio de pago. El popover es inline y anclado a la
 * tarjeta, nunca un modal (DESIGN.md): cobrar un turno no puede taparle el
 * resto del día a quien está mirando la agenda.
 *
 * Después del cobro la factura sale sola (el worker facturador habla con ARCA),
 * así que acá no hay ningún botón de "facturar": hay un estado que se cuenta y
 * que se vuelve a preguntar solo mientras diga "Facturando…".
 */

import { useEffect, useRef, useState } from 'react'
import { cobrar, traerCobro } from '../api/endpoints'
import type { Cobro, MedioPago } from '../api/tipos'
import { MEDIOS_PAGO, estadoFactura, etiquetaMedio } from '../dominio/cobros'
import { plata } from '../dominio/formato'

interface Props {
  compromisoID: string
  total: string
  /**
   * Lo que ya se sabe de este cobro: null es "no está cobrado" y undefined es
   * "no sé", que hace una consulta al montar. La agenda no trae el cobro en su
   * payload, así que sin esta consulta un turno ya cobrado volvería a mostrar
   * el botón después de un F5.
   */
  cobroInicial?: Cobro | null
  /** Cada cuánto se vuelve a preguntar por la factura. Inyectable para tests. */
  refrescoMs?: number
}

const REFRESCO_MS = 5000
/** Tope del reintento: dos minutos. Si a esa altura no salió, salió mal. */
const REINTENTOS_MAX = 24

export function BotonCobrar({ compromisoID, total, cobroInicial, refrescoMs = REFRESCO_MS }: Props) {
  const [cobro, setCobro] = useState<Cobro | null>(cobroInicial ?? null)
  const [abierto, setAbierto] = useState(false)
  const [enVuelo, setEnVuelo] = useState<MedioPago | null>(null)
  const [problema, setProblema] = useState('')
  const caja = useRef<HTMLDivElement>(null)

  // "No sé si está cobrado" se pregunta una vez. Un 404 acá es la respuesta
  // normal (todavía no se cobró) y no tiene por qué mostrarle nada a nadie.
  useEffect(() => {
    if (cobroInicial !== undefined) return
    let vivo = true
    traerCobro(compromisoID)
      .then((c) => {
        if (vivo) setCobro(c)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [compromisoID, cobroInicial])

  useEffect(() => {
    if (!abierto) return
    function afuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', afuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', afuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const factura = cobro ? estadoFactura(cobro) : null

  // Mientras la factura esté en camino se vuelve a preguntar. El core no
  // empuja nada: el comprobante lo sella un worker de fondo.
  useEffect(() => {
    if (!factura?.esperando) return
    let vivo = true
    let vueltas = 0
    const id = window.setInterval(() => {
      if (vueltas >= REINTENTOS_MAX) {
        window.clearInterval(id)
        return
      }
      vueltas += 1
      traerCobro(compromisoID)
        .then((c) => {
          if (vivo) setCobro(c)
        })
        .catch(() => {
          /* Un tropiezo de red no cambia lo que se ve: se reintenta solo. */
        })
    }, refrescoMs)
    return () => {
      vivo = false
      window.clearInterval(id)
    }
  }, [factura?.esperando, compromisoID, refrescoMs])

  async function cobrarCon(medio: MedioPago) {
    setProblema('')
    setEnVuelo(medio)
    try {
      const hecho = await cobrar(compromisoID, medio)
      setCobro(hecho)
      setAbierto(false)
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo cobrar.')
    } finally {
      setEnVuelo(null)
    }
  }

  if (cobro && factura) {
    return (
      <div className={`cobro cobro--${factura.tono}`}>
        <p className="cobro__hecho">
          Cobrado <span className="plata">{plata(cobro.monto)}</span> · {etiquetaMedio(cobro.medio_pago)}
        </p>
        <p className="cobro__factura">{factura.texto}</p>
        {factura.detalle && <p className="cobro__detalle">{factura.detalle}</p>}
      </div>
    )
  }

  return (
    <div className="cobro-alta" ref={caja}>
      {problema && <p className="cobro__problema">{problema}</p>}

      <button
        type="button"
        className="boton turno__accion turno__accion--primario"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        Cobrar
      </button>

      {abierto && (
        <div className="medios" role="group" aria-label="Con qué pagó">
          <p className="medios__titulo">Cobrar {plata(total)}</p>
          <div className="medios__lista">
            {MEDIOS_PAGO.map((m) => (
              <button
                key={m.medio}
                type="button"
                className="boton medios__opcion"
                disabled={enVuelo !== null}
                onClick={() => void cobrarCon(m.medio)}
              >
                {enVuelo === m.medio ? 'Cobrando' : m.etiqueta}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
