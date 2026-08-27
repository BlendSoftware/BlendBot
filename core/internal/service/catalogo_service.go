package service

import (
	"context"
	"errors"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

// ErrNoExisteEnNegocio cubre los dos casos a propósito: la fila no existe, o
// existe pero es de otro tenant. Desde afuera no se distinguen — eso es lo que
// impide usar los 404 para mapear el catálogo ajeno.
var ErrNoExisteEnNegocio = errors.New("no encontrado en este negocio")

// CatalogoService: lo que el negocio ofrece y con qué lo presta.
type CatalogoService interface {
	// Categorías
	ListarCategorias(ctx context.Context, negocioID string, incluirInactivas bool) ([]model.Categoria, error)
	CrearCategoria(ctx context.Context, negocioID string, req dto.CrearCategoriaRequest) (*model.Categoria, error)
	ActualizarCategoria(ctx context.Context, negocioID, id string, req dto.ActualizarCategoriaRequest) (*model.Categoria, error)

	// Recursos
	ListarRecursos(ctx context.Context, negocioID string, incluirInactivos bool) ([]model.Recurso, error)
	CrearRecurso(ctx context.Context, negocioID string, req dto.CrearRecursoRequest) (*model.Recurso, error)
	ActualizarRecurso(ctx context.Context, negocioID, id string, req dto.ActualizarRecursoRequest) (*model.Recurso, error)

	// Servicios
	//
	// El listado trae además cuánto queda de cada plato: Restante y Agotado,
	// derivados de la receta si el plato tiene una, o del cupo de la jornada
	// abierta si no. Los agotados NO se filtran — viajan marcados, incluso con
	// f.SoloDisponibles, para que quien consume pueda distinguir "el dueño lo
	// apagó" de "hoy se terminó" en una sola lectura.
	ListarServicios(ctx context.Context, negocioID string, f repository.FiltroServicios) ([]model.Servicio, error)
	// ListarServiciosParaCobertura es el mismo listado con PrecioEfectivo
	// resuelto: lo que el agente tiene que cotizar para ESE cliente. Con
	// coberturaID vacío es idéntico a ListarServicios.
	ListarServiciosParaCobertura(ctx context.Context, negocioID string, f repository.FiltroServicios, coberturaID string) ([]model.Servicio, error)
	ObtenerServicio(ctx context.Context, negocioID, id string) (*model.Servicio, error)
	CrearServicio(ctx context.Context, negocioID string, req dto.CrearServicioRequest) (*model.Servicio, error)
	ActualizarServicio(ctx context.Context, negocioID, id string, req dto.ActualizarServicioRequest) (*model.Servicio, error)
	// SetDisponible es EL interruptor: apagado, el servicio desaparece de todo
	// listado no-admin al instante.
	SetDisponible(ctx context.Context, negocioID, id string, disponible bool) error

	// Coberturas y precios
	ListarCoberturas(ctx context.Context, negocioID string) ([]model.Cobertura, error)
	CrearCobertura(ctx context.Context, negocioID string, req dto.CrearCoberturaRequest) (*model.Cobertura, error)
	ActualizarCobertura(ctx context.Context, negocioID, id string, req dto.ActualizarCoberturaRequest) (*model.Cobertura, error)
	ListarPrecios(ctx context.Context, negocioID, servicioID string) ([]model.PrecioCobertura, error)
	FijarPrecio(ctx context.Context, negocioID, servicioID string, req dto.PrecioCoberturaRequest) (*model.PrecioCobertura, error)
	// PrecioParaCobertura devuelve el precio del servicio para esa cobertura, o
	// precio_base si no hay fila específica.
	PrecioParaCobertura(ctx context.Context, negocioID, servicioID string, coberturaID *string) (*model.Servicio, error)
}

type catalogoService struct {
	categorias repository.CategoriaRepository
	recursos   repository.RecursoRepository
	servicios  repository.ServicioRepository
	coberturas repository.CoberturaRepository
	cupos      cupoLector                   // opcional: nil = todo ilimitado
	jornadas   repository.JornadaRepository // opcional: va de la mano de cupos
	recetas    porcionesLector              // opcional: nil = ningún plato lleva receta
}

// cupoLector es lo único que el catálogo necesita del control de stock: cuánto
// queda de cada plato de la jornada, en UNA consulta. Lo implementa
// repository.CupoRepository.
//
// Es lectura y nada más. El descuento al confirmar sigue siendo del motor y de
// Postgres: acá no se toca un cupo, se mira.
type cupoLector interface {
	RestantePorServicio(ctx context.Context, negocioID, jornadaID string) (map[string]int, error)
}

// porcionesLector es la segunda fuente del mismo número: cuántas porciones da
// la materia prima que hay en el local. Lo implementa
// repository.RecetaRepository, el mismo repo que usa el descuento — pero esto
// es otra pregunta y por eso es otra interfaz: el descuento quiere la receta de
// UN plato para bajarle el stock, el catálogo quiere las porciones de TODA la
// carta para mostrarlas.
//
// Mismas dos reglas que cupoLector, y no por simetría estética sino porque el
// catálogo depende de las dos:
//   - UNA consulta para toda la carta. El camino ingenuo —la receta de cada
//     plato, y después el insumo de cada línea— es un N+1 sobre dos tablas, y
//     el catálogo se pide en cada mensaje de cada conversación.
//   - Lo que NO está en el mapa no lleva cuenta. Un servicio sin receta, y uno
//     con receta a la que le borraron todas las líneas, son el mismo caso: no
//     vienen, y quedan ilimitados. Apagar un plato porque alguien le vació la
//     receta es el peor default posible.
//
// Es lectura y nada más: el descuento al confirmar es del decorador de gastro y
// del CHECK de Postgres. Acá no se toca un insumo, se mira.
type porcionesLector interface {
	PorcionesPorServicio(ctx context.Context, negocioID string) (map[string]repository.PorcionesServicio, error)
}

// OpcionCatalogo configura el service sin romperle la firma al constructor,
// igual que OpcionGastro en el motor.
type OpcionCatalogo func(*catalogoService)

// ConCupoEnCatalogo hace que el listado informe el cupo del día. Sin la opción
// el catálogo sale como salía siempre —todo con restante nil y agotado false—,
// que es lo correcto para salud, donde no hay cupos.
//
// La opción no cambia QUÉ platos se listan, sólo cuánto se sabe de cada uno:
// olvidarse de cablearla deja al consumidor sin stock, no le cambia la carta
// por abajo.
func ConCupoEnCatalogo(c cupoLector, j repository.JornadaRepository) OpcionCatalogo {
	return func(s *catalogoService) {
		s.cupos = c
		s.jornadas = j
	}
}

// ConRecetasEnCatalogo hace que el listado derive las porciones posibles desde
// el stock de insumos. Hermana de ConCupoEnCatalogo y con la misma promesa: sin
// la opción, el catálogo sale exactamente como salía —el cupo manual sigue
// mandando y lo demás queda ilimitado—, que es lo correcto para salud y para
// todo negocio que no cargó un insumo en su vida.
//
// No pide jornada, y eso no es un olvido: ver el comentario de resolverRestante.
func ConRecetasEnCatalogo(r porcionesLector) OpcionCatalogo {
	return func(s *catalogoService) {
		s.recetas = r
	}
}

func NewCatalogoService(
	categorias repository.CategoriaRepository,
	recursos repository.RecursoRepository,
	servicios repository.ServicioRepository,
	coberturas repository.CoberturaRepository,
	opts ...OpcionCatalogo,
) CatalogoService {
	s := &catalogoService{
		categorias: categorias,
		recursos:   recursos,
		servicios:  servicios,
		coberturas: coberturas,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// traducirNoEncontrado normaliza el error del ORM a un sentinel del dominio.
func traducirNoEncontrado(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNoExisteEnNegocio
	}
	return err
}

// ─── Categorías ──────────────────────────────────────────────────────────────

func (s *catalogoService) ListarCategorias(ctx context.Context, negocioID string, incluirInactivas bool) ([]model.Categoria, error) {
	return s.categorias.List(ctx, negocioID, incluirInactivas)
}

func (s *catalogoService) CrearCategoria(ctx context.Context, negocioID string, req dto.CrearCategoriaRequest) (*model.Categoria, error) {
	c := &model.Categoria{Nombre: req.Nombre, Orden: req.Orden, Activo: true}
	if err := s.categorias.Create(ctx, negocioID, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *catalogoService) ActualizarCategoria(ctx context.Context, negocioID, id string, req dto.ActualizarCategoriaRequest) (*model.Categoria, error) {
	c, err := s.categorias.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.Nombre != nil {
		c.Nombre = *req.Nombre
	}
	if req.Orden != nil {
		c.Orden = *req.Orden
	}
	if req.Activo != nil {
		c.Activo = *req.Activo
	}
	if err := s.categorias.Update(ctx, negocioID, c); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

// ─── Recursos ────────────────────────────────────────────────────────────────

func (s *catalogoService) ListarRecursos(ctx context.Context, negocioID string, incluirInactivos bool) ([]model.Recurso, error) {
	return s.recursos.List(ctx, negocioID, incluirInactivos)
}

func (s *catalogoService) CrearRecurso(ctx context.Context, negocioID string, req dto.CrearRecursoRequest) (*model.Recurso, error) {
	capacidad := req.Capacidad
	if capacidad <= 0 {
		capacidad = 1
	}
	r := &model.Recurso{
		Tipo:      model.TipoRecurso(req.Tipo),
		Nombre:    req.Nombre,
		Capacidad: capacidad,
		Activo:    true,
	}
	if err := s.recursos.Create(ctx, negocioID, r); err != nil {
		return nil, err
	}
	return r, nil
}

func (s *catalogoService) ActualizarRecurso(ctx context.Context, negocioID, id string, req dto.ActualizarRecursoRequest) (*model.Recurso, error) {
	r, err := s.recursos.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.Tipo != nil {
		r.Tipo = model.TipoRecurso(*req.Tipo)
	}
	if req.Nombre != nil {
		r.Nombre = *req.Nombre
	}
	if req.Capacidad != nil {
		r.Capacidad = *req.Capacidad
	}
	if req.Activo != nil {
		r.Activo = *req.Activo
	}
	if err := s.recursos.Update(ctx, negocioID, r); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return r, nil
}

// ─── Servicios ───────────────────────────────────────────────────────────────

func (s *catalogoService) ListarServicios(ctx context.Context, negocioID string, f repository.FiltroServicios) ([]model.Servicio, error) {
	// Un solo camino: si el cupo se resolviera en un listado y no en el otro,
	// el que se olvide de pasar cobertura se queda sin saber qué hay.
	return s.ListarServiciosParaCobertura(ctx, negocioID, f, "")
}

// ListarServiciosParaCobertura resuelve el precio que se le va a congelar a un
// cliente con esa cobertura. El agente cotizaba precio_base y el motor congelaba
// el precio de cobertura: el cliente cerraba el pedido con un número y en la
// caja le aparecía otro (H4). Ahora quien cotiza pide el precio de la cobertura
// y los dos lados dicen lo mismo.
//
// El stock se resuelve y se informa; no se filtra. Un plato agotado sale igual,
// con agotado true y su precio: quien consume necesita las dos cosas para
// decirle al cliente "hoy se nos terminó" en vez de hacer de cuenta que el
// plato no existe.
func (s *catalogoService) ListarServiciosParaCobertura(ctx context.Context, negocioID string, f repository.FiltroServicios, coberturaID string) ([]model.Servicio, error) {
	servicios, err := s.servicios.List(ctx, negocioID, f)
	if err != nil {
		return nil, err
	}
	if err := s.resolverRestante(ctx, negocioID, servicios); err != nil {
		return nil, err
	}
	if coberturaID == "" || len(servicios) == 0 {
		return servicios, nil
	}
	// La cobertura tiene que ser de ESTE negocio: precio_cobertura no lleva
	// negocio_id, así que el tenant se valida acá o no se valida en ningún lado.
	if _, err := s.coberturas.GetByID(ctx, negocioID, coberturaID); err != nil {
		return nil, traducirNoEncontrado(err)
	}

	ids := make([]string, 0, len(servicios))
	for _, sv := range servicios {
		ids = append(ids, sv.ID)
	}
	precios, err := s.coberturas.PreciosDeCobertura(ctx, coberturaID, ids)
	if err != nil {
		return nil, err
	}
	for i := range servicios {
		efectivo := servicios[i].PrecioBase
		if p, hay := precios[servicios[i].ID]; hay {
			efectivo = p
		}
		servicios[i].PrecioEfectivo = &efectivo
	}
	return servicios, nil
}

// resolverRestante mergea sobre el listado de dónde sale el número de porciones
// de cada plato. Hay dos fuentes y el orden está escrito acá, una sola vez:
//
//  1. Receta      → min(floor(stock del insumo / lo que pide la receta))
//  2. Cupo manual → asignado - consumido de la jornada abierta
//  3. Ilimitado   → restante nil, agotado false
//
// El orden no desempata nada real: un plato no puede tener receta y cupo a la
// vez, porque la escritura lo rechaza en los dos sentidos. Está explícito de
// todos modos para que el día que alguien rompa esa validación el catálogo no
// cambie de opinión según cómo quedó ordenado un if. Un comportamiento que
// depende del orden accidental de la implementación es una respuesta distinta
// para la misma pregunta, y el dueño la va a hacer en el peor momento.
//
// Las dos fuentes se resuelven ANTES del loop y cada una en una consulta: si la
// lectura entrara al for, el catálogo —que el agente pide en cada mensaje de
// cada conversación— se vuelve un N+1 sobre dos tablas más.
//
// Se resuelve acá y no en ServicioRepository a propósito: el repositorio de
// servicios no conoce la jornada ni los insumos, y también lo usa salud, donde
// no hay ni cupos ni recetas. Meterle jornada_id a su firma acopla el catálogo
// entero a algo que la mitad del producto no tiene.
func (s *catalogoService) resolverRestante(ctx context.Context, negocioID string, servicios []model.Servicio) error {
	if len(servicios) == 0 {
		return nil
	}
	porciones, err := s.porcionesPorReceta(ctx, negocioID)
	if err != nil {
		return err
	}
	cupos, err := s.cupoDeLaJornada(ctx, negocioID)
	if err != nil {
		return err
	}
	for i := range servicios {
		// 1. Receta.
		if p, tieneReceta := porciones[servicios[i].ID]; tieneReceta {
			aplicarPorciones(&servicios[i], p)
			continue
		}
		// 2. Cupo manual. Lo que no está en cupo_jornada es ilimitado: dejarlo
		// en restante 0 sería decirle al que consume "no hay" donde la verdad
		// es "no sé".
		if r, llevaCupo := cupos[servicios[i].ID]; llevaCupo {
			aplicarCupo(&servicios[i], r)
			continue
		}
		// 3. Ilimitado: se deja como salió del repo, o sea restante nil y
		// agotado false. No se toca nada a propósito — no hay un cero que
		// escribir acá.
	}
	return nil
}

// porcionesPorReceta trae, en UNA consulta, las porciones posibles de todos los
// platos de la carta que tienen receta con al menos una línea.
//
// No pide jornada, y ahí está la asimetría con el cupo: el insumo es un saldo
// corriente del negocio, no una foto del día. La carne está en la heladera
// exista o no una jornada abierta, y sigue estando mañana a la mañana. Un plato
// con receta calcula su restante con la caja cerrada; uno con cupo manual y sin
// jornada abierta es ilimitado, porque su cupo literalmente no existe todavía.
// Unificar las dos cosas "por consistencia" rompe una de las dos.
//
// Sin la opción cableada devuelve nil, y un mapa nil se lee igual que uno
// vacío: ningún plato tiene receta y todo cae al cupo manual, que es cómo se
// comportaba el catálogo antes de este cambio.
func (s *catalogoService) porcionesPorReceta(ctx context.Context, negocioID string) (map[string]repository.PorcionesServicio, error) {
	if s.recetas == nil {
		return nil, nil
	}
	return s.recetas.PorcionesPorServicio(ctx, negocioID)
}

// cupoDeLaJornada trae, en UNA consulta, el restante de los platos que llevan
// cupo hoy.
//
// Sin jornada abierta —o sin control de cupos cableado— no se inventa un día:
// devuelve nil y los servicios quedan ilimitados. Eso NO es un error: el
// negocio que nunca abre caja tiene que seguir vendiendo igual que siempre.
func (s *catalogoService) cupoDeLaJornada(ctx context.Context, negocioID string) (map[string]int, error) {
	if s.cupos == nil || s.jornadas == nil {
		return nil, nil
	}
	j, err := s.jornadas.Actual(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	if j == nil || j.CerradaEn != nil {
		return nil, nil
	}
	return s.cupos.RestantePorServicio(ctx, negocioID, j.ID)
}

// aplicarPorciones vuelca el resultado de la receta sobre el servicio. El
// contrato de afuera no cambia ni un byte: restante sigue siendo entero o null
// y agotado sigue siendo restante == 0. Lo único que cambió es de dónde salió
// el número.
//
// Además viaja el limitante, que es el argmin del mismo min() y por eso no
// cuesta una consulta más. Va siempre que el plato se controle por receta, no
// sólo cuando está agotado: el insumo que se va a quedar corto primero es la
// única forma de mostrar que el bife y las empanadas comparten la carne, en vez
// de dos números que parezcan sumables.
func aplicarPorciones(sv *model.Servicio, p repository.PorcionesServicio) {
	r := p.Porciones
	if r < 0 {
		// El CHECK (stock >= 0) del insumo no deja llegar acá. Si algún día
		// llegara, agotado es la lectura segura: la otra vende de más.
		r = 0
	}
	sv.Restante = &r
	sv.Agotado = r == 0
	sv.Limitante = &model.InsumoLimitante{
		Insumo:       p.InsumoLimitante,
		Unidad:       p.UnidadLimitante,
		Stock:        p.StockLimitante,
		PideLaReceta: p.PideLaReceta,
	}
}

// aplicarCupo es lo mismo para la Capa 1, y se mantiene idéntico a como estaba:
// este cambio agrega una fuente, no toca la que ya andaba.
func aplicarCupo(sv *model.Servicio, r int) {
	if r < 0 {
		// El CHECK (consumido <= asignado) no deja llegar acá. Si algún día
		// llegara, agotado es la lectura segura: la otra vende de más.
		r = 0
	}
	sv.Restante = &r
	sv.Agotado = r == 0
}

func (s *catalogoService) ObtenerServicio(ctx context.Context, negocioID, id string) (*model.Servicio, error) {
	sv, err := s.servicios.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return sv, nil
}

func (s *catalogoService) CrearServicio(ctx context.Context, negocioID string, req dto.CrearServicioRequest) (*model.Servicio, error) {
	// La categoría tiene que ser del mismo negocio: si no, un servicio quedaría
	// colgando de la carta de otro tenant.
	if req.CategoriaID != nil && *req.CategoriaID != "" {
		if _, err := s.categorias.GetByID(ctx, negocioID, *req.CategoriaID); err != nil {
			return nil, traducirNoEncontrado(err)
		}
	}
	sv := &model.Servicio{
		CategoriaID: req.CategoriaID,
		Nombre:      req.Nombre,
		Descripcion: req.Descripcion,
		DuracionMin: req.DuracionMin,
		PrecioBase:  req.PrecioBase,
		Disponible:  true,
		Activo:      true,
	}
	if req.Disponible != nil {
		sv.Disponible = *req.Disponible
	}
	if err := s.servicios.Create(ctx, negocioID, sv); err != nil {
		return nil, err
	}
	return sv, nil
}

func (s *catalogoService) ActualizarServicio(ctx context.Context, negocioID, id string, req dto.ActualizarServicioRequest) (*model.Servicio, error) {
	sv, err := s.servicios.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.CategoriaID != nil {
		if *req.CategoriaID != "" {
			if _, err := s.categorias.GetByID(ctx, negocioID, *req.CategoriaID); err != nil {
				return nil, traducirNoEncontrado(err)
			}
			sv.CategoriaID = req.CategoriaID
		} else {
			sv.CategoriaID = nil
		}
	}
	if req.Nombre != nil {
		sv.Nombre = *req.Nombre
	}
	if req.Descripcion != nil {
		sv.Descripcion = req.Descripcion
	}
	if req.DuracionMin != nil {
		sv.DuracionMin = req.DuracionMin
	}
	if req.PrecioBase != nil {
		sv.PrecioBase = *req.PrecioBase
	}
	if req.Disponible != nil {
		sv.Disponible = *req.Disponible
	}
	if req.Activo != nil {
		sv.Activo = *req.Activo
	}
	if err := s.servicios.Update(ctx, negocioID, sv); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return sv, nil
}

func (s *catalogoService) SetDisponible(ctx context.Context, negocioID, id string, disponible bool) error {
	return traducirNoEncontrado(s.servicios.SetDisponible(ctx, negocioID, id, disponible))
}

// ─── Coberturas y precios ────────────────────────────────────────────────────

func (s *catalogoService) ListarCoberturas(ctx context.Context, negocioID string) ([]model.Cobertura, error) {
	return s.coberturas.List(ctx, negocioID)
}

func (s *catalogoService) CrearCobertura(ctx context.Context, negocioID string, req dto.CrearCoberturaRequest) (*model.Cobertura, error) {
	c := &model.Cobertura{Nombre: req.Nombre}
	if err := s.coberturas.Create(ctx, negocioID, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *catalogoService) ActualizarCobertura(ctx context.Context, negocioID, id string, req dto.ActualizarCoberturaRequest) (*model.Cobertura, error) {
	c, err := s.coberturas.GetByID(ctx, negocioID, id)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if req.Nombre != nil {
		c.Nombre = *req.Nombre
	}
	if err := s.coberturas.Update(ctx, negocioID, c); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return c, nil
}

func (s *catalogoService) ListarPrecios(ctx context.Context, negocioID, servicioID string) ([]model.PrecioCobertura, error) {
	// precio_cobertura no tiene negocio_id: el tenant se valida acá, contra el
	// servicio, antes de tocar la tabla.
	if _, err := s.servicios.GetByID(ctx, negocioID, servicioID); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	return s.coberturas.ListPrecios(ctx, servicioID)
}

func (s *catalogoService) FijarPrecio(ctx context.Context, negocioID, servicioID string, req dto.PrecioCoberturaRequest) (*model.PrecioCobertura, error) {
	if _, err := s.servicios.GetByID(ctx, negocioID, servicioID); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if _, err := s.coberturas.GetByID(ctx, negocioID, req.CoberturaID); err != nil {
		return nil, traducirNoEncontrado(err)
	}
	p := &model.PrecioCobertura{
		ServicioID:  servicioID,
		CoberturaID: req.CoberturaID,
		Precio:      req.Precio,
		Coseguro:    req.Coseguro,
	}
	if err := s.coberturas.UpsertPrecio(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// PrecioParaCobertura devuelve el servicio con PrecioBase ya resuelto al precio
// que le corresponde a esa cobertura. Es lo que el motor congela en la línea.
func (s *catalogoService) PrecioParaCobertura(ctx context.Context, negocioID, servicioID string, coberturaID *string) (*model.Servicio, error) {
	sv, err := s.servicios.GetByID(ctx, negocioID, servicioID)
	if err != nil {
		return nil, traducirNoEncontrado(err)
	}
	if coberturaID == nil || *coberturaID == "" {
		return sv, nil
	}
	p, err := s.coberturas.PrecioDe(ctx, servicioID, *coberturaID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return sv, nil // sin precio por cobertura: manda precio_base
		}
		return nil, err
	}
	sv.PrecioBase = p.Precio
	return sv, nil
}
