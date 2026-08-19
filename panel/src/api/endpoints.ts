/** Un nombre por ruta del core. Nadie llama a `pedir` fuera de acá. */

import { pedir } from './cliente'
import { cerrarSesion, guardarSesion } from './sesion'
import type {
  Agenda,
  AltaNegocio,
  Categoria,
  Cliente,
  Cobertura,
  Compromiso,
  Estado,
  Excepcion,
  Horario,
  Negocio,
  NegocioDatos,
  Plata,
  PrecioCobertura,
  Recurso,
  Servicio,
  TokenAgente,
  Tokens,
  TransicionarInput,
  Vertical,
} from './tipos'

// ─── Sesión ──────────────────────────────────────────────────────────────────

export async function entrar(username: string, password: string): Promise<Tokens> {
  const tokens = await pedir<Tokens>('/api/auth/login', {
    metodo: 'POST',
    cuerpo: { username, password },
    publica: true,
  })
  guardarSesion(tokens)
  return tokens
}

export async function salir(): Promise<void> {
  try {
    await pedir<void>('/api/auth/logout', { metodo: 'POST' })
  } finally {
    cerrarSesion()
  }
}

export function cambiarPassword(passwordNueva: string): Promise<{ mensaje: string }> {
  return pedir<{ mensaje: string }>('/api/auth/cambiar-password', {
    metodo: 'POST',
    cuerpo: { password_nueva: passwordNueva },
  })
}

// ─── Negocio ─────────────────────────────────────────────────────────────────

export function datosDelNegocio(): Promise<NegocioDatos> {
  return pedir<NegocioDatos>('/api/negocio')
}

// ─── Agenda y compromisos ────────────────────────────────────────────────────

export function traerAgenda(fecha: string): Promise<Agenda> {
  return pedir<Agenda>(`/api/agenda?fecha=${encodeURIComponent(fecha)}`)
}

export function listarCompromisos(filtro: {
  estados?: Estado[]
  desde?: string
  hasta?: string
}): Promise<Compromiso[]> {
  const q = new URLSearchParams()
  if (filtro.estados?.length) q.set('estado', filtro.estados.join(','))
  if (filtro.desde) q.set('desde', filtro.desde)
  if (filtro.hasta) q.set('hasta', filtro.hasta)
  const cola = q.toString()
  return pedir<Compromiso[]>(`/api/compromisos${cola ? `?${cola}` : ''}`)
}

