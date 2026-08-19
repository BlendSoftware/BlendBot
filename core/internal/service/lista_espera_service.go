package service

import (
	"context"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// ListaEsperaService administra la cola de gente que quiere un servicio si se
// libera un hueco. Valida que cliente y servicio sean del mismo tenant: el
// negocio sale del token y acá se comprueba que los ids también le pertenezcan.
type ListaEsperaService interface {
	Anotar(ctx context.Context, negocioID string, in dto.AnotarEnListaEsperaInput) (*dto.ListaEsperaResponse, error)
	Listar(ctx context.Context, negocioID string, f dto.FiltroListaEspera) ([]dto.ListaEsperaResponse, error)
	Borrar(ctx context.Context, negocioID, id string) error
}

type listaEsperaService struct {
	repo repository.ListaEsperaRepository
}

func NewListaEsperaService(repo repository.ListaEsperaRepository) ListaEsperaService {
	return &listaEsperaService{repo: repo}
}

func (s *listaEsperaService) Anotar(ctx context.Context, negocioID string, in dto.AnotarEnListaEsperaInput) (*dto.ListaEsperaResponse, error) {
	ok, err := s.repo.ClienteDelNegocio(ctx, negocioID, in.ClienteID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoEncontrado
	}

	ok, err = s.repo.ServicioDelNegocio(ctx, negocioID, in.ServicioID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoEncontrado
	}

	le := &model.ListaEspera{
		ClienteID:  in.ClienteID,
		ServicioID: in.ServicioID,
		Nota:       in.Nota,
	}
	if err := s.repo.Create(ctx, negocioID, le); err != nil {
		return nil, err
	}
	return dto.ListaEsperaDesdeModel(le), nil
}

func (s *listaEsperaService) Listar(ctx context.Context, negocioID string, f dto.FiltroListaEspera) ([]dto.ListaEsperaResponse, error) {
	les, err := s.repo.List(ctx, negocioID, repository.FiltroListaEspera{
		ServicioID:     f.ServicioID,
		SoloPendientes: f.SoloPendientes,
	})
	if err != nil {
		return nil, err
	}
	return dto.ListaEsperaDesdeModelos(les), nil
}

func (s *listaEsperaService) Borrar(ctx context.Context, negocioID, id string) error {
	borrado, err := s.repo.Delete(ctx, negocioID, id)
	if err != nil {
		return err
	}
	if !borrado {
		return ErrNoEncontrado
	}
	return nil
}
