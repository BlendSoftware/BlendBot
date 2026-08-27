package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// PorcionesServicio es lo que el catálogo y el panel necesitan saber de un
// plato con receta. El limitante viaja para que el panel pueda nombrarlo:
// un plato que se apaga solo y no dice por qué es indistinguible de un bug.
//
// InsumoLimitante es el NOMBRE, no el id: el panel lo escribe tal cual en
// "falta pan de papa (quedan 2, la receta pide 1)". Resolverlo después sería
// otra consulta para un dato que ya teníamos en la mano.
type PorcionesServicio struct {
	Porciones       int    // min(floor(stock/cantidad)) sobre todas las líneas
	InsumoLimitante string // nombre del insumo que dio el mínimo
	// UnidadLimitante viaja pegada a los números: "quedan 2" no dice nada si no
	// se sabe si son dos gramos o dos panes, y ésa es la frase que el dueño lee
	// cuando un plato se apagó solo. Sale de la misma consulta; resolverla
	// después obligaría al panel a cruzar por nombre contra el listado de
	// insumos, y ese cruce se rompe con homónimos o con un rename en el medio.
	UnidadLimitante string // "g" | "ml" | "unidad"
	StockLimitante  int    // cuánto hay de ese insumo
	PideLaReceta    int    // cuánto pide la receta de ese insumo por porción
}

// RecetaRepository lleva de qué está hecho cada plato.
//
// DeServicio y PorcionesPorServicio son dos preguntas distintas y las dos
// hacen falta: DeServicio es "qué descuento cuando confirman ESTE plato" y
// PorcionesPorServicio es "cuántas porciones da CADA plato de la carta".
// Resolver la segunda llamando a la primera en un loop es el N+1 sobre dos
// tablas que el diseño prohíbe, y el catálogo se pide en cada mensaje de cada
// conversación.
type RecetaRepository interface {
	DeServicio(ctx context.Context, negocioID, servicioID string) ([]model.RecetaItem, error)
	Reemplazar(ctx context.Context, negocioID, servicioID string, items []model.RecetaItem) error
	TieneReceta(ctx context.Context, negocioID, servicioID string) (bool, error)
	// PorcionesPorServicio resuelve TODA la carta en UNA consulta.
	// Sólo trae servicios que TIENEN receta con al menos una línea.
	// Lo que no está en el mapa, no tiene receta (mismo criterio que
	// RestantePorServicio con el cupo: ausente = no lleva cuenta).
	PorcionesPorServicio(ctx context.Context, negocioID string) (map[string]PorcionesServicio, error)
}

type recetaRepo struct{ db *gorm.DB }

func NewRecetaRepository(db *gorm.DB) RecetaRepository { return &recetaRepo{db: db} }

func (r *recetaRepo) DeServicio(ctx context.Context, negocioID, servicioID string) ([]model.RecetaItem, error) {
	var out []model.RecetaItem
	// El JOIN con servicio es el que acota por tenant: receta_item no lleva
	// negocio_id (igual que precio_cobertura), así que el negocio se valida
	// acá o no lo valida nadie.
	err := r.db.WithContext(ctx).Raw(`
		SELECT r.id, r.servicio_id, r.insumo_id, r.cantidad
		  FROM receta_item r
		  JOIN servicio s ON s.id = r.servicio_id
		 WHERE s.negocio_id = ? AND r.servicio_id = ?
		 ORDER BY r.insumo_id
	`, negocioID, servicioID).Scan(&out).Error
	return out, err
}

// Reemplazar pisa la receta entera de un plato: borra lo que había y escribe lo
// que viene, en una transacción.
//
// Es reemplazo y no un CRUD línea por línea porque el editor del panel edita la
// receta como una unidad ("la hamburguesa lleva esto"). Un alta/baja/cambio por
// línea deja al panel teniendo que diffear contra el servidor, y el día que ese
// diff esté mal la receta queda a medias sin que nadie se entere.
//
// Una lista vacía deja el plato SIN receta, que es ilimitado. Es lo mismo que
// borrarle todas las líneas y está bien que sea así: el default de un plato sin
// información no puede ser "apagado".
func (r *recetaRepo) Reemplazar(ctx context.Context, negocioID, servicioID string, items []model.RecetaItem) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// El subselect por negocio es lo que impide vaciar la receta de un
		// plato ajeno pasando su uuid.
		res := tx.Exec(`
			DELETE FROM receta_item
			 WHERE servicio_id IN (SELECT id FROM servicio WHERE id = ? AND negocio_id = ?)
		`, servicioID, negocioID)
		if res.Error != nil {
			return res.Error
		}
		for _, it := range items {
			// El INSERT ... SELECT lleva la validación de tenant adentro de la
			// escritura: si el insumo no es de este negocio no inserta nada y
			// nos enteramos por RowsAffected. Validarlo antes en el service
			// también se hace, pero esto es lo que lo hace imposible.
			ins := tx.Exec(`
				INSERT INTO receta_item (servicio_id, insumo_id, cantidad)
				SELECT ?, i.id, ?
				  FROM insumo i
				 WHERE i.id = ? AND i.negocio_id = ?
			`, servicioID, it.Cantidad, it.InsumoID, negocioID)
			if ins.Error != nil {
				return ins.Error
			}
			if ins.RowsAffected == 0 {
				return gorm.ErrRecordNotFound
			}
		}
		return nil
	})
}

