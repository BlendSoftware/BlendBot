/**
 * D8: presets del config del negocio y campo libre SIEMPRE. Los presets eran
 * 15/25/40 y el local eligió 30; si el campo libre no está, el producto miente.
 *
 * Es un popover inline anclado a la tarjeta, no un modal: confirmar un pedido
 * no puede taparle la pantalla a quien está mirando el resto del día.
 */

import { useEffect, useRef, useState } from 'react'

interface Props {
  sugeridas: number[]
  alElegir: (minutos: number) => void
  alCerrar: () => void
}

export function SelectorDemora({ sugeridas, alElegir, alCerrar }: Props) {
  const [libre, setLibre] = useState('')
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function afuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) alCerrar()
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') alCerrar()
    }
    document.addEventListener('mousedown', afuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', afuera)
      document.removeEventListener('keydown', escape)
    }
  }, [alCerrar])

  const minutosLibres = Number(libre)
  const libreValido = libre.trim() !== '' && Number.isFinite(minutosLibres) && minutosLibres >= 0

  return (
    <div className="demora" ref={caja} role="group" aria-label="En cuánto sale">
      <p className="demora__titulo">¿En cuánto sale?</p>
      <div className="demora__presets">
        {sugeridas.map((m) => (
          <button key={m} type="button" className="boton demora__preset" onClick={() => alElegir(m)}>
            {m} min
          </button>
        ))}
      </div>
      <form
        className="demora__libre"
        onSubmit={(e) => {
          e.preventDefault()
          if (libreValido) alElegir(Math.round(minutosLibres))
        }}
      >
        <label className="solo-lectores" htmlFor="demora-libre">
          Otra cantidad de minutos
        </label>
        <input
          id="demora-libre"
          className="entrada demora__entrada tabular"
          inputMode="numeric"
          placeholder="otro"
          value={libre}
          onChange={(e) => setLibre(e.target.value.replace(/[^\d]/g, ''))}
        />
        <button type="submit" className="boton boton--primario" disabled={!libreValido}>
          Listo
        </button>
      </form>
    </div>
  )
}
