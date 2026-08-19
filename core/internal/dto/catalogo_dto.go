package dto

import "github.com/shopspring/decimal"

// ─── Categorías ──────────────────────────────────────────────────────────────

type CrearCategoriaRequest struct {
	Nombre string `json:"nombre" binding:"required"`
	Orden  int    `json:"orden"`
}

type ActualizarCategoriaRequest struct {
	Nombre *string `json:"nombre"`
	Orden  *int    `json:"orden"`
	Activo *bool   `json:"activo"`
}

// ─── Recursos ────────────────────────────────────────────────────────────────

type CrearRecursoRequest struct {
	Tipo      string `json:"tipo" binding:"required,oneof=profesional mesa cocina"`
	Nombre    string `json:"nombre" binding:"required"`
	Capacidad int    `json:"capacidad"`
}

type ActualizarRecursoRequest struct {
	Tipo      *string `json:"tipo" binding:"omitempty,oneof=profesional mesa cocina"`
	Nombre    *string `json:"nombre"`
	Capacidad *int    `json:"capacidad"`
	Activo    *bool   `json:"activo"`
}

// ─── Servicios ───────────────────────────────────────────────────────────────

type CrearServicioRequest struct {
	CategoriaID *string         `json:"categoria_id"`
	Nombre      string          `json:"nombre" binding:"required"`
	DuracionMin *int            `json:"duracion_min"` // nil = no consume tiempo
	PrecioBase  decimal.Decimal `json:"precio_base"`
	Disponible  *bool           `json:"disponible"`
}

type ActualizarServicioRequest struct {
	CategoriaID *string          `json:"categoria_id"`
	Nombre      *string          `json:"nombre"`
	DuracionMin *int             `json:"duracion_min"`
	PrecioBase  *decimal.Decimal `json:"precio_base"`
	Disponible  *bool            `json:"disponible"`
	Activo      *bool            `json:"activo"`
}

// SetDisponibleRequest es EL interruptor. Puntero porque `false` es el valor
// interesante y `binding:"required"` sobre un bool plano lo rechazaría.
type SetDisponibleRequest struct {
	Disponible *bool `json:"disponible" binding:"required"`
}

// ─── Coberturas y precios ────────────────────────────────────────────────────

type CrearCoberturaRequest struct {
	Nombre string `json:"nombre" binding:"required"`
}

type ActualizarCoberturaRequest struct {
	Nombre *string `json:"nombre"`
}

// PrecioCoberturaRequest fija el precio de un servicio para una cobertura.
type PrecioCoberturaRequest struct {
	CoberturaID string           `json:"cobertura_id" binding:"required,uuid"`
	Precio      decimal.Decimal  `json:"precio"`
	Coseguro    *decimal.Decimal `json:"coseguro"`
}
