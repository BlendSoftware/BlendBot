import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cambiarPassword } from '../api/endpoints'
import { marcarCambioPendiente } from '../api/sesion'
import { useSesion } from '../contexto'
import { Aviso } from '../componentes/basicos'

const MINIMO = 8

export function CambiarPassword() {
  const { claims } = useSesion()
  const ir = useNavigate()
  const [nueva, setNueva] = useState('')
  const [repite, setRepite] = useState('')
  const [problema, setProblema] = useState('')
  const [guardando, setGuardando] = useState(false)

  const corta = nueva.length > 0 && nueva.length < MINIMO
  const distinta = repite.length > 0 && nueva !== repite
  const puede = nueva.length >= MINIMO && nueva === repite && !guardando

  async function mandar(e: React.FormEvent) {
    e.preventDefault()
    setProblema('')
    setGuardando(true)
    try {
      await cambiarPassword(nueva)
      marcarCambioPendiente(false)
      ir(claims?.rol === 'admin' ? '/admin' : '/', { replace: true })
    } catch (err) {
      setProblema(err instanceof Error ? err.message : 'No se pudo guardar la contraseña.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="portada">
      <form className="portada__forma" onSubmit={mandar}>
        <p className="portada__marca">Copiloto</p>
        <h1 className="portada__titulo">Elegí una contraseña tuya</h1>
        <p className="portada__bajada">
          La que te dimos es provisoria y sirve una sola vez. Poné una que te acuerdes.
        </p>

        <label className="campo">
          <span>Contraseña nueva</span>
          <input
            className="entrada"
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            required
          />
        </label>

        <label className="campo">
          <span>Repetila</span>
          <input
            className="entrada"
            type="password"
            autoComplete="new-password"
            value={repite}
            onChange={(e) => setRepite(e.target.value)}
            required
          />
        </label>

        {corta && <Aviso texto={`Tiene que tener al menos ${MINIMO} caracteres.`} />}
        {distinta && <Aviso texto="Las dos no coinciden." />}
        <Aviso texto={problema} />

        <button type="submit" className="boton boton--primario portada__entrar" disabled={!puede}>
          {guardando ? 'Guardando' : 'Guardar y entrar'}
        </button>
      </form>
    </div>
  )
}
