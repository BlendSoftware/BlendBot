package repository

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// ErrSinStock: no alcanza la materia prima para algo que se quiso descontar.
// Es un error de negocio, no de transporte: el service lo re-exporta y el
// handler lo traduce a 409, igual que ErrSinCupo.
//
// El error CONCRETO que devuelve Mover es *ErrStockDeInsumo, que envuelve a
// éste y además nombra el insumo. errors.Is(err, ErrSinStock) sigue andando.
var ErrSinStock = errors.New("no alcanza el stock de algún insumo")

// ErrStockDeInsumo es ErrSinStock con nombre y apellido: qué insumo faltó,
// cuánto pedía la operación y cuánto había.
//
// Existe porque "no hay stock" no le sirve a nadie en el medio del servicio: el
// local necesita saber si le faltó el pan o la carne para poder ir a buscarlo,
// mandar a comprarlo o corregir la receta. Un error genérico se resuelve
// apagando la feature; uno que nombra el insumo se resuelve en treinta
// segundos.
type ErrStockDeInsumo struct {
	Insumo string
	Pedido int
	Hay    int
}

func (e *ErrStockDeInsumo) Error() string {
	return fmt.Sprintf("no alcanza el stock de %s: hacen falta %d y quedan %d", e.Insumo, e.Pedido, e.Hay)
}

// Unwrap es lo que hace que errors.Is(err, ErrSinStock) siga siendo verdad. Sin
// esto, cada lugar que hoy compara contra el sentinel tendría que aprender un
// tipo nuevo.
func (e *ErrStockDeInsumo) Unwrap() error { return ErrSinStock }

// InsumoRepository lleva el saldo de materia prima del negocio.
//
// La regla de oro está en Mover, y es la misma que en CupoRepository.Consumir:
// el descuento se hace con un UPDATE guardado, en Postgres, dentro de una
// transacción. No hay chequeo previo en Go que decida si alcanza — eso abre la
// ventana entre "miré" y "descontá" por la que se cuela la sobreventa.
type InsumoRepository interface {
	Crear(ctx context.Context, negocioID string, in *model.Insumo) error
	Listar(ctx context.Context, negocioID string) ([]model.Insumo, error)
	GetByID(ctx context.Context, negocioID, id string) (*model.Insumo, error)
	// Actualizar cambia lo editable de un insumo. La UNIDAD no está acá a
	// propósito: cambiarla es una operación aparte porque puede tener que
	// rebotar (ver CambiarUnidad). stockMinimo nil BORRA el mínimo — es la
	// forma de decir "dejá de avisarme".
	Actualizar(ctx context.Context, negocioID, id string, nombre string, stockMinimo *int) error
	// CambiarUnidad reescribe la unidad de un insumo. Rebota con
	// ErrInsumoConRecetas si el insumo ya está en alguna receta: las
	// cantidades de esas líneas están expresadas en la unidad vieja y
	// cambiarla por abajo las multiplicaría o dividiría por mil en silencio.
	CambiarUnidad(ctx context.Context, negocioID, id, unidad string) error
	// Mover ajusta stock y registra el movimiento en la MISMA transacción, para
	// todos los insumos de una vez: o se mueve todo, o no se mueve nada.
	// Devuelve ErrSinStock nombrando el insumo que faltó.
	//
	// SaldoResultante lo llena Mover, NO el que llama: quien llame deja el
	// campo en cero. El saldo posterior sólo se conoce adentro de la
	// transacción que hizo el UPDATE —sale del RETURNING— y calcularlo afuera
	// abre la ventana de carrera que este registro existe para cerrar. Un
	// historial que miente sobre el saldo es peor que no tener historial.
	//
	// La excepción es el tipo `ajuste`, donde SaldoResultante es el dato de
	// ENTRADA: el dueño contó la heladera y dice en cuánto quedó. Ver
	// deltaDelMovimiento.
	Mover(ctx context.Context, negocioID string, movs []model.MovimientoInsumo) error
	Movimientos(ctx context.Context, negocioID, insumoID string, limite int) ([]model.MovimientoInsumo, error)
	// MovimientosDeCompromiso son los movimientos que originó un pedido.
	//
	// Es lo que permite devolver EXACTAMENTE lo que se consumió en vez de
	// recalcularlo desde la receta actual: si alguien edita la receta entre la
	// confirmación y la cancelación, recalcular devuelve la cantidad
	// equivocada y en silencio. "Deshacé lo que hiciste", no "recalculá lo que
	// harías ahora".
	MovimientosDeCompromiso(ctx context.Context, negocioID, compromisoID string) ([]model.MovimientoInsumo, error)
}

