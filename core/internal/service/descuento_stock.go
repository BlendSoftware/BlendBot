package service

import (
	"context"
	"sort"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/rs/zerolog/log"
)

// ErrSinStock se re-exporta desde el repositorio para que los handlers no
// tengan que importar repository, igual que ErrSinCupo. El error concreto que
// vuelve del repo envuelve a este sentinel y trae el NOMBRE del insumo que
// faltó: `errors.Is` lo reconoce y el mensaje se muestra tal cual al dueño.
var ErrSinStock = repository.ErrSinStock

// recetaLector es lo único que el descuento necesita saber de las recetas:
// de qué está hecho un plato. Lo implementa repository.RecetaRepository.
type recetaLector interface {
	DeServicio(ctx context.Context, negocioID, servicioID string) ([]model.RecetaItem, error)
}

// insumoLibroMayor es lo que el descuento necesita del stock de materia prima,
// y el nombre es literal: no alcanza con poder mover el saldo, hay que poder
// leer lo que uno mismo movió. La devolución se calcula desde ese registro y no
// desde la receta, así que `MovimientosDeCompromiso` no es un extra de
// diagnóstico — es la fuente de verdad de cuánto hay que devolver.
// Lo implementa repository.InsumoRepository.
type insumoLibroMayor interface {
	Mover(ctx context.Context, negocioID string, movs []model.MovimientoInsumo) error
	MovimientosDeCompromiso(ctx context.Context, negocioID, compromisoID string) ([]model.MovimientoInsumo, error)
}

/*
DescontadorStock decide, plato por plato, de dónde sale el descuento cuando el
local se compromete a cocinar:

  - plato con receta  → baja los insumos (Capa 2, saldo del negocio)
  - plato con cupo    → baja el cupo del día (Capa 1, foto de la jornada)
  - plato sin ninguno → no descuenta nada: es ilimitado

Un mismo pedido puede tener platos de los tres tipos y los tres controles se
aplican en la misma confirmación. La exclusión receta ⊕ cupo se valida al
cargar (design §2), así que acá nunca hay que desempatar: si el plato tiene
receta, el cupo no existe.

jornadaID puede venir vacío. El insumo NO depende de la jornada —un saldo de
carne sigue siendo verdad con la caja cerrada—, así que sin jornada abierta el
descuento de insumos se hace igual y el de cupo se saltea.
*/
type DescontadorStock interface {
	Consumir(ctx context.Context, negocioID, jornadaID, compromisoID string, porServicio map[string]int) error
	Devolver(ctx context.Context, negocioID, jornadaID, compromisoID string, porServicio map[string]int) error
}

type descontadorStock struct {
	recetas recetaLector
	insumos insumoLibroMayor
	cupos   cupoDescontador
}

// NewDescontadorStock arma el enrutador de descuentos. Cualquiera de las dos
// capas puede venir en nil: sin recetas todo cae al cupo (que es exactamente
// el comportamiento anterior a esta capability), y sin cupos sólo se descuentan
// insumos.
func NewDescontadorStock(recetas recetaLector, insumos insumoLibroMayor, cupos cupoDescontador) DescontadorStock {
	return &descontadorStock{recetas: recetas, insumos: insumos, cupos: cupos}
}

// soloCupo adapta un cupoDescontador pelado a la interfaz nueva, para que
// ConControlDeCupos siga significando lo mismo que significaba: Capa 1 sola,
// sin insumos. Ignora negocioID y compromisoID porque el cupo no los usa —
// vive colgado de la jornada y no lleva historial de movimientos.
type soloCupo struct{ cupos cupoDescontador }

func (s soloCupo) Consumir(ctx context.Context, _, jornadaID, _ string, porServicio map[string]int) error {
	if s.cupos == nil || jornadaID == "" {
		return nil
	}
	return s.cupos.Consumir(ctx, jornadaID, porServicio)
}

func (s soloCupo) Devolver(ctx context.Context, _, jornadaID, _ string, porServicio map[string]int) error {
	if s.cupos == nil || jornadaID == "" {
		return nil
	}
	return s.cupos.Devolver(ctx, jornadaID, porServicio)
}

