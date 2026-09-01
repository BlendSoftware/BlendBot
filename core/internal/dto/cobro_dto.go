package dto

import (
	"context"
	"fmt"

	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
)

// ── Cobro ─────────────────────────────────────────────────────────────────

// CobrarInput es POST /api/cobros. El monto no viaja: sale del total congelado
// del compromiso, así nadie cobra un número distinto al que se pactó.
type CobrarInput struct {
	CompromisoID string `json:"compromiso_id" binding:"required,uuid"`
	MedioPago    string `json:"medio_pago" binding:"required"`
}

// ComprobanteResponse es el estado fiscal del cobro tal como lo ve el panel.
// Nunca incluye nada del certificado.
type ComprobanteResponse struct {
	ID         string `json:"id"`
	Estado     string `json:"estado"` // pendiente | emitido | error
	TipoCbte   int    `json:"tipo_cbte"`
	PuntoVenta int    `json:"punto_venta"`
	Numero     *int64 `json:"numero"`
	// NumeroFormateado es "0001-00000123", que es como lo lee una persona.
	NumeroFormateado *string         `json:"numero_formateado"`
	CAE              *string         `json:"cae"`
	CAEVence         *string         `json:"cae_vence"` // YYYY-MM-DD
	Importe          decimal.Decimal `json:"importe"`
	Intentos         int             `json:"intentos"`
	UltimoError      *string         `json:"ultimo_error"`
	EmitidoEn        *Hora           `json:"emitido_en"`
}

// CobroResponse es lo que devuelve POST /api/cobros y GET /api/cobros/:id.
// Comprobante nil significa que se cobró sin factura, y Facturacion dice por
// qué: el negocio no tiene configuración fiscal, o el cobro fue en cero y ARCA
// no acepta un comprobante así. Son dos cosas distintas y el dueño necesita
// distinguirlas — una es un trámite pendiente suyo, la otra es normal (H15).
type CobroResponse struct {
	ID           string               `json:"id"`
	CompromisoID string               `json:"compromiso_id"`
	MedioPago    string               `json:"medio_pago"`
	Monto        decimal.Decimal      `json:"monto"`
	CobradoEn    Hora                 `json:"cobrado_en"`
	Comprobante  *ComprobanteResponse `json:"comprobante"`
	// Facturacion explica en castellano qué va a pasar con la factura. El panel
	// lo puede mostrar tal cual.
	Facturacion string `json:"facturacion"`
}

// CobroDesdeModel arma la respuesta. comp puede ser nil.
func CobroDesdeModel(ctx context.Context, c *model.Cobro, comp *model.Comprobante) *CobroResponse {
	if c == nil {
		return nil
	}
	out := &CobroResponse{
		ID:           c.ID,
		CompromisoID: c.CompromisoID,
		MedioPago:    string(c.MedioPago),
		Monto:        c.Monto,
		CobradoEn:    HoraDe(ctx, c.CobradoEn),
		Comprobante:  ComprobanteDesdeModel(ctx, comp),
		Facturacion:  motivoSinFactura(c),
	}
	if comp != nil {
		switch comp.Estado {
		case model.ComprobanteEmitido:
			out.Facturacion = "Factura C emitida."
		case model.ComprobanteError:
			out.Facturacion = "La factura no se pudo emitir. Revisala desde el panel."
		default:
			out.Facturacion = "Facturando…"
		}
	}
	return out
}

// motivoSinFactura explica por qué un cobro no tiene comprobante. Sin esto los
// dos motivos salían con el mismo texto y un cobro bonificado le decía al dueño
// que le faltaba cargar el CUIT que ya tenía cargado (H15).
func motivoSinFactura(c *model.Cobro) string {
	if !c.Monto.IsPositive() {
		return "Cobro en cero: no hay factura que emitir."
	}
	return "Este negocio todavia no tiene configuracion fiscal, asi que no se emite factura."
}

