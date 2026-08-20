/**
 * LA pantalla. Columnas por profesional, franjas del día, cada turno pintado
 * del color de su estado y los huecos libres a la vista, porque un hueco es
 * plata que se está por perder (PRODUCT.md 8).
 *
 * Se refresca sola cada 15 segundos: nadie tiene que acordarse de apretar nada.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listarListaEspera, traerAgenda, transicionar } from '../api/endpoints'
import type { Agenda as AgendaDTO, Estado, TurnoAgenda } from '../api/tipos'
import { TarjetaCompromiso } from '../componentes/TarjetaCompromiso'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'
import { BarraDia } from '../componentes/BarraDia'
import { useSesion } from '../contexto'
import { duracionCorta, hhmmDeMinutos, hoyISO } from '../dominio/formato'
import { construirRejilla } from '../dominio/rejilla'

const REFRESCO_MS = 15000

/**
 * Canal de horas + una columna por profesional, igual arriba y abajo. Ancho
 * tope fijo, no 1fr: con poca gente en el equipo las columnas no tienen por
 * qué estirarse a ocupar toda la pantalla ancha.
 */
function columnas(cantidad: number): string {
  return `76px repeat(${cantidad}, minmax(230px, 360px))`
}

/** El cobro ya viene en la agenda: la tarjeta no tiene que ir a preguntarlo. */
function cobroDe(t: TurnoAgenda) {
  return { cobrado: t.cobrado, comprobante_estado: t.comprobante_estado }
}

function datosDe(t: TurnoAgenda) {
  return {
    id: t.compromiso_id,
    tipo: t.tipo,
    estado: t.estado,
    inicio: t.inicio,
    fin: t.fin,
    clienteNombre: t.cliente_nombre,
    clienteTelefono: t.cliente_telefono,
    total: t.total,
    nota: t.nota,
  }
}

