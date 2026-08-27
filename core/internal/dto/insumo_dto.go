package dto

import (
	"time"

	"copiloto/core/internal/model"
)

// CrearInsumoInput da de alta materia prima.
//
// StockInicial es puntero por el mismo motivo que Asignado en SetCupoInput: 0
// es un valor interesante ("lo cargo ahora y lo compro mañana") y sobre un int
// plano `required` lo rechazaría.
//
// La unidad se elige UNA vez, acá. Después no se convierte nunca y sólo se
// puede cambiar mientras el insumo no esté en ninguna receta.
type CrearInsumoInput struct {
	Nombre       string `json:"nombre" binding:"required"`
	Unidad       string `json:"unidad" binding:"required"`
	StockInicial *int   `json:"stock_inicial" binding:"omitempty,min=0"`
	StockMinimo  *int   `json:"stock_minimo" binding:"omitempty,min=0"`
}

// ActualizarInsumoInput edita lo que se puede editar de un insumo.
//
// NO es un PATCH parcial: nombre y stock_minimo se mandan siempre, y
// `stock_minimo: null` significa "sacame el mínimo, no me avises más". Si fuera
// parcial, "campo ausente" y "campo en null" querrían decir lo mismo y el dueño
// no tendría forma de borrar un mínimo que ya cargó.
//
// El stock NO se toca por acá: para eso están la compra y el ajuste, que
// escriben su movimiento. Un stock que cambia sin movimiento es un agujero en
// la historia.
//
// Unidad es opcional y aparte: mandarla distinta a la que está rebota si el
// insumo ya tiene recetas.
type ActualizarInsumoInput struct {
	Nombre      string  `json:"nombre" binding:"required"`
	StockMinimo *int    `json:"stock_minimo" binding:"omitempty,min=0"`
	Unidad      *string `json:"unidad"`
}

// RegistrarCompraInput es "entraron 20000 g de carne". Suma al saldo y deja un
// movimiento `compra`.
type RegistrarCompraInput struct {
	Cantidad int     `json:"cantidad" binding:"required,min=1"`
	Motivo   *string `json:"motivo"`
}

// AjustarStockInput es "conté la heladera y hay 3200".
//
// Se manda el SALDO, no la diferencia, porque es lo que el dueño sabe: contó lo
// que hay. Que el dato de entrada sea el saldo también evita que el servidor
// tenga que leer el stock antes de escribirlo, que es la ventana de carrera
// que todo este módulo existe para cerrar.
type AjustarStockInput struct {
	Stock  *int    `json:"stock" binding:"required,min=0"`
	Motivo *string `json:"motivo"`
}

// InsumoResponse es una fila de la pestaña Insumos.
//
// `unidad` viaja siempre para que el panel la pueda mostrar al lado de cada
// campo de cantidad: es la mitigación del riesgo de unidades, no un adorno.
//
// `bajo_minimo` viene resuelto del servidor y no se recalcula en el panel: la
// regla "sin mínimo NUNCA marca" tiene que vivir en un solo lugar.
type InsumoResponse struct {
	ID          string `json:"id"`
	Nombre      string `json:"nombre"`
	Unidad      string `json:"unidad"`
	Stock       int    `json:"stock"`
	StockMinimo *int   `json:"stock_minimo"`
	BajoMinimo  bool   `json:"bajo_minimo"`
	Activo      bool   `json:"activo"`
}

// InsumoDesde arma la fila del panel a partir del modelo.
func InsumoDesde(i model.Insumo) InsumoResponse {
	return InsumoResponse{
		ID:          i.ID,
		Nombre:      i.Nombre,
		Unidad:      i.Unidad,
		Stock:       i.Stock,
		StockMinimo: i.StockMinimo,
		BajoMinimo:  i.BajoMinimo(),
		Activo:      i.Activo,
	}
}

// MovimientoResponse es una línea de la historia de un insumo: lo que responde
// "compré 20 kg, ¿por qué me quedan 3?".
//
// `cantidad` es la magnitud y `tipo` dice el signo. `saldo_resultante` deja
// leer cada fila sola sin tener que ir sumando desde el principio.
type MovimientoResponse struct {
	ID              string    `json:"id"`
	Tipo            string    `json:"tipo"`
	Cantidad        int       `json:"cantidad"`
	SaldoResultante int       `json:"saldo_resultante"`
	CompromisoID    *string   `json:"compromiso_id"`
	Motivo          *string   `json:"motivo"`
	CreadoEn        time.Time `json:"creado_en"`
}

// MovimientoDesde arma la línea de historia a partir del modelo.
func MovimientoDesde(m model.MovimientoInsumo) MovimientoResponse {
	return MovimientoResponse{
		ID:              m.ID,
		Tipo:            m.Tipo,
		Cantidad:        m.Cantidad,
		SaldoResultante: m.SaldoResultante,
		CompromisoID:    m.CompromisoID,
		Motivo:          m.Motivo,
		CreadoEn:        m.CreadoEn,
	}
}
