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
        <p className="portada__marca">Copiloto</p>
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
      </form>
    </div>
  )
}
