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

/**
 * Info del local que el asistente contesta cuando alguien pregunta dónde
 * están, a qué hora abren o el teléfono. Vive en config.info (jsonb): todos
 * los campos son opcionales porque el dueño la va cargando de a poco.
 */
export interface InfoLocal {
  direccion?: string
  horarios?: string
  telefono?: string
  notas?: string
}

export interface ConfigNegocio {
  confirmacion?: Partial<Record<TipoCompromiso, 'humana' | 'automatica'>>
  hold_minutos?: number
  recordatorio_horas_antes?: number
  demoras_sugeridas?: number[]
  acepta_delivery?: boolean
  radio_delivery_km?: number
  info?: InfoLocal
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

export type ModoFiscal = 'homologacion' | 'produccion'

export interface ConfigFiscal {
  negocio_id: string
  cuit: string
  razon_social: string | null
  condicion: string | null
  punto_venta: number | null
  modo: ModoFiscal
  tiene_certificados: boolean
  actualizado_en: string | null
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
  /** Lo que lleva el plato: el asistente la usa para contestar "¿qué tiene la
   *  Doble bacon?". Vacía hasta que el dueño la carga. */
  descripcion: string | null
  duracion_min: number | null
  precio_base: Plata
  disponible: boolean
  activo: boolean
  /**
   * Porciones que quedan. `null` NO es cero: `null` es "este plato no lleva
   * cuenta" —ilimitado es el default— y `0` es "lleva cuenta y no queda". El
   * que confunde los dos apaga el plato equivocado o vende el que se terminó.
   *
   * De dónde sale el número lo decide el core, en este orden: receta → cupo
   * del día → ilimitado. Acá llega ya resuelto.
   */
  restante: number | null
  /** `restante === 0`. Viaja aparte para que nadie tenga que decidir de nuevo
   *  qué significa un cero, y para que un plato ilimitado diga `false`. */
  agotado: boolean
  /** Sólo viaja si el plato se controla por receta: su presencia ES la forma de
   *  saber que este plato lleva receta y no cupo a mano. */
  limitante?: InsumoLimitante
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

/** Una fila de la lista de clientes del negocio: la ficha básica más el resumen
 *  de su actividad. Alimenta la vista de Clientes de gastronomía. */
export interface ClienteResumen {
  id: string
  telefono: string
  nombre: string | null
  cobertura_id: string | null
  creado_en: string
  cantidad_pedidos: number
  total_acumulado: Plata
  ultimo_pedido: string | null
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
  /** Quién pidió: el nombre puede venir nulo (aún no lo dio), el teléfono no. */
  cliente_nombre: string | null
  cliente_telefono: string
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
  /**
   * El estado del cobro viene con el turno: sin esto la agenda haría un
   * GET /api/cobros/:id por cada turno completado, en cada refresco.
   * comprobante_estado es null si no se cobró, o si se cobró sin factura
   * (el negocio todavía no cargó sus datos de ARCA).
   */
  cobrado: boolean
  comprobante_estado: EstadoComprobante | null
}

/** Lo que la agenda ya sabe del cobro de un turno. */
export interface EstadoCobroTurno {
  cobrado: boolean
  comprobante_estado: EstadoComprobante | null
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

// ─── Lista de espera ─────────────────────────────────────────────────────────

/**
 * Un anotado en la cola del anti-ausentismo. El core resuelve el nombre del
 * cliente y el del servicio: acá no se cruzan ids con nada.
 * notificado_en marca que ya le ofrecieron un hueco liberado.
 */
export interface AnotadoEnEspera {
  id: string
  negocio_id: string
  cliente_id: string
  cliente_nombre: string | null
  cliente_telefono: string
  servicio_id: string
  servicio_nombre: string
  nota: string | null
  creado_en: string
  notificado_en: string | null
  compromiso_ofrecido_id: string | null
}

// ─── Cobro y factura ─────────────────────────────────────────────────────────
//
// Espejo de los DTO de E8/W4-A (core/internal/dto/cobro_dto.go). Los cinco
// medios son los del CHECK de la tabla `cobro`: si allá se agrega uno, entra
// acá y la botonera del popover lo muestra sola.

// ─── Stock: el cupo del día ──────────────────────────────────────────────────
//
// Espejo de dto.CupoResponse. `disponible` (el interruptor manual) y `agotado`
// (el cupo en cero) son dos motivos distintos por los que un plato no se vende,
// y la cocina necesita distinguirlos: el interruptor le gana al cupo.

export interface CupoStock {
  servicio_id: string
  servicio_nombre: string
  asignado: number
  consumido: number
  restante: number
  agotado: boolean
  disponible: boolean
}

// ─── Insumos: la materia prima ───────────────────────────────────────────────
//
// Espejo de los DTO de insumos y recetas. La diferencia con el cupo no es de
// detalle y define todo lo demás: el cupo es una foto del día y se reinicia al
// abrir la caja; el insumo es un saldo corriente del negocio y la carne que
// sobra hoy sigue estando mañana. Nada de esto cuelga de la jornada.
//
// La unidad la define el insumo y NADIE la convierte: no hay kg↔g ni l↔ml en
// ningún punto del sistema. Toda cantidad escrita contra un insumo —en una
// receta, en una compra, en un ajuste— va en ESTA unidad, y la pantalla la
// muestra siempre pegada al campo.

export type Unidad = 'g' | 'ml' | 'unidad'

export interface Insumo {
  id: string
  nombre: string
  unidad: Unidad
  stock: number
  /**
   * `null` es "no me avises", no "avisame siempre": un insumo sin mínimo
   * cargado NUNCA se marca, aunque quede en 1.
   */
  stock_minimo: number | null
  bajo_minimo: boolean
  activo: boolean
}

export type TipoMovimiento = 'compra' | 'consumo' | 'devolucion' | 'ajuste'

/**
 * Una línea de la historia del saldo. `cantidad` es SIEMPRE positiva: el signo
 * lo dice el tipo. Existe para poder contestar "compré 20 kg, ¿por qué me
 * quedan 3?", que es la primera pregunta que aparece cuando el sistema y la
 * heladera no coinciden.
 */
export interface MovimientoInsumo {
  id: string
  tipo: TipoMovimiento
  cantidad: number
  saldo_resultante: number
  /** El pedido que se lo llevó, cuando lo hubo. */
  compromiso_id: string | null
  motivo: string | null
  creado_en: string
}

/**
 * Una línea de receta como la manda el panel: cuánto de un insumo lleva UNA
 * porción del plato. No lleva unidad porque la unidad es del insumo y la receta
 * la hereda — ofrecer elegirla acá reintroduciría el error de conversión que
 * todo el módulo está diseñado para hacer imposible.
 */
export interface RecetaItem {
  insumo_id: string
  cantidad: number
}

/** Una línea de receta como vuelve del core: ya resuelta para mostrar, con el
 *  nombre del insumo, su unidad y cuánto hay de él ahora mismo. */
export interface LineaReceta {
  insumo_id: string
  insumo_nombre: string
  unidad: Unidad
  cantidad: number
  /** Cuánto hay de ese insumo hoy: al lado de lo que pide la receta se ve de
   *  una de dónde salen las porciones. */
  stock: number
}

/** La receta de un plato más lo que se deriva de ella. */
export interface Receta {
  servicio_id: string
  tiene_receta: boolean
  items: LineaReceta[]
  /** `null` cuando el plato no tiene receta. `null` NO es cero, igual que en el
   *  catálogo: una receta vacía deja el plato ilimitado, no agotado. */
  porciones: number | null
  /** Vacío cuando no hay receta. */
  insumo_limitante: string
  stock_limitante: number
  pide_la_receta: number
}

/**
 * Quién le fijó las porciones al plato: el insumo más escaso de su receta, con
 * su saldo y lo que la receta le pide por porción.
 *
 * Existe por una sola razón: un plato que se apaga solo y no dice por qué es
 * indistinguible de un bug, y el dueño lo resuelve apagando la feature entera.
 * Viaja también cuando el plato NO está agotado — es el que se va a quedar
 * corto primero.
 */
export interface InsumoLimitante {
  /** Nombre, no id: es para leer. */
  insumo: string
  /**
   * La unidad viaja pegada a los números y no se resuelve afuera. Sin ella
   * "quedan 2" es ambiguo, que es el riesgo de las unidades entrando por la
   * puerta de atrás: el panel tendría que cruzar el nombre contra la lista de
   * insumos, y ese cruce se rompe con dos insumos homónimos o con un rename
   * entre dos lecturas.
   */
  unidad: Unidad
  stock: number
  pide_la_receta: number
}

export type MedioPago = 'efectivo' | 'transferencia' | 'debito' | 'credito' | 'qr'

export type EstadoComprobante = 'pendiente' | 'emitido' | 'error'

export interface Comprobante {
  id: string
  estado: EstadoComprobante
  /** 11 = Factura C. Monotributo no discrimina IVA. */
  tipo_cbte: number
  punto_venta: number
  numero: number | null
  /** '0001-00000123', como sale impreso. Lo arma el core. */
  numero_formateado: string | null
  cae: string | null
  cae_vence: string | null
  importe: Plata
  intentos: number
  /** Texto crudo de ARCA. Va al soporte, jamás a la pantalla del mostrador. */
  ultimo_error: string | null
  emitido_en: string | null
}

export interface Cobro {
  id: string
  compromiso_id: string
  medio_pago: MedioPago
  monto: Plata
  cobrado_en: string
  /** null cuando el negocio todavía no cargó sus datos de ARCA. */
  comprobante: Comprobante | null
  /** Frase del core. El panel arma la suya, con la misma tabla de estados. */
  facturacion: string
}

// ─── Cierre del día ──────────────────────────────────────────────────────────

export interface CierreComprobantes {
  emitidos: number
  pendientes: number
  con_error: number
}

/**
 * Todo el día en un objeto: el core agrega en la timezone del negocio. Los dos
 * cortes vienen como mapa y sólo traen las claves que tuvieron movimiento.
 */
export interface Cierre {
  fecha: string
  timezone: string
  compromisos: number
  completados: number
  cancelados: number
  ausentes: number
  /** origen → cuántos compromisos. */
  por_origen: Partial<Record<OrigenCompromiso, number>>
  /**
   * Lo entregado del día (total de los completados), se haya cobrado o no.
   * Suele ser mayor que total_cobrado: un pedido se entrega sin pasar por caja.
   */
  vendido: Plata
  cobros: number
  total_cobrado: Plata
  ticket_promedio: Plata
  /** medio de pago → cuánta plata. */
  por_medio_pago: Partial<Record<MedioPago, Plata>>
  comprobantes: CierreComprobantes
}

// ─── Jornada: la caja del día ────────────────────────────────────────────────
//
// Espejo de core/internal/dto/jornada_dto.go. La jornada es el ciclo abrir →
// cerrar; los números del día los da el cierre, no la jornada.

export interface Jornada {
  id: string
  negocio_id: string
  abierta: boolean
  abierta_en: string
  cerrada_en: string | null
  abierta_por: string | null
  cerrada_por: string | null
}

/** GET /api/jornada/actual: abierta primero, la jornada null si está cerrada. */
export interface JornadaActual {
  abierta: boolean
  jornada: Jornada | null
}

// ─── Reportes por día ────────────────────────────────────────────────────────
//
// Espejo de core/internal/dto/reporte_dto.go. Una fila por día, ceros incluidos.

export type RangoReporte = 'semanal' | 'mensual'

export interface ReporteDia {
  fecha: string
  vendido: Plata
  cobrado: Plata
}

export interface Reporte {
  rango: RangoReporte
  desde: string
  hasta: string
  timezone: string
  dias: ReporteDia[]
  total_vendido: Plata
  total_cobrado: Plata
}

// ─── Consultas ───────────────────────────────────────────────────────────────
//
// Preguntas que el asistente no supo contestar (no estaban en la carta ni en
// los datos del local): en vez de inventar, las deja acá para que el dueño las
// responda. Al responder, el core le avisa al cliente por WhatsApp.

export type EstadoConsulta = 'pendiente' | 'respondida'

export interface Consulta {
  id: string
  negocio_id: string
  /** null si el cliente no quedó registrado; el teléfono siempre está. */
  cliente_id: string | null
  cliente_nombre: string | null
  telefono: string
  pregunta: string
  respuesta: string | null
  estado: EstadoConsulta
  creado_en: string
  respondida_en: string | null
}
