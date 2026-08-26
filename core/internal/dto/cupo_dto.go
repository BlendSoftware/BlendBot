package dto

import "copiloto/core/internal/repository"

// SetCupoInput carga o pisa el cupo de un plato en la jornada abierta.
//
// Asignado es puntero por el mismo motivo que el interruptor: 0 es el valor
// interesante ("no queda más") y `binding:"required"` sobre un int plano lo
// rechazaría. Sobre un puntero, required sólo exige que venga el campo.
type SetCupoInput struct {
	ServicioID string `json:"servicio_id" binding:"required,uuid"`
	Asignado   *int   `json:"asignado" binding:"required,min=0"`
}

// CupoResponse es una fila de la pantalla de stock.
//
// `disponible` (el interruptor manual) y `agotado` (el cupo en cero) van por
// separado a propósito: son dos motivos distintos por los que un plato no se
// vende, y el que está en la cocina necesita saber cuál de los dos es. El
// interruptor manual le gana al cupo — si alguien apagó el plato, apagado
// queda aunque sobren porciones.
type CupoResponse struct {
	ServicioID     string `json:"servicio_id"`
	ServicioNombre string `json:"servicio_nombre"`
	Asignado       int    `json:"asignado"`
	Consumido      int    `json:"consumido"`
	Restante       int    `json:"restante"`
	Agotado        bool   `json:"agotado"`
	Disponible     bool   `json:"disponible"`
}

// CupoDesdeRepo arma la fila del panel a partir de la consulta del repositorio.
func CupoDesdeRepo(c repository.CupoConServicio) CupoResponse {
	restante := c.Asignado - c.Consumido
	if restante < 0 {
		restante = 0
	}
	return CupoResponse{
		ServicioID:     c.ServicioID,
		ServicioNombre: c.ServicioNombre,
		Asignado:       c.Asignado,
		Consumido:      c.Consumido,
		Restante:       restante,
		Agotado:        restante == 0,
		Disponible:     c.Disponible,
	}
}
