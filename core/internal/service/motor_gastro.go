package service

import (
	"context"
	"errors"

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
	avisador AvisadorPedido   // opcional: nil = no se avisa al cliente
	stock    DescontadorStock // opcional: nil = no hay control de stock
	jornadas repository.JornadaRepository
}

// cupoDescontador es lo que el vertical necesita de la Capa 1 del stock: bajar
// el cupo cuando el local se compromete a cocinar, y devolverlo si el pedido
// se cae. Lo implementa repository.CupoRepository.
//
// El decorador ya no habla directamente con esta interfaz: habla con
// DescontadorStock, que enruta plato por plato entre cupo e insumos. Esto queda
// como el contrato de la Capa 1 y como lo que ConControlDeCupos recibe.
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

// ConControlDeCupos engancha SÓLO la Capa 1 del stock: confirmar un pedido baja
// el cupo del día de cada plato, y cancelarlo lo devuelve. Sin esta opción el
// motor se comporta como siempre (todo ilimitado).
//
// Sigue existiendo con el mismo significado que tenía: es lo que se cablea
// cuando el negocio no tiene recetas. Por dentro envuelve el cupoDescontador en
// un DescontadorStock que no sabe de insumos.
func ConControlDeCupos(c cupoDescontador, j repository.JornadaRepository) OpcionGastro {
	return ConControlDeStock(soloCupo{cupos: c}, j)
}

