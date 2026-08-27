package model

import "github.com/shopspring/decimal"

// TipoRecurso: lo que un compromiso ocupa.
type TipoRecurso string

const (
	RecursoProfesional TipoRecurso = "profesional"
	RecursoMesa        TipoRecurso = "mesa"
	RecursoCocina      TipoRecurso = "cocina"
)

// Recurso es lo que se ocupa: "Dra. Gómez", "Mesa 4", "Cocina".
type Recurso struct {
	ID        string      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID string      `gorm:"type:uuid;not null" json:"negocio_id"`
	Tipo      TipoRecurso `gorm:"type:tipo_recurso;not null" json:"tipo"`
	Nombre    string      `gorm:"not null" json:"nombre"`
	Capacidad int         `gorm:"not null;default:1" json:"capacidad"` // mesa: cubiertos · cocina: unidades/hora
	Activo    bool        `gorm:"not null;default:true" json:"activo"`
}

func (Recurso) TableName() string { return "recurso" }

// Categoria: secciones de la carta o tipos de práctica.
type Categoria struct {
	ID        string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID string `gorm:"type:uuid;not null" json:"negocio_id"`
	Nombre    string `gorm:"not null" json:"nombre"`
	Orden     int    `gorm:"not null;default:0" json:"orden"`
	Activo    bool   `gorm:"not null;default:true" json:"activo"`
}

func (Categoria) TableName() string { return "categoria" }

// Servicio es lo que se pide: "Doble cheddar" o "Arreglo de conducto".
// Disponible es EL interruptor: apagado, el agente deja de ofrecerlo al segundo.
type Servicio struct {
	ID          string          `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID   string          `gorm:"type:uuid;not null" json:"negocio_id"`
	CategoriaID *string         `gorm:"type:uuid" json:"categoria_id"`
	Nombre      string          `gorm:"not null" json:"nombre"`
	Descripcion *string         `json:"descripcion"`  // qué lleva el plato; nil = sin describir
	DuracionMin *int            `json:"duracion_min"` // nil = no consume tiempo (un producto)
	PrecioBase  decimal.Decimal `gorm:"type:numeric(12,2);not null;default:0" json:"precio_base"`
	Disponible  bool            `gorm:"not null;default:true" json:"disponible"`
	Activo      bool            `gorm:"not null;default:true" json:"activo"`

	// PrecioEfectivo es el precio que se le va a CONGELAR a este cliente: el de
	// su cobertura si tiene una fila propia, si no precio_base. No es una
	// columna — se calcula al listar con ?cobertura_id=. Existe porque el
	// agente cotizaba precio_base mientras el motor congelaba el de cobertura:
	// el cliente confirmaba un número y se le cobraba otro (H4).
	PrecioEfectivo *decimal.Decimal `gorm:"-" json:"precio_efectivo,omitempty"`

	// Restante son las porciones que quedan hoy, según el cupo de la jornada
	// abierta. Tampoco es una columna: se resuelve al listar.
	//
	// nil NO es cero. nil es "este plato no lleva cuenta" —el cupo se opta
	// plato por plato, así que ilimitado es el default— y 0 es "lleva cuenta y
	// no queda". Viaja como puntero y sin omitempty para que la diferencia
	// llegue entera al JSON: el que no puede distinguir "no sé" de "no hay"
	// termina apagando el plato equivocado o vendiendo el que se terminó.
	Restante *int `gorm:"-" json:"restante"`
	// Agotado es Restante == 0. Va aparte para que nadie tenga que volver a
	// decidir qué significa un cero, y para que un plato ilimitado diga false
	// en vez de dejar al consumidor adivinando.
	Agotado bool `gorm:"-" json:"agotado"`

	// Limitante es el insumo que fijó ese Restante, y sólo existe cuando el
	// plato se controla por receta. Tampoco es una columna: sale del mismo
	// min() que derivó las porciones, así que mostrarlo no cuesta una consulta
	// más.
	//
	// Va con omitempty —al revés que Restante— porque acá su ausencia no es
	// ambigua: un plato sin receta no tiene limitante y nunca lo va a tener.
	// Restante necesita viajar siempre para que null se distinga de 0; este
	// campo, no. Así el JSON de un plato sin receta queda igual al de antes de
	// este cambio, que es lo que le promete el deploy a los negocios que no
	// cargaron un solo insumo.
	Limitante *InsumoLimitante `gorm:"-" json:"limitante,omitempty"`
}

func (Servicio) TableName() string { return "servicio" }

// InsumoLimitante nombra al culpable de que un plato tenga las porciones que
// tiene: el insumo más escaso de su receta, con su saldo y lo que la receta le
// pide por porción.
//
// Existe por una sola razón: un plato que se apaga solo y no dice por qué es
// indistinguible de un bug, y el dueño lo resuelve apagando la feature entera.
// Con estos tres números el panel puede decir "Hamburguesa: 0 — falta pan de
// papa (quedan 2, la receta pide 3)", y la diferencia entre "esto anda mal" y
// "ah, cargué mal el pan" se resuelve en dos segundos.
//
// Viaja también cuando el plato NO está agotado: es el insumo que se va a
// quedar corto primero, y es la forma de mostrar la dependencia entre platos
// que comparten materia prima en vez de dos números que parezcan sumables.
type InsumoLimitante struct {
	Insumo string `json:"insumo"` // nombre, no id: es para leer
	// Unidad viaja con los números y no es redundante: "quedan 2" no dice nada
	// —¿dos gramos o dos panes?— y ésta es exactamente la frase que el dueño lee
	// cuando un plato se le apagó solo. Sin ella el panel tiene que cruzar el
	// nombre contra el listado de insumos para saber en qué está expresado el
	// número, y ese cruce se rompe con dos insumos homónimos o con un rename
	// entre dos lecturas. Un campo acá cuesta menos que esa fragilidad.
	Unidad       string `json:"unidad"`
	Stock        int    `json:"stock"`          // cuánto hay, en la unidad del insumo
	PideLaReceta int    `json:"pide_la_receta"` // cuánto pide por porción
}

// ServicioRecurso: qué recurso puede prestar qué servicio.
type ServicioRecurso struct {
	ServicioID string `gorm:"type:uuid;primaryKey" json:"servicio_id"`
	RecursoID  string `gorm:"type:uuid;primaryKey" json:"recurso_id"`
}

func (ServicioRecurso) TableName() string { return "servicio_recurso" }
