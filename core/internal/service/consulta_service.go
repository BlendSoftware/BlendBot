package service

import (
	"context"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
)

// ConsultaService administra el inbox de preguntas que el agente no supo
// responder. Valida que el cliente sea del tenant (el negocio sale del token), y
// al responder le avisa al cliente por WhatsApp.
type ConsultaService interface {
	Crear(ctx context.Context, negocioID string, in dto.CrearConsultaInput) (*dto.ConsultaResponse, error)
	Listar(ctx context.Context, negocioID string, f dto.FiltroConsultas) ([]dto.ConsultaResponse, error)
	Responder(ctx context.Context, negocioID, id string, in dto.ResponderConsultaInput) (*dto.ConsultaResponse, error)
}

type consultaService struct {
	repo     repository.ConsultaRepository
	avisador AvisadorConsulta // opcional: nil = no se avisa al cliente
}

// NewConsultaService arma el servicio. avisador puede ser nil (p.ej. en tests
// que no ejercitan el aviso).
func NewConsultaService(repo repository.ConsultaRepository, avisador AvisadorConsulta) ConsultaService {
	return &consultaService{repo: repo, avisador: avisador}
}

func (s *consultaService) Crear(ctx context.Context, negocioID string, in dto.CrearConsultaInput) (*dto.ConsultaResponse, error) {
	ok, err := s.repo.ClienteDelNegocio(ctx, negocioID, in.ClienteID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoEncontrado
	}

	// El teléfono se congela en la consulta: es por donde vuelve la respuesta, y
	// no depende de que la ficha del cliente siga existiendo cuando se conteste.
	telefono, err := s.repo.TelefonoDeCliente(ctx, negocioID, in.ClienteID)
	if err != nil {
		return nil, err
	}

	clienteID := in.ClienteID
	c := &model.Consulta{
		ClienteID: &clienteID,
		Telefono:  telefono,
		Pregunta:  in.Pregunta,
		Estado:    model.ConsultaPendiente,
	}
	if err := s.repo.Create(ctx, negocioID, c); err != nil {
		return nil, err
	}

	fila, err := s.repo.PorID(ctx, negocioID, c.ID)
	if err != nil {
		return nil, err
	}
	if fila == nil {
		return nil, ErrNoEncontrado
	}
	return consultaDesdeFila(ctx, fila), nil
}

func (s *consultaService) Listar(ctx context.Context, negocioID string, f dto.FiltroConsultas) ([]dto.ConsultaResponse, error) {
	filas, err := s.repo.List(ctx, negocioID, repository.FiltroConsultas{Estado: f.Estado})
	if err != nil {
		return nil, err
	}
	out := make([]dto.ConsultaResponse, 0, len(filas))
	for i := range filas {
		out = append(out, *consultaDesdeFila(ctx, &filas[i]))
	}
	return out, nil
}

func (s *consultaService) Responder(ctx context.Context, negocioID, id string, in dto.ResponderConsultaInput) (*dto.ConsultaResponse, error) {
	ok, err := s.repo.Responder(ctx, negocioID, id, in.Respuesta, time.Now())
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoEncontrado
	}

	// El aviso al cliente es el "el panel actúa, no sólo muestra": responder
	// encola un WhatsApp. Si el negocio no tiene wa_phone_id no hay a quién
	// avisarle, pero la consulta igual quedó respondida.
	if s.avisador != nil {
		if datos, err := s.repo.DatosAviso(ctx, negocioID, id); err == nil && datos != nil {
			_ = s.avisador.ConsultaRespondida(ctx, AvisoConsultaRespondida{
				NegocioID:       negocioID,
				ConsultaID:      id,
				WaPhoneID:       datos.WaPhoneID,
				ClienteTelefono: datos.Telefono,
				ClienteNombre:   datos.ClienteNombre,
				Respuesta:       in.Respuesta,
			})
		}
	}

	fila, err := s.repo.PorID(ctx, negocioID, id)
	if err != nil {
		return nil, err
	}
	if fila == nil {
		return nil, ErrNoEncontrado
	}
	return consultaDesdeFila(ctx, fila), nil
}

// consultaDesdeFila mapea la fila joineada al shape que sale por HTTP.
func consultaDesdeFila(ctx context.Context, c *repository.ConsultaConDatos) *dto.ConsultaResponse {
	return &dto.ConsultaResponse{
		ID:            c.ID,
		NegocioID:     c.NegocioID,
		ClienteID:     c.ClienteID,
		ClienteNombre: c.ClienteNombre,
		Telefono:      c.Telefono,
		Pregunta:      c.Pregunta,
		Respuesta:     c.Respuesta,
		Estado:        c.Estado,
		CreadoEn:      dto.HoraDe(ctx, c.CreadoEn),
		RespondidaEn:  dto.HoraPtrDe(ctx, c.RespondidaEn),
	}
}