// ConControlDeStock engancha las dos capas: el descontador decide plato por
// plato si el pedido baja insumos (plato con receta) o cupo del día (plato con
// cupo manual). Es la opción que se cablea cuando hay recetas cargadas.
func ConControlDeStock(d DescontadorStock, j repository.JornadaRepository) OpcionGastro {
	return func(m *motorGastro) {
		m.stock = d
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
	return m.inner.Crear(ctx, negocioID, in)
}

func (m *motorGastro) Obtener(ctx context.Context, negocioID, id string) (*dto.CompromisoResponse, error) {
	return m.inner.Obtener(ctx, negocioID, id)
}

func (m *motorGastro) Listar(ctx context.Context, negocioID string, f dto.FiltroCompromisos) ([]dto.CompromisoResponse, error) {
	return m.inner.Listar(ctx, negocioID, f)
}

/*
Transicionar mueve el pedido y, de paso, mueve el stock: el cupo del día de los
platos con cupo y los insumos de los platos con receta.

El orden importa y es el mismo que usa el worker facturador: primero se toma lo
que puede fallar por concurrencia (el stock), y sólo después se hace lo que no
se deshace fácil (la transición). Al revés, dos "Confirmar" simultáneos del
último plato pasarían los dos y recién se pelearían por el stock, con el pedido
ya confirmado.

Si la transición falla DESPUÉS de haber tomado el stock, se devuelve. Es una
compensación, no una transacción: el motor no expone su tx y meterle una sería
reescribirlo. La ventana es de milisegundos.
*/
func (m *motorGastro) Transicionar(ctx context.Context, negocioID, id string, nuevo model.EstadoCompromiso, opts OpcionesTransicion) (*dto.CompromisoResponse, error) {
	antes, err := m.inner.Obtener(ctx, negocioID, id)
	if err != nil {
		return nil, err
	}

	tomado, err := m.tomarStock(ctx, negocioID, antes, nuevo)
	if err != nil {
		return nil, err
	}

	resp, err := m.inner.Transicionar(ctx, negocioID, id, nuevo, opts)
	if err != nil {
		if tomado {
			m.moverStock(ctx, negocioID, antes, false)
		}
		return nil, err
	}

	m.devolverStockSiSeCayo(ctx, negocioID, antes, nuevo)
	m.avisarConfirmacion(ctx, negocioID, resp)
	m.avisarListo(ctx, negocioID, resp)
	return resp, nil
}

// avisarListo le avisa al cliente que su pedido está pronto. Es el segundo de
// los dos avisos que el producto manda (docs/FLUJOS.md).
//
// Sigue las MISMAS tres reglas que avisarConfirmacion: sólo pedidos que entraron
// por WhatsApp —si no, no hay a quién avisarle—, sólo con teléfono, y
// best-effort: un aviso que falla no voltea la transición, que ya está
// persistida.
//
// Con UNA diferencia deliberada: acá NO se exige `DemoraMin`. El aviso de
// confirmación lo pide porque su texto la usa; éste no la menciona. Copiar la
// condición sin pensarla dejaría mudo el aviso justo en los pedidos que se
// confirmaron sin cargar demora, que es donde el cliente MÁS necesita que le
// avisen.
//
// `en_local` se filtra acá: el mozo lleva la comida a la mesa y un WhatsApp
// diciendo "está listo" a alguien sentado adentro es ruido que se paga.
func (m *motorGastro) avisarListo(ctx context.Context, negocioID string, resp *dto.CompromisoResponse) {
	if m.avisador == nil || resp == nil {
		return
	}
	if resp.Estado != model.EstadoListo || resp.Tipo != model.CompromisoPedido {
		return
	}
	if resp.Origen != model.OrigenWhatsApp || resp.ClienteTelefono == "" {
		return
	}
	// Sin entrega no hay frase posible: no se inventa una.
	if resp.Entrega == nil || *resp.Entrega == model.EntregaEnLocal {
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
	aviso := AvisoPedidoListo{
		NegocioID:       negocioID,
		CompromisoID:    resp.ID,
		WaPhoneID:       waPhone,
		ClienteTelefono: resp.ClienteTelefono,
		ClienteNombre:   nombre,
		Entrega:         string(*resp.Entrega),
	}
	if err := m.avisador.PedidoListo(ctx, aviso); err != nil {
		log.Warn().Err(err).Str("compromiso", resp.ID).Msg("no se pudo avisar que el pedido está listo")
	}
}

// tomarStock descuenta si esta transición es la que compromete la cocina:
// pendiente → confirmado. Devuelve si efectivamente descontó, para poder
// compensar si la transición falla después.
//
// El error que sube de acá puede ser ErrSinCupo (no queda cupo del día) o
// ErrSinStock (no alcanza algún insumo, y el mensaje lo nombra). Los dos frenan
// la confirmación y los dos los traduce el handler a 409.
func (m *motorGastro) tomarStock(ctx context.Context, negocioID string, antes *dto.CompromisoResponse, nuevo model.EstadoCompromiso) (bool, error) {
	if !m.hayControlDeStock(antes) {
		return false, nil
	}
	if antes.Estado != model.EstadoPendiente || nuevo != model.EstadoConfirmado {
		return false, nil
	}
	if err := m.moverStock(ctx, negocioID, antes, true); err != nil {
		return false, err
	}
	return true, nil
}

/*
devolverStockSiSeCayo reintegra lo descontado cuando el pedido se cae después de
confirmado.

Los caminos son exactamente dos, y salen de la tabla de transiciones: desde
CONFIRMADO se puede ir a CANCELADO o a AUSENTE. Desde EN_CURSO y LISTO no hay
salida cancelatoria (una vez que la cocina arrancó, el plato ya se gastó), y
RECHAZADO sólo se llega desde PENDIENTE, que todavía no había descontado.

Es best-effort a propósito: la transición ya está persistida y no se va a
voltear porque el reintegro falle. Se loguea, que es lo que permite arreglarlo
a mano.
*/
func (m *motorGastro) devolverStockSiSeCayo(ctx context.Context, negocioID string, antes *dto.CompromisoResponse, nuevo model.EstadoCompromiso) {
	if !m.hayControlDeStock(antes) || antes.Estado != model.EstadoConfirmado {
		return
	}
	if nuevo != model.EstadoCancelado && nuevo != model.EstadoAusente {
		return
	}
	if err := m.moverStock(ctx, negocioID, antes, false); err != nil {
		log.Error().Err(err).Str("compromiso", antes.ID).
			Msg("no se pudo devolver el stock de un pedido caído: revisar a mano")
	}
}

func (m *motorGastro) hayControlDeStock(antes *dto.CompromisoResponse) bool {
	return m.stock != nil && m.jornadas != nil && antes != nil && antes.Tipo == model.CompromisoPedido
}

/*
moverStock traduce las líneas del pedido a "cuánto de cada plato" y se lo pasa
al descontador, que decide si eso sale del cupo del día o de los insumos. Un
pedido puede repetir el mismo servicio en dos líneas (dos notas distintas), así
que las cantidades se suman ANTES de bajar: si no, el mismo plato descontaría
dos veces por separado y la guarda de "¿alcanza?" se evaluaría por línea.

La jornada dejó de ser un requisito para descontar. Sin caja abierta no hay día
al que bajarle el cupo —eso no cambió, y el descontador se saltea la Capa 1
cuando el jornadaID viene vacío—, pero los insumos son un saldo del negocio y no
de la jornada: la carne que se usa a las 3 de la mañana con la caja cerrada
salió igual de la heladera (spec `recetas`, MODIFIED). Por eso acá se tolera que
no haya jornada en vez de cortar.
*/
func (m *motorGastro) moverStock(ctx context.Context, negocioID string, c *dto.CompromisoResponse, consumir bool) error {
	jornadaID := ""
	if j, err := m.jornadas.Actual(ctx, negocioID); err == nil && j != nil && j.CerradaEn == nil {
		jornadaID = j.ID
	}
	porServicio := make(map[string]int, len(c.Lineas))
	for _, l := range c.Lineas {
		porServicio[l.ServicioID] += l.Cantidad
	}
	if consumir {
		return m.stock.Consumir(ctx, negocioID, jornadaID, c.ID, porServicio)
	}
	return m.stock.Devolver(ctx, negocioID, jornadaID, c.ID, porServicio)
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

