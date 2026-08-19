/** Piezas chicas que se repiten en todas las vistas. */

interface VacioProps {
  /** Una línea cálida, no un cartel genérico. */
  titulo: string
  detalle?: string
  accion?: { texto: string; alTocar: () => void }
}

export function Vacio({ titulo, detalle, accion }: VacioProps) {
  return (
    <div className="vacio">
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
