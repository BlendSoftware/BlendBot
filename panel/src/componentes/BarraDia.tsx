/**
 * La barra mínima de arriba: qué negocio, qué día, y salir. Nada más: la
 * pantalla operativa es el tablero, no el chrome.
 */

import { salir } from '../api/endpoints'
import { esHoy, fechaCorta, fechaLarga, hoyISO, sumarDias } from '../dominio/formato'

interface Props {
  fecha: string
  alCambiarFecha: (iso: string) => void
  negocio: string
  resumen?: string
}

export function BarraDia({ fecha, alCambiarFecha, negocio, resumen }: Props) {
  return (
    <header className="barra-dia">
      <div className="barra-dia__dia">
        <button
          type="button"
          className="boton barra-dia__flecha"
          aria-label="Día anterior"
          onClick={() => alCambiarFecha(sumarDias(fecha, -1))}
        >
          ‹
        </button>

        <div className="barra-dia__fecha">
          <h1 className="barra-dia__titulo">{esHoy(fecha) ? 'Hoy' : fechaCorta(fecha)}</h1>
          <p className="barra-dia__larga">{fechaLarga(fecha)}</p>
        </div>

        <button
          type="button"
          className="boton barra-dia__flecha"
          aria-label="Día siguiente"
          onClick={() => alCambiarFecha(sumarDias(fecha, 1))}
        >
          ›
        </button>

        {!esHoy(fecha) && (
          <button type="button" className="boton" onClick={() => alCambiarFecha(hoyISO())}>
            Volver a hoy
          </button>
        )}
      </div>

      <div className="barra-dia__derecha">
        {resumen && <p className="barra-dia__resumen">{resumen}</p>}
        <p className="barra-dia__negocio">{negocio}</p>
        <button
          type="button"
          className="boton boton--fantasma"
          onClick={() => {
            void salir()
          }}
        >
          Salir
        </button>
      </div>
    </header>
  )
}
