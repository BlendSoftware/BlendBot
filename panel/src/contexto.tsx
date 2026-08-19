/**
 * Quién está adentro y en qué negocio. El rol y el negocio salen del JWT, no
 * de un estado paralelo: si el token no lo dice, no existe.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { alCambiarSesion, leerClaims } from './api/sesion'
import type { Claims } from './api/sesion'
import { datosDelNegocio } from './api/endpoints'
import type { NegocioDatos } from './api/tipos'

export const DEMORAS_POR_DEFECTO = [15, 25, 40]

interface Sesion {
  claims: Claims | null
  negocio: NegocioDatos | null
  demorasSugeridas: number[]
  recargarNegocio: () => void
}

const Ctx = createContext<Sesion>({
  claims: null,
  negocio: null,
  demorasSugeridas: DEMORAS_POR_DEFECTO,
  recargarNegocio: () => {},
})

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<Claims | null>(() => leerClaims())
  const [negocio, setNegocio] = useState<NegocioDatos | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => alCambiarSesion(() => setClaims(leerClaims())), [])

  useEffect(() => {
    let vivo = true
    if (!claims || claims.rol === 'admin' || !claims.negocio_id) {
      setNegocio(null)
      return
    }
    datosDelNegocio()
      .then((n) => {
        if (vivo) setNegocio(n)
      })
      .catch(() => {
        if (vivo) setNegocio(null)
      })
    return () => {
      vivo = false
    }
  }, [claims, version])

  const valor = useMemo<Sesion>(
    () => ({
      claims,
      negocio,
      demorasSugeridas: negocio?.config?.demoras_sugeridas?.length
        ? negocio.config.demoras_sugeridas
        : DEMORAS_POR_DEFECTO,
      recargarNegocio: () => setVersion((v) => v + 1),
    }),
    [claims, negocio],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useSesion(): Sesion {
  return useContext(Ctx)
}
