package integration

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ── Helpers del cupo en el catálogo ─────────────────────────────────────────

// catalogoConCupo arma el service como lo arma producción (main.go): con el
// control de cupos cableado. Sin la opción el catálogo no miente, pero queda
// MUDO —todo `restante: null`— y un test de stock fallaría por falta de datos
// en vez de por el bug que busca.
func catalogoConCupo(db *gorm.DB) service.CatalogoService {
	return service.NewCatalogoService(
		repository.NewCategoriaRepository(db),
		repository.NewRecursoRepository(db),
		repository.NewServicioRepository(db),
		repository.NewCoberturaRepository(db),
		service.ConCupoEnCatalogo(
			repository.NewCupoRepository(db),
			repository.NewJornadaRepository(db),
		),
	)
}

// cargarCupo deja el plato con `asignado` porciones y `consumido` vendidas.
// Se vende consumiendo de verdad, no con un UPDATE a mano: el CHECK de la
// migración es parte de lo que se está probando.
func cargarCupo(t *testing.T, db *gorm.DB, negocioID, jornadaID, servicioID string, asignado, consumido int) {
	t.Helper()
	repo := repository.NewCupoRepository(db)
	if _, err := repo.Set(context.Background(), negocioID, jornadaID, servicioID, asignado); err != nil {
		t.Fatalf("cargar cupo %d: %v", asignado, err)
	}
	if consumido > 0 {
		if err := repo.Consumir(context.Background(), jornadaID, map[string]int{servicioID: consumido}); err != nil {
			t.Fatalf("consumir %d: %v", consumido, err)
		}
	}
}

// buscar devuelve el servicio por nombre, o corta el test. Buscar por nombre y
// no por índice: el orden del listado no es parte del contrato de este cambio.
func buscar(t *testing.T, servicios []model.Servicio, nombre string) model.Servicio {
	t.Helper()
	for _, s := range servicios {
		if s.Nombre == nombre {
			return s
		}
	}
	t.Fatalf("%q no salió en el catálogo (%d servicios)", nombre, len(servicios))
	return model.Servicio{}
}

func nombres(servicios []model.Servicio) []string {
	out := make([]string, 0, len(servicios))
	for _, s := range servicios {
		out = append(out, s.Nombre)
	}
	return out
}

// exigirIlimitado: `restante: null` y `agotado: false`, o sea "este plato no
// lleva cuenta". Es distinto de `restante: 0`, que es "lleva cuenta y no
// queda": confundirlos es apagar el plato equivocado.
func exigirIlimitado(t *testing.T, s model.Servicio) {
	t.Helper()
	if s.Restante != nil {
		t.Errorf("%s: esperaba restante null (ilimitado), obtuvo %d", s.Nombre, *s.Restante)
	}
	if s.Agotado {
		t.Errorf("%s: un plato sin cuenta no puede venir agotado", s.Nombre)
	}
}

// exigirRestante: el plato lleva cuenta y quedan `n`.
func exigirRestante(t *testing.T, s model.Servicio, n int, agotado bool) {
	t.Helper()
	if s.Restante == nil {
		t.Fatalf("%s: esperaba restante %d, vino null (el cupo no se resolvió)", s.Nombre, n)
	}
	if *s.Restante != n {
		t.Errorf("%s: restante esperado %d, obtenido %d", s.Nombre, n, *s.Restante)
	}
	if s.Agotado != agotado {
		t.Errorf("%s: agotado esperado %v, obtenido %v", s.Nombre, agotado, s.Agotado)
	}
}

// ── El catálogo expone el cupo del día ──────────────────────────────────────

// TestCatalogoExponeElCupoDeLaJornadaAbierta cubre los tres primeros escenarios
// del requirement "El catálogo expone el cupo del día", los tres sobre el MISMO
// listado: la carta se lee de una y cada plato tiene que contar su verdad.
func TestCatalogoExponeElCupoDeLaJornadaAbierta(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConCupo(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	crearServicio(t, db, neg.ID, "Empanadas", "4500")
	conStock := crearServicio(t, db, neg.ID, "Milanesa", "9500")
	agotado := crearServicio(t, db, neg.ID, "Bife", "14500")

	j := abrirJornada(t, db, neg.ID)
	cargarCupo(t, db, neg.ID, j.ID, conStock.ID, 10, 4)
	cargarCupo(t, db, neg.ID, j.ID, agotado.ID, 3, 3)
	// "Empanadas" no lleva cupo a propósito: el cupo es opt-in plato por plato.

	servicios, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar servicios: %v", err)
	}
	if len(servicios) != 3 {
		t.Fatalf("esperaba los 3 platos de la carta, obtuve %v", nombres(servicios))
	}

	t.Run("plato sin cupo cargado viaja como ilimitado", func(t *testing.T) {
		exigirIlimitado(t, buscar(t, servicios, "Empanadas"))
	})

	t.Run("plato con cupo y stock dice cuánto queda", func(t *testing.T) {
		// asignado 10, consumido 4 → quedan 6.
		exigirRestante(t, buscar(t, servicios, "Milanesa"), 6, false)
	})

	t.Run("plato agotado dice cero y lo dice también en agotado", func(t *testing.T) {
		// asignado 3, consumido 3 → 0, y agotado true.
		exigirRestante(t, buscar(t, servicios, "Bife"), 0, true)
	})
}

