package service

import (
	"context"
	"encoding/json"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/rs/zerolog/log"
	"gorm.io/datatypes"
)

// Acciones auditadas. La lista es corta a propósito: se audita lo sensible,
// no todo (Ley 25.326, principio de mínimo dato).
const (
	AccionClienteLeer           = "cliente.leer"
	AccionClienteCrear          = "cliente.crear"
	AccionClienteActualizar     = "cliente.actualizar"
	AccionNegocioAlta           = "negocio.alta"
	AccionNegocioBaja           = "negocio.baja"
	AccionNegocioActualizar     = "negocio.actualizar"
	AccionServicioSetDisponible = "servicio.disponible"
)

// Evento es una entrada del rastro de auditoría.
type Evento struct {
	NegocioID string
	UsuarioID string
	Accion    string
	Entidad   string
	EntidadID string
	Detalle   any // se serializa a JSON
}

// AuditService escribe el rastro. La escritura es sincrónica: un audit_log que
// se pierde en un shutdown no sirve como prueba de nada. Si falla, se loguea y
// la operación de negocio sigue: auditar no puede romper el pedido del cliente.
type AuditService interface {
	Registrar(ctx context.Context, e Evento)
}

type auditService struct {
	repo repository.AuditRepository
}

func NewAuditService(repo repository.AuditRepository) AuditService {
	return &auditService{repo: repo}
}

func (s *auditService) Registrar(ctx context.Context, e Evento) {
	if s.repo == nil {
		return
	}

	entrada := &model.AuditLog{
		Accion:  e.Accion,
		Entidad: e.Entidad,
	}
	if e.NegocioID != "" {
		entrada.NegocioID = &e.NegocioID
	}
	if e.UsuarioID != "" {
		entrada.UsuarioID = &e.UsuarioID
	}
	if e.EntidadID != "" {
		entrada.EntidadID = &e.EntidadID
	}
	if e.Detalle != nil {
		b, err := json.Marshal(e.Detalle)
		if err != nil {
			log.Error().Err(err).Str("accion", e.Accion).Msg("audit: no se pudo serializar el detalle")
			b = []byte(`{}`)
		}
		entrada.Detalle = datatypes.JSON(b)
	}

	if err := s.repo.Registrar(ctx, entrada); err != nil {
		log.Error().Err(err).
			Str("accion", e.Accion).
			Str("entidad", e.Entidad).
			Msg("audit: no se pudo persistir la entrada")
	}
}