// TieneReceta es "este plato se controla por insumos". Con CERO líneas la
// respuesta es false: una receta vacía es un plato sin receta, no un plato
// agotado.
func (r *recetaRepo) TieneReceta(ctx context.Context, negocioID, servicioID string) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(*)
		  FROM receta_item r
		  JOIN servicio s ON s.id = r.servicio_id
		 WHERE s.negocio_id = ? AND r.servicio_id = ?
	`, negocioID, servicioID).Scan(&n).Error
	return n > 0, err
}

/*
PorcionesPorServicio resuelve la carta entera en UNA consulta y hace el min()
en memoria.

El camino ingenuo —por cada plato traer su receta, por cada línea traer su
insumo— es un N+1 sobre dos tablas, y el catálogo se pide en cada mensaje de
cada conversación. `stock-visible-al-agente` ya sentó el precedente de resolver
el stock en una consulta agrupada; esto lo sostiene.

Por qué el min() se hace en Go y no con un GROUP BY: el argmin. El panel no
necesita sólo cuántas porciones quedan, necesita CUÁL insumo dio ese mínimo y
con qué números, y sacar eso en SQL pide una window function o un segundo pase.
En Go es el mismo loop que ya calcula el mínimo y sale gratis.

floor y no redondeo: la división entera de Go sobre no-negativos ES floor.
1000 g de carne con una receta de 300 g da 3 porciones, no 3.33 ni 4. Redondear
para arriba acá es prometer un plato que no se puede cocinar.
*/
func (r *recetaRepo) PorcionesPorServicio(ctx context.Context, negocioID string) (map[string]PorcionesServicio, error) {
	var filas []struct {
		ServicioID string `gorm:"column:servicio_id"`
		Insumo     string `gorm:"column:insumo"`
		Unidad     string `gorm:"column:unidad"`
		Stock      int    `gorm:"column:stock"`
		Cantidad   int    `gorm:"column:cantidad"`
	}
	// Arranca por servicio (idx_servicio_negocio), entra a receta_item por
	// idx_receta_servicio_insumo y a insumo por su PK. El negocio se exige en
	// los DOS lados: un insumo de otro tenant colado en una receta no debería
	// existir, y si existiera no va a apagar platos de este local.
	if err := r.db.WithContext(ctx).Raw(`
		SELECT r.servicio_id AS servicio_id,
		       i.nombre      AS insumo,
		       i.unidad      AS unidad,
		       i.stock       AS stock,
		       r.cantidad    AS cantidad
		  FROM servicio s
		  JOIN receta_item r ON r.servicio_id = s.id
		  JOIN insumo i      ON i.id = r.insumo_id AND i.negocio_id = s.negocio_id
		 WHERE s.negocio_id = ?
		 ORDER BY r.servicio_id, i.nombre
	`, negocioID).Scan(&filas).Error; err != nil {
		return nil, err
	}

	out := make(map[string]PorcionesServicio)
	for _, f := range filas {
		if f.Cantidad <= 0 {
			// El CHECK (cantidad > 0) no deja llegar acá. Si algún día llegara,
			// saltear la línea es mejor que dividir por cero y tirar el
			// catálogo entero de un negocio.
			continue
		}
		posibles := f.Stock / f.Cantidad // floor: son dos enteros no negativos
		actual, hay := out[f.ServicioID]
		if !hay || posibles < actual.Porciones {
			out[f.ServicioID] = PorcionesServicio{
				Porciones:       posibles,
				InsumoLimitante: f.Insumo,
				UnidadLimitante: f.Unidad,
				StockLimitante:  f.Stock,
				PideLaReceta:    f.Cantidad,
			}
		}
	}
	return out, nil
}