// ErrInsumoConRecetas: se quiso cambiar la unidad de un insumo que ya está en
// una receta. No se puede "reinterpretar" 300 de gramos a mililitros sin
// mentir sobre lo que el plato lleva.
var ErrInsumoConRecetas = errors.New("el insumo ya está en una receta expresada en la unidad vieja")

type insumoRepo struct{ db *gorm.DB }

func NewInsumoRepository(db *gorm.DB) InsumoRepository { return &insumoRepo{db: db} }

// Crear da de alta el insumo SIEMPRE en cero.
//
// El stock inicial no entra por acá aunque venga en el modelo: si el INSERT
// pudiera nacer con 40000, ése sería un camino que escribe insumo.stock sin
// dejar movimiento, y la historia arrancaría con un saldo que no explica de
// dónde salió. El alta con stock la hace el service en dos pasos: crear en cero
// y registrar una `compra` por Mover, que es el único camino que toca el stock.
func (r *insumoRepo) Crear(ctx context.Context, negocioID string, in *model.Insumo) error {
	in.NegocioID = negocioID
	in.Stock = 0
	return r.db.WithContext(ctx).Create(in).Error
}

func (r *insumoRepo) Listar(ctx context.Context, negocioID string) ([]model.Insumo, error) {
	var out []model.Insumo
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND activo = TRUE", negocioID).
		Order("nombre asc").
		Find(&out).Error
	return out, err
}

func (r *insumoRepo) GetByID(ctx context.Context, negocioID, id string) (*model.Insumo, error) {
	var in model.Insumo
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", id, negocioID).
		First(&in).Error
	if err != nil {
		return nil, err
	}
	return &in, nil
}