export function Agenda() {
  const { negocio, demorasSugeridas, vePlata } = useSesion()
  const ir = useNavigate()
  const [fecha, setFecha] = useState(hoyISO())
  const [agenda, setAgenda] = useState<AgendaDTO | null>(null)
  const [esperando, setEsperando] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const cargar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setCargando(true)
      try {
        const datos = await traerAgenda(fecha)
        if (!montado.current) return
        setAgenda(datos)
        setProblema('')
      } catch (e) {
        if (!montado.current) return
        if (!silencioso) setProblema(e instanceof Error ? e.message : 'No se pudo traer el día.')
      } finally {
        if (montado.current) setCargando(false)
      }
    },
    [fecha],
  )

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cuánta gente está esperando un hueco. Una consulta por pantalla, no una por
  // hueco: el número se muestra sobre los huecos libres, que es donde sirve.
  useEffect(() => {
    let vivo = true
    listarListaEspera({ soloPendientes: true })
      .then((cola) => {
        if (vivo) setEsperando(cola.length)
      })
      .catch(() => {
        /* la lista de espera es un extra: si falla, la agenda sigue */
      })
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void cargar(true)
    }, REFRESCO_MS)
    return () => window.clearInterval(id)
  }, [cargar])

  /** Optimista: el bloque cambia de color ya, y el servidor confirma después. */
  async function mover(
    compromisoID: string,
    estado: Estado,
    extra?: { demora_min?: number; recurso_id?: string },
  ) {
    const previo = agenda
    setAgenda((a) => (a ? pintar(a, compromisoID, estado) : a))
    try {
      await transicionar(compromisoID, { estado, ...extra })
      void cargar(true)
    } catch (e) {
      setAgenda(previo)
      throw e
    }
  }

  const rejilla = useMemo(() => (agenda ? construirRejilla(agenda) : null), [agenda])

  const pendientes = useMemo(() => {
    if (!agenda) return 0
    const enColumnas = agenda.recursos.reduce(
      (t, r) => t + r.turnos.filter((x) => x.estado === 'pendiente').length,
      0,
    )
    return enColumnas + agenda.sin_recurso.filter((x) => x.estado === 'pendiente').length
  }, [agenda])

  return (
    <section className="agenda">
      <BarraDia
        fecha={fecha}
        alCambiarFecha={setFecha}
        negocio={negocio?.nombre ?? ''}
        resumen={
          !rejilla
            ? ''
            : agenda && agenda.recursos.length === 0
              ? 'sin equipo cargado'
              : !rejilla.hayAlgo
                ? 'nadie atiende hoy'
                : [
                    pendientes > 0 ? `${pendientes} sin confirmar` : 'todo confirmado',
                    rejilla.minutosLibres > 0
                      ? `${duracionCorta(rejilla.minutosLibres)} libres`
                      : 'sin huecos',
                  ].join(' · ')
        }
      />

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

      {cargando && !agenda && <Esqueleto alto={96} cantidad={4} />}

      {agenda && rejilla && agenda.recursos.length === 0 && (
        <Vacio
          titulo="Todavía no hay nadie cargado en el equipo."
          detalle="Cargá a los profesionales y sus horarios y el día se arma solo."
          accion={{ texto: 'Ir a Equipo', alTocar: () => ir('/equipo') }}
        />
      )}

      {agenda && rejilla && agenda.recursos.length > 0 && !rejilla.hayAlgo && (
        <Vacio
          titulo="Nadie atiende hoy."
          detalle="Ninguno del equipo tiene horario cargado para este día. Si alguien tenía que estar, revisá los horarios en Equipo."
          accion={{ texto: 'Ir a Equipo', alTocar: () => ir('/equipo') }}
        />
      )}

      {agenda && rejilla && agenda.recursos.length > 0 && rejilla.hayAlgo && (
        <div className="agenda__marco">
          <div className="agenda__encabezados" style={{ gridTemplateColumns: columnas(rejilla.columnas.length) }}>
            <div className="agenda__esquina" />
            {rejilla.columnas.map((c) => (
              <h2 key={c.recursoID} className="agenda__profesional">
                {c.recursoNombre}
                {c.minutosLibres > 0 && (
                  <span className="agenda__libre-total">{duracionCorta(c.minutosLibres)} libres</span>
                )}
              </h2>
            ))}
          </div>

          <div
            className="agenda__rejilla"
            style={{
              gridTemplateColumns: columnas(rejilla.columnas.length),
              gridTemplateRows: `repeat(${rejilla.filas}, minmax(104px, auto))`,
            }}
          >
            {rejilla.horas.map((h) => (
              <div
                key={h.minutos}
                className={`agenda__hora hora ${h.enPunto ? 'agenda__hora--punto' : ''}`}
                style={{ gridColumn: 1, gridRow: h.fila + 1 }}
              >
                {h.enPunto ? hhmmDeMinutos(h.minutos) : ''}
              </div>
            ))}

            {rejilla.columnas.map((c, i) =>
              c.bloques.length === 0 ? (
                <div
                  key={`sin-horario-${c.recursoID}`}
                  className="agenda__sin-horario"
                  style={{ gridColumn: i + 2, gridRow: `1 / span ${rejilla.filas}` }}
                >
                  sin horario hoy
                </div>
              ) : (
                c.bloques.map((b) =>
                  b.clase === 'turno' ? (
                    <div
                      key={b.turno.compromiso_id}
                      className="agenda__celda"
                      style={{ gridColumn: i + 2, gridRow: `${b.fila + 1} / span ${b.filas}` }}
                    >
                      <TarjetaCompromiso
                        datos={datosDe(b.turno)}
                        demorasSugeridas={demorasSugeridas}
                        cobrable
                        estadoCobro={cobroDe(b.turno)}
                        mostrarTotal={vePlata}
                        alTransicionar={(estado, extra) =>
                          mover(b.turno.compromiso_id, estado, extra)
                        }
                      />
                    </div>
                  ) : (
                    <div
                      key={`hueco-${c.recursoID}-${b.fila}`}
                      className="agenda__hueco"
                      style={{ gridColumn: i + 2, gridRow: `${b.fila + 1} / span ${b.filas}` }}
                    >
                      <span className="agenda__hueco-hora hora">{hhmmDeMinutos(b.desdeMin)}</span>
                      <span className="agenda__hueco-texto">
                        libre · {duracionCorta(b.hastaMin - b.desdeMin)}
                      </span>
                      {esperando > 0 && (
                        <Link className="agenda__hueco-espera" to="/lista-espera">
                          {esperando} esperando
                        </Link>
                      )}
                    </div>
                  ),
                )
              ),
            )}
          </div>
        </div>
      )}

      {agenda && agenda.sin_recurso.length > 0 && (
        <section className="sin-recurso">
          <h2 className="sin-recurso__titulo">Sin profesional asignado</h2>
          <p className="sin-recurso__bajada">
            Entraron por WhatsApp y todavía nadie les puso con quién.
          </p>
          <div className="sin-recurso__lista">
            {agenda.sin_recurso.map((t) => (
              <div key={t.compromiso_id} className="sin-recurso__item">
                <TarjetaCompromiso
                  datos={datosDe(t)}
                  demorasSugeridas={demorasSugeridas}
                  cobrable
                  estadoCobro={cobroDe(t)}
                  mostrarTotal={vePlata}
                  alTransicionar={(estado, extra) => mover(t.compromiso_id, estado, extra)}
                />
                {t.estado === 'pendiente' && agenda.recursos.length > 0 && (
                  <label className="campo sin-recurso__asignar">
                    <span>Confirmar con</span>
                    <select
                      className="entrada"
                      defaultValue=""
                      onChange={(e) => {
                        const recurso = e.target.value
                        if (recurso) void mover(t.compromiso_id, 'confirmado', { recurso_id: recurso })
                      }}
                    >
                      <option value="">Elegí a quién</option>
                      {agenda.recursos.map((r) => (
                        <option key={r.recurso_id} value={r.recurso_id}>
                          {r.recurso_nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {agenda &&
        rejilla &&
        rejilla.hayAlgo &&
        agenda.recursos.length > 0 &&
        agenda.sin_recurso.length === 0 &&
        agenda.recursos.every((r) => r.turnos.length === 0) && (
          <p className="agenda__vacio-dia">
            El día está entero libre. Buen momento para{' '}
            <Link to="/lista-espera">llamar a la lista de espera</Link>.
          </p>
        )}
    </section>
  )
}

/** Cambia el estado de un turno en la agenda que ya está en pantalla. */
function pintar(agenda: AgendaDTO, compromisoID: string, estado: Estado): AgendaDTO {
  const cambiar = (t: TurnoAgenda) => (t.compromiso_id === compromisoID ? { ...t, estado } : t)
  return {
    ...agenda,
    recursos: agenda.recursos.map((r) => ({ ...r, turnos: r.turnos.map(cambiar) })),
    sin_recurso: agenda.sin_recurso.map(cambiar),
  }
}
