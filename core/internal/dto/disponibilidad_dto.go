package dto

import (
	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
)

// ConsultarDisponibilidadInput pide huecos reales para un servicio.
//
// Desde es una fecha "YYYY-MM-DD" (o un RFC3339, del que se toma el día) en la
// timezone del negocio; vacío = hoy. Dias vacío = 7, tope 30.
type ConsultarDisponibilidadInput struct {
	ServicioID string  `json:"servicio_id" binding:"required,uuid"`
	Desde      string  `json:"desde"`
	Dias       int     `json:"dias" binding:"omitempty,min=1,max=30"`
	RecursoID  *string `json:"recurso_id" binding:"omitempty,uuid"`
}

// Hueco es un rango libre de un recurso. Inicio y Fin van en RFC3339 con el
// offset del negocio: el agente los repite tal cual y no hace aritmética de
// husos horarios.
type Hueco struct {
	RecursoID     string `json:"recurso_id"`
	RecursoNombre string `json:"recurso_nombre"`
	Inicio        string `json:"inicio"`
	Fin           string `json:"fin"`
	// Cupo es el cupo restante de la franja para un recurso con capacidad en
	// paralelo (cocina: unidades/hora). Para profesional y mesa —que atienden 1
	// por franja— va nil y se omite: la salida de esos verticales no cambia.
	Cupo *int `json:"cupo,omitempty"`
}

// HuecosResponse es la respuesta de POST /api/disponibilidad/consultar.
// Truncado avisa que se alcanzó el tope de huecos: hay más, pedí un rango menor.
type HuecosResponse struct {
	ServicioID     string  `json:"servicio_id"`
	ServicioNombre string  `json:"servicio_nombre"`
	DuracionMin    int     `json:"duracion_min"`
	Timezone       string  `json:"timezone"`
	Desde          string  `json:"desde"` // YYYY-MM-DD
	Dias           int     `json:"dias"`
	Huecos         []Hueco `json:"huecos"`
	Truncado       bool    `json:"truncado"`
}

// FranjaHoraria es un tramo de la agenda semanal declarada, en hora local.
type FranjaHoraria struct {
	Desde string `json:"desde"`
	Hasta string `json:"hasta"`
}

// TurnoAgenda es un compromiso del día visto desde la agenda: lo mínimo para
// saber quién viene y a qué hora.
//
// Cobrado y ComprobanteEstado viajan acá a propósito: el panel pinta un botón
// "Cobrar" por turno completado y sin esto tendría que preguntar
// GET /api/cobros/:id una vez por turno, en cada refresco de la agenda. Un
// LEFT JOIN acá es una consulta; allá eran N requests cada quince segundos.
// ComprobanteEstado es nil cuando no hay cobro, o cuando el negocio todavía no
// cargó sus datos de ARCA y el cobro salió sin comprobante.
type TurnoAgenda struct {
	CompromisoID      string                   `json:"compromiso_id"`
	Inicio            string                   `json:"inicio"`
	Fin               *string                  `json:"fin"`
	Tipo              model.TipoCompromiso     `json:"tipo"`
	Estado            model.EstadoCompromiso   `json:"estado"`
	ClienteID         string                   `json:"cliente_id"`
	ClienteNombre     *string                  `json:"cliente_nombre"`
	ClienteTelefono   string                   `json:"cliente_telefono"`
	Total             decimal.Decimal          `json:"total"`
	Nota              *string                  `json:"nota"`
	Cobrado           bool                     `json:"cobrado"`
	ComprobanteEstado *model.EstadoComprobante `json:"comprobante_estado"`
}

// AgendaRecurso es la columna de un recurso: lo que declaró trabajar ese día y
// lo que ya tiene agendado.
type AgendaRecurso struct {
	RecursoID     string          `json:"recurso_id"`
	RecursoNombre string          `json:"recurso_nombre"`
	Horarios      []FranjaHoraria `json:"horarios"`
	Turnos        []TurnoAgenda   `json:"turnos"`
}

// AgendaResponse es la respuesta de GET /api/agenda?fecha=.
// SinRecurso son los compromisos del día que todavía no tienen recurso
// asignado (D7: entran incompletos al panel y alguien los termina).
type AgendaResponse struct {
	Fecha      string          `json:"fecha"` // YYYY-MM-DD
	Timezone   string          `json:"timezone"`
	Recursos   []AgendaRecurso `json:"recursos"`
	SinRecurso []TurnoAgenda   `json:"sin_recurso"`
}