/*
Consumir baja lo que el pedido se lleva: el cupo del día de los platos con cupo
y los insumos de los platos con receta, en esa orden y con ese criterio.

EL ORDEN ES CUPO PRIMERO, INSUMOS DESPUÉS, y no es arbitrario.

Las dos capas no comparten transacción —viven en tablas con ciclos de vida
distintos, y meterlas en la misma obligaría a que CupoRepository exponga la
suya, que es reescribir la Capa 1—, así que si la segunda falla hay que
compensar la primera. La pregunta entonces no es cuál falla más seguido sino
cuál es más barata de deshacer, y ahí no hay empate:

  - Compensar el cupo es invisible: `consumido - n` sobre un contador que se
    tira a la basura cuando cierra la caja, con GREATEST(0, …) de piso. No deja
    rastro y a nadie le cambia la vida.

  - Compensar los insumos deja un par consumo/devolución PERMANENTE en el libro
    mayor, por un pedido que nunca existió. Y ese libro es lo único que le
    contesta al dueño "compré 20 kg, ¿por qué me quedan 3?". Ensuciarlo con
    fantasmas es corroer justo el activo que sostiene la confianza en el número.

Poniendo el cupo primero, un ErrSinCupo frena el pedido ANTES de tocar un solo
insumo: el libro mayor ni se entera. Y un ErrSinStock sólo obliga a devolver
cupo, que no se nota. La compensación cara nunca ocurre por este camino.

LIMITACIÓN CONOCIDA: entre las dos capas hay una ventana de milisegundos sin
atomicidad. Si el proceso se muere justo ahí, queda cupo consumido por un pedido
que no se confirmó. Es el mismo riesgo que el decorador ya asume entre tomar el
stock y persistir la transición, y se arregla igual: a mano, mirando el cupo del
día contra los pedidos confirmados.
*/
func (d *descontadorStock) Consumir(ctx context.Context, negocioID, jornadaID, compromisoID string, porServicio map[string]int) error {
	movs, sinReceta, err := d.repartir(ctx, negocioID, compromisoID, porServicio)
	if err != nil {
		return err
	}

	tomoCupo := false
	if len(sinReceta) > 0 && d.cupos != nil && jornadaID != "" {
		if err := d.cupos.Consumir(ctx, jornadaID, sinReceta); err != nil {
			return err
		}
		tomoCupo = true
	}

	if len(movs) > 0 && d.insumos != nil {
		if err := d.insumos.Mover(ctx, negocioID, movs); err != nil {
			if tomoCupo {
				d.compensarCupo(ctx, jornadaID, compromisoID, sinReceta)
			}
			return err
		}
	}
	return nil
}

