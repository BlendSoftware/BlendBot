package service

import (
	"context"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// Errores de la exclusión receta ⊕ cupo. Los dos dicen explícitamente CUÁL de
// los dos hay que sacar: un "no se puede" pelado deja al dueño adivinando en el
// peor momento posible.
//
//	ErrPlatoConCupo   → 409
//	ErrPlatoConReceta → 409
var (
	// ErrPlatoConCupo: se quiso cargar una receta en un plato que ya tiene
	// cupo del día.
	ErrPlatoConCupo = errors.New("ese plato tiene cupo del día cargado: quitá el cupo antes de darle una receta")

	// ErrPlatoConReceta: se quiso poner cupo manual sobre un plato que se
	// controla por receta.
	ErrPlatoConReceta = errors.New("ese plato se controla por receta: sacá la receta antes de ponerle cupo")

	// ErrInsumoRepetido: el mismo insumo dos veces en la misma receta. El
	// índice único también lo rebota; esto existe para poder decirle al dueño
	// qué hacer (cambiar la cantidad de la línea que ya está) en vez de
	// mostrarle un error de Postgres.
	ErrInsumoRepetido = errors.New("ese insumo ya está en la receta: cambiá la cantidad de la línea que ya está")
)

// RecetaService: de qué está hecho cada plato.
type RecetaService interface {
	// DeServicio devuelve la receta con las porciones ya derivadas y el insumo
	// limitante nombrado.
	DeServicio(ctx context.Context, negocioID, servicioID string) (*dto.RecetaResponse, error)
	// Guardar reemplaza la receta entera. Con la lista vacía el plato vuelve a
	// ser ilimitado.
	Guardar(ctx context.Context, negocioID, servicioID string, in dto.GuardarRecetaInput) (*dto.RecetaResponse, error)
}

type recetaService struct {
	recetas   repository.RecetaRepository
	insumos   repository.InsumoRepository
	servicios repository.ServicioRepository
	// cupos y jornadas son la mitad "receta sobre plato con cupo" de la
	// exclusión. Opcionales: sin ellos no se puede validar ese sentido, pero
	// el otro (cupo sobre plato con receta, en CupoService) sigue en pie.
	cupos    cupoDelDiaLector
	jornadas repository.JornadaRepository
}

// cupoDelDiaLector es lo único que la receta necesita saber del cupo: qué
// platos llevan cuenta hoy. Lo implementa repository.CupoRepository.
//
// Es lectura y nada más: acá no se toca un cupo, se mira si existe.
type cupoDelDiaLector interface {
	RestantePorServicio(ctx context.Context, negocioID, jornadaID string) (map[string]int, error)
}

// OpcionReceta configura el service sin romperle la firma al constructor,
// igual que OpcionCatalogo y OpcionGastro.
type OpcionReceta func(*recetaService)

// ConExclusionDeCupo hace que cargar una receta rebote si el plato ya tiene
// cupo del día. Es la mitad de la exclusión que se valida acá; la otra mitad
// vive en CupoService (ConExclusionDeReceta) y las dos tienen que estar
// cableadas para que la regla sea de verdad.
func ConExclusionDeCupo(c cupoDelDiaLector, j repository.JornadaRepository) OpcionReceta {
	return func(s *recetaService) {
		s.cupos = c
		s.jornadas = j
	}
}

func NewRecetaService(
	recetas repository.RecetaRepository,
	insumos repository.InsumoRepository,
	servicios repository.ServicioRepository,
	opts ...OpcionReceta,
) RecetaService {
	s := &recetaService{recetas: recetas, insumos: insumos, servicios: servicios}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *recetaService) DeServicio(ctx context.Context, negocioID, servicioID string) (*dto.RecetaResponse, error) {
	if _, err := s.servicios.GetByID(ctx, negocioID, servicioID); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	return s.armar(ctx, negocioID, servicioID)
}

/*
Guardar reemplaza la receta entera de un plato.

Tres validaciones, y ninguna es opcional:

  - El servicio es de ESTE negocio. Sin esto se le carga una receta al plato de
    otro restaurante pasando su uuid.

  - El plato no tiene cupo del día. Es la mitad "receta sobre plato con cupo"
    de la exclusión (design §2): dos fuentes para el mismo número obligan a
    inventar una regla de precedencia, y toda regla de precedencia es una
    pregunta que el dueño se hace en el peor momento ("¿por qué dice 3 si
    cargué 10?"). Sólo se valida cuando la receta que llega NO está vacía:
    vaciar la receta es justamente cómo se sale de esta situación.

  - Ningún insumo repetido. El índice único lo rebota igual, pero un error de
    Postgres no le dice al dueño que lo que quiere es editar la línea que ya
    está.

El insumo de otro negocio lo rechaza el propio INSERT del repositorio, que
filtra por negocio_id adentro de la escritura.
*/
func (s *recetaService) Guardar(ctx context.Context, negocioID, servicioID string, in dto.GuardarRecetaInput) (*dto.RecetaResponse, error) {
	if _, err := s.servicios.GetByID(ctx, negocioID, servicioID); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}

	if len(in.Items) > 0 {
		tiene, err := s.tieneCupoDelDia(ctx, negocioID, servicioID)
		if err != nil {
			return nil, err
		}
		if tiene {
			return nil, ErrPlatoConCupo
		}
	}

	vistos := make(map[string]bool, len(in.Items))
	items := make([]model.RecetaItem, 0, len(in.Items))
	for _, l := range in.Items {
		if vistos[l.InsumoID] {
			return nil, ErrInsumoRepetido
		}
		vistos[l.InsumoID] = true
		if l.Cantidad <= 0 {
			return nil, repository.ErrCantidadInvalida
		}
		items = append(items, model.RecetaItem{InsumoID: l.InsumoID, Cantidad: l.Cantidad})
	}

	if err := s.recetas.Reemplazar(ctx, negocioID, servicioID, items); err != nil {
		return nil, traducirNoEncontradoStock(err)
	}
	return s.armar(ctx, negocioID, servicioID)
}