// ComprobanteDesdeModel mapea el comprobante; nil devuelve nil.
func ComprobanteDesdeModel(ctx context.Context, c *model.Comprobante) *ComprobanteResponse {
	if c == nil {
		return nil
	}
	out := &ComprobanteResponse{
		ID:          c.ID,
		Estado:      string(c.Estado),
		TipoCbte:    c.TipoCbte,
		PuntoVenta:  c.PuntoVenta,
		Numero:      c.Numero,
		CAE:         c.CAE,
		Importe:     c.Importe,
		Intentos:    c.RetryCount,
		UltimoError: c.LastError,
		EmitidoEn:   HoraPtrDe(ctx, c.EmitidoEn),
	}
	if c.Numero != nil {
		f := NumeroComprobante(c.PuntoVenta, *c.Numero)
		out.NumeroFormateado = &f
	}
	if c.CAEVence != nil {
		v := c.CAEVence.Format("2006-01-02")
		out.CAEVence = &v
	}
	return out
}

// NumeroComprobante formatea "0001-00000123", que es como sale impreso.
func NumeroComprobante(puntoVenta int, numero int64) string {
	return fmt.Sprintf("%04d-%08d", puntoVenta, numero)
}

// ── Cierre del día ────────────────────────────────────────────────────────

// ResumenComprobantes es el estado fiscal del día de un vistazo.
type ResumenComprobantes struct {
	Emitidos   int `json:"emitidos"`
	Pendientes int `json:"pendientes"`
	ConError   int `json:"con_error"`
}

// CierreResponse es la vista 3 del panel: lo que el dueño mira antes de irse.
// Todo se calcula en la timezone del negocio.
type CierreResponse struct {
	Fecha    string `json:"fecha"` // YYYY-MM-DD en la zona del negocio
	Timezone string `json:"timezone"`

	Compromisos int            `json:"compromisos"`
	Completados int            `json:"completados"`
	Cancelados  int            `json:"cancelados"`
	Ausentes    int            `json:"ausentes"`
	PorOrigen   map[string]int `json:"por_origen"`

	// Vendido es lo entregado del día (total de los compromisos completados),
	// haya entrado o no por la caja de ARCA. Suele ser mayor que TotalCobrado:
	// se puede entregar un pedido sin cobrarlo por el panel.
	Vendido decimal.Decimal `json:"vendido"`

	Cobros         int                        `json:"cobros"`
	TotalCobrado   decimal.Decimal            `json:"total_cobrado"`
	TicketPromedio decimal.Decimal            `json:"ticket_promedio"`
	PorMedioPago   map[string]decimal.Decimal `json:"por_medio_pago"`

	Comprobantes ResumenComprobantes `json:"comprobantes"`
}

// ── Configuración fiscal (admin) ──────────────────────────────────────────

// ConfigFiscalInput es PUT /api/admin/negocios/:id/fiscal. Los PEM entran acá y
// no salen nunca: se guardan cifrados y el GET sólo dice si están o no.
// Mandar cert_pem/key_pem vacíos o ausentes deja los que ya estaban.
type ConfigFiscalInput struct {
	CUIT        string  `json:"cuit" binding:"required"`
	RazonSocial *string `json:"razon_social"`
	Condicion   *string `json:"condicion"`
	PuntoVenta  *int    `json:"punto_venta"`
	Modo        *string `json:"modo"` // homologacion | produccion
	CertPEM     *string `json:"cert_pem"`
	KeyPEM      *string `json:"key_pem"`
}

// ConfigFiscalResponse es la ficha fiscal SIN secretos. TieneCertificados es
// todo lo que el panel necesita saber del par de PEM.
type ConfigFiscalResponse struct {
	NegocioID         string    `json:"negocio_id"`
	CUIT              string    `json:"cuit"`
	RazonSocial       *string   `json:"razon_social"`
	Condicion         string    `json:"condicion"`
	PuntoVenta        int       `json:"punto_venta"`
	Modo              string    `json:"modo"`
	TieneCertificados bool      `json:"tiene_certificados"`
	ActualizadoEn     Hora      `json:"actualizado_en"`
}

// ConfigFiscalDesdeModel arma la ficha pública. nil devuelve nil.
func ConfigFiscalDesdeModel(ctx context.Context, cf *model.ConfigFiscal) *ConfigFiscalResponse {
	if cf == nil {
		return nil
	}
	return &ConfigFiscalResponse{
		NegocioID:         cf.NegocioID,
		CUIT:              cf.CUIT,
		RazonSocial:       cf.RazonSocial,
		Condicion:         cf.Condicion,
		PuntoVenta:        cf.PuntoVenta,
		Modo:              cf.Modo,
		TieneCertificados: cf.TieneCertificados(),
		ActualizadoEn:     HoraDe(ctx, cf.ActualizadoEn),
	}
}
