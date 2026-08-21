package service

import (
	"context"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

// ErrNoExisteEnNegocio cubre los dos casos a propósito: la fila no existe, o
// existe pero es de otro tenant. Desde afuera no se distinguen — eso es lo que
// impide usar los 404 para mapear el catálogo ajeno.
var ErrNoExisteEnNegocio = errors.New("no encontrado en este negocio")

// CatalogoService: lo que el negocio ofrece y con qué lo presta.
type CatalogoService interface {
	// Categorías
	ListarCategorias(ctx context.Context, negocioID string, incluirInactivas bool) ([]model.Categoria, error)
	CrearCategoria(ctx context.Context, negocioID string, req dto.CrearCategoriaRequest) (*model.Categoria, error)
	ActualizarCategoria(ctx context.Context, negocioID, id string, req dto.ActualizarCategoriaRequest) (*model.Categoria, error)

	// Recursos
	ListarRecursos(ctx context.Context, negocioID string, incluirInactivos bool) ([]model.Recurso, error)
	CrearRecurso(ctx context.Context, negocioID string, req dto.CrearRecursoRequest) (*model.Recurso, error)
	ActualizarRecurso(ctx context.Context, negocioID, id string, req dto.ActualizarRecursoRequest) (*model.Recurso, error)

	// Servicios
	ListarServicios(ctx context.Context, negocioID string, f repository.FiltroServicios) ([]model.Servicio, error)
	ObtenerServicio(ctx context.Context, negocioID, id string) (*model.Servicio, error)
	CrearServicio(ctx context.Context, negocioID string, req dto.CrearServicioRequest) (*model.Servicio, error)
	ActualizarServicio(ctx context.Context, negocioID, id string, req dto.ActualizarServicioRequest) (*model.Servicio, error)
	// SetDisponible es EL interruptor: apagado, el servicio desaparece de todo
	// listado no-admin al instante.
	SetDisponible(ctx context.Context, negocioID, id string, disponible bool) error

	// Coberturas y precios
	ListarCoberturas(ctx context.Context, negocioID string) ([]model.Cobertura, error)
	CrearCobertura(ctx context.Context, negocioID string, req dto.CrearCoberturaRequest) (*model.Cobertura, error)
	ActualizarCobertura(ctx context.Context, negocioID, id string, req dto.ActualizarCoberturaRequest) (*model.Cobertura, error)
	ListarPrecios(ctx context.Context, negocioID, servicioID string) ([]model.PrecioCobertura, error)
	FijarPrecio(ctx context.Context, negocioID, servicioID string, req dto.PrecioCoberturaRequest) (*model.PrecioCobertura, error)
	// PrecioParaCobertura devuelve el precio del servicio para esa cobertura, o
	// precio_base si no hay fila específica.
	PrecioParaCobertura(ctx context.Context, negocioID, servicioID string, coberturaID *string) (*model.Servicio, error)
}

type catalogoService struct {
	categorias repository.CategoriaRepository
	recursos   repository.RecursoRepository
	servicios  repository.ServicioRepository
	coberturas repository.CoberturaRepository
}

func NewCatalogoService(
	categorias repository.CategoriaRepository,
	recursos repository.RecursoRepository,
	servicios repository.ServicioRepository,
	coberturas repository.CoberturaRepository,
) CatalogoService {
	return &catalogoService{
		categorias: categorias,
		recursos:   recursos,
		servicios:  servicios,
		coberturas: coberturas,
	}
}

// traducirNoEncontrado normaliza el error del ORM a un sentinel del dominio.
func traducirNoEncontrado(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNoExisteEnNegocio
	}
	return err
}

// ─── Categorías ──────────────────────────────────────────────────────────────

func (s *catalogoService) ListarCategorias(ctx context.Context, negocioID string, incluirInactivas bool) ([]model.Categoria, error) {
	return s.categorias.List(ctx, negocioID, incluirInactivas)
}

