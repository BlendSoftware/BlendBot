package dto

import (
	"time"

	"github.com/shopspring/decimal"
)

// ClienteResumen es la fila de la lista de clientes del negocio: la ficha básica
// más el resumen de su actividad (cuántos pedidos, cuánto acumuló, cuándo fue el
// último). Alimenta la vista de Clientes de gastronomía.
type ClienteResumen struct {
	ID              string          `json:"id"`
	Telefono        string          `json:"telefono"`
	Nombre          *string         `json:"nombre"`
	CoberturaID     *string         `json:"cobertura_id"`
	CreadoEn        time.Time       `json:"creado_en"`
	CantidadPedidos int             `json:"cantidad_pedidos"`
	TotalAcumulado  decimal.Decimal `json:"total_acumulado"`
	UltimoPedido    *time.Time      `json:"ultimo_pedido"`
}

// CrearClienteRequest: mínimo dato necesario (Ley 25.326). Nada de motivo de
// consulta libre — el tipo de práctica ya vive en el servicio.
type CrearClienteRequest struct {
	Telefono    string  `json:"telefono" binding:"required"`
	Nombre      *string `json:"nombre"`
	Documento   *string `json:"documento"`
	CoberturaID *string `json:"cobertura_id" binding:"omitempty,uuid"`
	Notas       *string `json:"notas"`
}

type ActualizarClienteRequest struct {
	Nombre      *string `json:"nombre"`
	Documento   *string `json:"documento"`
	CoberturaID *string `json:"cobertura_id" binding:"omitempty,uuid"`
	Notas       *string `json:"notas"`
}
