/**
 * El cierre del día (PANEL.md vista 3), ahora una CAJA de verdad. Tres cosas
 * en una pantalla que se lee parado:
 *
 *  1. La caja: abierta o cerrada, con el botón para abrir o cerrar el día.
 *  2. Los números del día: lo VENDIDO (todo lo que salió, se haya cobrado o no)
 *     arriba y grande, y al lado lo cobrado, lo entregado y el ticket.
 *  3. El informe: cuánto se vendió y se cobró cada día de la semana o del mes.
 *
 * El core agrega en la timezone del negocio y manda todo hecho: acá no se suma
 * nada que el servidor no haya sumado ya. El único cálculo de pantalla es el
 * ancho de las barras del informe, que es una lectura, no un dato.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  abrirJornada,
  cerrarJornada,
  jornadaActual,
  traerCierre,
  traerReportes,
} from '../api/endpoints'
import type {
  Cierre as CierreDTO,
  JornadaActual,
  RangoReporte,
  Reporte,
} from '../api/tipos'
import { Aviso, BotonConfirmar, Esqueleto, useAvisoBien, Vacio } from '../componentes/basicos'
import { BarraDia } from '../componentes/BarraDia'
import { useSesion } from '../contexto'
import { cobradoPorMedio, compromisosPorOrigen, porcentaje } from '../dominio/cobros'
import { DIAS_CORTOS, hoyISO, plata } from '../dominio/formato'

/** La hora en la zona del negocio, sin importar en qué offset vino el string. */
function horaEnZona(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function Cierre() {
  const { negocio } = useSesion()
  const [fecha, setFecha] = useState(hoyISO())
  const [cierre, setCierre] = useState<CierreDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [bien, avisarBien] = useAvisoBien()

  const [jornada, setJornada] = useState<JornadaActual | null>(null)
  const [moviendoCaja, setMoviendoCaja] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const datos = await traerCierre(fecha)
      setCierre(datos)
      setProblema('')
    } catch (e) {
      setCierre(null)
      setProblema(e instanceof Error ? e.message : 'No se pudo traer el cierre del día.')
    } finally {
      setCargando(false)
    }
  }, [fecha])

  const cargarJornada = useCallback(async () => {
    try {
      setJornada(await jornadaActual())
    } catch {
      // Si la caja no carga, la pantalla igual muestra los números del día.
      setJornada(null)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    void cargarJornada()
  }, [cargarJornada])

  const abierta = jornada?.abierta ?? false

  const moverCaja = useCallback(
    async (accion: 'abrir' | 'cerrar') => {
      setMoviendoCaja(true)
      try {
        if (accion === 'abrir') {
          await abrirJornada()
          avisarBien('Caja abierta. Buen día de laburo.')
        } else {
          await cerrarJornada()
          avisarBien('Caja cerrada. Que descanses.')
        }
        await cargarJornada()
      } catch (e) {
        setProblema(e instanceof Error ? e.message : 'No se pudo mover la caja.')
      } finally {
        setMoviendoCaja(false)
      }
    },
    [avisarBien, cargarJornada],
  )

  const esSalud = negocio?.vertical !== 'gastronomia'
  const porWhatsApp = cierre?.por_origen.whatsapp ?? 0
  const huboDia = (cierre?.compromisos ?? 0) > 0
  const medios = cierre ? cobradoPorMedio(cierre) : []
  const origenes = cierre ? compromisosPorOrigen(cierre) : []

  return (
    <section className="cierre">
      <BarraDia
        fecha={fecha}
        alCambiarFecha={setFecha}
        negocio={negocio?.nombre ?? ''}
        resumen={cierre && huboDia ? plata(cierre.vendido) : ''}
      />

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      <Caja
        abierta={abierta}
        desde={
          jornada?.jornada ? horaEnZona(jornada.jornada.abierta_en, negocio?.timezone ?? 'America/Argentina/Mendoza') : ''
        }
        moviendo={moviendoCaja}
        onAbrir={() => void moverCaja('abrir')}
        onCerrar={() => void moverCaja('cerrar')}
      />

      {cargando && !cierre && <Esqueleto alto={96} cantidad={3} />}

      {cierre && !huboDia && (
        <Vacio
          titulo={abierta ? 'Todavía no salió nada hoy.' : 'Este día no pasó nada todavía.'}
          detalle="Cuando se entregue y se cobre el primer pedido, los números aparecen acá solos."
        />
      )}

      {cierre && huboDia && (
        <>
          <div className="cierre__grandes">
            <Numero titulo="Vendido" valor={plata(cierre.vendido)} destacado />
            <Numero titulo="Cobrado" valor={plata(cierre.total_cobrado)} />
            <Numero titulo="Entregados" valor={String(cierre.completados)} />
            <Numero
              titulo="Ticket promedio"
              valor={plata(cierre.ticket_promedio)}
              pie={`${porcentaje(porWhatsApp, cierre.compromisos)}% por WhatsApp`}
            />
          </div>

          <div className="cierre__detalle">
            <section className="cierre__bloque">
              <h2 className="cierre__titulo">Cómo pagaron</h2>
              {medios.length === 0 ? (
                <p className="cierre__nada">Todavía no se cobró nada de este día por caja.</p>
              ) : (
                <ul className="cifras">
                  {medios.map((m) => (
                    <li key={m.medio} className="cifras__fila">
                      <span className="cifras__nombre">{m.etiqueta}</span>
                      <span className="cifras__monto plata">{plata(m.monto)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cierre__bloque">
              <h2 className="cierre__titulo">Por dónde entraron</h2>
              <ul className="cifras">
                {origenes.map((o) => (
                  <li key={o.origen} className="cifras__fila">
                    <span className="cifras__nombre">{o.etiqueta}</span>
                    <span className="cifras__cantidad tabular">{o.cantidad}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="cierre__bloque">
              <h2 className="cierre__titulo">Lo que no salió</h2>
              <ul className="cifras">
                <li className="cifras__fila">
                  <span className="cifras__nombre">Cancelados</span>
                  <span className="cifras__cantidad tabular">{cierre.cancelados}</span>
                </li>
                {esSalud && (
                  <li className="cifras__fila">
                    <span className="cifras__nombre">No vinieron</span>
                    <span className="cifras__cantidad tabular">{cierre.ausentes}</span>
                  </li>
                )}
              </ul>
              {esSalud && cierre.ausentes > 0 && (
                <p className="cierre__nota">
                  {cierre.ausentes === 1 ? 'Un turno se perdió' : `${cierre.ausentes} turnos se perdieron`} sin
                  aviso. El recordatorio de la noche anterior es lo que baja ese número.
                </p>
              )}
            </section>

            <section className="cierre__bloque">
              <h2 className="cierre__titulo">Facturas</h2>
              <Facturas comprobantes={cierre.comprobantes} />
            </section>
          </div>
        </>
      )}

      <Informe />
    </section>
  )
}

/** La caja: una franja arriba que dice cómo está y deja abrirla o cerrarla. */
function Caja({
  abierta,
  desde,
  moviendo,
  onAbrir,
  onCerrar,
}: {
  abierta: boolean
  desde: string
  moviendo: boolean
  onAbrir: () => void
  onCerrar: () => void
}) {
  return (
    <div className={`caja ${abierta ? 'caja--abierta' : ''}`}>
      <div className="caja__estado">
        <span className="caja__punto" aria-hidden="true" />
        <p className="caja__texto">
          {abierta ? 'Caja abierta' : 'Caja cerrada'}
          {abierta && desde && <span className="caja__desde"> desde las {desde}</span>}
        </p>
      </div>
      {abierta ? (
        <BotonConfirmar
          etiqueta="Cerrar día"
          etiquetaConfirmar="Sí, cerrar el día"
          onConfirmar={onCerrar}
          className="boton boton--primario"
        />
      ) : (
        <button type="button" className="boton boton--primario" onClick={onAbrir} disabled={moviendo}>
          Abrir día
        </button>
      )}
    </div>
  )
}

function Numero({
  titulo,
  valor,
  pie,
  destacado = false,
}: {
  titulo: string
  valor: string
  pie?: string
  destacado?: boolean
}) {
  return (
    <div className={`cierre__numero ${destacado ? 'cierre__numero--fuerte' : ''}`}>
      <p className="cierre__etiqueta">{titulo}</p>
      <p className="cierre__valor tabular">{valor}</p>
      {pie && <p className="cierre__pie">{pie}</p>}
    </div>
  )
}

function Facturas({ comprobantes }: { comprobantes: CierreDTO['comprobantes'] }) {
  const total = comprobantes.emitidos + comprobantes.pendientes + comprobantes.con_error

  if (total === 0) {
    return (
      <p className="cierre__nada">
        Ninguna factura de este día. Se emiten solas apenas se cobra, si el negocio tiene cargados sus datos
        de ARCA.
      </p>
    )
  }

  // Mismo vocabulario que en la tarjeta al cobrar: emitida, facturando, no salió.
  return (
    <>
      <ul className="cifras">
        <li className="cifras__fila">
          <span className="cifras__nombre">Factura C emitida</span>
          <span className="cifras__cantidad tabular">{comprobantes.emitidos}</span>
        </li>
        <li className="cifras__fila">
          <span className="cifras__nombre">Facturando…</span>
          <span className="cifras__cantidad tabular">{comprobantes.pendientes}</span>
        </li>
        <li className="cifras__fila">
          <span className="cifras__nombre">No salieron</span>
          <span className="cifras__cantidad tabular">{comprobantes.con_error}</span>
        </li>
      </ul>
      {comprobantes.con_error > 0 && (
        <p className="cierre__nota">
          Las que no salieron se siguen intentando solas. Si quedan trabadas, revisá los datos de ARCA del
          negocio.
        </p>
      )}
    </>
  )
}

const RANGOS: { rango: RangoReporte; etiqueta: string }[] = [
  { rango: 'semanal', etiqueta: 'La semana' },
  { rango: 'mensual', etiqueta: 'El mes' },
]

/** El informe por día: barras de lo vendido, con lo cobrado al lado. */
function Informe() {
  const [rango, setRango] = useState<RangoReporte>('semanal')
  const [reporte, setReporte] = useState<Reporte | null>(null)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')

  useEffect(() => {
    let vivo = true
    setCargando(true)
    traerReportes(rango)
      .then((r) => {
        if (vivo) {
          setReporte(r)
          setProblema('')
        }
      })
      .catch((e: unknown) => {
        if (vivo) {
          setReporte(null)
          setProblema(e instanceof Error ? e.message : 'No se pudo traer el informe.')
        }
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [rango])

  const maximo = reporte ? Math.max(1, ...reporte.dias.map((d) => Number(d.vendido))) : 1
  const huboVentas = reporte ? Number(reporte.total_vendido) > 0 : false

  return (
    <section className="informe">
      <div className="informe__cabecera">
        <h2 className="informe__titulo">Cómo viene la cosa</h2>
        <div className="informe__pestanas" role="tablist" aria-label="Rango del informe">
          {RANGOS.map((r) => (
            <button
              key={r.rango}
              type="button"
              role="tab"
              aria-selected={rango === r.rango}
              className={`informe__pestana ${rango === r.rango ? 'informe__pestana--activa' : ''}`}
              onClick={() => setRango(r.rango)}
            >
              {r.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

      {cargando && !reporte && <Esqueleto alto={40} cantidad={4} />}

      {reporte && (
        <>
          <div className="informe__totales">
            <div className="informe__total">
              <p className="cierre__etiqueta">Total vendido</p>
              <p className="informe__totalvalor tabular">{plata(reporte.total_vendido)}</p>
            </div>
            <div className="informe__total">
              <p className="cierre__etiqueta">Total cobrado</p>
              <p className="informe__totalvalor tabular">{plata(reporte.total_cobrado)}</p>
            </div>
          </div>

          {!huboVentas ? (
            <p className="cierre__nada">Todavía no hay ventas en este período. Aparecen solas apenas empieces.</p>
          ) : (
            <ul className="informe__dias">
              {reporte.dias.map((d) => (
                <li key={d.fecha} className="informe__dia">
                  <span className="informe__fecha tabular">{etiquetaDia(d.fecha)}</span>
                  <span className="informe__barra">
                    <span
                      className="informe__relleno"
                      style={{
                        width: `${(Number(d.vendido) / maximo) * 100}%`,
                        // Un día sin ventas no deja ni el mínimo asomo de barra:
                        // el nub de 2px del CSS haría leer plata donde hubo $0.
                        ...(Number(d.vendido) === 0 ? { minWidth: 0 } : {}),
                      }}
                    />
                  </span>
                  <span className="informe__montos">
                    <span className="informe__vendido tabular">{plata(d.vendido)}</span>
                    <span className="informe__cobrado tabular">{plata(d.cobrado)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** '2026-08-21' → 'vie 21'. Corto, para la columna del informe. */
function etiquetaDia(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const fecha = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
  return `${DIAS_CORTOS[fecha.getDay()]} ${fecha.getDate()}`
}
