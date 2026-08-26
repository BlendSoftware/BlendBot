/**
 * El cupo del día: cuántas porciones quedan de cada plato.
 *
 * No lleva ingredientes ni recetas a propósito — eso exige rendimientos
 * perfectos y se abandona en una semana. Lleva lo que el cocinero ya sabe de
 * memoria: "me quedan seis milanesas". Cuando llega a cero, el plato deja de
 * ofrecerse solo.
 *
 * El cupo es OPT-IN: un plato sin cupo cargado es ilimitado, que es como venía
 * andando todo hasta ahora. Sólo se limita lo que alguien decide limitar.
 *
 * Se refresca sola cada 15 s, igual que el tablero: dos mozos tocando la misma
 * pantalla no se pisan más de quince segundos.
 */

import { useCallback, useEffect, useState } from 'react'
import { listarServicios, listarStock, quitarCupo, setCupo } from '../api/endpoints'
import { ErrorApi } from '../api/cliente'
import type { CupoStock, Servicio } from '../api/tipos'
import { Aviso, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'

const REFRESCO_MS = 15000

/** Una fila de la pantalla: el plato, con o sin cupo cargado. */
interface Fila {
  servicioID: string
  nombre: string
  disponible: boolean
  cupo: CupoStock | null
}

export function Stock() {
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cupos, setCupos] = useState<CupoStock[]>([])
  const [sinCaja, setSinCaja] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const carta = await listarServicios({ incluirInactivos: false })
      setServicios(carta)
      try {
        setCupos(await listarStock())
        setSinCaja(false)
      } catch (e) {
        // 409 acá es "no hay jornada abierta", no un error de verdad: la carta
        // se muestra igual y la pantalla explica qué falta.
        if (e instanceof ErrorApi && e.estado === 409) {
          setCupos([])
          setSinCaja(true)
        } else {
          throw e
        }
      }
      setProblema('')
    } catch (e) {
      if (!silencioso) setProblema(e instanceof Error ? e.message : 'No se pudo traer el stock.')
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void cargar(true)
    }, REFRESCO_MS)
    return () => window.clearInterval(id)
  }, [cargar])

  const filas: Fila[] = servicios.map((s) => ({
    servicioID: s.id,
    nombre: s.nombre,
    disponible: s.disponible,
    cupo: cupos.find((c) => c.servicio_id === s.id) ?? null,
  }))
  const conCupo = filas.filter((f) => f.cupo)
  const agotados = conCupo.filter((f) => f.cupo!.agotado).length

  async function guardar(f: Fila, asignado: number) {
    try {
      const guardado = await setCupo(f.servicioID, Math.max(0, asignado))
      setCupos((l) => [...l.filter((c) => c.servicio_id !== f.servicioID), guardado])
      setProblema('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo guardar el cupo.')
    }
  }

  async function sacar(f: Fila) {
    try {
      await quitarCupo(f.servicioID)
      setCupos((l) => l.filter((c) => c.servicio_id !== f.servicioID))
      mostrarBien(`${f.nombre} vuelve a estar sin límite.`)
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo sacar el cupo.')
    }
  }

  return (
    <section className="stock">
      <header className="encabezado">
        <div>
          <h1>Stock del día</h1>
          <p className="encabezado__bajada">
            Cuántas porciones quedan de cada plato. Lo que llega a cero deja de ofrecerse en
            WhatsApp solo.
          </p>
        </div>
        {conCupo.length > 0 && (
          <span className="grupo__cuenta">
            {agotados > 0 ? `${agotados} agotado${agotados > 1 ? 's' : ''}` : 'nada agotado'}
          </span>
        )}
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      {sinCaja && (
        <Vacio
          titulo="La caja del día está cerrada."
          detalle="El cupo es del día: abrí la caja en Cierre y después cargá cuántas porciones hay de cada plato."
        />
      )}

      {cargando && <Esqueleto alto={64} cantidad={5} />}

      {!cargando && servicios.length === 0 && (
        <Vacio
          titulo="Todavía no hay platos en la carta."
          detalle="Cargá la carta primero y después ponele cupo a lo que se pueda acabar."
        />
      )}

      {!cargando && !sinCaja && servicios.length > 0 && (
        <ul className="stock__lista">
          {filas.map((f) => (
            <FilaStock
              key={f.servicioID}
              fila={f}
              alGuardar={(n) => guardar(f, n)}
              alSacar={() => sacar(f)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function FilaStock({
  fila,
  alGuardar,
  alSacar,
}: {
  fila: Fila
  alGuardar: (asignado: number) => void
  alSacar: () => void
}) {
  const c = fila.cupo
  const agotado = c?.agotado ?? false

  return (
    <li className={`stock__fila ${agotado ? 'stock__fila--agotado' : ''}`}>
      <div className="stock__datos">
        <span className="stock__nombre">{fila.nombre}</span>
        <span className="stock__estado">
          {!fila.disponible
            ? 'apagado a mano en la carta'
            : c
              ? `${c.restante} de ${c.asignado} · ${c.consumido} vendida${c.consumido === 1 ? '' : 's'}`
              : 'sin límite'}
        </span>
      </div>

      {c ? (
        <div className="stock__controles">
          {/* Uno menos / uno más sobre el ASIGNADO, no sobre lo vendido: es lo
              que el cocinero corrige cuando se le quemó una o apareció otra. */}
          <button
            type="button"
            className="boton stock__paso"
            onClick={() => alGuardar(c.asignado - 1)}
            disabled={c.asignado <= c.consumido}
            aria-label={`Bajar el cupo de ${fila.nombre}`}
          >
            −
          </button>
          <span className="stock__restante tabular" aria-live="polite">
            {c.restante}
          </span>
          <button
            type="button"
            className="boton stock__paso"
            onClick={() => alGuardar(c.asignado + 1)}
            aria-label={`Subir el cupo de ${fila.nombre}`}
          >
            +
          </button>
          <button type="button" className="boton boton--fantasma" onClick={alSacar}>
            Sin límite
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="boton boton--fantasma"
          onClick={() => alGuardar(cupoInicialSugerido)}
        >
          + Ponerle cupo
        </button>
      )}
    </li>
  )
}

/** Con cuánto arranca un plato al que recién le ponen cupo. Se ajusta con −/+. */
const cupoInicialSugerido = 10
