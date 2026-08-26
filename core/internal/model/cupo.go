package model

import "time"

// CupoJornada es cuántas porciones de un plato quedan en la jornada abierta.
//
// Un servicio SIN fila es ilimitado: el cupo se opta plato por plato. Eso
// mantiene el comportamiento de siempre para el que no lo usa y hace que
// "sacar el cupo" sea borrar la fila, no poner un número mágico.
type CupoJornada struct {
	ID            string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID     string    `gorm:"type:uuid;not null" json:"negocio_id"`
	JornadaID     string    `gorm:"type:uuid;not null" json:"jornada_id"`
	ServicioID    string    `gorm:"type:uuid;not null" json:"servicio_id"`
	Asignado      int       `gorm:"not null" json:"asignado"`
	Consumido     int       `gorm:"not null;default:0" json:"consumido"`
	CreadoEn      time.Time `gorm:"autoCreateTime" json:"creado_en"`
	ActualizadoEn time.Time `json:"actualizado_en"`
}

func (CupoJornada) TableName() string { return "cupo_jornada" }

// Restante es lo que queda por vender. Nunca negativo: la CHECK de la tabla
// garantiza consumido <= asignado.
func (c CupoJornada) Restante() int {
	r := c.Asignado - c.Consumido
	if r < 0 {
		return 0
	}
	return r
}

// Agotado es el plato que llegó a cero. Es lo que apaga el ítem para el
// cliente sin que nadie toque el interruptor.
func (c CupoJornada) Agotado() bool { return c.Restante() == 0 }
