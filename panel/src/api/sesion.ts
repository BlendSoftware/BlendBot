/**
 * La sesión vive en memoria y se respalda en localStorage para sobrevivir un
 * F5. El rol y el negocio salen del payload del JWT, no de un estado aparte:
 * lo que manda es el token.
 */

import type { Rol } from './tipos'

const CLAVE_ACCESO = 'copiloto.acceso'
const CLAVE_REFRESH = 'copiloto.refresh'
const CLAVE_CAMBIO = 'copiloto.cambio-pendiente'

export interface Claims {
  user_id: string
  username: string
  rol: Rol
  negocio_id: string
  type: string
  exp?: number
}

let acceso: string | null = null
let refresco: string | null = null
let hidratada = false

const oyentes = new Set<() => void>()

function almacen(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function hidratar(): void {
  if (hidratada) return
  hidratada = true
  const s = almacen()
  if (!s) return
  acceso = s.getItem(CLAVE_ACCESO)
  refresco = s.getItem(CLAVE_REFRESH)
}

export function tokenAcceso(): string | null {
  hidratar()
  return acceso
}

export function tokenRefresco(): string | null {
  hidratar()
  return refresco
}

export function guardarSesion(tokens: { access_token: string; refresh_token: string }): void {
  hidratar()
  acceso = tokens.access_token
  refresco = tokens.refresh_token
  const s = almacen()
  if (s) {
    s.setItem(CLAVE_ACCESO, acceso)
    s.setItem(CLAVE_REFRESH, refresco)
  }
  avisar()
}

export function cerrarSesion(): void {
  hidratar()
  acceso = null
  refresco = null
  const s = almacen()
  if (s) {
    s.removeItem(CLAVE_ACCESO)
    s.removeItem(CLAVE_REFRESH)
    s.removeItem(CLAVE_CAMBIO)
  }
  avisar()
}

export function alCambiarSesion(fn: () => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

function avisar(): void {
  for (const fn of oyentes) fn()
}

/** Decodifica el payload del JWT. Sin librería: es base64url y nada más. */
export function leerClaims(token: string | null = tokenAcceso()): Claims | null {
  if (!token) return null
  const partes = token.split('.')
  const carga = partes[1]
  if (partes.length !== 3 || !carga) return null
  try {
    const base64 = carga.replace(/-/g, '+').replace(/_/g, '/')
    const relleno = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const binario = atob(relleno)
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0))
    const texto = new TextDecoder().decode(bytes)
    const datos = JSON.parse(texto) as Partial<Claims>
    if (!datos.rol) return null
    return {
      user_id: datos.user_id ?? '',
      username: datos.username ?? '',
      rol: datos.rol,
      negocio_id: datos.negocio_id ?? '',
      type: datos.type ?? 'access',
      ...(datos.exp === undefined ? {} : { exp: datos.exp }),
    }
  } catch {
    return null
  }
}

export function haySesion(): boolean {
  return leerClaims() !== null
}

/**
 * El alta de negocio entrega una contraseña temporal: hasta que la cambien,
 * el panel no los deja seguir. El dato viene en la respuesta del login, no en
 * el token, así que se anota acá para sobrevivir un F5.
 */
export function marcarCambioPendiente(pendiente: boolean): void {
  const s = almacen()
  if (!s) return
  if (pendiente) s.setItem(CLAVE_CAMBIO, '1')
  else s.removeItem(CLAVE_CAMBIO)
}

export function cambioPendiente(): boolean {
  return almacen()?.getItem(CLAVE_CAMBIO) === '1'
}

/** Sólo para tests: devuelve el módulo a su estado inicial. */
export function reiniciarSesionParaTests(): void {
  acceso = null
  refresco = null
  hidratada = false
  oyentes.clear()
}
