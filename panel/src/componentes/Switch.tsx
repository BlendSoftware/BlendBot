/**
 * El interruptor. Es la feature más importante del producto (PRODUCT.md 6):
 * grande, con el estado escrito al lado, y optimista. Cambia en el acto y si
 * el servidor lo rechaza vuelve solo y avisa.
 */

import { useEffect, useState } from 'react'

interface Props {
  activo: boolean
  etiquetaSi: string
  etiquetaNo: string
  /** Nombre de lo que se prende o apaga, para el lector de pantalla. */
  describe: string
  alCambiar: (valor: boolean) => Promise<void>
  alFallar?: (mensaje: string) => void
  deshabilitado?: boolean
}

export function Switch({
  activo,
  etiquetaSi,
  etiquetaNo,
  describe,
  alCambiar,
  alFallar,
  deshabilitado = false,
}: Props) {
  const [optimista, setOptimista] = useState(activo)
  const [enVuelo, setEnVuelo] = useState(false)

  useEffect(() => {
    setOptimista(activo)
  }, [activo])

  async function tocar() {
    if (deshabilitado || enVuelo) return
    const nuevo = !optimista
    setOptimista(nuevo)
    setEnVuelo(true)
    try {
      await alCambiar(nuevo)
    } catch (e) {
      setOptimista(!nuevo)
      alFallar?.(e instanceof Error ? e.message : 'No se pudo guardar el cambio.')
    } finally {
      setEnVuelo(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimista}
      aria-label={`${describe}: ${optimista ? etiquetaSi : etiquetaNo}`}
      className={`interruptor ${optimista ? 'interruptor--si' : 'interruptor--no'}`}
      onClick={tocar}
      disabled={deshabilitado}
    >
      <span className="interruptor__pista">
        <span className="interruptor__perilla" />
      </span>
      <span className="interruptor__texto">{optimista ? etiquetaSi : etiquetaNo}</span>
    </button>
  )
}