// tieneCupoDelDia mira SÓLO la jornada abierta, que es la misma ventana que
// mira el catálogo para resolver `restante`. Un cupo de una jornada cerrada es
// historia, no un control activo: bloquear una receta por un cupo que ya no
// decide nada sería rechazar por un fantasma.
//
// Sin la opción cableada, o con la caja cerrada, no se puede afirmar que haya
// cupo: se deja pasar. La otra mitad de la exclusión (CupoService) igual va a
// impedir que se le agregue cupo a este plato después.
func (s *recetaService) tieneCupoDelDia(ctx context.Context, negocioID, servicioID string) (bool, error) {
	if s.cupos == nil || s.jornadas == nil {
		return false, nil
	}
	j, err := s.jornadas.Actual(ctx, negocioID)
	if err != nil || j == nil || j.CerradaEn != nil {
		// Sin jornada abierta no hay cupo del día que valga. El error del repo
		// se traga a propósito: no poder mirar la jornada no puede impedirle al
		// dueño cargar una receta.
		return false, nil
	}
	restantes, err := s.cupos.RestantePorServicio(ctx, negocioID, j.ID)
	if err != nil {
		return false, err
	}
	_, tiene := restantes[servicioID]
	return tiene, nil
}

/*
armar arma la respuesta: las líneas con nombre y unidad, y las porciones
derivadas con el limitante nombrado.

El min(floor()) se hace acá y no en el repositorio porque es de UN plato: la
versión de toda la carta (PorcionesPorServicio) existe aparte justamente para
que el catálogo no llame a ésta en un loop, que sería el N+1 que el diseño
prohíbe.

Con cero líneas, Porciones queda en nil y TieneReceta en false: receta vacía es
un plato SIN receta, o sea ilimitado. NO agotado. Apagar un plato porque
alguien le vació la receta es el peor default posible — el dueño ve el plato
apagado, no entiende por qué, y apaga la feature entera.
*/
func (s *recetaService) armar(ctx context.Context, negocioID, servicioID string) (*dto.RecetaResponse, error) {
	items, err := s.recetas.DeServicio(ctx, negocioID, servicioID)
	if err != nil {
		return nil, err
	}
	resp := &dto.RecetaResponse{
		ServicioID:  servicioID,
		TieneReceta: len(items) > 0,
		Items:       make([]dto.LineaRecetaResponse, 0, len(items)),
	}
	if len(items) == 0 {
		return resp, nil
	}

	// Una sola lectura de los insumos del negocio para resolver los nombres y
	// las unidades de todas las líneas. Preguntar insumo por insumo acá sería
	// un N+1 chiquito, pero es el mismo reflejo que hay que no tener.
	todos, err := s.insumos.Listar(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	porID := make(map[string]model.Insumo, len(todos))
	for _, i := range todos {
		porID[i.ID] = i
	}

	primero := true
	for _, it := range items {
		i, hay := porID[it.InsumoID]
		if !hay {
			// El insumo se dio de baja (activo = FALSE) pero la receta sigue
			// apuntándolo. Se muestra la línea sin resolver en vez de omitirla:
			// una receta a la que le faltan líneas en la pantalla es cómo el
			// dueño termina creyendo que cargó algo que no cargó.
			resp.Items = append(resp.Items, dto.LineaRecetaResponse{
				InsumoID: it.InsumoID,
				Cantidad: it.Cantidad,
			})
			continue
		}
		resp.Items = append(resp.Items, dto.LineaRecetaResponse{
			InsumoID:     i.ID,
			InsumoNombre: i.Nombre,
			Unidad:       i.Unidad,
			Cantidad:     it.Cantidad,
			Stock:        i.Stock,
		})
		if it.Cantidad <= 0 {
			continue // el CHECK no lo permite; no dividir por cero igual
		}
		posibles := i.Stock / it.Cantidad // floor: 1000 g / 300 g = 3, no 3.33
		if primero || posibles < *resp.Porciones {
			p := posibles
			resp.Porciones = &p
			resp.InsumoLimitante = i.Nombre
			resp.UnidadLimitante = i.Unidad
			resp.StockLimitante = i.Stock
			resp.PideLaReceta = it.Cantidad
			primero = false
		}
	}
	return resp, nil
}
