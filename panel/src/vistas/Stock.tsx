/**
 * Stock: cuánto queda, y de dónde sale ese número.
 *
 * Dos pestañas porque son dos cosas distintas, no dos vistas de lo mismo:
 *
 * · **Platos** es el cupo del día — "me quedan seis milanesas". Es una foto de
 *   la jornada: se carga a mano, se reinicia al abrir la caja y no sabe de
 *   ingredientes. Sigue siendo OPT-IN: un plato sin cupo es ilimitado.
 *
 * · **Insumos** es la materia prima — un SALDO CORRIENTE del negocio. No se
 *   reinicia nunca (la carne que sobra hoy sigue estando mañana) y no depende
 *   de la jornada: con la caja cerrada se lee y se corrige igual.
 *
 * Un plato tiene cupo a mano o receta, nunca los dos: si tuviera los dos habría
 * que inventar una regla de precedencia, y toda regla de precedencia es una
 * pregunta que el dueño se hace en el peor momento. Por eso a un plato que se
 * controla por receta esta pantalla no le ofrece ponerle cupo.
 *
 * Se refresca sola cada 15 s, igual que el tablero: dos mozos tocando la misma
 * pantalla no se pisan más de quince segundos.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listarInsumos,
  listarServicios,
  listarStock,
  quitarCupo,
  setCupo,
  traerReceta,
} from '../api/endpoints'
import { ErrorApi } from '../api/cliente'
import type { CupoStock, Insumo, LineaReceta, Servicio } from '../api/tipos'
import { Aviso, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'
import { Insumos } from './Insumos'
import {
  fraseCompartidoDesdeElPlato,
  fraseLimitante,
  porciones,
  usosPorInsumo,
} from '../dominio/insumos'
import type { UsoDeInsumo } from '../dominio/insumos'

const REFRESCO_MS = 15000

type Pestana = 'platos' | 'insumos'

/** Una fila de la pestaña Platos: el plato, con o sin cupo cargado. */
interface Fila {
  servicioID: string
  nombre: string
  disponible: boolean
  cupo: CupoStock | null
  /** El plato entero, por su `limitante`: que venga o no es lo que distingue
   *  "no lleva cuenta" de "la cuenta la lleva la materia prima". */
  servicio: Servicio
}

/**
 * El id del insumo que limita a este plato, para poder preguntar en qué OTROS
 * platos va.
 *
 * Sale de la receta del propio plato y no de un mapa global por nombre: el
 * limitante viaja con el nombre para leerse, y dos insumos homónimos harían que
 * un mapa global señalara al equivocado. Adentro de una sola receta el nombre no
 * se repite —un insumo aparece una vez por receta— así que acá sí identifica.
 */
function idDelLimitante(fila: Fila, recetas: Map<string, LineaReceta[]>): string | undefined {
  const nombre = fila.servicio.limitante?.insumo
  if (!nombre) return undefined
  return recetas.get(fila.servicioID)?.find((l) => l.insumo_nombre === nombre)?.insumo_id
}

