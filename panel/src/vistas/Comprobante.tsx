/**
 * El comprobante impreso: lo único del sistema pensado para salir en papel y
 * quedar en manos del cliente.
 *
 * Se arma con tres cosas que el core ya tenía sueltas y nadie juntaba: la
 * cabecera fiscal del negocio (razón social, CUIT, punto de venta), el cobro
 * con su comprobante (número, CAE, vencimiento) y el pedido con sus líneas.
 *
 * Imprime con el diálogo del navegador (@media print en vistas.css): así sale
 * por la impresora que ya tenga el local, o a PDF, sin que el sistema tenga
 * que generar un archivo ni saber de impresoras.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { miConfigFiscal, listarServicios, traerCobro, traerCompromiso } from '../api/endpoints'
import { ErrorApi } from '../api/cliente'
import type { Cobro, Compromiso, ConfigFiscal, Servicio } from '../api/tipos'
import { Aviso, Esqueleto } from '../componentes/basicos'
import { useSesion } from '../contexto'
import {
  condicionVisible,
  cuitVisible,
  esPrueba,
  nombreTipoComprobante,
  urlQrAfip,
} from '../dominio/comprobante'
import { etiquetaMedio } from '../dominio/cobros'
import { fechaLarga, horaDe, nombreVisible, plata, telefonoVisible } from '../dominio/formato'

export function Comprobante() {
  const { compromisoID = '' } = useParams()
  const { negocio } = useSesion()

  const [cobro, setCobro] = useState<Cobro | null>(null)
  const [pedido, setPedido] = useState<Compromiso | null>(null)
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [fiscal, setFiscal] = useState<ConfigFiscal | null>(null)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')

  useEffect(() => {
    let vivo = true
    setCargando(true)

    // La config fiscal es opcional: 404 es "todavía no la cargó", no un error.
    // El resto sí hace falta para que haya algo que imprimir.
    const traerFiscal = miConfigFiscal().catch((e: unknown) => {
      if (e instanceof ErrorApi && e.estado === 404) return null
      throw e
    })

    Promise.all([
      traerCobro(compromisoID),
      traerCompromiso(compromisoID),
      listarServicios({ incluirInactivos: true }),
      traerFiscal,
    ])
      .then(([c, p, carta, f]) => {
        if (!vivo) return
        setCobro(c)
        setPedido(p)
        setServicios(carta)
        setFiscal(f)
        setProblema('')
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setProblema(
          e instanceof ErrorApi && e.estado === 404
            ? 'Este pedido todavía no se cobró, así que no hay comprobante.'
            : e instanceof Error
              ? e.message
              : 'No se pudo traer el comprobante.',
        )
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })

    return () => {
      vivo = false
    }
  }, [compromisoID])

  const nombreDe = (servicioID: string) =>
    servicios.find((s) => s.id === servicioID)?.nombre ?? 'Ítem'

  const comp = cobro?.comprobante ?? null
  const emitido = comp?.estado === 'emitido'
  const prueba = esPrueba(fiscal)

  const qr =
    emitido && fiscal && comp?.numero && comp.cae && comp.cae_vence
      ? urlQrAfip({
          cuit: fiscal.cuit,
          puntoVenta: comp.punto_venta,
          tipoComprobante: comp.tipo_cbte,
          numero: comp.numero,
          fecha: cobro!.cobrado_en.slice(0, 10),
          importe: Number(cobro!.monto),
          cae: comp.cae,
        })
      : null

  return (
    <section className="comprobante">
      <header className="encabezado comprobante__volver">
        <div>
          <h1>Comprobante</h1>
          <p className="encabezado__bajada">
            Imprimilo o guardalo como PDF desde el diálogo del navegador.
          </p>
        </div>
        <div className="encabezado__acciones">
          <Link to="/" className="boton boton--fantasma">
            Volver
          </Link>
          {!cargando && !problema && (
            <button type="button" className="boton boton--primario" onClick={() => window.print()}>
              Imprimir
            </button>
          )}
        </div>
      </header>

      <Aviso texto={problema} />

      {cargando && <Esqueleto alto={120} cantidad={3} />}

      {!cargando && !problema && cobro && pedido && (
        <article className="papel">
          {prueba && (
            <p className="papel__prueba">
              Comprobante de PRUEBA — emitido en el entorno de homologación de ARCA. No tiene
              validez fiscal.
            </p>
          )}

          <header className="papel__cabeza">
            <div>
              <p className="papel__negocio">{fiscal?.razon_social || negocio?.nombre}</p>
              {fiscal && (
                <p className="papel__fiscal">
                  CUIT {cuitVisible(fiscal.cuit)} · {condicionVisible(fiscal.condicion)}
                </p>
              )}
            </div>
            <div className="papel__tipo">
              <p className="papel__tipo-nombre">
                {comp ? nombreTipoComprobante(comp.tipo_cbte) : 'Recibo'}
              </p>
              {comp?.numero_formateado && (
                <p className="papel__numero tabular">{comp.numero_formateado}</p>
              )}
              <p className="papel__fecha">
                {fechaLarga(cobro.cobrado_en.slice(0, 10))} · {horaDe(cobro.cobrado_en)}
              </p>
            </div>
          </header>

          <section className="papel__cliente">
            <p>
              <span className="papel__etiqueta">Cliente</span>{' '}
              {nombreVisible(pedido.cliente_nombre, pedido.cliente_telefono)}
            </p>
            <p>
              <span className="papel__etiqueta">Teléfono</span>{' '}
              <span className="tabular">{telefonoVisible(pedido.cliente_telefono)}</span>
            </p>
            {pedido.entrega === 'delivery' && pedido.direccion && (
              <p>
                <span className="papel__etiqueta">Envío a</span> {pedido.direccion}
              </p>
            )}
          </section>

          <table className="papel__items">
            <thead>
              <tr>
                <th scope="col">Cant.</th>
                <th scope="col">Detalle</th>
                <th scope="col" className="papel__num">
                  Unitario
                </th>
                <th scope="col" className="papel__num">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {pedido.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="tabular">{l.cantidad}</td>
                  <td>
                    {nombreDe(l.servicio_id)}
                    {l.nota && <span className="papel__nota"> · {l.nota}</span>}
                  </td>
                  <td className="papel__num tabular">{plata(l.precio_unit)}</td>
                  <td className="papel__num tabular">{plata(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="papel__total">
            <span>Total</span>
            <span className="papel__total-monto tabular">{plata(cobro.monto)}</span>
          </div>

          <p className="papel__medio">Pagado con {etiquetaMedio(cobro.medio_pago).toLowerCase()}</p>

          <footer className="papel__pie">
            {emitido && comp ? (
              <div className="papel__cae">
                {qr && (
                  <QRCodeSVG value={qr} size={96} level="M" marginSize={0} title="QR de AFIP" />
                )}
                <div>
                  <p>
                    <span className="papel__etiqueta">CAE</span>{' '}
                    <span className="tabular">{comp.cae}</span>
                  </p>
                  {comp.cae_vence && (
                    <p>
                      <span className="papel__etiqueta">Vence</span>{' '}
                      <span className="tabular">{comp.cae_vence}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="papel__sin-cae">
                {cobro.facturacion} Este papel es el detalle del cobro, no una factura.
              </p>
            )}
          </footer>
        </article>
      )}
    </section>
  )
}
