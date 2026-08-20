/**
 * Panel interno de la plataforma (D20): alta de negocios y token del agente.
 * La contraseña temporal y el token se ven UNA vez y no vuelven nunca: la
 * pantalla lo dice con todas las letras antes de que alguien cierre la pestaña.
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  actualizarNegocio,
  altaNegocio,
  guardarConfigFiscal,
  listarNegocios,
  obtenerConfigFiscal,
  rotarTokenAgente,
  salir,
} from '../api/endpoints'
import { ErrorApi } from '../api/cliente'
import type { AltaNegocio, ModoFiscal, Negocio, Vertical } from '../api/tipos'
import { Switch } from '../componentes/Switch'
import { Aviso, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'

export function Admin() {
  const ir = useNavigate()
  const [negocios, setNegocios] = useState<Negocio[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [alta, setAlta] = useState<AltaNegocio | null>(null)
  const [token, setToken] = useState<{ negocio: string; valor: string } | null>(null)
  const [bien, mostrarBien] = useAvisoBien()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setNegocios(await listarNegocios())
      setProblema('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo traer la lista.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <section className="admin">
      <header className="encabezado">
        <div>
          <h1>Negocios</h1>
          <p className="encabezado__bajada">Alta de negocios y token del agente.</p>
        </div>
        <div className="encabezado__acciones">
          <button type="button" className="boton boton--fantasma" onClick={() => ir('/cambiar-password')}>
            Cambiar contraseña
          </button>
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

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      {alta && (
        <div className="secreto">
          <h2 className="secreto__titulo">{alta.nombre} quedó creado</h2>
          <p className="secreto__aviso">
            Esta contraseña se muestra una sola vez. Pasásela ahora al dueño: después no se puede
            recuperar, sólo generar otra.
          </p>
          <p className="secreto__usuario">Usuario: {alta.usuario_dueno.username}</p>
          <p className="secreto__valor tabular">{alta.password_temporal}</p>
          <button type="button" className="boton" onClick={() => setAlta(null)}>
            Ya la copié
          </button>
        </div>
      )}

      {token && (
        <div className="secreto">
          <h2 className="secreto__titulo">Token nuevo de {token.negocio}</h2>
          <p className="secreto__aviso">
            El token anterior dejó de funcionar recién. Pegá este en el agente antes de cerrar:
            no se vuelve a mostrar.
          </p>
          <p className="secreto__valor secreto__valor--largo">{token.valor}</p>
          <button type="button" className="boton" onClick={() => setToken(null)}>
            Ya lo copié
          </button>
        </div>
      )}

      <AltaNegocioForma
        alCrear={(a) => {
          setAlta(a)
          void cargar()
        }}
        alFallar={setProblema}
      />

      {cargando && <Esqueleto alto={64} cantidad={3} />}

      {!cargando && negocios.length === 0 && (
        <Vacio titulo="Todavía no hay ningún negocio dado de alta." />
      )}

      {!cargando && negocios.length > 0 && (
        <div className="grupo">
          <div className="grupo__cabeza">
            <span className="grupo__cuenta">
              {negocios.length === 1 ? '1 negocio' : `${negocios.length} negocios`}
            </span>
          </div>

          <ul className="negocios">
            {negocios.map((n) => (
              <NegocioFila
                key={n.id}
                negocio={n}
                alGuardar={async (cambios) => {
                  const guardado = await actualizarNegocio(n.id, cambios)
                  setNegocios((l) => l.map((x) => (x.id === n.id ? guardado : x)))
                  mostrarBien(`${guardado.nombre} actualizado.`)
                }}
                alActivar={async (v) => {
                  const guardado = await actualizarNegocio(n.id, { activo: v })
                  setNegocios((l) => l.map((x) => (x.id === n.id ? guardado : x)))
                }}
                alRotarToken={async () => {
                  try {
                    const t = await rotarTokenAgente(n.id)
                    setToken({ negocio: n.nombre, valor: t.token })
                  } catch (e) {
                    setProblema(e instanceof Error ? e.message : 'No se pudo rotar el token.')
                  }
                }}
                alFallar={setProblema}
                alExito={mostrarBien}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function NegocioFila({
  negocio,
  alGuardar,
  alActivar,
  alRotarToken,
  alFallar,
  alExito,
}: {
  negocio: Negocio
  alGuardar: (cambios: { nombre: string; timezone: string; wa_phone_id: string | null }) => Promise<void>
  alActivar: (valor: boolean) => Promise<void>
  alRotarToken: () => Promise<void>
  alFallar: (m: string) => void
  alExito: (m: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [fiscalAbierta, setFiscalAbierta] = useState(false)
  const [nombre, setNombre] = useState(negocio.nombre)
  const [timezone, setTimezone] = useState(negocio.timezone)
  const [waPhone, setWaPhone] = useState(negocio.wa_phone_id ?? '')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setNombre(negocio.nombre)
    setTimezone(negocio.timezone)
    setWaPhone(negocio.wa_phone_id ?? '')
  }, [negocio.nombre, negocio.timezone, negocio.wa_phone_id])

  async function guardar() {
    setGuardando(true)
    try {
      await alGuardar({ nombre: nombre.trim(), timezone: timezone.trim(), wa_phone_id: waPhone.trim() || null })
      setEditando(false)
    } catch (e) {
      alFallar(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  if (editando) {
    return (
      <li className="negocio">
        <form
          className="negocio__edicion"
          onSubmit={(e) => {
            e.preventDefault()
            void guardar()
          }}
        >
          <label className="campo">
            <span>Nombre</span>
            <input
              className="entrada"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="campo">
            <span>Timezone</span>
            <input
              className="entrada tabular"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Argentina/Mendoza"
              required
            />
          </label>
          <label className="campo">
            <span>ID de WhatsApp</span>
            <input
              className="entrada tabular"
              value={waPhone}
              onChange={(e) => setWaPhone(e.target.value)}
              placeholder="opcional"
            />
          </label>
          <button
            type="submit"
            className="boton boton--primario"
            disabled={guardando || !nombre.trim() || !timezone.trim()}
          >
            {guardando ? 'Guardando' : 'Guardar'}
          </button>
          <button
            type="button"
            className="boton boton--fantasma"
            onClick={() => {
              setEditando(false)
              setFiscalAbierta(false)
            }}
          >
            Cancelar
          </button>
        </form>

        <button
          type="button"
          className="boton boton--fantasma disparador"
          onClick={() => setFiscalAbierta((v) => !v)}
          aria-expanded={fiscalAbierta}
        >
          {fiscalAbierta ? 'Cerrar configuración fiscal' : '+ Configuración fiscal'}
        </button>

        {fiscalAbierta && (
          <ConfigFiscalForma negocioID={negocio.id} alFallar={alFallar} alExito={alExito} />
        )}
      </li>
    )
  }

  return (
    <li className="negocio">
      <div className="negocio__fila">
        <div className="negocio__datos">
          <span className="negocio__nombre">{negocio.nombre}</span>
          <span className="negocio__meta">
            {negocio.vertical === 'salud' ? 'consultorio' : 'gastronomía'} · {negocio.timezone}
            {negocio.wa_phone_id ? ` · WhatsApp ${negocio.wa_phone_id}` : ' · sin WhatsApp'}
          </span>
        </div>

        <button type="button" className="boton boton--fantasma" onClick={() => setEditando(true)}>
          Editar
        </button>

        <Switch
          activo={negocio.activo}
          etiquetaSi="activo"
          etiquetaNo="apagado"
          describe={negocio.nombre}
          alCambiar={alActivar}
          alFallar={alFallar}
        />

        <button type="button" className="boton" onClick={() => void alRotarToken()}>
          Token nuevo
        </button>
      </div>
    </li>
  )
}

function ConfigFiscalForma({
  negocioID,
  alFallar,
  alExito,
}: {
  negocioID: string
  alFallar: (m: string) => void
  alExito: (m: string) => void
}) {
  const [cargando, setCargando] = useState(true)
  const [tieneCertificados, setTieneCertificados] = useState(false)
  const [cuit, setCuit] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [condicion, setCondicion] = useState('')
  const [puntoVenta, setPuntoVenta] = useState('')
  const [modo, setModo] = useState<ModoFiscal>('homologacion')
  const [certPem, setCertPem] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    obtenerConfigFiscal(negocioID)
      .then((c) => {
        if (!vivo) return
        setTieneCertificados(c.tiene_certificados)
        setCuit(c.cuit)
        setRazonSocial(c.razon_social ?? '')
        setCondicion(c.condicion ?? '')
        setPuntoVenta(c.punto_venta != null ? String(c.punto_venta) : '')
        setModo(c.modo)
      })
      .catch((e: unknown) => {
        // Sin config todavía, el core contesta 404 igual que "no existe": es
        // el mismo sentinel a propósito (motor_errors.go), no un error real.
        if (!vivo) return
        if (!(e instanceof ErrorApi && e.estado === 404)) {
          alFallar(e instanceof Error ? e.message : 'No se pudo traer la configuración fiscal.')
        }
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [negocioID, alFallar])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!cuit.trim()) return
    setGuardando(true)
    try {
      const guardado = await guardarConfigFiscal(negocioID, {
        cuit: cuit.trim(),
        razon_social: razonSocial.trim() || null,
        condicion: condicion.trim() || null,
        punto_venta: puntoVenta.trim() ? Number(puntoVenta) : null,
        modo,
        cert_pem: certPem.trim() || null,
        key_pem: keyPem.trim() || null,
      })
      setTieneCertificados(guardado.tiene_certificados)
      setCertPem('')
      setKeyPem('')
      alExito('Configuración fiscal guardada.')
    } catch (err) {
      alFallar(err instanceof Error ? err.message : 'No se pudo guardar la configuración fiscal.')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <Esqueleto alto={44} cantidad={3} />

  return (
    <form className="fiscal" onSubmit={guardar}>
      <div className="fiscal__campos">
        <label className="campo">
          <span>CUIT</span>
          <input
            className="entrada tabular"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="20-12345678-9"
            required
          />
        </label>

        <label className="campo">
          <span>Razón social</span>
          <input className="entrada" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
        </label>

        <label className="campo">
          <span>Condición</span>
          <input
            className="entrada"
            value={condicion}
            onChange={(e) => setCondicion(e.target.value)}
            placeholder="Monotributo, Resp. inscripto"
          />
        </label>

        <label className="campo">
          <span>Punto de venta</span>
          <input
            className="entrada tabular"
            inputMode="numeric"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        <label className="campo">
          <span>Modo</span>
          <select className="entrada" value={modo} onChange={(e) => setModo(e.target.value as ModoFiscal)}>
            <option value="homologacion">Homologación (pruebas)</option>
            <option value="produccion">Producción</option>
          </select>
        </label>
      </div>

      <p className="fiscal__certs-estado">
        {tieneCertificados
          ? 'Ya tiene certificados cargados.'
          : 'Todavía no tiene certificados cargados: sin esto no puede facturar.'}
      </p>

      <label className="campo">
        <span>Certificado (PEM)</span>
        <textarea
          className="entrada fiscal__pem tabular"
          rows={4}
          value={certPem}
          onChange={(e) => setCertPem(e.target.value)}
          placeholder="Dejalo vacío para no tocar el que ya está cargado"
        />
      </label>

      <label className="campo">
        <span>Clave privada (PEM)</span>
        <textarea
          className="entrada fiscal__pem tabular"
          rows={4}
          value={keyPem}
          onChange={(e) => setKeyPem(e.target.value)}
          placeholder="Dejalo vacío para no tocar la que ya está cargada"
        />
      </label>

      <button type="submit" className="boton boton--primario" disabled={guardando || !cuit.trim()}>
        {guardando ? 'Guardando' : 'Guardar configuración fiscal'}
      </button>
    </form>
  )
}

function AltaNegocioForma({
  alCrear,
  alFallar,
}: {
  alCrear: (a: AltaNegocio) => void
  alFallar: (m: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [vertical, setVertical] = useState<Vertical>('salud')
  const [usuario, setUsuario] = useState('')
  const [waPhone, setWaPhone] = useState('')
  const [guardando, setGuardando] = useState(false)

  return (
    <form
      className="alta-negocio"
      onSubmit={async (e) => {
        e.preventDefault()
        setGuardando(true)
        try {
          const a = await altaNegocio({
            nombre: nombre.trim(),
            vertical,
            usuario_dueno: usuario.trim(),
            wa_phone_id: waPhone.trim() || null,
          })
          alCrear(a)
          setNombre('')
          setUsuario('')
          setWaPhone('')
        } catch (err) {
          alFallar(err instanceof Error ? err.message : 'No se pudo dar de alta.')
        } finally {
          setGuardando(false)
        }
      }}
    >
      <label className="campo">
        <span>Nombre del negocio</span>
        <input className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </label>

      <label className="campo">
        <span>Rubro</span>
        <select
          className="entrada"
          value={vertical}
          onChange={(e) => setVertical(e.target.value as Vertical)}
        >
          <option value="salud">Consultorio</option>
          <option value="gastronomia">Gastronomía</option>
        </select>
      </label>

      <label className="campo">
        <span>Usuario del dueño</span>
        <input
          className="entrada"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          minLength={3}
          required
        />
      </label>

      <label className="campo">
        <span>ID de WhatsApp</span>
        <input
          className="entrada tabular"
          value={waPhone}
          onChange={(e) => setWaPhone(e.target.value)}
          placeholder="opcional"
        />
      </label>

      <button type="submit" className="boton boton--primario" disabled={guardando}>
        {guardando ? 'Creando' : 'Dar de alta'}
      </button>
    </form>
  )
}
