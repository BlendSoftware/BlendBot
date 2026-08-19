/**
 * El bloque del turno en la agenda: hora grande, nombre, plata, y el fondo
 * pintado del color del estado. Las acciones son las transiciones válidas del
 * core y nada más (dominio/estados.ts es el espejo de model/estado.go).
 */

import { useEffect, useState } from 'react'
import type { Estado, TipoCompromiso } from '../api/tipos'
import { COLOR_ESTADO, TINTA_ESTADO, accionesPara, etiquetaEstado } from '../dominio/estados'
import { horaDe, nombreVisible, plata } from '../dominio/formato'
import { SelectorDemora } from './SelectorDemora'

export interface DatosCompromiso {
  id: string
  tipo: TipoCompromiso
  estado: Estado
  inicio: string | null
  fin: string | null
  clienteNombre: string | null
  clienteTelefono: string
  total: string
  nota: string | null
  demoraMin?: number | null
  confirmadoEn?: string | null
}

interface Props {
  datos: DatosCompromiso
  /** Presets de negocio.config.demoras_sugeridas. */
  demorasSugeridas: number[]
  alTransicionar: (estado: Estado, extra?: { demora_min?: number }) => Promise<void>
  /** Densidad: dentro de la grilla el bloque puede ser corto. */
  compacta?: boolean
  /** Reloj inyectable: los tests no dependen de la hora de la máquina. */
  ahora?: Date
}

function minutosHasta(rfc3339: string, ahora: Date): number {
  const t = Date.parse(rfc3339)
  if (Number.isNaN(t)) return 0
  return Math.round((t - ahora.getTime()) / 60000)
}

/** El contador va contra la hora prometida y se pone rojo cuando se pasa. */
function textoContador(datos: DatosCompromiso, ahora: Date): { texto: string; vencido: boolean } | null {
  if (datos.estado !== 'pendiente' && datos.estado !== 'confirmado' && datos.estado !== 'en_curso') {
    return null
  }

  if (datos.tipo === 'turno') {
    if (!datos.inicio) return null
    const m = minutosHasta(datos.inicio, ahora)
    // Fuera de la ventana cercana el contador no dice nada útil y ensucia.
    if (m > 90 || m < -120) return null
    if (m >= 0) return { texto: `en ${m} min`, vencido: false }
    return { texto: `hace ${Math.abs(m)} min`, vencido: true }
  }

  if (datos.confirmadoEn && datos.demoraMin != null) {
    const limite = new Date(Date.parse(datos.confirmadoEn) + datos.demoraMin * 60000)
    const m = Math.round((limite.getTime() - ahora.getTime()) / 60000)
    return m >= 0 ? { texto: `${m} min`, vencido: false } : { texto: `+${Math.abs(m)} min`, vencido: true }
  }

  return null
}

export function TarjetaCompromiso({
  datos,
  demorasSugeridas,
  alTransicionar,
  compacta = false,
  ahora,
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

  const acciones = accionesPara(datos.estado, datos.tipo)
  const contador = textoContador(datos, reloj)
  const pulsa = datos.estado === 'pendiente' && !tocada

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
      className={`turno ${pulsa ? 'turno--late' : ''} ${compacta ? 'turno--compacta' : ''}`}
      style={{
        // El estado se lee de lejos: el color va en el fondo del bloque entero.
        background: COLOR_ESTADO[datos.estado],
        color: TINTA_ESTADO[datos.estado],
      }}
      onPointerDown={() => setTocada(true)}
      aria-label={`${nombreVisible(datos.clienteNombre, datos.clienteTelefono)}, ${etiquetaEstado(
        datos.estado,
        datos.tipo,
      )}`}
    >
      <header className="turno__cabeza">
        {datos.inicio && <span className="turno__hora hora">{horaDe(datos.inicio)}</span>}
        <span className="turno__estado">{etiquetaEstado(datos.estado, datos.tipo)}</span>
      </header>

      <p className="turno__nombre">{nombreVisible(datos.clienteNombre, datos.clienteTelefono)}</p>

      <p className="turno__pie">
        <span className="plata">{plata(datos.total)}</span>
        {contador && (
          <span className={`turno__contador tabular ${contador.vencido ? 'turno__contador--vencido' : ''}`}>
            {contador.texto}
          </span>
        )}
      </p>

      {datos.nota && <p className="turno__nota">{datos.nota}</p>}

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
