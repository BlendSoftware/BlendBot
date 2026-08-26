/**
 * El sol y la luna. Vive en la barra de abajo porque es lo único que está en
 * todas las pantallas, pero no es un destino: va separado de los NavLink y con
 * su propio ancho, para que nadie lo lea como una sección más.
 */

import { useState } from 'react'
import { aplicarTema, temaGuardado, type Tema } from '../dominio/tema'

const trazo = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function IconoSol() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...trazo}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function IconoLuna() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...trazo}>
      <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
    </svg>
  )
}

export function BotonTema() {
  const [tema, setTema] = useState<Tema>(temaGuardado)

  function alternar() {
    const nuevo: Tema = tema === 'oscuro' ? 'claro' : 'oscuro'
    aplicarTema(nuevo)
    setTema(nuevo)
  }

  const esOscuro = tema === 'oscuro'

  return (
    <button
      type="button"
      className="barra-inferior__tema"
      onClick={alternar}
      aria-pressed={esOscuro}
      aria-label={esOscuro ? 'Pasar al tema claro' : 'Pasar al tema oscuro'}
      title={esOscuro ? 'Tema claro' : 'Tema oscuro'}
    >
      {esOscuro ? <IconoSol /> : <IconoLuna />}
    </button>
  )
}
