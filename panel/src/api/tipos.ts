/**
 * Espejo TS de core/internal/dto/*.go. Si un shape cambia allá, cambia acá.
 * La plata viaja como string (shopspring/decimal serializa con comillas):
 * nunca la convertimos a number salvo para mostrarla.
 */

export type Plata = string

export type Rol = 'admin' | 'dueno' | 'operador' | 'agente'

export type Vertical = 'salud' | 'gastronomia'

export type TipoCompromiso = 'pedido' | 'reserva' | 'turno'

export type OrigenCompromiso = 'whatsapp' | 'panel' | 'telefono'

export type TipoEntrega = 'retira' | 'delivery' | 'en_local'

export type TipoRecurso = 'profesional' | 'mesa' | 'cocina'

export type Estado =
  | 'pendiente'
  | 'confirmado'
  | 'en_curso'
  | 'listo'
  | 'completado'
  | 'rechazado'
  | 'cancelado'
  | 'ausente'

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface Usuario {
  id: string
  username: string
  rol: Rol
  negocio_id: string | null
  must_change_password: boolean
}

export interface Tokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  usuario: Usuario
}

// ─── Negocio ─────────────────────────────────────────────────────────────────

export interface CoberturaBreve {
  id: string
  nombre: string
}

export interface ConfigNegocio {
  confirmacion?: Partial<Record<TipoCompromiso, 'humana' | 'automatica'>>
  hold_minutos?: number
  recordatorio_horas_antes?: number
  demoras_sugeridas?: number[]
  acepta_delivery?: boolean
  radio_delivery_km?: number
}

export interface NegocioDatos {
  id: string
  nombre: string
  vertical: Vertical
  timezone: string
  config: ConfigNegocio
  coberturas: CoberturaBreve[]
}

export interface Negocio {
  id: string
  nombre: string
  vertical: Vertical
  timezone: string
  wa_phone_id: string | null
  wa_waba_id: string | null
  activo: boolean
  creado_en: string
}

export interface AltaNegocio {
  negocio_id: string
  nombre: string
  vertical: Vertical
  usuario_dueno: Usuario
  password_temporal: string
}

export interface TokenAgente {
  negocio_id: string
  token: string
  aviso: string
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

export interface Categoria {
  id: string
  negocio_id: string
  nombre: string
  orden: number
  activo: boolean
}

export interface Servicio {
  id: string
  negocio_id: string
  categoria_id: string | null
  nombre: string
  duracion_min: number | null
  precio_base: Plata
  disponible: boolean
  activo: boolean
}

export interface Recurso {
  id: string
  negocio_id: string
  tipo: TipoRecurso
  nombre: string
  capacidad: number
  activo: boolean
}

export interface Cobertura {
  id: string
  negocio_id: string
  nombre: string
}

export interface PrecioCobertura {
  servicio_id: string
  cobertura_id: string
  precio: Plata
  coseguro: Plata | null
}

// ─── Clientes ────────────────────────────────────────────────────────────────

export interface Cliente {
  id: string
  negocio_id: string
  telefono: string
  nombre: string | null
  cobertura_id: string | null
  creado_en: string
}

// ─── Horarios ────────────────────────────────────────────────────────────────

export interface Horario {
  id: string
  recurso_id: string
  dia_semana: number
  desde: string
  hasta: string
}

export interface Excepcion {
  id: string
  recurso_id: string
  desde: string
  hasta: string
  motivo: string | null
}

// ─── Compromisos ─────────────────────────────────────────────────────────────

export interface LineaCompromiso {
  id: string
  servicio_id: string
  cantidad: number
  precio_unit: Plata
  subtotal: Plata
  nota: string | null
}

export interface Compromiso {
  id: string
  negocio_id: string
  cliente_id: string
  recurso_id: string | null
  tipo: TipoCompromiso
  estado: Estado
  inicio: string | null
  fin: string | null
  demora_min: number | null
  entrega: TipoEntrega | null
  direccion: string | null
  total: Plata
  origen: OrigenCompromiso
  nota: string | null
  creado_en: string
  confirmado_en: string | null
  cerrado_en: string | null
  lineas: LineaCompromiso[]
}

export interface TransicionarInput {
  estado: Estado
  demora_min?: number
  recurso_id?: string
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

export interface FranjaHoraria {
  desde: string
  hasta: string
}

export interface TurnoAgenda {
  compromiso_id: string
  inicio: string
  fin: string | null
  tipo: TipoCompromiso
  estado: Estado
  cliente_id: string
  cliente_nombre: string | null
  cliente_telefono: string
  total: Plata
  nota: string | null
}

export interface AgendaRecurso {
  recurso_id: string
  recurso_nombre: string
  horarios: FranjaHoraria[]
  turnos: TurnoAgenda[]
}

export interface Agenda {
  fecha: string
  timezone: string
  recursos: AgendaRecurso[]
  sin_recurso: TurnoAgenda[]
}
