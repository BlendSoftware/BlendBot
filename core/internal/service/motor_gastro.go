package service

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"github.com/rs/zerolog/log"
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
	avisador AvisadorPedido // opcional: nil = no se avisa al cliente
}

// OpcionGastro configura el decorador sin romperle la firma al constructor.
type OpcionGastro func(*motorGastro)

// ConAvisadorPedido engancha el aviso al cliente: cuando el local confirma un
// pedido de WhatsApp con una demora, el cliente recibe un mensaje con el tiempo.
func ConAvisadorPedido(a AvisadorPedido) OpcionGastro {
	return func(m *motorGastro) { m.avisador = a }
}

// NewMotorGastro envuelve un MotorService ya construido (con su notificador y
// todo). Se cablea en la composition root en lugar del motor pelado.
func NewMotorGastro(inner MotorService, negocios negocioConfigLeer, opts ...OpcionGastro) MotorService {
	m := &motorGastro{inner: inner, negocios: negocios}
	for _, o := range opts {
		o(m)
	}
	return m
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
	resp, err := m.inner.Crear(ctx, negocioID, in)
	if err != nil {
		return nil, err
	}
	return m.localizado(ctx, negocioID, resp)
}

func (m *motorGastro) Obtener(ctx context.Context, negocioID, id string) (*dto.CompromisoResponse, error) {
	resp, err := m.inner.Obtener(ctx, negocioID, id)
	if err != nil {
		return nil, err
	}
	return m.localizado(ctx, negocioID, resp)
}

func (m *motorGastro) Listar(ctx context.Context, negocioID string, f dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	resp, err := m.inner.Listar(ctx, negocioID, f)
	if err != nil {
		return nil, err
	}
	loc, err := m.locNegocio(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	for i := range resp {
		resp[i].EnTimezone(loc)
	}
	return resp, nil
}

func (m *motorGastro) Transicionar(ctx context.Context, negocioID, id string, nuevo model.EstadoCompromiso, opts OpcionesTransicion) (*dto.CompromisoResponse, error) {
	resp, err := m.inner.Transicionar(ctx, negocioID, id, nuevo, opts)
	if err != nil {
		return nil, err
	}
	m.avisarConfirmacion(ctx, negocioID, resp)
	return m.localizado(ctx, negocioID, resp)
}

// avisarConfirmacion le avisa al cliente que el local confirmó su pedido y con
// qué demora. Sólo cuando el pedido entró por WhatsApp (hay a quién avisarle) y
// la confirmación trae una demora. Es best-effort: si el aviso falla no voltea
// la transición, que ya está persistida — sólo se loguea. El panel "no sólo
// muestra: actúa", y esto es esa acción del lado del pedido.
func (m *motorGastro) avisarConfirmacion(ctx context.Context, negocioID string, resp *dto.CompromisoResponse) {
	if m.avisador == nil || resp == nil {
		return
	}
	if resp.Estado != model.EstadoConfirmado || resp.Tipo != model.CompromisoPedido {
		return
	}
	if resp.Origen != model.OrigenWhatsApp || resp.DemoraMin == nil || resp.ClienteTelefono == "" {
		return
	}
	neg, err := m.negocios.Negocio(ctx, negocioID)
	if err != nil {
		return
	}
	waPhone := ""
	if neg.WaPhoneID != nil {
		waPhone = *neg.WaPhoneID
	}
	nombre := ""
	if resp.ClienteNombre != nil {
		nombre = *resp.ClienteNombre
	}
	aviso := AvisoPedidoConfirmado{
		NegocioID:       negocioID,
		CompromisoID:    resp.ID,
		WaPhoneID:       waPhone,
		ClienteTelefono: resp.ClienteTelefono,
		ClienteNombre:   nombre,
		DemoraMin:       *resp.DemoraMin,
		Total:           resp.Total,
	}
	if err := m.avisador.PedidoConfirmado(ctx, aviso); err != nil {
		log.Warn().Err(err).Str("compromiso", resp.ID).Msg("no se pudo avisar la confirmación del pedido")
	}
}

// localizado reescribe los timestamps del response a la TZ del negocio. Es la
// misma corrección que la agenda: el motor deja las horas en la TZ del proceso
// (UTC en el contenedor) y el panel las lee como hora de pared, así que sin
// esto muestra horas y días corridos. El motor no se toca; la timezone se
// resuelve acá, en el vertical, donde ya vive el acceso a la config del negocio.
func (m *motorGastro) localizado(ctx context.Context, negocioID string, resp *dto.CompromisoResponse) (*dto.CompromisoResponse, error) {
	loc, err := m.locNegocio(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	resp.EnTimezone(loc)
	return resp, nil
}

func (m *motorGastro) locNegocio(ctx context.Context, negocioID string) (*time.Location, error) {
	neg, err := m.negocios.Negocio(ctx, negocioID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}
	loc, err := time.LoadLocation(neg.Timezone)
	if err != nil {
		return nil, ErrTimezoneInvalida
	}
	return loc, nil
}
