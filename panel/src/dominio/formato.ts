/**
 * Formato para pantalla. Las horas se leen del string RFC3339 tal cual vino:
 * el core ya las mandó en la hora del negocio y hacer aritmética de husos en
 * el navegador es la forma más fácil de mostrar un turno una hora corrido.
 */

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const PESOS_CON_CENTAVOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function plata(valor: string | number | null | undefined): string {
  const n = typeof valor === 'number' ? valor : Number(valor ?? 0)
  if (!Number.isFinite(n)) return '$0'
  return Number.isInteger(n) ? PESOS.format(n) : PESOS_CON_CENTAVOS.format(n)
}

/** '2026-08-21T09:30:00-03:00' → '09:30'. Sin conversión de huso. */
export function horaDe(rfc3339: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(rfc3339)
  return m ? `${m[1]}:${m[2]}` : ''
}

/** Minutos desde la medianoche de esa fecha, leyendo el string. */
export function minutosDe(rfc3339: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(rfc3339)
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

/** '09:30' o '09:30:00' → 570 */
export function minutosDeHHMM(hhmm: string): number {
  const partes = hhmm.split(':')
  const h = Number(partes[0] ?? 0)
  const mm = Number(partes[1] ?? 0)
  return h * 60 + mm
}

export function hhmmDeMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = Math.round(minutos % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function duracionCorta(minutos: number): string {
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

/**
 * Offset de una zona IANA en una fecha dada, como '-03:00'. Se calcula con
 * Intl y no a mano: el offset depende del día (horario de verano) y de la zona.
 */
function offsetDe(tz: string, diaISO: string): string {
  try {
    const instante = new Date(`${diaISO}T12:00:00Z`)
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(instante)
    const nombre = partes.find((p) => p.type === 'timeZoneName')?.value ?? ''
    const m = /GMT([+-]\d{2}:\d{2})/.exec(nombre)
    if (m?.[1]) return m[1]
    if (nombre === 'GMT') return '+00:00'
  } catch {
    // Zona desconocida para el navegador: mejor el offset local que romper.
  }
  const min = -new Date(`${diaISO}T12:00:00`).getTimezoneOffset()
  const signo = min < 0 ? '-' : '+'
  const abs = Math.abs(min)
  return `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/**
 * Medianoche de ese día EN LA ZONA DEL NEGOCIO, como RFC3339.
 *
 * `new Date('2026-08-21T00:00:00')` se interpreta en la zona del NAVEGADOR: el
 * dueño cargando una ausencia desde otro huso (o desde un celular con la zona
 * mal puesta) la guardaba corrida varias horas.
 */
export function inicioDelDiaEnZona(diaISO: string, tz: string): string {
  return `${diaISO}T00:00:00${offsetDe(tz, diaISO)}`
}

/**
 * Fin de ese día en la zona del negocio: la medianoche del día SIGUIENTE.
 *
 * Los rangos del core son semiabiertos [desde, hasta), así que 00:00 del día
 * siguiente cubre el día entero sin invadirlo. Cerrar a las 23:59 —como se
 * hacía— dejaba el último minuto afuera: un turno a las 23:59:30 se colaba
 * dentro de una ausencia cargada (H12).
 */
export function finDelDiaEnZona(diaISO: string, tz: string): string {
  const siguiente = sumarDias(diaISO, 1)
  return `${siguiente}T00:00:00${offsetDe(tz, siguiente)}`
}

export function fechaISO(d: Date = new Date()): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

export function hoyISO(): string {
  return fechaISO(new Date())
}

export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const fecha = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
  fecha.setDate(fecha.getDate() + dias)
  return fechaISO(fecha)
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** '2026-08-21' → 'viernes 21 de agosto' */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const fecha = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
  return `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
}

/** '2026-08-21' → 'vie 21/8' */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const fecha = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
  return `${DIAS_CORTOS[fecha.getDay()]} ${fecha.getDate()}/${fecha.getMonth() + 1}`
}

export function esHoy(iso: string): boolean {
  return iso === hoyISO()
}

/** Nombre para mostrar cuando el cliente todavía no dijo cómo se llama. */
export function nombreVisible(nombre: string | null, telefono: string): string {
  if (nombre && nombre.trim()) return nombre.trim()
  const cola = telefono.replace(/\D/g, '').slice(-4)
  return cola ? `Sin nombre (${cola})` : 'Sin nombre'
}

export function telefonoVisible(telefono: string): string {
  const n = telefono.replace(/\D/g, '')
  if (n.length < 8) return telefono
  return `${n.slice(0, -6)} ${n.slice(-6, -4)} ${n.slice(-4)}`.trim()
}
