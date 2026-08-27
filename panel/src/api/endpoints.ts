/** Un nombre por ruta del core. Nadie llama a `pedir` fuera de acá. */

import { pedir } from './cliente'
import { cerrarSesion, guardarSesion } from './sesion'
import type {
  Agenda,
  AltaNegocio,
  AnotadoEnEspera,
  Categoria,
  Cierre,
  Cliente,
  ClienteResumen,
  Cobertura,
  Cobro,
  Compromiso,
  CupoStock,
  ConfigFiscal,
  Consulta,
  Estado,
  EstadoConsulta,
  Excepcion,
  Horario,
  InfoLocal,
  Insumo,
  Jornada,
  JornadaActual,
  MedioPago,
  ModoFiscal,
  MovimientoInsumo,
  Negocio,
  NegocioDatos,
  Plata,
  PrecioCobertura,
  RangoReporte,
  Receta,
  RecetaItem,
  Recurso,
  Reporte,
  Servicio,
  TokenAgente,
  Tokens,
  TransicionarInput,
  Unidad,
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

/** Guarda la info del local (dirección, horarios, teléfono, notas). El core
 *  mergea en config.info: mandá sólo lo que cambió, no pisa el resto. */
export function guardarInfoLocal(info: InfoLocal): Promise<NegocioDatos> {
  return pedir<NegocioDatos>('/api/negocio', { metodo: 'PATCH', cuerpo: { info } })
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

/** Un compromiso solo, con sus líneas: lo que el comprobante detalla. */
export function traerCompromiso(id: string): Promise<Compromiso> {
  return pedir<Compromiso>(`/api/compromisos/${id}`)
}

export function transicionar(id: string, input: TransicionarInput): Promise<Compromiso> {
  return pedir<Compromiso>(`/api/compromisos/${id}/estado`, {
    metodo: 'PATCH',
    cuerpo: input,
  })
}

// ─── Lista de espera ─────────────────────────────────────────────────────────

/** Sin filtro trae la cola entera; `pendientes` deja sólo a los que todavía no
 *  recibieron una oferta. */
export function listarListaEspera(
  filtro: { servicioID?: string; soloPendientes?: boolean } = {},
): Promise<AnotadoEnEspera[]> {
  const q = new URLSearchParams()
  if (filtro.servicioID) q.set('servicio_id', filtro.servicioID)
  if (filtro.soloPendientes) q.set('pendientes', 'true')
  const cola = q.toString()
  return pedir<AnotadoEnEspera[]>(`/api/lista-espera${cola ? `?${cola}` : ''}`)
}

export function anotarEnListaEspera(cuerpo: {
  cliente_id: string
  servicio_id: string
  nota?: string | null
}): Promise<AnotadoEnEspera> {
  return pedir<AnotadoEnEspera>('/api/lista-espera', { metodo: 'POST', cuerpo })
}

export function quitarDeListaEspera(id: string): Promise<void> {
  return pedir<void>(`/api/lista-espera/${id}`, { metodo: 'DELETE' })
}

// ─── Cobro y cierre del día ──────────────────────────────────────────────────

export function cobrar(compromisoID: string, medioPago: MedioPago): Promise<Cobro> {
  return pedir<Cobro>('/api/cobros', {
    metodo: 'POST',
    cuerpo: { compromiso_id: compromisoID, medio_pago: medioPago },
  })
}

/** 404 cuando todavía no se cobró: quien llama decide si eso es un problema. */
export function traerCobro(compromisoID: string): Promise<Cobro> {
  return pedir<Cobro>(`/api/cobros/${compromisoID}`)
}

export function traerCierre(fecha: string): Promise<Cierre> {
  return pedir<Cierre>(`/api/cierre?fecha=${encodeURIComponent(fecha)}`)
}

// ─── Stock: el cupo del día ──────────────────────────────────────────────────
//
// Todo cuelga de la jornada abierta: sin caja abierta el core contesta 409, y
// la pantalla lo dice en criollo en vez de mostrar una lista vacía.

export function listarStock(): Promise<CupoStock[]> {
  return pedir<CupoStock[]>('/api/stock')
}

export function setCupo(servicioID: string, asignado: number): Promise<CupoStock> {
  return pedir<CupoStock>('/api/stock/cupos', {
    metodo: 'PUT',
    cuerpo: { servicio_id: servicioID, asignado },
  })
}

/** Sacar el cupo devuelve el plato a "sin límite", que es el default. */
export function quitarCupo(servicioID: string): Promise<void> {
  return pedir<void>(`/api/stock/cupos/${servicioID}`, { metodo: 'DELETE' })
}

// ─── Insumos y recetas ───────────────────────────────────────────────────────
//
// Al revés que el cupo, NADA de esto cuelga de la jornada: el stock de un
// insumo es un saldo del negocio y se lee y se corrige con la caja cerrada.

export function listarInsumos(): Promise<Insumo[]> {
  return pedir<Insumo[]>('/api/insumos')
}

/** `stock_inicial` va aparte del stock de después: es lo único que entra sin
 *  movimiento de compra, porque es el punto de partida. */
export function crearInsumo(cuerpo: {
  nombre: string
  unidad: Unidad
  stock_inicial?: number
  stock_minimo?: number | null
}): Promise<Insumo> {
  return pedir<Insumo>('/api/insumos', { metodo: 'POST', cuerpo })
}

/**
 * NO es un PATCH parcial aunque el verbo lo sea: el nombre va siempre, y
 * `stock_minimo: null` significa "sacame el mínimo, no me avises más". Si fuera
 * parcial, "campo ausente" y "campo en null" querrían decir lo mismo y no habría
 * forma de borrar un mínimo ya cargado.
 *
 * El stock NO se toca por acá: para eso están la compra y el ajuste, que dejan
 * su movimiento. Un stock que cambia sin movimiento es un agujero en la
 * historia.
 */
export function actualizarInsumo(
  id: string,
  cuerpo: { nombre: string; stock_minimo: number | null; unidad?: Unidad },
): Promise<Insumo> {
  return pedir<Insumo>(`/api/insumos/${id}`, { metodo: 'PATCH', cuerpo })
}

/**
 * "Entraron 20000 g de carne": suma al saldo y deja un movimiento `compra`.
 * Es POST de un HECHO y no PATCH del stock a propósito — un PATCH invitaría a
 * escribir el saldo sin explicación, que es justo lo que la historia de
 * movimientos existe para impedir.
 */
export function registrarCompra(
  insumoID: string,
  cuerpo: { cantidad: number; motivo?: string | null },
): Promise<Insumo> {
  return pedir<Insumo>(`/api/insumos/${insumoID}/compras`, { metodo: 'POST', cuerpo })
}

/**
 * "Conté la heladera y hay 3200": se manda el SALDO, no la diferencia, porque
 * es lo que el dueño sabe. Deja un movimiento `ajuste`.
 */
export function ajustarStock(
  insumoID: string,
  cuerpo: { stock: number; motivo?: string | null },
): Promise<Insumo> {
  return pedir<Insumo>(`/api/insumos/${insumoID}/ajustes`, { metodo: 'POST', cuerpo })
}

/** La historia de un saldo, de lo último a lo primero. El core recorta en 50 si
 *  no se le pide otra cosa. */
export function listarMovimientos(insumoID: string, limite?: number): Promise<MovimientoInsumo[]> {
  const cola = limite ? `?limite=${limite}` : ''
  return pedir<MovimientoInsumo[]>(`/api/insumos/${insumoID}/movimientos${cola}`)
}

/** La receta de un plato, ya resuelta para mostrar: cada línea trae el nombre
 *  del insumo, su unidad y cuánto hay, así el editor no cruza nada. */
export function traerReceta(servicioID: string): Promise<Receta> {
  return pedir<Receta>(`/api/servicios/${servicioID}/receta`)
}

/** Guarda la receta ENTERA de una: la lista que va es la que queda. Mandar `[]`
 *  la vacía, y un plato con receta vacía vuelve a ser ilimitado — no agotado. */
export function guardarReceta(servicioID: string, items: RecetaItem[]): Promise<Receta> {
  return pedir<Receta>(`/api/servicios/${servicioID}/receta`, {
    metodo: 'PUT',
    cuerpo: { items },
  })
}

// ─── Jornada (la caja del día) ───────────────────────────────────────────────

export function jornadaActual(): Promise<JornadaActual> {
  return pedir<JornadaActual>('/api/jornada/actual')
}

export function abrirJornada(): Promise<Jornada> {
  return pedir<Jornada>('/api/jornada/abrir', { metodo: 'POST' })
}

export function cerrarJornada(): Promise<Jornada> {
  return pedir<Jornada>('/api/jornada/cerrar', { metodo: 'POST' })
}

// ─── Informes por día ────────────────────────────────────────────────────────

export function traerReportes(rango: RangoReporte): Promise<Reporte> {
  return pedir<Reporte>(`/api/reportes?rango=${rango}`)
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
  descripcion?: string | null
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
    descripcion: string | null
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

/** Todos los clientes del negocio con el resumen de su actividad (gastronomía). */
export function listarClientes(): Promise<ClienteResumen[]> {
  return pedir<ClienteResumen[]>('/api/clientes')
}

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

// ─── Consultas ───────────────────────────────────────────────────────────────

/** Las preguntas que el asistente dejó para el dueño. Sin filtro trae todas;
 *  con `estado` deja sólo las pendientes o las ya respondidas. */
export function listarConsultas(estado?: EstadoConsulta): Promise<Consulta[]> {
  const cola = estado ? `?estado=${estado}` : ''
  return pedir<Consulta[]>(`/api/consultas${cola}`)
}

/** Responde una consulta: la marca respondida y el core le avisa al cliente
 *  por WhatsApp ("Sobre tu consulta: ..."). */
export function responderConsulta(id: string, respuesta: string): Promise<Consulta> {
  return pedir<Consulta>(`/api/consultas/${id}/responder`, {
    metodo: 'PATCH',
    cuerpo: { respuesta },
  })
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

export function obtenerConfigFiscal(negocioID: string): Promise<ConfigFiscal> {
  return pedir<ConfigFiscal>(`/api/admin/negocios/${negocioID}/fiscal`)
}

/**
 * La cabecera fiscal del PROPIO negocio, para imprimir el comprobante. Misma
 * vista que la del admin (sin nada del certificado), pero el tenant sale del
 * token. 404 = todavía no cargó sus datos de ARCA.
 */
export function miConfigFiscal(): Promise<ConfigFiscal> {
  return pedir<ConfigFiscal>('/api/negocio/fiscal')
}

export function guardarConfigFiscal(
  negocioID: string,
  cuerpo: {
    cuit: string
    razon_social?: string | null
    condicion?: string | null
    punto_venta?: number | null
    modo?: ModoFiscal
    cert_pem?: string | null
    key_pem?: string | null
  },
): Promise<ConfigFiscal> {
  return pedir<ConfigFiscal>(`/api/admin/negocios/${negocioID}/fiscal`, { metodo: 'PUT', cuerpo })
}