// TestCatalogoSinJornadaAbiertaEsTodoIlimitado: el negocio que no abrió la caja
// vende como siempre. No se inventa una jornada implícita ni se devuelve error
// — el día del deploy nadie cambia de comportamiento.
func TestCatalogoSinJornadaAbiertaEsTodoIlimitado(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConCupo(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Milanesa", "9500")

	// Ayer hubo cupo y se agotó. Hoy la caja está cerrada: el cupo de ayer no
	// puede seguir apagando el plato de hoy.
	ayer := abrirJornada(t, db, neg.ID)
	cargarCupo(t, db, neg.ID, ayer.ID, sv.ID, 2, 2)
	cerrarJornada(t, db, ayer.ID)

	servicios, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("sin jornada abierta el catálogo no puede fallar: %v", err)
	}
	if len(servicios) != 1 {
		t.Fatalf("esperaba 1 servicio, obtuve %v", nombres(servicios))
	}
	exigirIlimitado(t, servicios[0])
}

// TestElCupoDelCatalogoNoSeFiltraEntreNegocios: dos parrillas con la caja
// abierta al mismo tiempo. Lo que se agotó en una no puede apagar el plato de
// la otra, y el restante de una no puede aparecer en el catálogo de la otra.
func TestElCupoDelCatalogoNoSeFiltraEntreNegocios(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConCupo(db)

	a := crearNegocio(t, db, "Parrilla A", model.VerticalGastronomia)
	b := crearNegocio(t, db, "Parrilla B", model.VerticalGastronomia)
	// Mismo nombre de plato en los dos: si el merge se hiciera por nombre y no
	// por id, este test lo destapa.
	svA := crearServicio(t, db, a.ID, "Milanesa", "9500")
	svB := crearServicio(t, db, b.ID, "Milanesa", "9900")

	jA := abrirJornada(t, db, a.ID)
	jB := abrirJornada(t, db, b.ID)
	cargarCupo(t, db, a.ID, jA.ID, svA.ID, 4, 4) // A la agotó
	cargarCupo(t, db, b.ID, jB.ID, svB.ID, 7, 2) // a B le quedan 5

	deA, err := catalogo.ListarServicios(ctx, a.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar A: %v", err)
	}
	if len(deA) != 1 {
		t.Fatalf("A tiene que ver sólo su carta: %v", nombres(deA))
	}
	exigirRestante(t, deA[0], 0, true)

	deB, err := catalogo.ListarServicios(ctx, b.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar B: %v", err)
	}
	if len(deB) != 1 {
		t.Fatalf("B tiene que ver sólo su carta: %v", nombres(deB))
	}
	exigirRestante(t, deB[0], 5, false)
}

// ── solo_disponibles filtra el interruptor manual, no el stock ──────────────

