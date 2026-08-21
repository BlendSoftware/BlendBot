/**
 * El acceso a las preguntas sin responder, desde el tablero de cocina: una
 * franja que aparece SÓLO cuando hay pendientes y lleva su número como badge
 * (principio 5: el pendiente reclama atención hasta que alguien lo toca). Sin
 * pendientes no dice nada de más y no ocupa lugar. Se refresca sola, como el
 * tablero, para que el número no quede viejo.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarConsultas } from '../api/endpoints'

const REFRESCO_MS = 30000

export function AccesoConsultas() {
  const [pendientes, setPendientes] = useState(0)
  const montado = useRef(true)

  const cargar = useCallback(async () => {
    try {
      const lista = await listarConsultas('pendiente')
      if (montado.current) setPendientes(lista.length)
    } catch {
      // Silencioso: es un aviso secundario, no vale romper el tablero por esto.
    }
  }, [])

  useEffect(() => {
    montado.current = true
    void cargar()
    const id = window.setInterval(() => {
      if (!document.hidden) void cargar()
    }, REFRESCO_MS)
    return () => {
      montado.current = false
      window.clearInterval(id)
    }
  }, [cargar])

  if (pendientes === 0) return null

  return (
    <Link to="/consultas" className="acceso-consultas">
      <span className="acceso-consultas__badge tabular">{pendientes}</span>
      <span className="acceso-consultas__texto">
        {pendientes === 1 ? 'Una pregunta sin responder' : `${pendientes} preguntas sin responder`}
      </span>
      <span className="acceso-consultas__ir" aria-hidden="true">
        Responder
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  )
}
