package service

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

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
	cupos    cupoDescontador // opcional: nil = no hay control de cupos
	jornadas repository.JornadaRepository
}

// cupoDescontador es lo que el vertical necesita del control de stock: bajar
// el cupo cuando el local se compromete a cocinar, y devolverlo si el pedido
// se cae. Lo implementa repository.CupoRepository.
type cupoDescontador interface {
	Consumir(ctx context.Context, jornadaID string, porServicio map[string]int) error
	Devolver(ctx context.Context, jornadaID string, porServicio map[string]int) error
}

// OpcionGastro configura el decorador sin romperle la firma al constructor.
type OpcionGastro func(*motorGastro)

// ConAvisadorPedido engancha el aviso al cliente: cuando el local confirma un
// pedido de WhatsApp con una demora, el cliente recibe un mensaje con el tiempo.
func ConAvisadorPedido(a AvisadorPedido) OpcionGastro {
	return func(m *motorGastro) { m.avisador = a }
}

// ConControlDeCupos engancha la Capa 1 del stock: confirmar un pedido baja el
// cupo del día de cada plato, y cancelarlo lo devuelve. Sin esta opción el
// motor se comporta como siempre (todo ilimitado).
func ConControlDeCupos(c cupoDescontador, j repository.JornadaRepository) OpcionGastro {
	return func(m *motorGastro) {
		m.cupos = c
		m.jornadas = j
	}
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

/*
Transicionar mueve el pedido y, de paso, mueve el cupo del día.

El orden importa y es el mismo que usa el worker facturador: primero se toma lo
que puede fallar por concurrencia (el cupo), y sólo después se hace lo que no
se deshace fácil (la transición). Al revés, dos "Confirmar" simultáneos del
último plato pasarían los dos y recién se pelearían por el cupo, con el pedido
ya confirmado.

Si la transición falla DESPUÉS de haber tomado el cupo, se devuelve. Es una
compensación, no una transacción: el motor no expone su tx y meterle una sería
reescribirlo. La ventana es de milisegundos y el peor caso —cupo devuelto de
más— lo tapa el GREATEST(0, …) del repositorio.
*/
func (m *motorGastro) Transicionar(ctx context.Context, negocioID, id string, nuevo model.EstadoCompromiso, opts OpcionesTransicion) (*dto.CompromisoResponse, error) {
	antes, err := m.inner.Obtener(ctx, negocioID, id)
	if err != nil {
		return nil, err
	}

	tomado, err := m.tomarCupo(ctx, negocioID, antes, nuevo)
	if err != nil {
		return nil, err
	}

	resp, err := m.inner.Transicionar(ctx, negocioID, id, nuevo, opts)
	if err != nil {
		if tomado {
			m.moverCupo(ctx, negocioID, antes, false)
		}
		return nil, err
	}

	m.devolverCupoSiSeCayo(ctx, negocioID, antes, nuevo)
	m.avisarConfirmacion(ctx, negocioID, resp)
	return m.localizado(ctx, negocioID, resp)
}

// tomarCupo descuenta si esta transición es la que compromete la cocina:
// pendiente → confirmado. Devuelve si efectivamente descontó, para poder
// compensar si la transición falla después.
func (m *motorGastro) tomarCupo(ctx context.Context, negocioID string, antes *dto.CompromisoResponse, nuevo model.EstadoCompromiso) (bool, error) {
	if !m.hayControlDeCupos(antes) {
		return false, nil
	}
	if antes.Estado != model.EstadoPendiente || nuevo != model.EstadoConfirmado {
		return false, nil
	}
	if err := m.moverCupo(ctx, negocioID, antes, true); err != nil {
		return false, err
	}
	return true, nil
}

/*
devolverCupoSiSeCayo reintegra lo descontado cuando el pedido se cae después de
confirmado.

Los caminos son exactamente dos, y salen de la tabla de transiciones: desde
CONFIRMADO se puede ir a CANCELADO o a AUSENTE. Desde EN_CURSO y LISTO no hay
salida cancelatoria (una vez que la cocina arrancó, el plato ya se gastó), y
RECHAZADO sólo se llega desde PENDIENTE, que todavía no había descontado.

Es best-effort a propósito: la transición ya está persistida y no se va a
voltear porque el reintegro falle. Se loguea, que es lo que permite arreglarlo
a mano.
*/
func (m *motorGastro) devolverCupoSiSeCayo(ctx context.Context, negocioID string, antes *dto.CompromisoResponse, nuevo model.EstadoCompromiso) {
	if !m.hayControlDeCupos(antes) || antes.Estado != model.EstadoConfirmado {
		return
	}
	if nuevo != model.EstadoCancelado && nuevo != model.EstadoAusente {
		return
	}
	if err := m.moverCupo(ctx, negocioID, antes, false); err != nil {
		log.Error().Err(err).Str("compromiso", antes.ID).
			Msg("no se pudo devolver el cupo de un pedido caído: revisar a mano")
	}
}

func (m *motorGastro) hayControlDeCupos(antes *dto.CompromisoResponse) bool {
	return m.cupos != nil && m.jornadas != nil && antes != nil && antes.Tipo == model.CompromisoPedido
}

// moverCupo traduce las líneas del pedido a "cuánto de cada plato" y se lo pasa
// al repositorio. Un pedido puede repetir el mismo servicio en dos líneas
// (dos notas distintas), así que las cantidades se suman.
func (m *motorGastro) moverCupo(ctx context.Context, negocioID string, c *dto.CompromisoResponse, consumir bool) error {
	j, err := m.jornadas.Actual(ctx, negocioID)
	if err != nil || j == nil || j.CerradaEn != nil {
		// Sin caja abierta no hay día al que descontarle. No es un error del
		// pedido: el local todavía no abrió, y el motor no es quién para
		// frenarlo por eso.
		return nil
	}
	porServicio := make(map[string]int, len(c.Lineas))
	for _, l := range c.Lineas {
		porServicio[l.ServicioID] += l.Cantidad
	}
	if consumir {
		return m.cupos.Consumir(ctx, j.ID, porServicio)
	}
	return m.cupos.Devolver(ctx, j.ID, porServicio)
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
