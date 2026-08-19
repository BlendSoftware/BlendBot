/**
 * Navegación tablet-first: cuatro destinos, íconos grandes, siempre abajo y a
 * mano del pulgar. La pantalla operativa no tiene más chrome que esto.
 */

import { NavLink } from 'react-router-dom'
import type { Rol } from '../api/tipos'

interface Props {
  rol: Rol
}

const trazo = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function IconoAgenda() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

function IconoCatalogo() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M4 6h10M4 12h10M4 18h10" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
    </svg>
  )
}

function IconoEquipo() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 9.5a2.8 2.8 0 1 0 0-5.6M17.5 20c0-2.3-.9-4-2.3-5" />
    </svg>
  )
}

function IconoClientes() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 21 21" />
    </svg>
  )
}

function IconoAdmin() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
}

export function BarraInferior({ rol }: Props) {
  const destinos =
    rol === 'admin'
      ? [{ a: '/admin', texto: 'Negocios', icono: <IconoAdmin /> }]
      : [
          { a: '/', texto: 'Agenda', icono: <IconoAgenda /> },
          { a: '/catalogo', texto: 'Catálogo', icono: <IconoCatalogo /> },
          { a: '/equipo', texto: 'Equipo', icono: <IconoEquipo /> },
          { a: '/clientes', texto: 'Clientes', icono: <IconoClientes /> },
        ]

  return (
    <nav className="barra-inferior" aria-label="Secciones del panel">
      {destinos.map((d) => (
        <NavLink
          key={d.a}
          to={d.a}
          end={d.a === '/'}
          className={({ isActive }) => `barra-inferior__ir ${isActive ? 'es-actual' : ''}`}
        >
          {d.icono}
          <span>{d.texto}</span>
        </NavLink>
      ))}
    </nav>
  )
}
