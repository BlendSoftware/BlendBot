package dto

import (
	"context"
	"time"

	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
)

// LineaCompromisoInput es un ítem pedido. El precio NO viaja en el request:
// se congela en el core desde el catálogo (o el precio por cobertura).
type LineaCompromisoInput struct {
	ServicioID string  `json:"servicio_id" binding:"required,uuid"`
	Cantidad   int     `json:"cantidad" binding:"required,min=1"`
	Nota       *string `json:"nota"`
}

// CrearCompromisoInput arma un compromiso. Recurso, inicio y fin son
// opcionales: un compromiso incompleto es válido y entra igual al panel (D7).
type CrearCompromisoInput struct {
	ClienteID string                 `json:"cliente_id" binding:"required,uuid"`
	Tipo      model.TipoCompromiso   `json:"tipo" binding:"required,oneof=pedido reserva turno"`
	Origen    model.OrigenCompromiso `json:"origen" binding:"required,oneof=whatsapp panel telefono"`
	RecursoID *string                `json:"recurso_id" binding:"omitempty,uuid"`
	Inicio    *time.Time             `json:"inicio"`
	Fin       *time.Time             `json:"fin"`
	Entrega   *model.TipoEntrega     `json:"entrega" binding:"omitempty,oneof=retira delivery en_local"`
	Direccion *string                `json:"direccion"`
	Nota      *string                `json:"nota"`
	// Sesion identifica al cliente de WhatsApp: el hold de esa misma sesión no
	// cuenta como solape (es el que él mismo tomó mientras completaba datos).
	Sesion *string                `json:"sesion"`
	Lineas []LineaCompromisoInput `json:"lineas" binding:"required,min=1,dive"`
}

// TransicionarInput es el cuerpo de PATCH /api/compromisos/:id/estado.
type TransicionarInput struct {
	Estado    model.EstadoCompromiso `json:"estado" binding:"required"`
	DemoraMin *int                   `json:"demora_min" binding:"omitempty,min=0"`
	RecursoID *string                `json:"recurso_id" binding:"omitempty,uuid"`
}

// FiltroCompromisos es el filtro del tablero.
type FiltroCompromisos struct {
	Estados []model.EstadoCompromiso
	Desde   *time.Time
	Hasta   *time.Time
}

// LineaCompromisoResponse expone la línea con su precio ya congelado.
type LineaCompromisoResponse struct {
	ID         string          `json:"id"`
	ServicioID string          `json:"servicio_id"`
	Cantidad   int             `json:"cantidad"`
	PrecioUnit decimal.Decimal `json:"precio_unit"`
	Subtotal   decimal.Decimal `json:"subtotal"`
	Nota       *string         `json:"nota"`
}

// CompromisoResponse es la vista del motor para panel y agente.
type CompromisoResponse struct {
	ID        string `json:"id"`
	NegocioID string `json:"negocio_id"`
	ClienteID string `json:"cliente_id"`
	// Datos del cliente para mostrar quién pidió sin un GET extra por ficha. El
	// nombre puede venir nulo (el que escribe por WhatsApp aún no lo dio); el
	// teléfono es la identidad y siempre está.
	ClienteNombre   *string                   `json:"cliente_nombre"`
	ClienteTelefono string                    `json:"cliente_telefono"`
	RecursoID       *string                   `json:"recurso_id"`
	Tipo            model.TipoCompromiso      `json:"tipo"`
	Estado          model.EstadoCompromiso    `json:"estado"`
	Inicio          *Hora                     `json:"inicio"`
	Fin             *Hora                     `json:"fin"`
	DemoraMin       *int                      `json:"demora_min"`
	Entrega         *model.TipoEntrega        `json:"entrega"`
	Direccion       *string                   `json:"direccion"`
	Total           decimal.Decimal           `json:"total"`
	Origen          model.OrigenCompromiso    `json:"origen"`
	Nota            *string                   `json:"nota"`
	CreadoEn        Hora                      `json:"creado_en"`
	ConfirmadoEn    *Hora                     `json:"confirmado_en"`
	CerradoEn       *Hora                     `json:"cerrado_en"`
	Lineas          []LineaCompromisoResponse `json:"lineas"`
}

// CompromisoDesdeModel arma la respuesta a partir del modelo.
func CompromisoDesdeModel(ctx context.Context, c *model.Compromiso) *CompromisoResponse {
	if c == nil {
		return nil
	}
	lineas := make([]LineaCompromisoResponse, 0, len(c.Lineas))
	for _, l := range c.Lineas {
		lineas = append(lineas, LineaCompromisoResponse{
			ID:         l.ID,
			ServicioID: l.ServicioID,
			Cantidad:   l.Cantidad,
			PrecioUnit: l.PrecioUnit,
			Subtotal:   l.PrecioUnit.Mul(decimal.NewFromInt(int64(l.Cantidad))),
			Nota:       l.Nota,
		})
	}
	return &CompromisoResponse{
		ID:              c.ID,
		NegocioID:       c.NegocioID,
		ClienteID:       c.ClienteID,
		ClienteNombre:   c.ClienteNombre,
		ClienteTelefono: c.ClienteTelefono,
		RecursoID:       c.RecursoID,
		Tipo:            c.Tipo,
		Estado:          c.Estado,
		Inicio:          HoraPtrDe(ctx, c.Inicio),
		Fin:             HoraPtrDe(ctx, c.Fin),
		DemoraMin:       c.DemoraMin,
		Entrega:         c.Entrega,
		Direccion:       c.Direccion,
		Total:           c.Total,
		Origen:          c.Origen,
		Nota:            c.Nota,
		CreadoEn:        HoraDe(ctx, c.CreadoEn),
		ConfirmadoEn:    HoraPtrDe(ctx, c.ConfirmadoEn),
		CerradoEn:       HoraPtrDe(ctx, c.CerradoEn),
		Lineas:          lineas,
	}
}

// CompromisosDesdeModelos mapea una lista del tablero.
func CompromisosDesdeModelos(ctx context.Context, cs []model.Compromiso) []CompromisoResponse {
	out := make([]CompromisoResponse, 0, len(cs))
	for i := range cs {
		out = append(out, *CompromisoDesdeModel(ctx, &cs[i]))
	}
	return out
}

