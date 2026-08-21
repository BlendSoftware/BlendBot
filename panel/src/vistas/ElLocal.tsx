/**
 * En gastronomía no hay "equipo" de profesionales con agenda: el local es uno
 * solo. Esta pantalla es la ficha del local — dirección, horarios, teléfono y
 * lo que haga falta aclarar — que el asistente usa para contestar "¿dónde
 * están?", "¿a qué hora abren?", "¿tienen delivery?". Un form plano: se carga
 * una vez y se toca poco.
 */

import { useState } from 'react'
import { guardarInfoLocal } from '../api/endpoints'
import type { InfoLocal } from '../api/tipos'
import { useSesion } from '../contexto'
import { Aviso, useAvisoBien } from '../componentes/basicos'

/** Deja el objeto sólo con los campos que tienen algo: así el merge del core no
 *  guarda cadenas vacías y "sin cargar" se distingue de "cargado en blanco". */
function limpiar(info: InfoLocal): InfoLocal {
  const salida: InfoLocal = {}
  if (info.direccion?.trim()) salida.direccion = info.direccion.trim()
  if (info.horarios?.trim()) salida.horarios = info.horarios.trim()
  if (info.telefono?.trim()) salida.telefono = info.telefono.trim()
  if (info.notas?.trim()) salida.notas = info.notas.trim()
  return salida
}

export function ElLocal() {
  const { negocio, recargarNegocio } = useSesion()
  const guardada = negocio?.config?.info ?? {}

  const [direccion, setDireccion] = useState(guardada.direccion ?? '')
  const [horarios, setHorarios] = useState(guardada.horarios ?? '')
  const [telefono, setTelefono] = useState(guardada.telefono ?? '')
  const [notas, setNotas] = useState(guardada.notas ?? '')
  const [guardando, setGuardando] = useState(false)
  const [problema, setProblema] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

  const sinCambios =
    direccion === (guardada.direccion ?? '') &&
    horarios === (guardada.horarios ?? '') &&
    telefono === (guardada.telefono ?? '') &&
    notas === (guardada.notas ?? '')

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    try {
      await guardarInfoLocal(limpiar({ direccion, horarios, telefono, notas }))
      recargarNegocio()
      mostrarBien('Datos del local guardados.')
    } catch (err) {
      setProblema(err instanceof Error ? err.message : 'No se pudieron guardar los datos.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="local">
      <header className="encabezado">
        <div>
          <h1>El local</h1>
          <p className="encabezado__bajada">
            Con esto el asistente contesta dónde estás, a qué hora abrís y cómo llamarte. Lo que
            dejes en blanco, no lo va a inventar.
          </p>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      <form className="local__forma" onSubmit={guardar}>
        <label className="campo">
          <span>Dirección</span>
          <input
            className="entrada"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Av. San Martín 1234, Mendoza"
          />
        </label>

        <label className="campo">
          <span>Horarios</span>
          <textarea
            className="area"
            value={horarios}
            onChange={(e) => setHorarios(e.target.value)}
            placeholder="Lun a Vie de 20 a 00. Sáb y Dom de 12 a 15 y de 20 a 01."
            rows={3}
          />
        </label>

        <label className="campo">
          <span>Teléfono</span>
          <input
            className="entrada tabular"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="261 555 1234"
            inputMode="tel"
          />
        </label>

        <label className="campo">
          <span>Para aclarar</span>
          <textarea
            className="area"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Hacemos delivery hasta 3 km. Estacionamiento sobre la calle de atrás."
            rows={3}
          />
        </label>

        <div className="local__acciones">
          <button type="submit" className="boton boton--primario" disabled={guardando || sinCambios}>
            {guardando ? 'Guardando' : 'Guardar'}
          </button>
        </div>
      </form>
    </section>
  )
}