export function transicionar(id: string, input: TransicionarInput): Promise<Compromiso> {
  return pedir<Compromiso>(`/api/compromisos/${id}/estado`, {
    metodo: 'PATCH',
    cuerpo: input,
  })
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

export function listarServicios(opciones: { incluirInactivos?: boolean } = {}): Promise<Servicio[]> {
  const cola = opciones.incluirInactivos ? '?incluir_inactivos=true' : ''
  return pedir<Servicio[]>(`/api/servicios${cola}`)
}

export function crearServicio(cuerpo: {
  nombre: string
  categoria_id?: string | null
  duracion_min?: number | null
  precio_base?: Plata
}): Promise<Servicio> {
  return pedir<Servicio>('/api/servicios', { metodo: 'POST', cuerpo })
}

export function actualizarServicio(
  id: string,
  cuerpo: Partial<{
    nombre: string
    categoria_id: string | null
    duracion_min: number | null
    precio_base: Plata
    disponible: boolean
    activo: boolean
  }>,
): Promise<Servicio> {
  return pedir<Servicio>(`/api/servicios/${id}`, { metodo: 'PATCH', cuerpo })
}

export function setDisponible(
  id: string,
  disponible: boolean,
): Promise<{ id: string; disponible: boolean }> {
  return pedir<{ id: string; disponible: boolean }>(`/api/servicios/${id}/disponible`, {
    metodo: 'PATCH',
    cuerpo: { disponible },
  })
}

export function listarPrecios(servicioID: string): Promise<PrecioCobertura[]> {
  return pedir<PrecioCobertura[]>(`/api/servicios/${servicioID}/precios`)
}

export function fijarPrecio(
  servicioID: string,
  cuerpo: { cobertura_id: string; precio: Plata; coseguro?: Plata | null },
): Promise<PrecioCobertura> {
  return pedir<PrecioCobertura>(`/api/servicios/${servicioID}/precios`, {
    metodo: 'PUT',
    cuerpo,
  })
}

export function listarCategorias(): Promise<Categoria[]> {
  return pedir<Categoria[]>('/api/categorias')
}

export function crearCategoria(nombre: string, orden = 0): Promise<Categoria> {
  return pedir<Categoria>('/api/categorias', { metodo: 'POST', cuerpo: { nombre, orden } })
}

export function actualizarCategoria(
  id: string,
  cuerpo: Partial<{ nombre: string; orden: number; activo: boolean }>,
): Promise<Categoria> {
  return pedir<Categoria>(`/api/categorias/${id}`, { metodo: 'PATCH', cuerpo })
}

export function listarCoberturas(): Promise<Cobertura[]> {
  return pedir<Cobertura[]>('/api/coberturas')
}

export function crearCobertura(nombre: string): Promise<Cobertura> {
  return pedir<Cobertura>('/api/coberturas', { metodo: 'POST', cuerpo: { nombre } })
}

// ─── Equipo ──────────────────────────────────────────────────────────────────

export function listarRecursos(): Promise<Recurso[]> {
  return pedir<Recurso[]>('/api/recursos')
}

export function crearRecurso(cuerpo: {
  tipo: Recurso['tipo']
  nombre: string
  capacidad?: number
}): Promise<Recurso> {
  return pedir<Recurso>('/api/recursos', { metodo: 'POST', cuerpo })
}

export function actualizarRecurso(
  id: string,
  cuerpo: Partial<{ nombre: string; tipo: Recurso['tipo']; capacidad: number; activo: boolean }>,
): Promise<Recurso> {
  return pedir<Recurso>(`/api/recursos/${id}`, { metodo: 'PATCH', cuerpo })
}

export function listarHorarios(recursoID: string): Promise<Horario[]> {
  return pedir<Horario[]>(`/api/recursos/${recursoID}/horarios`)
}

export function crearHorario(
  recursoID: string,
  cuerpo: { dia_semana: number; desde: string; hasta: string },
): Promise<Horario> {
  return pedir<Horario>(`/api/recursos/${recursoID}/horarios`, { metodo: 'POST', cuerpo })
}

export function borrarHorario(recursoID: string, horarioID: string): Promise<void> {
  return pedir<void>(`/api/recursos/${recursoID}/horarios/${horarioID}`, { metodo: 'DELETE' })
}

export function listarExcepciones(recursoID: string): Promise<Excepcion[]> {
  return pedir<Excepcion[]>(`/api/recursos/${recursoID}/excepciones`)
}

export function crearExcepcion(
  recursoID: string,
  cuerpo: { desde: string; hasta: string; motivo?: string | null },
): Promise<Excepcion> {
  return pedir<Excepcion>(`/api/recursos/${recursoID}/excepciones`, { metodo: 'POST', cuerpo })
}

export function borrarExcepcion(recursoID: string, excepcionID: string): Promise<void> {
  return pedir<void>(`/api/recursos/${recursoID}/excepciones/${excepcionID}`, { metodo: 'DELETE' })
}

// ─── Clientes ────────────────────────────────────────────────────────────────

export function clientePorTelefono(telefono: string): Promise<Cliente> {
  return pedir<Cliente>(`/api/clientes/por-telefono/${encodeURIComponent(telefono)}`)
}

export function crearCliente(cuerpo: {
  telefono: string
  nombre?: string | null
  cobertura_id?: string | null
  documento?: string | null
  notas?: string | null
}): Promise<Cliente> {
  return pedir<Cliente>('/api/clientes', { metodo: 'POST', cuerpo })
}

export function actualizarCliente(
  id: string,
  cuerpo: Partial<{
    nombre: string | null
    cobertura_id: string | null
    documento: string | null
    notas: string | null
  }>,
): Promise<Cliente> {
  return pedir<Cliente>(`/api/clientes/${id}`, { metodo: 'PATCH', cuerpo })
}

// ─── Admin de la plataforma ──────────────────────────────────────────────────

export function listarNegocios(): Promise<Negocio[]> {
  return pedir<Negocio[]>('/api/admin/negocios')
}

export function altaNegocio(cuerpo: {
  nombre: string
  vertical: Vertical
  usuario_dueno: string
  timezone?: string
  wa_phone_id?: string | null
}): Promise<AltaNegocio> {
  return pedir<AltaNegocio>('/api/admin/negocios', { metodo: 'POST', cuerpo })
}

export function actualizarNegocio(
  id: string,
  cuerpo: Partial<{ nombre: string; timezone: string; wa_phone_id: string | null; activo: boolean }>,
): Promise<Negocio> {
  return pedir<Negocio>(`/api/admin/negocios/${id}`, { metodo: 'PATCH', cuerpo })
}

export function rotarTokenAgente(negocioID: string): Promise<TokenAgente> {
  return pedir<TokenAgente>(`/api/admin/negocios/${negocioID}/token-agente`, { metodo: 'POST' })
}