/*
Devolver reintegra lo que el pedido se había llevado, cuando el pedido se cae.

La regla es "deshacé lo que hiciste", no "recalculá lo que harías ahora". Los
insumos NO se derivan de la receta actual del plato: se leen del libro mayor,
filtrando los movimientos que llevan este compromiso_id — el mismo que Consumir
grabó. Si alguien editó la receta entre la confirmación y la cancelación (un
martes cualquiera), recalcular devolvería una cantidad distinta a la que se
llevó, en silencio, y el saldo quedaría mintiendo sin que nadie pueda notarlo.
El dato exacto ya está guardado; no hay razón para adivinarlo.

DOBLE DEVOLUCIÓN: se resuelve neteando el libro mayor, no con un piso tipo
GREATEST(0, …). Lo que se devuelve es `sum(consumo) - sum(devolucion)` de ese
compromiso, o sea la deuda que todavía queda abierta; una segunda llamada la ve
en cero y no hace nada. El truco del cupo no sirve acá: `consumido` es un
contador de la jornada que se descarta al cerrar la caja, así que un piso en
cero alcanza para acotar el daño. El stock de un insumo es un saldo real que
sobrevive para siempre, y si se infla de más no hay piso que lo detecte — el
número simplemente queda mal, con confianza. El libro mayor ya sabe la
respuesta; preguntarle es más barato que inventar una guarda.

  - Ventana conocida del neteo: leer y escribir no es atómico. En la práctica no
    se pisan, porque las dos salidas de CONFIRMADO (cancelado y ausente) las
    serializa la máquina de estados y la compensación del decorador corre cuando
    todavía no hay transición persistida. El arreglo exacto sería netear adentro
    de la transacción del repositorio; no se hizo porque agrega superficie al
    contrato para cerrar una ventana que hoy nadie puede abrir.

  - Sin movimientos para ese compromiso —nunca se confirmó, o ningún plato tenía
    receta— no se devuelve nada y NO es un error.

LIMITACIÓN CONOCIDA, la que el design admite y no tiene arreglo técnico (Risks):
si el pedido se canceló DESPUÉS de que la cocina lo hizo, la carne ya no está en
la heladera y devolver el stock miente en favor. Se devuelve igual —el camino
alternativo, no devolver nunca, miente en contra, que es peor— y el movimiento
queda registrado como `devolucion` con su compromiso, así el dueño lo ve en la
historia del insumo y lo ajusta a mano. No está resuelto: está anotado.
*/
func (d *descontadorStock) Devolver(ctx context.Context, negocioID, jornadaID, compromisoID string, porServicio map[string]int) error {
	// Las dos capas se intentan siempre, aunque una falle: devolver es
	// reintegro, y saltear un reintegro porque el otro falló es estrictamente
	// peor que intentar los dos. Se devuelve el primer error para que el que
	// llama pueda loguearlo.
	var primero error

	// Capa 1: el pedido ENTERO, sin filtrar por receta. cupoRepo.mover ya es
	// selectivo (sólo toca los servicios que tienen fila de cupo) y un plato con
	// receta no puede tener una, así que filtrar no agregaría nada y sí abriría
	// el mismo agujero que arriba: si le cargaron receta al plato después de
	// confirmar, quedaría afuera del reintegro y su cupo no volvería nunca.
	if d.cupos != nil && jornadaID != "" && len(porServicio) > 0 {
		primero = d.cupos.Devolver(ctx, jornadaID, porServicio)
	}

	// Capa 2: lo que el libro mayor dice que este compromiso todavía debe.
	movs, err := d.pendienteDeDevolver(ctx, negocioID, compromisoID)
	if err != nil {
		if primero == nil {
			primero = err
		}
		return primero
	}
	if len(movs) > 0 {
		if err := d.insumos.Mover(ctx, negocioID, movs); err != nil && primero == nil {
			primero = err
		}
	}
	return primero
}

// pendienteDeDevolver arma los movimientos de devolución leyendo lo que este
// compromiso efectivamente se llevó y descontando lo que ya se le reintegró.
// Los tipos que no son consumo ni devolución (`compra`, `ajuste`) se ignoran a
// propósito: no deberían llevar compromiso_id, y si alguno lo lleva no forma
// parte de la deuda de este pedido.
func (d *descontadorStock) pendienteDeDevolver(ctx context.Context, negocioID, compromisoID string) ([]model.MovimientoInsumo, error) {
	if d.insumos == nil || compromisoID == "" {
		return nil, nil
	}
	hist, err := d.insumos.MovimientosDeCompromiso(ctx, negocioID, compromisoID)
	if err != nil {
		return nil, err
	}
	deuda := make(map[string]int, len(hist))
	for _, m := range hist {
		switch m.Tipo {
		case model.MovConsumo:
			deuda[m.InsumoID] += m.Cantidad
		case model.MovDevolucion:
			deuda[m.InsumoID] -= m.Cantidad
		}
	}
	return movimientos(deuda, model.MovDevolucion, compromisoID), nil
}

