package service

import (
	"context"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// negocioConfigLeer es lo mínimo que el vertical gastronomía necesita del
// tenant: su config, para validar reglas que NO son de la máquina de estados.
// La implementa NegocioDatosRepository.
type negocioConfigLeer interface {
	Negocio(ctx context.Context, negocioID string) (*model.Negocio, error)
}

// motorGastro decora al MotorService con las validaciones del vertical
// gastronomía que el motor no conoce, sin tocarlo. Hoy es una sola: un pedido
// con entrega=delivery sólo se acepta si el negocio ofrece delivery. Todo lo
// demás —crear turnos, reservas, transiciones, cobros— pasa intacto al motor.
//
// El camino de salud no cambia: un turno no trae `entrega`, así que ni se mira
// la config.
type motorGastro struct {
	inner    MotorService
	negocios negocioConfigLeer
}

// NewMotorGastro envuelve un MotorService ya construido (con su notificador y
// todo). Se cablea en la composition root en lugar del motor pelado.
func NewMotorGastro(inner MotorService, negocios negocioConfigLeer) MotorService {
	return &motorGastro{inner: inner, negocios: negocios}
}

func (m *motorGastro) Crear(ctx context.Context, negocioID string, in dto.CrearCompromisoInput) (*dto.CompromisoResponse, error) {
	if in.Entrega != nil && *in.Entrega == model.EntregaDelivery {
		neg, err := m.negocios.Negocio(ctx, negocioID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNoEncontrado
		}
		if err != nil {
			return nil, err
		}
		cfg, err := model.ParseConfigNegocio(neg.Config)
		if err != nil {
			return nil, err
		}
		if !cfg.AceptaDelivery {
			return nil, ErrDeliveryNoAceptado
		}
		// TODO(geocoding): cuando la dirección se pueda geocodificar, validar acá
		// que la distancia al negocio no supere cfg.RadioDeliveryKm. Por ahora el
		// radio es un hook: sólo se valida que el negocio ofrezca delivery.
	}
	return m.inner.Crear(ctx, negocioID, in)
}

func (m *motorGastro) Obtener(ctx context.Context, negocioID, id string) (*dto.CompromisoResponse, error) {
	return m.inner.Obtener(ctx, negocioID, id)
}

func (m *motorGastro) Listar(ctx context.Context, negocioID string, f dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	return m.inner.Listar(ctx, negocioID, f)
}

func (m *motorGastro) Transicionar(ctx context.Context, negocioID, id string, nuevo model.EstadoCompromiso, opts OpcionesTransicion) (*dto.CompromisoResponse, error) {
	return m.inner.Transicionar(ctx, negocioID, id, nuevo, opts)
}
