package model

import "time"

// Unidades válidas de un insumo. Son las tres y no hay conversión entre
// ellas: la unidad se define al crear el insumo y toda cantidad que se exprese
// contra ese insumo —receta, compra, ajuste— está en ESA unidad.
//
// Sin conversión no hay error de conversión, y el error de conversión (cargar
// la carne en kilos y la receta en gramos) apaga la cocina entera por un
// factor de mil sin que nadie pueda darse cuenta de qué pasó.
const (
	UnidadGramo  = "g"
	UnidadML     = "ml"
	UnidadUnidad = "unidad"
)

// UnidadValida dice si el string es una de las tres. El CHECK de la tabla es
// el árbitro final; esto existe para poder devolver un 422 con un mensaje en
// castellano en vez de un error de Postgres.
func UnidadValida(u string) bool {
	return u == UnidadGramo || u == UnidadML || u == UnidadUnidad
}

// Tipos de movimiento de stock. compra y devolucion suman; consumo resta;
// ajuste deja el saldo donde el dueño dice que está (contó la heladera).
const (
	MovCompra     = "compra"
	MovConsumo    = "consumo"
	MovDevolucion = "devolucion"
	MovAjuste     = "ajuste"
)

// Insumo es la materia prima del negocio: "carne picada", 40000 gramos.
//
// A diferencia del cupo, que es una foto del día y vive colgado de la jornada,
// el insumo es un SALDO CORRIENTE que vive colgado del negocio: la carne que
// sobra hoy sigue estando mañana. Por eso acá no hay jornada_id.
type Insumo struct {
	ID        string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID string `gorm:"type:uuid;not null" json:"negocio_id"`
	Nombre    string `gorm:"not null" json:"nombre"`
	// Unidad es del insumo y no se convierte. Ver las constantes de arriba.
	Unidad string `gorm:"not null" json:"unidad"`
	// Stock es el saldo, entero en la unidad del insumo. Nunca negativo: lo
	// garantiza insumo_stock_no_negativo en la base, no el service.
	Stock int `gorm:"not null;default:0" json:"stock"`
	// StockMinimo nil es "no me avises", NO "avisame siempre". Ver BajoMinimo.
	StockMinimo   *int      `json:"stock_minimo"`
	Activo        bool      `gorm:"not null;default:true" json:"activo"`
	CreadoEn      time.Time `gorm:"autoCreateTime" json:"creado_en"`
	ActualizadoEn time.Time `json:"actualizado_en"`
}

func (Insumo) TableName() string { return "insumo" }

// BajoMinimo es lo que el panel marca en rojo.
//
// Sin mínimo cargado NUNCA marca. No tener mínimo significa "no me avises", y
// si el default fuera avisar el panel arrancaría con todo en rojo el primer
// día: el dueño aprendería a ignorar la marca, que es la única forma en que un
// aviso muere de verdad.
func (i Insumo) BajoMinimo() bool {
	if i.StockMinimo == nil {
		return false
	}
	return i.Stock < *i.StockMinimo
}

// RecetaItem es una línea de "de qué está hecho este plato": 1 medallón, 1 pan
// de papa. Cantidad va en la unidad del insumo, siempre.
//
// Sin negocio_id a propósito, igual que precio_cobertura: el tenant sale del
// servicio y del insumo, que sí lo tienen. Quien escriba una receta valida los
// dos lados contra el mismo negocio o no lo valida nadie.
type RecetaItem struct {
	ID         string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ServicioID string `gorm:"type:uuid;not null" json:"servicio_id"`
	InsumoID   string `gorm:"type:uuid;not null" json:"insumo_id"`
	Cantidad   int    `gorm:"not null" json:"cantidad"`
}

func (RecetaItem) TableName() string { return "receta_item" }

// MovimientoInsumo es una variación de stock con su explicación.
//
// Se escribe SIEMPRE en la misma transacción que el cambio de insumo.stock. Un
// stock que cambió sin movimiento, o un movimiento sin cambio de stock, no
// puede existir: la historia es lo único que responde "compré 20 kg, ¿por qué
// me quedan 3?", y esa pregunta aparece el día dos.
type MovimientoInsumo struct {
	ID       string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	InsumoID string `gorm:"type:uuid;not null" json:"insumo_id"`
	// Tipo es una de las cuatro constantes Mov*. Dice el signo del movimiento.
	Tipo string `gorm:"not null" json:"tipo"`
	// Cantidad es la MAGNITUD, siempre positiva. El signo lo pone el tipo.
	//
	// En un `ajuste` la cantidad no es un dato de entrada sino el resultado:
	// el que ajusta dice en cuánto quedó el saldo (SaldoResultante) y el
	// repositorio calcula la diferencia contra lo que había. Ver
	// repository.InsumoRepository.Mover.
	Cantidad int `gorm:"not null" json:"cantidad"`
	// SaldoResultante es el stock DESPUÉS del movimiento. Redundante con la
	// suma de la historia y por eso mismo útil: una fila sola ya dice en qué
	// quedó la cosa.
	SaldoResultante int `gorm:"not null" json:"saldo_resultante"`
	// CompromisoID: qué pedido se lo llevó. nil en compras y ajustes.
	CompromisoID *string `gorm:"type:uuid" json:"compromiso_id"`
	// Motivo: el texto que el dueño escribe en un ajuste.
	Motivo   *string   `json:"motivo"`
	CreadoEn time.Time `gorm:"autoCreateTime" json:"creado_en"`
}

func (MovimientoInsumo) TableName() string { return "movimiento_insumo" }
