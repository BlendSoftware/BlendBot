package service

import (
	"context"
	"errors"
	"strings"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

// Errores del módulo de insumos. El mapeo a HTTP vive en
// handler.responderErrorMotor:
//
//	ErrUnidadInvalida   → 422
//	ErrInsumoConRecetas → 409
//
// ErrSinStock NO se re-exporta acá: ya lo hace descuento_stock.go, que es
// donde el handler lo necesita. Declararlo dos veces en el mismo paquete no
// compila.
var (
	// ErrUnidadInvalida: la unidad no es una de las tres. No hay conversión,
	// así que tampoco hay forma de "interpretar" kg.
	ErrUnidadInvalida = errors.New("unidad invalida: g, ml o unidad")

	// ErrInsumoConRecetas se re-exporta del repositorio: se quiso cambiar la
	// unidad de un insumo que ya está en una receta.
	ErrInsumoConRecetas = repository.ErrInsumoConRecetas
)

// InsumoService es la Capa 2 del control de stock: la materia prima del
// negocio como saldo corriente.
//
// A diferencia de CupoService, acá NO hay jornada en el medio. El insumo es un
// saldo que persiste —la carne que sobra hoy sigue estando mañana—, así que
// todas las operaciones andan con la caja cerrada. Exigir jornada abierta para
// registrar una compra sería pedirle al dueño que abra el día para guardar la
// mercadería que le acaban de traer.
type InsumoService interface {
	Listar(ctx context.Context, negocioID string) ([]dto.InsumoResponse, error)
	Crear(ctx context.Context, negocioID string, in dto.CrearInsumoInput) (*dto.InsumoResponse, error)
	Actualizar(ctx context.Context, negocioID, id string, in dto.ActualizarInsumoInput) (*dto.InsumoResponse, error)
	// RegistrarCompra suma al saldo: "entraron 20000 g de carne".
	RegistrarCompra(ctx context.Context, negocioID, id string, in dto.RegistrarCompraInput) (*dto.InsumoResponse, error)
	// Ajustar deja el saldo donde el dueño dice que está: contó la heladera.
	Ajustar(ctx context.Context, negocioID, id string, in dto.AjustarStockInput) (*dto.InsumoResponse, error)
	// Movimientos es la historia que responde "compré 20 kg, ¿por qué me
	// quedan 3?".
	Movimientos(ctx context.Context, negocioID, id string, limite int) ([]dto.MovimientoResponse, error)
}

type insumoService struct {
	insumos repository.InsumoRepository
}

func NewInsumoService(insumos repository.InsumoRepository) InsumoService {
	return &insumoService{insumos: insumos}
}

func (s *insumoService) Listar(ctx context.Context, negocioID string) ([]dto.InsumoResponse, error) {
	list, err := s.insumos.Listar(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.InsumoResponse, 0, len(list))
	for _, i := range list {
		out = append(out, dto.InsumoDesde(i))
	}
	return out, nil
}

// Crear da de alta el insumo y, si viene con stock inicial, lo carga como una
// `compra`.
//
// Son dos pasos y no uno a propósito: el alta escribe la fila en cero y el
// stock entra por Mover, que es el ÚNICO camino que toca insumo.stock. Si el
// INSERT pudiera nacer con 40000, la historia del insumo arrancaría con un
// saldo que no explica de dónde salió, y "reconstruir cómo llegué del saldo
// anterior al actual" dejaría de ser posible desde el primer día.
//
// Si el segundo paso falla, el insumo queda creado en cero: es recuperable con
// una compra desde el panel, y es mejor que la alternativa (perder el alta o
// dejar stock sin movimiento).
func (s *insumoService) Crear(ctx context.Context, negocioID string, in dto.CrearInsumoInput) (*dto.InsumoResponse, error) {
	unidad := strings.TrimSpace(in.Unidad)
	if !model.UnidadValida(unidad) {
		return nil, ErrUnidadInvalida
	}
	nuevo := &model.Insumo{
		Nombre:      strings.TrimSpace(in.Nombre),
		Unidad:      unidad,
		StockMinimo: in.StockMinimo,
		Activo:      true,
	}
	if err := s.insumos.Crear(ctx, negocioID, nuevo); err != nil {
		return nil, err
	}
	if in.StockInicial != nil && *in.StockInicial > 0 {
		motivo := "carga inicial"
		if err := s.insumos.Mover(ctx, negocioID, []model.MovimientoInsumo{{
			InsumoID: nuevo.ID,
			Tipo:     model.MovCompra,
			Cantidad: *in.StockInicial,
			Motivo:   &motivo,
		}}); err != nil {
			return nil, err
		}
	}
	return s.leer(ctx, negocioID, nuevo.ID)
}

// Actualizar edita nombre, mínimo y —con condiciones— unidad.
//
// El cambio de unidad va aparte porque puede rebotar: si el insumo ya está en
// una receta, las cantidades de esas líneas están expresadas en la unidad
// vieja y cambiarla por abajo las multiplicaría o dividiría por mil en
// silencio. Ése es exactamente el bug que apaga la cocina entera sin que nadie
// entienda por qué, así que se rechaza y se explica.
func (s *insumoService) Actualizar(ctx context.Context, negocioID, id string, in dto.ActualizarInsumoInput) (*dto.InsumoResponse, error) {
	actual, err := s.insumos.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	if in.Unidad != nil {
		unidad := strings.TrimSpace(*in.Unidad)
		if !model.UnidadValida(unidad) {
			return nil, ErrUnidadInvalida
		}
		// Mandar la misma unidad que ya tiene NO es un cambio: el panel manda
		// el formulario entero y no tiene por qué saber qué tocó el usuario.
		if unidad != actual.Unidad {
			if err := s.insumos.CambiarUnidad(ctx, negocioID, id, unidad); err != nil {
				return nil, traducirNoEncontradoStock(err)
			}
		}
	}
	if err := s.insumos.Actualizar(ctx, negocioID, id, strings.TrimSpace(in.Nombre), in.StockMinimo); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	return s.leer(ctx, negocioID, id)
}

func (s *insumoService) RegistrarCompra(ctx context.Context, negocioID, id string, in dto.RegistrarCompraInput) (*dto.InsumoResponse, error) {
	if err := s.insumos.Mover(ctx, negocioID, []model.MovimientoInsumo{{
		InsumoID: id,
		Tipo:     model.MovCompra,
		Cantidad: in.Cantidad,
		Motivo:   in.Motivo,
	}}); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	return s.leer(ctx, negocioID, id)
}

// Ajustar manda el SALDO, no la diferencia. Ver el doc de Mover: el dato de
// entrada es en cuánto quedó porque es lo que el dueño sabe (contó lo que hay),
// y porque así el servidor no tiene que leer el stock antes de escribirlo.
func (s *insumoService) Ajustar(ctx context.Context, negocioID, id string, in dto.AjustarStockInput) (*dto.InsumoResponse, error) {
	nuevo := 0
	if in.Stock != nil {
		nuevo = *in.Stock
	}
	if err := s.insumos.Mover(ctx, negocioID, []model.MovimientoInsumo{{
		InsumoID:        id,
		Tipo:            model.MovAjuste,
		SaldoResultante: nuevo,
		Motivo:          in.Motivo,
	}}); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	return s.leer(ctx, negocioID, id)
}

func (s *insumoService) Movimientos(ctx context.Context, negocioID, id string, limite int) ([]dto.MovimientoResponse, error) {
	// Existe y es de este negocio: sin esto, un uuid ajeno devolvería una lista
	// vacía en vez de un 404, que es una forma lenta de mapear insumos ajenos.
	if _, err := s.insumos.GetByID(ctx, negocioID, id); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	movs, err := s.insumos.Movimientos(ctx, negocioID, id, limite)
	if err != nil {
		return nil, err
	}
	out := make([]dto.MovimientoResponse, 0, len(movs))
	for _, m := range movs {
		out = append(out, dto.MovimientoDesde(ctx, m))
	}
	return out, nil
}

// leer devuelve el insumo tal como quedó. Se relee de la base en vez de armar
// la respuesta en memoria porque el saldo lo escribió una transacción y el
// único que sabe en qué terminó es Postgres.
func (s *insumoService) leer(ctx context.Context, negocioID, id string) (*dto.InsumoResponse, error) {
	i, err := s.insumos.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	r := dto.InsumoDesde(*i)
	return &r, nil
}

// traducirNoEncontradoStock normaliza el error del ORM al sentinel del motor.
// Se usa el mismo ErrNoEncontrado que el resto para no distinguir nunca "no
// existe" de "es de otro tenant".
func traducirNoEncontradoStock(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNoEncontrado
	}
	return err
}