// TestSoloDisponiblesFiltraElInterruptorNoElStock: los dos estados son
// distintos y el cliente merece oír una frase distinta en cada uno.
// `disponible=false` es "el dueño lo apagó" → "eso no lo tenemos". `agotado` es
// "se terminó hoy" → "hoy se nos terminó". Colapsarlos en un solo filtro
// obligaría al agente a resignar el filtrado del servidor para distinguirlos.
func TestSoloDisponiblesFiltraElInterruptorNoElStock(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConCupo(db)
	servicioRepo := repository.NewServicioRepository(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	agotado := crearServicio(t, db, neg.ID, "Bife", "14500")
	apagado := crearServicio(t, db, neg.ID, "Provoleta", "6800")
	crearServicio(t, db, neg.ID, "Empanadas", "4500")

	j := abrirJornada(t, db, neg.ID)
	cargarCupo(t, db, neg.ID, j.ID, agotado.ID, 5, 5)
	// El apagado a mano tiene stock de sobra: lo único que lo saca de la carta
	// es el interruptor del panel.
	cargarCupo(t, db, neg.ID, j.ID, apagado.ID, 20, 0)
	setDisponible(t, db, apagado.ID, false)

	t.Run("el filtrado sigue trayendo los agotados, marcados", func(t *testing.T) {
		servicios, err := catalogo.ListarServicios(ctx, neg.ID,
			repository.FiltroServicios{SoloDisponibles: true})
		if err != nil {
			t.Fatalf("listar filtrado: %v", err)
		}
		bife := buscar(t, servicios, "Bife")
		exigirRestante(t, bife, 0, true)
		// Y con todo lo que hace falta para partir la lista de una: el precio
		// sigue viniendo, así que no hace falta una segunda llamada.
		igualDecimal(t, bife.PrecioBase, "14500", "el agotado conserva su precio")
	})

	t.Run("el interruptor manual sigue filtrando en el servidor", func(t *testing.T) {
		servicios, err := catalogo.ListarServicios(ctx, neg.ID,
			repository.FiltroServicios{SoloDisponibles: true})
		if err != nil {
			t.Fatalf("listar filtrado: %v", err)
		}
		for _, s := range servicios {
			if s.Nombre == "Provoleta" {
				t.Fatalf("un plato apagado a mano se coló en el listado filtrado: %+v", s)
			}
		}
		// Y el filtro se aplica en la consulta, no en el consumidor: el mismo
		// filtro contra el repositorio pelado ya lo deja afuera.
		delRepo, err := servicioRepo.List(ctx, neg.ID, repository.FiltroServicios{SoloDisponibles: true})
		if err != nil {
			t.Fatalf("listar del repo: %v", err)
		}
		for _, s := range delRepo {
			if s.ID == apagado.ID {
				t.Error("el WHERE del repositorio ya no filtra `disponible`: el filtrado se movió al consumidor")
			}
		}
		if len(delRepo) != 2 {
			t.Errorf("el repo filtrado devolvió %v; el agotado tiene que seguir estando", nombres(delRepo))
		}
	})

	t.Run("sin filtro se ve todo, marcado", func(t *testing.T) {
		servicios, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
		if err != nil {
			t.Fatalf("listar sin filtro: %v", err)
		}
		if len(servicios) != 3 {
			t.Fatalf("el panel tiene que ver la carta entera: %v", nombres(servicios))
		}
		provoleta := buscar(t, servicios, "Provoleta")
		if provoleta.Disponible {
			t.Error("el apagado a mano tiene que aparecer marcado con disponible=false")
		}
		// Apagado NO es agotado: tiene 20 porciones y el panel tiene que verlo.
		exigirRestante(t, provoleta, 20, false)
		exigirRestante(t, buscar(t, servicios, "Bife"), 0, true)
		exigirIlimitado(t, buscar(t, servicios, "Empanadas"))
	})
}

// ── Una sola consulta ───────────────────────────────────────────────────────

// contadorSQL cuenta las sentencias que GORM manda a Postgres. Es la única
// forma de aseverar "una consulta y no una por servicio" sin creerle a la
// implementación: un N+1 escondido adentro del repositorio también cae acá.
type contadorSQL struct {
	mu   sync.Mutex
	sqls []string
}

func (c *contadorSQL) LogMode(logger.LogLevel) logger.Interface      { return c }
func (c *contadorSQL) Info(context.Context, string, ...interface{})  {}
func (c *contadorSQL) Warn(context.Context, string, ...interface{})  {}
func (c *contadorSQL) Error(context.Context, string, ...interface{}) {}

func (c *contadorSQL) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sqls = append(c.sqls, sql)
}

// contra cuenta cuántas sentencias tocaron una tabla.
func (c *contadorSQL) contra(tabla string) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for _, s := range c.sqls {
		if strings.Contains(strings.ToLower(s), tabla) {
			out = append(out, s)
		}
	}
	return out
}

func (c *contadorSQL) reiniciar() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sqls = nil
}

// TestElCupoDelCatalogoSaleEnUnaSolaConsulta: la carta del agente se lista
// varias veces por conversación. Preguntar el cupo plato por plato convierte
// cada listado en un N+1 contra cupo_jornada, y con carta grande eso se paga
// en el servicio lleno, que es justo cuando importa.
//
// Se cuenta el SQL de verdad, no las llamadas al repositorio: si mañana el
// merge se hace con un JOIN, el test sigue valiendo; si alguien mete un bucle,
// falla con el número exacto.
func TestElCupoDelCatalogoSaleEnUnaSolaConsulta(t *testing.T) {
	_, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	j := abrirJornada(t, db, neg.ID)

	// Carta grande y con cupo en TODOS: el N+1, si existe, es proporcional.
	const platos = 50
	for i := 0; i < platos; i++ {
		sv := crearServicio(t, db, neg.ID, "Plato "+string(rune('A'+i%26))+string(rune('0'+i/26)), "1000")
		cargarCupo(t, db, neg.ID, j.ID, sv.ID, 10, i%10)
	}

	contador := &contadorSQL{}
	espiado := db.Session(&gorm.Session{Logger: contador})
	catalogo := catalogoConCupo(espiado)
	contador.reiniciar()

	servicios, err := catalogo.ListarServicios(context.Background(), neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	if len(servicios) != platos {
		t.Fatalf("esperaba %d platos, obtuve %d", platos, len(servicios))
	}

	consultas := contador.contra("cupo_jornada")
	if len(consultas) != 1 {
		t.Errorf("el listado resolvió el cupo en %d consultas a cupo_jornada; el contrato es UNA sola, agrupada por jornada.\n"+
			"Con %d platos en la carta esto es un N+1 en cada llamada del agente. Sentencias:\n  %s",
			len(consultas), platos, strings.Join(consultas, "\n  "))
	}

	// La jornada abierta también se resuelve de una: si esto crece, el N+1 se
	// mudó de tabla.
	if deJornada := contador.contra("from jornada"); len(deJornada) > 1 {
		t.Errorf("la jornada abierta se resolvió en %d consultas, esperaba 1: %s",
			len(deJornada), strings.Join(deJornada, "\n  "))
	}
}