func (s *catalogoService) CrearCategoria(ctx context.Context, negocioID string, req dto.CrearCategoriaRequest) (*model.Categoria, error) {
	c := &model.Categoria{Nombre: req.Nombre, Orden: req.Orden, Activo: true}
	if err := s.categorias.Create(ctx, negocioID, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *catalogoService) ActualizarCategoria(ctx context.Context, negocioID, id string, req dto.ActualizarCategoriaRequest) (*model.Categoria, error) {
	c, err := s.categorias.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.Nombre != nil {
		c.Nombre = *req.Nombre
	}
	if req.Orden != nil {
		c.Orden = *req.Orden
	}
	if req.Activo != nil {
		c.Activo = *req.Activo
	}
	if err := s.categorias.Update(ctx, negocioID, c); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

// ─── Recursos ────────────────────────────────────────────────────────────────

func (s *catalogoService) ListarRecursos(ctx context.Context, negocioID string, incluirInactivos bool) ([]model.Recurso, error) {
	return s.recursos.List(ctx, negocioID, incluirInactivos)
}

func (s *catalogoService) CrearRecurso(ctx context.Context, negocioID string, req dto.CrearRecursoRequest) (*model.Recurso, error) {
	capacidad := req.Capacidad
	if capacidad <= 0 {
		capacidad = 1
	}
	r := &model.Recurso{
		Tipo:      model.TipoRecurso(req.Tipo),
		Nombre:    req.Nombre,
		Capacidad: capacidad,
		Activo:    true,
	}
	if err := s.recursos.Create(ctx, negocioID, r); err != nil {
		return nil, err
	}
	return r, nil
}

func (s *catalogoService) ActualizarRecurso(ctx context.Context, negocioID, id string, req dto.ActualizarRecursoRequest) (*model.Recurso, error) {
	r, err := s.recursos.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.Tipo != nil {
		r.Tipo = model.TipoRecurso(*req.Tipo)
	}
	if req.Nombre != nil {
		r.Nombre = *req.Nombre
	}
	if req.Capacidad != nil {
		r.Capacidad = *req.Capacidad
	}
	if req.Activo != nil {
		r.Activo = *req.Activo
	}
	if err := s.recursos.Update(ctx, negocioID, r); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return r, nil
}

// ─── Servicios ───────────────────────────────────────────────────────────────

func (s *catalogoService) ListarServicios(ctx context.Context, negocioID string, f repository.FiltroServicios) ([]model.Servicio, error) {
	return s.servicios.List(ctx, negocioID, f)
}

func (s *catalogoService) ObtenerServicio(ctx context.Context, negocioID, id string) (*model.Servicio, error) {
	sv, err := s.servicios.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return sv, nil
}

func (s *catalogoService) CrearServicio(ctx context.Context, negocioID string, req dto.CrearServicioRequest) (*model.Servicio, error) {
	// La categoría tiene que ser del mismo negocio: si no, un servicio quedaría
	// colgando de la carta de otro tenant.
	if req.CategoriaID != nil && *req.CategoriaID != "" {
		if _, err := s.categorias.GetByID(ctx, negocioID, *req.CategoriaID); err != nil {
			return nil, traducirNoEncontrado(err)
		}
	}
	sv := &model.Servicio{
		CategoriaID: req.CategoriaID,
		Nombre:      req.Nombre,
		Descripcion: req.Descripcion,
		DuracionMin: req.DuracionMin,
		PrecioBase:  req.PrecioBase,
		Disponible:  true,
		Activo:      true,
	}
	if req.Disponible != nil {
		sv.Disponible = *req.Disponible
	}
	if err := s.servicios.Create(ctx, negocioID, sv); err != nil {
		return nil, err
	}
	return sv, nil
}

func (s *catalogoService) ActualizarServicio(ctx context.Context, negocioID, id string, req dto.ActualizarServicioRequest) (*model.Servicio, error) {
	sv, err := s.servicios.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.CategoriaID != nil {
		if *req.CategoriaID != "" {
			if _, err := s.categorias.GetByID(ctx, negocioID, *req.CategoriaID); err != nil {
				return nil, traducirNoEncontrado(err)
			}
			sv.CategoriaID = req.CategoriaID
		} else {
			sv.CategoriaID = nil
		}
	}
	if req.Nombre != nil {
		sv.Nombre = *req.Nombre
	}
	if req.Descripcion != nil {
		sv.Descripcion = req.Descripcion
	}
	if req.DuracionMin != nil {
		sv.DuracionMin = req.DuracionMin
	}
	if req.PrecioBase != nil {
		sv.PrecioBase = *req.PrecioBase
	}
	if req.Disponible != nil {
		sv.Disponible = *req.Disponible
	}
	if req.Activo != nil {
		sv.Activo = *req.Activo
	}
	if err := s.servicios.Update(ctx, negocioID, sv); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return sv, nil
}

func (s *catalogoService) SetDisponible(ctx context.Context, negocioID, id string, disponible bool) error {
	return traducirNoEncontrado(s.servicios.SetDisponible(ctx, negocioID, id, disponible))
}

// ─── Coberturas y precios ────────────────────────────────────────────────────

func (s *catalogoService) ListarCoberturas(ctx context.Context, negocioID string) ([]model.Cobertura, error) {
	return s.coberturas.List(ctx, negocioID)
}

func (s *catalogoService) CrearCobertura(ctx context.Context, negocioID string, req dto.CrearCoberturaRequest) (*model.Cobertura, error) {
	c := &model.Cobertura{Nombre: req.Nombre}
	if err := s.coberturas.Create(ctx, negocioID, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *catalogoService) ActualizarCobertura(ctx context.Context, negocioID, id string, req dto.ActualizarCoberturaRequest) (*model.Cobertura, error) {
	c, err := s.coberturas.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.Nombre != nil {
		c.Nombre = *req.Nombre
	}
	if err := s.coberturas.Update(ctx, negocioID, c); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

func (s *catalogoService) ListarPrecios(ctx context.Context, negocioID, servicioID string) ([]model.PrecioCobertura, error) {
	// precio_cobertura no tiene negocio_id: el tenant se valida acá, contra el
	// servicio, antes de tocar la tabla.
	if _, err := s.servicios.GetByID(ctx, negocioID, servicioID); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return s.coberturas.ListPrecios(ctx, servicioID)
}

func (s *catalogoService) FijarPrecio(ctx context.Context, negocioID, servicioID string, req dto.PrecioCoberturaRequest) (*model.PrecioCobertura, error) {
	if _, err := s.servicios.GetByID(ctx, negocioID, servicioID); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if _, err := s.coberturas.GetByID(ctx, negocioID, req.CoberturaID); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	p := &model.PrecioCobertura{
		ServicioID:  servicioID,
		CoberturaID: req.CoberturaID,
		Precio:      req.Precio,
		Coseguro:    req.Coseguro,
	}
	if err := s.coberturas.UpsertPrecio(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// PrecioParaCobertura devuelve el servicio con PrecioBase ya resuelto al precio
// que le corresponde a esa cobertura. Es lo que el motor congela en la línea.
func (s *catalogoService) PrecioParaCobertura(ctx context.Context, negocioID, servicioID string, coberturaID *string) (*model.Servicio, error) {
	sv, err := s.servicios.GetByID(ctx, negocioID, servicioID)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if coberturaID == nil || *coberturaID == "" {
		return sv, nil
	}
	p, err := s.coberturas.PrecioDe(ctx, servicioID, *coberturaID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return sv, nil // sin precio por cobertura: manda precio_base
		}
		return nil, err
	}
	sv.PrecioBase = p.Precio
	return sv, nil
}
