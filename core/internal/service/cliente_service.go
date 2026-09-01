package service

import (
	"context"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

var ErrClienteDuplicado = errors.New("ya existe un cliente con ese telefono")

// ClienteService: el que escribe por WhatsApp. Mínimo dato necesario.
//
// Pendiente (Ley 25.326): Documento y Notas deben cifrarse a nivel campo antes
// de tocar la base. Falta la clave en config — hoy se guardan tal cual y el
// modelo ya los marca `json:"-"` para que no salgan por la API.
type ClienteService interface {
	BuscarPorTelefono(ctx context.Context, negocioID, telefono string) (*model.Cliente, error)
	ObtenerPorID(ctx context.Context, negocioID, id string) (*model.Cliente, error)
	// Listar trae todos los clientes del negocio con su resumen de actividad.
	Listar(ctx context.Context, negocioID string) ([]dto.ClienteResumen, error)
	Crear(ctx context.Context, negocioID string, req dto.CrearClienteRequest) (*model.Cliente, error)
	Actualizar(ctx context.Context, negocioID, id string, req dto.ActualizarClienteRequest) (*model.Cliente, error)
}

type clienteService struct {
	clientes   repository.ClienteRepository
	coberturas repository.CoberturaRepository
}

func NewClienteService(clientes repository.ClienteRepository, coberturas repository.CoberturaRepository) ClienteService {
	return &clienteService{clientes: clientes, coberturas: coberturas}
}

func (s *clienteService) BuscarPorTelefono(ctx context.Context, negocioID, telefono string) (*model.Cliente, error) {
	c, err := s.clientes.GetByTelefono(ctx, negocioID, telefono)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

func (s *clienteService) ObtenerPorID(ctx context.Context, negocioID, id string) (*model.Cliente, error) {
	c, err := s.clientes.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

func (s *clienteService) Listar(ctx context.Context, negocioID string) ([]dto.ClienteResumen, error) {
	filas, err := s.clientes.ListarConResumen(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.ClienteResumen, 0, len(filas))
	for _, f := range filas {
		out = append(out, dto.ClienteResumen{
			ID:              f.ID,
			Telefono:        f.Telefono,
			Nombre:          f.Nombre,
			CoberturaID:     f.CoberturaID,
			CreadoEn:        dto.HoraDe(ctx, f.CreadoEn),
			CantidadPedidos: f.CantidadPedidos,
			TotalAcumulado:  f.TotalAcumulado,
			UltimoPedido:    dto.HoraPtrDe(ctx, f.UltimoPedido),
		})
	}
	return out, nil
}

func (s *clienteService) Crear(ctx context.Context, negocioID string, req dto.CrearClienteRequest) (*model.Cliente, error) {
	if _, err := s.clientes.GetByTelefono(ctx, negocioID, req.Telefono); err == nil {
		return nil, ErrClienteDuplicado
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := s.validarCobertura(ctx, negocioID, req.CoberturaID); err != nil {
		return nil, err
	}

	c := &model.Cliente{
		Telefono:    req.Telefono,
		Nombre:      req.Nombre,
		Documento:   req.Documento,
		CoberturaID: req.CoberturaID,
		Notas:       req.Notas,
	}
	if err := s.clientes.Create(ctx, negocioID, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *clienteService) Actualizar(ctx context.Context, negocioID, id string, req dto.ActualizarClienteRequest) (*model.Cliente, error) {
	c, err := s.clientes.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if err := s.validarCobertura(ctx, negocioID, req.CoberturaID); err != nil {
		return nil, err
	}
	if req.Nombre != nil {
		c.Nombre = req.Nombre
	}
	if req.Documento != nil {
		c.Documento = req.Documento
	}
	if req.CoberturaID != nil {
		if *req.CoberturaID == "" {
			c.CoberturaID = nil
		} else {
			c.CoberturaID = req.CoberturaID
		}
	}
	if req.Notas != nil {
		c.Notas = req.Notas
	}
	if err := s.clientes.Update(ctx, negocioID, c); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

// validarCobertura impide asignar una cobertura de otro negocio.
func (s *clienteService) validarCobertura(ctx context.Context, negocioID string, coberturaID *string) error {
	if coberturaID == nil || *coberturaID == "" {
		return nil
	}
	if _, err := s.coberturas.GetByID(ctx, negocioID, *coberturaID); err != nil {
		return traducirNoEncontrado(err)
	}
	return nil
}