export function Stock() {
  const [pestana, setPestana] = useState<Pestana>('platos')
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cupos, setCupos] = useState<CupoStock[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [recetas, setRecetas] = useState<Map<string, LineaReceta[]>>(new Map())
  const [sinCaja, setSinCaja] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

  const recargarInsumos = useCallback(async () => {
    setInsumos(await listarInsumos())
  }, [])

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
        // se muestra igual y la pantalla explica qué falta. Los insumos NO
        // pasan por acá: no dependen de la jornada.
        if (e instanceof ErrorApi && e.estado === 409) {
          setCupos([])
          setSinCaja(true)
        } else {
          throw e
        }
      }
      setInsumos(await listarInsumos())

      // Las recetas se piden SÓLO de los platos que se controlan por receta
      // (los que traen limitante), y sólo en la carga completa. Es la única
      // forma de saber qué platos comparten un insumo: el catálogo devuelve el
      // limitante de cada plato, pero no la vuelta —qué platos dependen de la
      // carne— y sin esa vuelta no se puede mostrar la dependencia.
      const conReceta = carta.filter((s) => s.limitante)
      if (conReceta.length > 0 && !silencioso) {
        const listas = await Promise.all(conReceta.map((s) => traerReceta(s.id)))
        setRecetas(new Map(conReceta.map((s, i) => [s.id, listas[i]?.items ?? []])))
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

  const usos = useMemo(() => usosPorInsumo(servicios, recetas), [servicios, recetas])

  const filas: Fila[] = servicios.map((s) => ({
    servicioID: s.id,
    nombre: s.nombre,
    disponible: s.disponible,
    cupo: cupos.find((c) => c.servicio_id === s.id) ?? null,
    servicio: s,
  }))
  const conCuenta = filas.filter((f) => f.cupo || f.servicio.limitante)
  const agotados = conCuenta.filter((f) => f.servicio.limitante ? f.servicio.agotado : f.cupo!.agotado).length
  const paraReponer = insumos.filter((i) => i.bajo_minimo).length

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
          <h1>Stock</h1>
          <p className="encabezado__bajada">
            {pestana === 'platos'
              ? 'Cuántas porciones quedan de cada plato. Lo que llega a cero deja de ofrecerse en WhatsApp solo.'
              : 'La materia prima que hay en el local. Los platos que llevan receta se apagan solos cuando esto no alcanza.'}
          </p>
        </div>
        {pestana === 'platos' && conCuenta.length > 0 && (
          <span className="grupo__cuenta">
            {agotados > 0 ? `${agotados} agotado${agotados > 1 ? 's' : ''}` : 'nada agotado'}
          </span>
        )}
      </header>

      <div className="stock__pestanas" role="tablist" aria-label="Qué stock mirar">
        <button
          type="button"
          role="tab"
          aria-selected={pestana === 'platos'}
          className={`stock__pestana ${pestana === 'platos' ? 'stock__pestana--activa' : ''}`}
          onClick={() => setPestana('platos')}
        >
          Platos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pestana === 'insumos'}
          className={`stock__pestana ${pestana === 'insumos' ? 'stock__pestana--activa' : ''}`}
          onClick={() => setPestana('insumos')}
        >
          Insumos
          {paraReponer > 0 && (
            <span className="stock__pestana-marca">{paraReponer} para reponer</span>
          )}
        </button>
      </div>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      {pestana === 'insumos' ? (
        <Insumos
          insumos={insumos}
          usos={usos}
          cargando={cargando}
          alRecargar={recargarInsumos}
          alFallar={setProblema}
          alBien={mostrarBien}
        />
      ) : (
        <>
          {/* La caja cerrada apaga el cupo del día, no los insumos: por eso el
              cartel vive acá adentro y la otra pestaña sigue andando. */}
          {sinCaja && (
            <Vacio
              titulo="La caja del día está cerrada."
              detalle="El cupo es del día: abrí la caja en Cierre y después cargá cuántas porciones hay de cada plato. Los insumos no dependen de la caja — esos los podés tocar igual."
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
                  usosDelLimitante={usos.get(idDelLimitante(f, recetas) ?? '') ?? []}
                  alGuardar={(n) => guardar(f, n)}
                  alSacar={() => sacar(f)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function FilaStock({
  fila,
  usosDelLimitante,
  alGuardar,
  alSacar,
}: {
  fila: Fila
  /** En qué platos va el insumo que le fijó las porciones a éste. */
  usosDelLimitante: UsoDeInsumo[]
  alGuardar: (asignado: number) => void
  alSacar: () => void
}) {
  const c = fila.cupo
  const limitante = fila.servicio.limitante
  const agotado = limitante ? fila.servicio.agotado : (c?.agotado ?? false)

  // La dependencia entre platos que comparten materia prima: vender un bife le
  // baja las porciones a las empanadas, y si el número se mueve solo sin
  // explicación parece roto.
  const otros = usosDelLimitante
    .filter((u) => u.servicio_id !== fila.servicioID)
    .map((u) => u.servicio_nombre)
  const compartido = limitante ? fraseCompartidoDesdeElPlato(limitante.insumo, otros) : null

  return (
    <li className={`stock__fila ${agotado ? 'stock__fila--agotado' : ''}`}>
      <div className="stock__datos">
        <span className="stock__nombre">{fila.nombre}</span>
        <span className="stock__estado">
          {!fila.disponible
            ? 'apagado a mano en la carta'
            : limitante
              ? // Nombrar al insumo que apagó el plato NO es un adorno: un plato
                // que se apaga solo y no dice por qué es indistinguible de un
                // bug, y el dueño lo arregla apagando la feature entera.
                `${porciones(fila.servicio.restante ?? 0)} — ${fraseLimitante(
                  fila.servicio.restante,
                  limitante,
                )}`
              : c
                ? `${c.restante} de ${c.asignado} · ${c.consumido} vendida${c.consumido === 1 ? '' : 's'}`
                : 'sin límite'}
        </span>
        {compartido && <span className="stock__compartido">{compartido}</span>}
      </div>

      {limitante ? (
        // Un plato con receta no acepta cupo a mano: no se le ofrece el botón,
        // porque el core lo rechazaría y el dueño se quedaría con un error en
        // vez de con una explicación.
        <span className="stock__porreceta">Se controla por receta · se edita en Carta</span>
      ) : c ? (
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
