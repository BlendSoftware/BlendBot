/**
 * Una FILA, no una card (DESIGN.md): el catálogo es una lista larga que se
 * recorre con el pulgar. Nombre y precio se editan en el lugar; el interruptor
 * vive al final, donde cae la mano.
 */

import { useEffect, useState } from 'react'
import type { Servicio } from '../api/tipos'
import { plata } from '../dominio/formato'
import { Switch } from './Switch'

interface Props {
  servicio: Servicio
  alCambiarDisponible: (valor: boolean) => Promise<void>
  alGuardar: (cambios: { nombre?: string; precio_base?: string }) => Promise<void>
  alFallar: (mensaje: string) => void
  expandida: boolean
  alExpandir: () => void
  children?: React.ReactNode
}

export function FilaServicio({
  servicio,
  alCambiarDisponible,
  alGuardar,
  alFallar,
  expandida,
  alExpandir,
  children,
}: Props) {
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState(servicio.nombre)
  const [precio, setPrecio] = useState(servicio.precio_base)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setNombre(servicio.nombre)
    setPrecio(servicio.precio_base)
  }, [servicio.nombre, servicio.precio_base])

  async function guardar() {
    setGuardando(true)
    try {
      await alGuardar({ nombre: nombre.trim(), precio_base: precio })
      setEditando(false)
    } catch (e) {
      alFallar(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <li className={`servicio ${servicio.disponible ? '' : 'servicio--apagado'}`}>
      <div className="servicio__linea">
        {editando ? (
          <form
            className="servicio__edicion"
            onSubmit={(e) => {
              e.preventDefault()
              void guardar()
            }}
          >
            <input
              className="entrada"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              aria-label="Nombre del servicio"
            />
            <input
              className="entrada tabular servicio__precio-entrada"
              value={precio}
              inputMode="decimal"
              onChange={(e) => setPrecio(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))}
              aria-label="Precio"
            />
            <button type="submit" className="boton boton--primario" disabled={guardando}>
              {guardando ? 'Guardando' : 'Guardar'}
            </button>
            <button
              type="button"
              className="boton boton--fantasma"
              onClick={() => {
                setNombre(servicio.nombre)
                setPrecio(servicio.precio_base)
                setEditando(false)
              }}
            >
              Dejarlo así
            </button>
          </form>
        ) : (
          <>
            <button type="button" className="servicio__nombre" onClick={() => setEditando(true)}>
              {servicio.nombre}
              {servicio.duracion_min ? (
                <span className="servicio__duracion">{servicio.duracion_min} min</span>
              ) : null}
            </button>
            <span className="servicio__precio plata">{plata(servicio.precio_base)}</span>
          </>
        )}

        {!editando && (
          <button
            type="button"
            className="boton boton--fantasma servicio__coberturas"
            onClick={alExpandir}
            aria-expanded={expandida}
          >
            {expandida ? 'Cerrar precios' : 'Precios por club'}
          </button>
        )}

        <Switch
          activo={servicio.disponible}
          etiquetaSi="disponible"
          etiquetaNo="se acabó"
          describe={servicio.nombre}
          alCambiar={alCambiarDisponible}
          alFallar={alFallar}
        />
      </div>

      {expandida && <div className="servicio__precios">{children}</div>}
    </li>
  )
}
