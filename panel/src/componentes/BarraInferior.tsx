/**
 * Navegación tablet-first: íconos grandes, siempre abajo y a mano del pulgar.
 * La pantalla operativa no tiene más chrome que esto. El cierre del día entró
 * como quinto destino (E8): es la otra pantalla que el dueño abre solo, y por
 * eso al operador no le aparece (docs/PANEL.md → Roles). La lista de espera no
 * está acá: se entra desde el hueco libre de la agenda, que es cuando importa
 * (DESIGN.md). Llegó a estar como sexto destino y se sacó: sin nadie usando la
 * cola todavía, era una pestaña que no se tocaba nunca.
 */

import { NavLink } from 'react-router-dom'
import { rolVePlata, useSesion } from '../contexto'
import type { Rol } from '../api/tipos'
import { BotonTema } from './BotonTema'

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

function IconoComanda() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
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

function IconoLocal() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5v10.5h16V9.5M4 9.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M9.5 20v-5h5v5" />
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

function IconoCierre() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M6 3h12v18l-2.4-1.6L13.2 21 12 19.8 10.8 21 8.4 19.4 6 21z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </svg>
  )
}

function IconoStock() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  )
}

function IconoSitio() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...trazo}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z" />
    </svg>
  )
}

/**
 * La landing vive en la raíz del mismo servidor (el panel está en /panel/,
 * ver nginx.conf). En `npm run dev` cada una corre en su puerto, como hace el
 * botón "Ingresar" de la landing al revés.
 */
const URL_SITIO = import.meta.env.DEV ? 'http://localhost:5173/' : '/'

function IconoAdmin() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" {...trazo}>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
}

export function BarraInferior({ rol }: Props) {
  const { negocio } = useSesion()
  const gastro = negocio?.vertical === 'gastronomia'
  const delNegocio = [
    { a: '/', texto: gastro ? 'Pedidos' : 'Agenda', icono: <IconoAgenda /> },
    ...(gastro ? [{ a: '/comanda', texto: 'Comanda', icono: <IconoComanda /> }] : []),
    { a: '/catalogo', texto: gastro ? 'Carta' : 'Catálogo', icono: <IconoCatalogo /> },
    // El cupo del día es de gastronomía: un consultorio no se queda sin
    // porciones de nada, su límite es la agenda.
    ...(gastro ? [{ a: '/stock', texto: 'Stock', icono: <IconoStock /> }] : []),
    {
      a: '/equipo',
      texto: gastro ? 'El local' : 'Equipo',
      icono: gastro ? <IconoLocal /> : <IconoEquipo />,
    },
    { a: '/clientes', texto: 'Clientes', icono: <IconoClientes /> },
  ]
  if (rolVePlata(rol)) {
    delNegocio.push({ a: '/cierre', texto: 'Cierre', icono: <IconoCierre /> })
  }

  const destinos =
    rol === 'admin' ? [{ a: '/admin', texto: 'Negocios', icono: <IconoAdmin /> }] : delNegocio

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
      {/* Volver al sitio sin cerrar sesión: es un enlace común (fuera del
          router), con el mismo formato que el botón del tema. */}
      <a className="barra-inferior__tema" href={URL_SITIO} aria-label="Ir al sitio de BlendBot" title="Ir al sitio">
        <IconoSitio />
      </a>
      <BotonTema />
    </nav>
  )
}
