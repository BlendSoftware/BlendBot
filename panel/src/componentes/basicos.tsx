/** Piezas chicas que se repiten en todas las vistas. */

import { useEffect, useState } from 'react'

interface VacioProps {
  /** Una línea cálida, no un cartel genérico. */
  titulo: string
  detalle?: string
  accion?: { texto: string; alTocar: () => void }
}

export function Vacio({ titulo, detalle, accion }: VacioProps) {
  return (
    <div className="vacio">
      <span className="vacio__icono" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M7.5 12h9M12 7.5v9" strokeDasharray="1 4.2" />
        </svg>
      </span>
      <p className="vacio__titulo">{titulo}</p>
      {detalle && <p className="vacio__detalle">{detalle}</p>}
      {accion && (
        <button type="button" className="boton boton--primario" onClick={accion.alTocar}>
          {accion.texto}
        </button>
      )}
    </div>
  )
}

interface AvisoProps {
  texto: string
  tono?: 'problema' | 'bien'
  alCerrar?: () => void
}

export function Aviso({ texto, tono = 'problema', alCerrar }: AvisoProps) {
  if (!texto) return null
  return (
    <p className={`aviso ${tono === 'bien' ? 'aviso--bien' : ''}`} role="status">
      {texto}
      {alCerrar && (
        <button type="button" className="boton boton--fantasma aviso__cerrar" onClick={alCerrar}>
          Entendido
        </button>
      )}
    </p>
  )
}

export function Esqueleto({ alto = 72, cantidad = 3 }: { alto?: number; cantidad?: number }) {
  return (
    <div className="esqueletos" aria-hidden="true">
      {Array.from({ length: cantidad }, (_, i) => (
        <div key={i} className="esqueleto" style={{ height: alto }} />
      ))}
    </div>
  )
}

const AVISO_BIEN_MS = 2500

/**
 * Un "listo" que aparece solo y se borra solo: guardar/crear no puede quedar
 * en silencio, pero tampoco exige que alguien lo cierre a mano (a diferencia
 * de un error, que sí se queda hasta que lo leen).
 */
export function useAvisoBien(duracionMs = AVISO_BIEN_MS): [string, (texto: string) => void] {
  const [texto, setTexto] = useState('')

  useEffect(() => {
    if (!texto) return
    const id = window.setTimeout(() => setTexto(''), duracionMs)
    return () => window.clearTimeout(id)
  }, [texto, duracionMs])

  return [texto, setTexto]
}

const CONFIRMAR_TIMEOUT_MS = 4000

interface BotonConfirmarProps {
  /** Lo que se ve en reposo, ej. "Sacar" o "✕". */
  etiqueta: string
  /** Lo que se ve en el botón que dispara la acción, ej. "Sí, sacar". */
  etiquetaConfirmar: string
  onConfirmar: () => void
  className?: string
  ariaLabel?: string
}

/**
 * Botón que en el lugar (sin popover ni modal) pide un segundo toque antes de
 * disparar una acción que no tiene vuelta atrás. Se resetea solo si nadie lo
 * toca en unos segundos.
 */
export function BotonConfirmar({
  etiqueta,
  etiquetaConfirmar,
  onConfirmar,
  className,
  ariaLabel,
}: BotonConfirmarProps) {
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => {
    if (!confirmando) return
    const id = window.setTimeout(() => setConfirmando(false), CONFIRMAR_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [confirmando])

  if (!confirmando) {
    return (
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        onClick={() => setConfirmando(true)}
      >
        {etiqueta}
      </button>
    )
  }

  return (
    <span className="confirmar-inline">
      <button
        type="button"
        className="boton boton--peligro"
        onClick={() => {
          setConfirmando(false)
          onConfirmar()
        }}
      >
        {etiquetaConfirmar}
      </button>
      <button type="button" className="boton boton--fantasma" onClick={() => setConfirmando(false)}>
        No
      </button>
    </span>
  )
}