/*
repartir es el corazón del camino de ida: convierte "cuántas unidades de cada
plato" en "cuánto de cada insumo" + "qué platos quedan para el cupo".

Las dos cosas que hay que hacer bien acá, y son las dos que es fácil errar:

  - Multiplicar por las unidades pedidas. Un pedido de 3 hamburguesas se lleva
    3 medallones y 3 panes, no 1 y 1. La cantidad de la receta es por porción.

  - Acumular los insumos compartidos ANTES de tocar la base. Si el pedido lleva
    un bife (200 g de carne) y empanadas (150 g), eso es UN movimiento de 350 g.
    Dos movimientos separados no sólo ensucian la historia: hacen que la guarda
    de "¿alcanza?" se evalúe línea por línea, y dos líneas que individualmente
    entran pero juntas no, pasarían las dos.

El plato sin receta cae al cupo. El plato con receta vacía también cae al cupo
—y ahí no encuentra fila, porque no puede tener las dos cosas—, o sea que no
descuenta nada: receta vacía es ilimitado, no agotado (design, Open Questions).
*/
func (d *descontadorStock) repartir(
	ctx context.Context,
	negocioID, compromisoID string,
	porServicio map[string]int,
) ([]model.MovimientoInsumo, map[string]int, error) {
	porInsumo := make(map[string]int)
	sinReceta := make(map[string]int, len(porServicio))

	// El pedido trae un puñado de platos distintos, así que una lectura por
	// plato es barata acá. El N+1 que el design prohíbe (§8) es el del
	// catálogo, que se pide en cada mensaje de cada conversación; esto corre
	// una vez por confirmación.
	for _, servicioID := range ordenadas(porServicio) {
		n := porServicio[servicioID]
		if n <= 0 {
			continue
		}
		var items []model.RecetaItem
		if d.recetas != nil {
			var err error
			items, err = d.recetas.DeServicio(ctx, negocioID, servicioID)
			if err != nil {
				return nil, nil, err
			}
		}
		if len(items) == 0 {
			sinReceta[servicioID] = n
			continue
		}
		for _, it := range items {
			porInsumo[it.InsumoID] += it.Cantidad * n
		}
	}
	return movimientos(porInsumo, model.MovConsumo, compromisoID), sinReceta, nil
}

// movimientos materializa el mapa acumulado en la lista que baja al
// repositorio. Descarta los saldos en cero o negativos: no hay nada que mover.
func movimientos(porInsumo map[string]int, tipo, compromisoID string) []model.MovimientoInsumo {
	// EL ORDEN NO ES COSMÉTICO — NO SACAR EL sort.
	//
	// El orden de iteración de un map en Go es deliberadamente aleatorio. Si los
	// movimientos bajaran en ese orden, dos pedidos que comparten insumos los
	// tomarían en secuencias distintas y se deadlockearían entre ellos: A toma
	// la carne y espera el pan, B toma el pan y espera la carne. Ordenar por
	// insumo_id fija un orden global de toma de locks y el ciclo no se puede
	// formar. Es exactamente la razón por la que cupoRepo.mover ordena su
	// SELECT ... FOR UPDATE por servicio_id.
	ids := make([]string, 0, len(porInsumo))
	for id, n := range porInsumo {
		if n > 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	sort.Strings(ids)

	// El compromiso viaja en cada movimiento: es lo que después deja responder
	// "¿qué pedido se llevó mi carne?" sin adivinar por timestamp, y es lo que
	// la devolución lee para saber cuánto deshacer.
	var ref *string
	if compromisoID != "" {
		ref = &compromisoID
	}

	out := make([]model.MovimientoInsumo, 0, len(ids))
	for _, id := range ids {
		// Cantidad SIEMPRE positiva: el Tipo dice el signo. SaldoResultante lo
		// llena el repositorio con el RETURNING de su UPDATE, que es el único
		// lugar donde el saldo posterior es un dato y no una suposición.
		out = append(out, model.MovimientoInsumo{
			InsumoID:     id,
			Tipo:         tipo,
			Cantidad:     porInsumo[id],
			CompromisoID: ref,
		})
	}
	return out
}

// compensarCupo devuelve cupo ya tomado cuando los insumos frenaron el pedido.
// Best-effort a propósito: el pedido ya está fallando y no se va a arreglar
// porque el reintegro también falle. Se loguea, que es lo que permite corregirlo
// a mano contra los pedidos confirmados del día.
func (d *descontadorStock) compensarCupo(ctx context.Context, jornadaID, compromisoID string, sinReceta map[string]int) {
	if err := d.cupos.Devolver(ctx, jornadaID, sinReceta); err != nil {
		log.Error().Err(err).Str("compromiso", compromisoID).
			Msg("no se pudo devolver el cupo de un pedido que frenó por falta de insumos: revisar a mano")
	}
}

// ordenadas devuelve las claves del mapa en orden estable. No es cosmético:
// hace que el reparto sea reproducible y que dos corridas del mismo pedido
// generen la misma secuencia de lecturas, lo que importa cuando hay que
// debuguear por qué un pedido falló y otro no.
func ordenadas(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
