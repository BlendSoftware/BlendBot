/**
 * El cierre del día (PANEL.md vista 3). No es un dashboard: son los cuatro
 * números que el dueño mira antes de apagar la luz, en tamaño de leerse parado,
 * y abajo el detalle de cómo le pagaron y qué pasó con las facturas.
 *
 * El core agrega en la timezone del negocio y manda todo hecho: acá no se suma
 * nada que el servidor no haya sumado ya. Lo único que se calcula en pantalla
 * es el porcentaje, que es una lectura, no un dato.
 */

import { useCallback, useEffect, useState } from 'react'
import { traerCierre } from '../api/endpoints'
import type { Cierre as CierreDTO } from '../api/tipos'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'
import { BarraDia } from '../componentes/BarraDia'
import { useSesion } from '../contexto'
import { cobradoPorMedio, compromisosPorOrigen, porcentaje } from '../dominio/cobros'
import { hoyISO, plata } from '../dominio/formato'

export function Cierre() {
  const { negocio } = useSesion()
  const [fecha, setFecha] = useState(hoyISO())
  const [cierre, setCierre] = useState<CierreDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')

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

  useEffect(() => {
    void cargar()
  }, [cargar])

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
        resumen={cierre && huboDia ? `${cierre.cobros} cobros` : ''}
      />

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

      {cargando && !cierre && <Esqueleto alto={96} cantidad={3} />}

      {cierre && !huboDia && (
        <Vacio
          titulo="Este día no pasó nada todavía."
          detalle="Cuando se atienda y se cobre el primer turno, los números aparecen acá solos."
        />
      )}

      {cierre && huboDia && (
        <>
          <div className="cierre__grandes">
            <Numero titulo="Compromisos" valor={String(cierre.compromisos)} />
            <Numero titulo="Cobrado" valor={plata(cierre.total_cobrado)} destacado />
            <Numero titulo="Ticket promedio" valor={plata(cierre.ticket_promedio)} />
            <Numero
              titulo="Por WhatsApp"
              valor={String(porWhatsApp)}
              pie={`${porcentaje(porWhatsApp, cierre.compromisos)}% del día`}
            />
          </div>

          <div className="cierre__detalle">
            <section className="cierre__bloque">
              <h2 className="cierre__titulo">Cómo pagaron</h2>
              {medios.length === 0 ? (
                <p className="cierre__nada">Todavía no se cobró nada de este día.</p>
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
    </section>
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
