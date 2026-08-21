import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { entrar } from '../api/endpoints'
import { marcarCambioPendiente } from '../api/sesion'
import { useSesion } from '../contexto'
import { Aviso } from '../componentes/basicos'

export function Login() {
  const { claims } = useSesion()
  const ir = useNavigate()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [problema, setProblema] = useState('')
  const [entrando, setEntrando] = useState(false)

  if (claims) return <Navigate to={claims.rol === 'admin' ? '/admin' : '/'} replace />

  async function mandar(e: React.FormEvent) {
    e.preventDefault()
    setProblema('')
    setEntrando(true)
    try {
      const tokens = await entrar(usuario.trim(), clave)
      marcarCambioPendiente(tokens.usuario.must_change_password)
      if (tokens.usuario.must_change_password) ir('/cambiar-password', { replace: true })
      else ir(tokens.usuario.rol === 'admin' ? '/admin' : '/', { replace: true })
    } catch (err) {
      // El core no distingue usuario de contraseña, y está bien que no lo haga.
      setProblema(
        err instanceof Error && err.message.includes('conexión')
          ? err.message
          : 'Usuario o contraseña incorrectos.',
      )
    } finally {
      setEntrando(false)
    }
  }

  return (
    <div className="portada">
      <form className="portada__forma" onSubmit={mandar}>
        <p className="portada__marca">
          <span className="portada__logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2v7a2 2 0 0 0 2 2v11" />
              <path d="M6 2v6M10 2v6" />
              <path d="M18 2c-2 2-2 5-2 8s0 4 2 4v8" />
            </svg>
          </span>
          Copiloto
        </p>
        <h1 className="portada__titulo">Buen día. Entrá para ver la agenda.</h1>

        <label className="campo">
          <span>Usuario</span>
          <input
            className="entrada"
            autoComplete="username"
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            required
          />
        </label>

        <label className="campo">
          <span>Contraseña</span>
          <input
            className="entrada"
            type="password"
            autoComplete="current-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            required
          />
        </label>

        <Aviso texto={problema} />

        <button type="submit" className="boton boton--primario portada__entrar" disabled={entrando}>
          {entrando ? 'Entrando' : 'Entrar'}
        </button>

        <a href="/" className="portada__volver">
          ← Volver al sitio
        </a>
      </form>
    </div>
  )
}
