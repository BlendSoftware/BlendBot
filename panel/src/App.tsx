import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { BarraInferior } from './componentes/BarraInferior'
import { ProveedorSesion, rolVePlata, useSesion } from './contexto'
import { cambioPendiente } from './api/sesion'
import { Login } from './vistas/Login'
import { CambiarPassword } from './vistas/CambiarPassword'
import { Tablero } from './vistas/Tablero'
import { Comanda } from './vistas/Comanda'
import { Catalogo } from './vistas/Catalogo'
import { Equipo } from './vistas/Equipo'
import { Clientes } from './vistas/Clientes'
import { ListaEspera } from './vistas/ListaEspera'
import { Cierre } from './vistas/Cierre'
import { Admin } from './vistas/Admin'

/**
 * El guard: sin token no se entra; con contraseña temporal sin cambiar no se
 * pasa de la pantalla de cambio; el admin de la plataforma no tiene agenda y
 * el negocio no tiene alta de negocios.
 *
 * `soloDueno` es la puerta de la plata: el cierre del día es del dueño y un
 * operador que escribe /cierre a mano vuelve a la agenda, sin cartel de reto.
 * Esto es comodidad y prolijidad, no seguridad: la que manda es la del core.
 */
function Protegida({
  children,
  soloAdmin = false,
  soloDueno = false,
}: {
  children: ReactNode
  soloAdmin?: boolean
  soloDueno?: boolean
}) {
  const { claims } = useSesion()
  const lugar = useLocation()

  if (!claims) return <Navigate to="/login" replace state={{ desde: lugar.pathname }} />

  if (cambioPendiente() && lugar.pathname !== '/cambiar-password') {
    return <Navigate to="/cambiar-password" replace />
  }

  // Cambiar la contraseña es de cualquiera con sesión: ni el admin de la
  // plataforma ni el negocio quedan afuera de esta, aunque no sea "la suya".
  if (lugar.pathname === '/cambiar-password') return <>{children}</>

  const esAdmin = claims.rol === 'admin'
  if (soloAdmin && !esAdmin) return <Navigate to="/" replace />
  if (!soloAdmin && esAdmin) return <Navigate to="/admin" replace />
  if (soloDueno && !rolVePlata(claims.rol)) return <Navigate to="/" replace />

  return <>{children}</>
}

function Marco() {
  const { claims } = useSesion()
  return (
    <div className="marco">
      <main className="marco__cuerpo">
        <Outlet />
      </main>
      {claims && <BarraInferior rol={claims.rol} />}
    </div>
  )
}

export function Rutas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/cambiar-password"
        element={
          <Protegida>
            <CambiarPassword />
          </Protegida>
        }
      />
      <Route element={<Marco />}>
        <Route
          index
          element={
            <Protegida>
              <Tablero />
            </Protegida>
          }
        />
        <Route
          path="/comanda"
          element={
            <Protegida>
              <Comanda />
            </Protegida>
          }
        />
        <Route
          path="/catalogo"
          element={
            <Protegida>
              <Catalogo />
            </Protegida>
          }
        />
        <Route
          path="/equipo"
          element={
            <Protegida>
              <Equipo />
            </Protegida>
          }
        />
        <Route
          path="/clientes"
          element={
            <Protegida>
              <Clientes />
            </Protegida>
          }
        />
        <Route
          path="/lista-espera"
          element={
            <Protegida>
              <ListaEspera />
            </Protegida>
          }
        />
        <Route
          path="/cierre"
          element={
            <Protegida soloDueno>
              <Cierre />
            </Protegida>
          }
        />
        <Route
          path="/admin"
          element={
            <Protegida soloAdmin>
              <Admin />
            </Protegida>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <ProveedorSesion>
      <Rutas />
    </ProveedorSesion>
  )
}
