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
}

func (Servicio) TableName() string { return "servicio" }

// ServicioRecurso: qué recurso puede prestar qué servicio.
type ServicioRecurso struct {
	ServicioID string `gorm:"type:uuid;primaryKey" json:"servicio_id"`
	RecursoID  string `gorm:"type:uuid;primaryKey" json:"recurso_id"`
}

func (ServicioRecurso) TableName() string { return "servicio_recurso" }
