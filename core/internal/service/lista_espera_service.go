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

	// Se relee para devolver el anotado con el nombre del cliente y el del
	// servicio, igual que los que salen del listado: un mismo shape para el
	// alta y para la cola, o el panel termina con dos casos.
	a, err := s.repo.PorID(ctx, negocioID, le.ID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, ErrNoEncontrado
	}
	return anotadoDesdeFila(a), nil
}

func (s *listaEsperaService) Listar(ctx context.Context, negocioID string, f dto.FiltroListaEspera) ([]dto.ListaEsperaResponse, error) {
	filas, err := s.repo.ListConDatos(ctx, negocioID, repository.FiltroListaEspera{
		ServicioID:     f.ServicioID,
		SoloPendientes: f.SoloPendientes,
	})
	if err != nil {
		return nil, err
	}
	out := make([]dto.ListaEsperaResponse, 0, len(filas))
	for i := range filas {
		out = append(out, *anotadoDesdeFila(&filas[i]))
	}
	return out, nil
}

// anotadoDesdeFila mapea la fila joineada al shape que sale por HTTP.
func anotadoDesdeFila(a *repository.AnotadoEnCola) *dto.ListaEsperaResponse {
	return &dto.ListaEsperaResponse{
		ID:                   a.ID,
		NegocioID:            a.NegocioID,
		ClienteID:            a.ClienteID,
		ClienteNombre:        a.ClienteNombre,
		ClienteTelefono:      a.ClienteTelefono,
		ServicioID:           a.ServicioID,
		ServicioNombre:       a.ServicioNombre,
		Nota:                 a.Nota,
		CreadoEn:             a.CreadoEn,
		NotificadoEn:         a.NotificadoEn,
		CompromisoOfrecidoID: a.CompromisoOfrecidoID,
	}
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
