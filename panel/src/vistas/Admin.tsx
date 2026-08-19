/**
 * Panel interno de la plataforma (D20): alta de negocios y token del agente.
 * La contraseña temporal y el token se ven UNA vez y no vuelven nunca: la
 * pantalla lo dice con todas las letras antes de que alguien cierre la pestaña.
 */

import { useCallback, useEffect, useState } from 'react'
import { actualizarNegocio, altaNegocio, listarNegocios, rotarTokenAgente, salir } from '../api/endpoints'
import type { AltaNegocio, Negocio, Vertical } from '../api/tipos'
import { Switch } from '../componentes/Switch'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'

export function Admin() {
  const [negocios, setNegocios] = useState<Negocio[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [alta, setAlta] = useState<AltaNegocio | null>(null)
  const [token, setToken] = useState<{ negocio: string; valor: string } | null>(null)

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
        <button
          type="button"
          className="boton boton--fantasma"
          onClick={() => {
            void salir()
          }}
        >
          Salir
        </button>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

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
        <ul className="negocios">
          {negocios.map((n) => (
            <li key={n.id} className="negocio">
              <div className="negocio__datos">
                <span className="negocio__nombre">{n.nombre}</span>
                <span className="negocio__meta">
                  {n.vertical === 'salud' ? 'consultorio' : 'gastronomía'} · {n.timezone}
                  {n.wa_phone_id ? ` · WhatsApp ${n.wa_phone_id}` : ' · sin WhatsApp'}
                </span>
              </div>

              <Switch
                activo={n.activo}
                etiquetaSi="activo"
                etiquetaNo="apagado"
                describe={n.nombre}
                alCambiar={async (v) => {
                  const guardado = await actualizarNegocio(n.id, { activo: v })
                  setNegocios((l) => l.map((x) => (x.id === n.id ? guardado : x)))
                }}
                alFallar={setProblema}
              />

              <button
                type="button"
                className="boton"
                onClick={async () => {
                  try {
                    const t = await rotarTokenAgente(n.id)
                    setToken({ negocio: n.nombre, valor: t.token })
                  } catch (e) {
                    setProblema(e instanceof Error ? e.message : 'No se pudo rotar el token.')
                  }
                }}
              >
                Token nuevo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
