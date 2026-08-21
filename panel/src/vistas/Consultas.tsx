/**
 * El buzón del dueño: las preguntas que el asistente no supo contestar. En vez
 * de inventar, el bot las deja acá; el dueño las lee y responde en el lugar, y
 * el core le manda la respuesta al cliente por WhatsApp. Un pendiente reclama
 * atención hasta que alguien lo toca (principio 5 de PRODUCT.md): apenas se
 * responde, la pregunta se va de la lista.
 */

import { useCallback, useEffect, useState } from 'react'
import { listarConsultas, responderConsulta } from '../api/endpoints'
import type { Consulta } from '../api/tipos'
import { Aviso, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'
import { horaDe, nombreVisible, telefonoVisible } from '../dominio/formato'

export function Consultas() {
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const lista = await listarConsultas('pendiente')
      setConsultas(lista)
      setProblema('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudieron traer las preguntas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function responder(consulta: Consulta, respuesta: string) {
    await responderConsulta(consulta.id, respuesta)
    setConsultas((l) => l.filter((c) => c.id !== consulta.id))
    mostrarBien(`Listo, le avisamos a ${nombreVisible(consulta.cliente_nombre, consulta.telefono)}.`)
  }

  return (
    <section className="consultas">
      <header className="encabezado">
        <div>
          <h1>Preguntas</h1>
          <p className="encabezado__bajada">
            Lo que el asistente no supo contestar. Respondé acá y el cliente lo recibe por WhatsApp.
          </p>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      {cargando && <Esqueleto alto={132} cantidad={3} />}

      {!cargando && consultas.length === 0 && (
        <Vacio
          titulo="No hay preguntas sin responder."
          detalle="Cuando alguien pregunte algo que el asistente no tiene cómo saber, en vez de inventar te lo deja acá."
        />
      )}

      {!cargando && consultas.length > 0 && (
        <ul className="consultas__lista">
          {consultas.map((c) => (
            <TarjetaConsulta
              key={c.id}
              consulta={c}
              alResponder={(respuesta) => responder(c, respuesta)}
              alFallar={setProblema}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function TarjetaConsulta({
  consulta,
  alResponder,
  alFallar,
}: {
  consulta: Consulta
  alResponder: (respuesta: string) => Promise<void>
  alFallar: (m: string) => void
}) {
  const [respuesta, setRespuesta] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const texto = respuesta.trim()
    if (!texto) return
    setEnviando(true)
    try {
      await alResponder(texto)
    } catch (err) {
      alFallar(err instanceof Error ? err.message : 'No se pudo responder.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li className="consulta">
      <div className="consulta__quien">
        <span className="consulta__nombre">
          {nombreVisible(consulta.cliente_nombre, consulta.telefono)}
        </span>
        <span className="consulta__telefono tabular">{telefonoVisible(consulta.telefono)}</span>
        <span className="consulta__hora tabular">{horaDe(consulta.creado_en)}</span>
      </div>

      <p className="consulta__pregunta">{consulta.pregunta}</p>

      <form className="consulta__forma" onSubmit={enviar}>
        <textarea
          className="area consulta__respuesta"
          value={respuesta}
          onChange={(e) => setRespuesta(e.target.value)}
          placeholder="Escribí la respuesta para el cliente"
          aria-label={`Respuesta para ${nombreVisible(consulta.cliente_nombre, consulta.telefono)}`}
          rows={2}
        />
        <button
          type="submit"
          className="boton boton--primario"
          disabled={enviando || !respuesta.trim()}
        >
          {enviando ? 'Enviando' : 'Responder'}
        </button>
      </form>
    </li>
  )
}
