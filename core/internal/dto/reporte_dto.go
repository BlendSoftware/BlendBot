package dto

import "github.com/shopspring/decimal"

// ReporteDia es una barra del informe: un día calendario del negocio con lo
// vendido (entregado) y lo cobrado (por caja) de ese día.
type ReporteDia struct {
	Fecha   string          `json:"fecha"` // YYYY-MM-DD en la zona del negocio
	Vendido decimal.Decimal `json:"vendido"`
	Cobrado decimal.Decimal `json:"cobrado"`
}

// ReporteResponse es GET /api/reportes?rango=semanal|mensual. Trae una fila por
// día, incluidos los días en cero, para que el panel dibuje la serie completa y
// no una tabla con huecos. Desde/Hasta son inclusivos y ya en la zona del
// negocio.
type ReporteResponse struct {
	Rango        string          `json:"rango"` // semanal | mensual
	Desde        string          `json:"desde"` // YYYY-MM-DD
	Hasta        string          `json:"hasta"` // YYYY-MM-DD (último día incluido)
	Timezone     string          `json:"timezone"`
	Dias         []ReporteDia    `json:"dias"`
	TotalVendido decimal.Decimal `json:"total_vendido"`
	TotalCobrado decimal.Decimal `json:"total_cobrado"`
}
