package repository

import (
	"context"
	"errors"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// ErrSinCupo: no queda cupo de alguno de los platos del pedido. Es un error de
// negocio, no de transporte: el service lo traduce a 409 y el panel lo muestra.
var ErrSinCupo = errors.New("no queda cupo de alguno de los platos")

// ErrCupoMenorAlConsumido: se quiso bajar el cupo por debajo de lo ya vendido.
// No se puede "des-vender": o se deja como está, o se cancelan pedidos.
var ErrCupoMenorAlConsumido = errors.New("el cupo no puede ser menor a lo ya vendido")

// CupoConServicio es la fila del panel: el cupo más el nombre del plato, para
// no hacer una consulta por fila.
type CupoConServicio struct {
	ServicioID     string `gorm:"column:servicio_id"`
	ServicioNombre string `gorm:"column:servicio_nombre"`
	Asignado       int    `gorm:"column:asignado"`
	Consumido      int    `gorm:"column:consumido"`
	Disponible     bool   `gorm:"column:disponible"`
}

// CupoRepository lleva el cupo del día. La regla de oro está en Consumir: el
// descuento se hace con un UPDATE guardado, en Postgres, dentro de una
// transacción. No hay contador en Redis ni chequeo previo en Go — los dos
// abren la ventana entre "miré" y "descontá" por la que se cuela la
// sobreventa.
type CupoRepository interface {
	// DeJornada son los cupos cargados de esa jornada, con el nombre del plato.
	DeJornada(ctx context.Context, negocioID, jornadaID string) ([]CupoConServicio, error)
	// RestantePorServicio son los restantes de la jornada indexados por
	// servicio. Sólo trae los que TIENEN cupo: lo que no está, es ilimitado.
	RestantePorServicio(ctx context.Context, negocioID, jornadaID string) (map[string]int, error)
	// Set carga o pisa el cupo de un plato. Rechaza bajarlo por debajo de lo
	// ya consumido.
	Set(ctx context.Context, negocioID, jornadaID, servicioID string, asignado int) (*model.CupoJornada, error)
	// Quitar saca el cupo: el plato vuelve a ser ilimitado.
	Quitar(ctx context.Context, negocioID, jornadaID, servicioID string) error
	// Consumir descuenta de a varios platos de una. O entran todos, o no entra
	// ninguno: un pedido no se confirma a medias.
	Consumir(ctx context.Context, jornadaID string, porServicio map[string]int) error
	// Devolver reintegra lo consumido cuando el pedido se cae.
	Devolver(ctx context.Context, jornadaID string, porServicio map[string]int) error
}

type cupoRepo struct{ db *gorm.DB }

func NewCupoRepository(db *gorm.DB) CupoRepository { return &cupoRepo{db: db} }

func (r *cupoRepo) DeJornada(ctx context.Context, negocioID, jornadaID string) ([]CupoConServicio, error) {
	var out []CupoConServicio
	err := r.db.WithContext(ctx).Raw(`
		SELECT c.servicio_id   AS servicio_id,
		       s.nombre        AS servicio_nombre,
		       c.asignado      AS asignado,
		       c.consumido     AS consumido,
		       s.disponible    AS disponible
		  FROM cupo_jornada c
		  JOIN servicio s ON s.id = c.servicio_id AND s.negocio_id = c.negocio_id
		 WHERE c.negocio_id = ? AND c.jornada_id = ?
		 ORDER BY s.nombre ASC
	`, negocioID, jornadaID).Scan(&out).Error
	return out, err
}

func (r *cupoRepo) RestantePorServicio(ctx context.Context, negocioID, jornadaID string) (map[string]int, error) {
	var filas []struct {
		ServicioID string `gorm:"column:servicio_id"`
		Restante   int    `gorm:"column:restante"`
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT servicio_id, (asignado - consumido) AS restante
		  FROM cupo_jornada
		 WHERE negocio_id = ? AND jornada_id = ?
	`, negocioID, jornadaID).Scan(&filas).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(filas))
	for _, f := range filas {
		out[f.ServicioID] = f.Restante
	}
	return out, nil
}

func (r *cupoRepo) Set(ctx context.Context, negocioID, jornadaID, servicioID string, asignado int) (*model.CupoJornada, error) {
	var out model.CupoJornada
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// El upsert devuelve la fila resultante. La guarda del WHERE en el
		// DO UPDATE es lo que impide dejar un cupo por debajo de lo vendido:
		// si no aplica, no vuelve fila y sabemos por qué.
		res := tx.Raw(`
			INSERT INTO cupo_jornada (negocio_id, jornada_id, servicio_id, asignado)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (jornada_id, servicio_id) DO UPDATE
			   SET asignado = EXCLUDED.asignado, actualizado_en = NOW()
			 WHERE cupo_jornada.consumido <= EXCLUDED.asignado
			RETURNING id, negocio_id, jornada_id, servicio_id, asignado, consumido, creado_en, actualizado_en
		`, negocioID, jornadaID, servicioID, asignado).Scan(&out)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrCupoMenorAlConsumido
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (r *cupoRepo) Quitar(ctx context.Context, negocioID, jornadaID, servicioID string) error {
	return r.db.WithContext(ctx).Exec(`
		DELETE FROM cupo_jornada
		 WHERE negocio_id = ? AND jornada_id = ? AND servicio_id = ?
	`, negocioID, jornadaID, servicioID).Error
}

/*
Consumir es el corazón del módulo. Tres cosas que no son negociables:

  - Todo adentro de UNA transacción: un pedido de tres platos donde el tercero
    no tiene cupo no puede dejar descontados los dos primeros.

  - El SELECT ... FOR UPDATE ordenado por servicio_id: bloquea sólo las filas
    que tienen cupo (las que no, son ilimitadas y no se tocan) y el ORDER BY
    fija un orden global de toma de locks, que es lo que evita el deadlock
    entre dos pedidos que comparten platos en distinto orden.

  - El UPDATE lleva su propia guarda (`consumido + n <= asignado`) además del
    lock. Con el lock alcanzaría, pero la guarda es la que hace que este
    método siga siendo correcto si algún día alguien lo llama fuera de la
    transacción.
*/
func (r *cupoRepo) Consumir(ctx context.Context, jornadaID string, porServicio map[string]int) error {
	return r.mover(ctx, jornadaID, porServicio, true)
}

// Devolver reintegra sin guarda de tope: devolver nunca puede sobrevender, y
// el GREATEST(0, …) evita que un doble reintegro deje el consumido negativo.
func (r *cupoRepo) Devolver(ctx context.Context, jornadaID string, porServicio map[string]int) error {
	return r.mover(ctx, jornadaID, porServicio, false)
}

func (r *cupoRepo) mover(ctx context.Context, jornadaID string, porServicio map[string]int, consumir bool) error {
	if len(porServicio) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ids := make([]string, 0, len(porServicio))
		for id := range porServicio {
			ids = append(ids, id)
		}

		// Qué platos de este pedido tienen cupo. Los que no aparecen son
		// ilimitados y quedan afuera de todo el resto.
		var conCupo []string
		if err := tx.Raw(`
			SELECT servicio_id
			  FROM cupo_jornada
			 WHERE jornada_id = ? AND servicio_id IN ?
			 ORDER BY servicio_id
			 FOR UPDATE
		`, jornadaID, ids).Scan(&conCupo).Error; err != nil {
			return err
		}

		for _, servicioID := range conCupo {
			n := porServicio[servicioID]
			if n <= 0 {
				continue
			}
			var res *gorm.DB
			if consumir {
				res = tx.Exec(`
					UPDATE cupo_jornada
					   SET consumido = consumido + ?, actualizado_en = NOW()
					 WHERE jornada_id = ? AND servicio_id = ?
					   AND consumido + ? <= asignado
				`, n, jornadaID, servicioID, n)
			} else {
				res = tx.Exec(`
					UPDATE cupo_jornada
					   SET consumido = GREATEST(0, consumido - ?), actualizado_en = NOW()
					 WHERE jornada_id = ? AND servicio_id = ?
				`, n, jornadaID, servicioID)
			}
			if res.Error != nil {
				return res.Error
			}
			if consumir && res.RowsAffected == 0 {
				// La fila está bloqueada por nosotros y existe: si el UPDATE
				// no tocó nada es porque la guarda lo frenó. No hay cupo.
				return ErrSinCupo
			}
		}
		return nil
	})
}