func (r *insumoRepo) Actualizar(ctx context.Context, negocioID, id string, nombre string, stockMinimo *int) error {
	// El stock NO se toca acá: cambiarlo sin escribir un movimiento dejaría un
	// agujero en la historia, que es justo lo que movimiento_insumo existe para
	// impedir. Para mover stock está Mover, y no hay otro camino.
	res := r.db.WithContext(ctx).Exec(`
		UPDATE insumo
		   SET nombre = ?, stock_minimo = ?, actualizado_en = NOW()
		 WHERE id = ? AND negocio_id = ?
	`, nombre, stockMinimo, id, negocioID)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *insumoRepo) CambiarUnidad(ctx context.Context, negocioID, id, unidad string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// El chequeo y el UPDATE van juntos en la transacción: si se hicieran
		// sueltos, alguien podría cargar la receta entre los dos y el cambio de
		// unidad pasaría igual.
		var n int64
		if err := tx.Raw(`
			SELECT COUNT(*)
			  FROM receta_item r
			  JOIN insumo i ON i.id = r.insumo_id
			 WHERE r.insumo_id = ? AND i.negocio_id = ?
		`, id, negocioID).Scan(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return ErrInsumoConRecetas
		}
		res := tx.Exec(`
			UPDATE insumo SET unidad = ?, actualizado_en = NOW()
			 WHERE id = ? AND negocio_id = ?
		`, unidad, id, negocioID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

/*
Mover es el corazón del módulo, y es la misma disciplina que cupoRepo.mover.
Tres cosas que no son negociables:

  - Todo adentro de UNA transacción. Un pedido de tres platos donde el tercero
    se queda sin pan no puede dejar descontada la carne de los dos primeros: o
    se mueve todo, o no se mueve nada.

  - El SELECT ... FOR UPDATE ordenado por id fija un orden global de toma de
    locks, que es lo que evita el deadlock entre dos pedidos que comparten
    insumos en distinto orden. A diferencia del cupo, acá el insumo que no
    aparece es un ERROR y no un "ilimitado": una receta apunta a insumos que
    existen, y un id que no aparece es de otro negocio o no existe. Dejarlo
    pasar en silencio sería aceptar el uuid del insumo de otro restaurante.

  - El UPDATE lleva su propia guarda (stock - n >= 0) además del lock, y
    insumo_stock_no_negativo en la tabla es el árbitro final. Con el lock
    alcanzaría; la guarda es la que hace que esto siga siendo correcto si algún
    día alguien llama al método fuera de la transacción.

Y la cuarta, que es de este módulo y no del cupo: el INSERT en
movimiento_insumo va en la MISMA transacción que el UPDATE del stock, y el
saldo que registra sale del RETURNING de ese mismo UPDATE. No existe —y no
puede existir— un camino que escriba uno sin el otro, ni uno que registre un
saldo que el UPDATE no devolvió.

Semántica del signo, por tipo:

	compra, devolucion → suman Cantidad
	consumo            → resta Cantidad
	ajuste             → deja el saldo en SaldoResultante, y Cantidad se
	                     CALCULA como |nuevo - viejo|

El ajuste es el único donde el tipo no alcanza para saber el signo, porque el
dueño no piensa en deltas: contó la heladera y hay 3200. Que el dato de entrada
sea el saldo y no la diferencia evita que el service tenga que leer el stock
antes de escribirlo, que es exactamente la ventana de carrera que este método
existe para cerrar.
*/
func (r *insumoRepo) Mover(ctx context.Context, negocioID string, movs []model.MovimientoInsumo) error {
	if len(movs) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ids := make([]string, 0, len(movs))
		vistos := make(map[string]bool, len(movs))
		for _, m := range movs {
			if !vistos[m.InsumoID] {
				vistos[m.InsumoID] = true
				ids = append(ids, m.InsumoID)
			}
		}

		var filas []struct {
			ID     string `gorm:"column:id"`
			Nombre string `gorm:"column:nombre"`
			Stock  int    `gorm:"column:stock"`
		}
		if err := tx.Raw(`
			SELECT id, nombre, stock
			  FROM insumo
			 WHERE negocio_id = ? AND id IN ?
			 ORDER BY id
			 FOR UPDATE
		`, negocioID, ids).Scan(&filas).Error; err != nil {
			return err
		}
		if len(filas) != len(ids) {
			// Alguno de los insumos no es de este negocio o no existe. No se
			// saltea: se rechaza la operación entera.
			return gorm.ErrRecordNotFound
		}

		// Saldo corriente en memoria. NO es el que se registra —ése sale del
		// RETURNING— pero hace falta para dos cosas: calcular el delta de un
		// `ajuste` (el dueño dice en cuánto quedó, no cuánto movió) y poder
		// decir "quedan 2" en el error cuando no alcanza.
		saldo := make(map[string]int, len(filas))
		nombre := make(map[string]string, len(filas))
		for _, f := range filas {
			saldo[f.ID] = f.Stock
			nombre[f.ID] = f.Nombre
		}

		// Mismo orden que los locks: el orden de aplicación no cambia el
		// resultado, pero mantenerlo hace que dos tandas idénticas escriban la
		// historia en el mismo orden y que un log sea comparable con otro.
		orden := make([]int, len(movs))
		for i := range movs {
			orden[i] = i
		}
		sort.SliceStable(orden, func(a, b int) bool {
			return movs[orden[a]].InsumoID < movs[orden[b]].InsumoID
		})

		for _, idx := range orden {
			m := movs[idx]
			delta, cantidad, err := deltaDelMovimiento(m, saldo[m.InsumoID])
			if err != nil {
				return err
			}
			if delta == 0 {
				// Un ajuste que no cambia nada no es un movimiento: escribirlo
				// llenaría la historia de ruido y haría más difícil contestar
				// la única pregunta que la historia tiene que contestar.
				continue
			}
			if saldo[m.InsumoID]+delta < 0 {
				// Falla antes del UPDATE para poder NOMBRAR el insumo y decir
				// cuánto había. La guarda del UPDATE de abajo sigue estando:
				// ésta es para el mensaje, aquélla para la correctitud.
				return &ErrStockDeInsumo{
					Insumo: nombre[m.InsumoID],
					Pedido: cantidad,
					Hay:    saldo[m.InsumoID],
				}
			}

			// El RETURNING es lo que hace que el saldo del historial sea el
			// saldo REAL post-UPDATE y no una cuenta que hicimos afuera. Sin
			// él, el número que el dueño lee para auditar su heladera sería
			// una estimación del cliente, no un hecho de la base.
			var nuevo []int
			res := tx.Raw(`
				UPDATE insumo
				   SET stock = stock + ?, actualizado_en = NOW()
				 WHERE id = ? AND negocio_id = ?
				   AND stock + ? >= 0
				RETURNING stock
			`, delta, m.InsumoID, negocioID, delta).Scan(&nuevo)
			if res.Error != nil {
				return res.Error
			}
			if len(nuevo) == 0 {
				// La fila está bloqueada por nosotros y existe: si el UPDATE no
				// tocó nada es porque la guarda lo frenó. No hay stock.
				return &ErrStockDeInsumo{
					Insumo: nombre[m.InsumoID],
					Pedido: cantidad,
					Hay:    saldo[m.InsumoID],
				}
			}

			saldo[m.InsumoID] = nuevo[0]
			if err := tx.Exec(`
				INSERT INTO movimiento_insumo
					(insumo_id, tipo, cantidad, saldo_resultante, compromiso_id, motivo)
				VALUES (?, ?, ?, ?, ?, ?)
			`, m.InsumoID, m.Tipo, cantidad, nuevo[0], m.CompromisoID, m.Motivo).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// deltaDelMovimiento traduce (tipo, cantidad, saldo pedido) a la variación que
// hay que aplicar y a la magnitud que se registra en la historia.
func deltaDelMovimiento(m model.MovimientoInsumo, actual int) (delta, cantidad int, err error) {
	switch m.Tipo {
	case model.MovCompra, model.MovDevolucion:
		if m.Cantidad <= 0 {
			return 0, 0, ErrCantidadInvalida
		}
		return m.Cantidad, m.Cantidad, nil
	case model.MovConsumo:
		if m.Cantidad <= 0 {
			return 0, 0, ErrCantidadInvalida
		}
		return -m.Cantidad, m.Cantidad, nil
	case model.MovAjuste:
		// El dueño dice en cuánto quedó, no cuánto movió.
		if m.SaldoResultante < 0 {
			return 0, 0, ErrCantidadInvalida
		}
		d := m.SaldoResultante - actual
		if d < 0 {
			return d, -d, nil
		}
		return d, d, nil
	default:
		return 0, 0, ErrTipoMovimientoInvalido
	}
}

var (
	// ErrCantidadInvalida: una cantidad que no es positiva. El CHECK de la
	// tabla también la rebota; esto existe para dar un mensaje entendible.
	ErrCantidadInvalida = errors.New("la cantidad tiene que ser mayor a cero")
	// ErrTipoMovimientoInvalido: un tipo que no es uno de los cuatro.
	ErrTipoMovimientoInvalido = errors.New("tipo de movimiento invalido")
)

func (r *insumoRepo) Movimientos(ctx context.Context, negocioID, insumoID string, limite int) ([]model.MovimientoInsumo, error) {
	if limite <= 0 {
		limite = 50
	}
	var out []model.MovimientoInsumo
	// El JOIN con insumo es el que acota por tenant: movimiento_insumo no lleva
	// negocio_id, así que sin esto un uuid ajeno leería la historia de otro
	// local.
	err := r.db.WithContext(ctx).Raw(`
		SELECT m.id, m.insumo_id, m.tipo, m.cantidad, m.saldo_resultante,
		       m.compromiso_id, m.motivo, m.creado_en
		  FROM movimiento_insumo m
		  JOIN insumo i ON i.id = m.insumo_id
		 WHERE i.negocio_id = ? AND m.insumo_id = ?
		 ORDER BY m.creado_en DESC
		 LIMIT ?
	`, negocioID, insumoID, limite).Scan(&out).Error
	return out, err
}

// MovimientosDeCompromiso son los movimientos que originó un pedido, del más
// viejo al más nuevo.
//
// Existe para que devolver sea "deshacé lo que hiciste" y no "recalculá lo que
// harías ahora". Recalcular desde la receta actual parece equivalente y no lo
// es: si alguien le cambia la cantidad a una línea entre que el pedido se
// confirma y que se cancela, la devolución le mete al insumo una cantidad que
// nunca salió, y no hay forma de darse cuenta después. Leer lo que efectivamente
// se movió no tiene ese agujero.
//
// Trae los cuatro tipos, no sólo `consumo`: quien devuelva tiene que poder ver
// si ese compromiso ya fue devuelto antes y no devolverlo dos veces.
func (r *insumoRepo) MovimientosDeCompromiso(ctx context.Context, negocioID, compromisoID string) ([]model.MovimientoInsumo, error) {
	var out []model.MovimientoInsumo
	err := r.db.WithContext(ctx).Raw(`
		SELECT m.id, m.insumo_id, m.tipo, m.cantidad, m.saldo_resultante,
		       m.compromiso_id, m.motivo, m.creado_en
		  FROM movimiento_insumo m
		  JOIN insumo i ON i.id = m.insumo_id
		 WHERE i.negocio_id = ? AND m.compromiso_id = ?
		 ORDER BY m.creado_en ASC
	`, negocioID, compromisoID).Scan(&out).Error
	return out, err
}
