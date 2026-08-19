/**
 * Cliente HTTP del panel. Tres responsabilidades y nada más:
 * pegarle al core con el JWT, renovar el token UNA vez ante un 401,
 * y traducir cualquier falla a una frase que la secretaria entienda.
 */

import { cerrarSesion, guardarSesion, tokenAcceso, tokenRefresco } from './sesion'
import type { Tokens } from './tipos'

export const BASE: string =
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? ''

export class ErrorApi extends Error {
  readonly estado: number
  readonly detalle: string

  constructor(estado: number, detalle: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.estado = estado
    this.detalle = detalle
  }
}

/**
 * El único lugar donde se decide qué lee una persona. El texto del servidor
 * nunca se muestra: dice "transicion de estado invalida" y eso no le sirve
 * a nadie del otro lado del mostrador.
 */
export function mensajeHumano(estado: number, detalle: string): string {
  const d = detalle.toLowerCase()
  if (estado === 0) return 'No hay conexión con el servidor. Probá de nuevo en un momento.'
  if (estado === 401) return 'Tu sesión se venció. Entrá de nuevo.'
  if (estado === 403) return 'Con este usuario no se puede hacer eso.'
  if (estado === 404) return 'Eso ya no está.'
  if (estado === 409) {
    if (d.includes('ocupad') || d.includes('solap')) return 'Ese horario se acaba de ocupar.'
    // "el compromiso ya fue cobrado" (ErrYaCobrado) vs "solo se puede cobrar un
    // compromiso completado" (ErrNoCobrable): los dos son 409 y quieren decir
    // cosas distintas del otro lado del mostrador.
    if (d.includes('cobrad')) return 'Este turno ya lo cobraron.'
    if (d.includes('cobrar')) return 'Para cobrarlo, primero marcá el turno como terminado.'
    return 'Alguien lo movió antes que vos. Actualizá la pantalla.'
  }
  if (estado === 422) {
    if (d.includes('medio de pago')) return 'Elegí de nuevo con qué te pagaron.'
    return 'Ese servicio está apagado en el catálogo.'
  }
  if (estado === 503) return 'Ese servicio no está disponible ahora. Probá más tarde.'
  if (estado === 429) return 'Muchas cosas juntas. Esperá un segundo y repetí.'
  if (estado >= 500) return 'El sistema no está respondiendo. Probá de nuevo.'
  return 'Revisá los datos: algo no quedó bien cargado.'
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  cuerpo?: unknown
  /** true en login y refresh: no llevan token ni intentan renovarlo. */
  publica?: boolean
}

let renovacionEnVuelo: Promise<boolean> | null = null

/** Renueva el access token. Una sola llamada aunque la disparen diez pedidos. */
async function renovar(): Promise<boolean> {
  if (renovacionEnVuelo) return renovacionEnVuelo
  const refresh = tokenRefresco()
  if (!refresh) return false

  renovacionEnVuelo = (async () => {
    try {
      const resp = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!resp.ok) return false
      const tokens = (await resp.json()) as Tokens
      guardarSesion(tokens)
      return true
    } catch {
      return false
    } finally {
      renovacionEnVuelo = null
    }
  })()

  return renovacionEnVuelo
}

async function ejecutar(ruta: string, o: Opciones): Promise<Response> {
  const cabeceras: Record<string, string> = {}
  if (o.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
  if (!o.publica) {
    const t = tokenAcceso()
    if (t) cabeceras.Authorization = `Bearer ${t}`
  }
  return fetch(`${BASE}${ruta}`, {
    method: o.metodo ?? 'GET',
    headers: cabeceras,
    ...(o.cuerpo === undefined ? {} : { body: JSON.stringify(o.cuerpo) }),
  })
}

async function detalleDe(resp: Response): Promise<string> {
  try {
    const cuerpo = (await resp.json()) as { detail?: string }
    return cuerpo?.detail ?? ''
  } catch {
    return ''
  }
}

export async function pedir<T>(ruta: string, o: Opciones = {}): Promise<T> {
  let resp: Response
  try {
    resp = await ejecutar(ruta, o)
  } catch {
    throw new ErrorApi(0, 'red', mensajeHumano(0, ''))
  }

  // Un solo reintento: si después de renovar sigue en 401, la sesión murió.
  if (resp.status === 401 && !o.publica) {
    const renovado = await renovar()
    if (!renovado) {
      cerrarSesion()
      throw new ErrorApi(401, 'sesion', mensajeHumano(401, ''))
    }
    try {
      resp = await ejecutar(ruta, o)
    } catch {
      throw new ErrorApi(0, 'red', mensajeHumano(0, ''))
    }
    if (resp.status === 401) {
      cerrarSesion()
      throw new ErrorApi(401, 'sesion', mensajeHumano(401, ''))
    }
  }

  if (!resp.ok) {
    const detalle = await detalleDe(resp)
    throw new ErrorApi(resp.status, detalle, mensajeHumano(resp.status, detalle))
  }

  if (resp.status === 204) return undefined as T
  const texto = await resp.text()
  if (!texto) return undefined as T
  return JSON.parse(texto) as T
}

/** Sólo para tests: descarta una renovación a medio camino. */
export function reiniciarClienteParaTests(): void {
  renovacionEnVuelo = null
}
