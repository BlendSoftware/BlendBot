package integration

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"gorm.io/gorm"
)

// ── Helpers ─────────────────────────────────────────────────────────────────

// catalogoConStock arma el catálogo como lo arma producción (main.go): con las
// DOS fuentes de `restante` cableadas. Con una sola de las dos, el catálogo le
// miente al agente sobre la mitad de la carta, y un test de recetas fallaría
// por falta de datos en vez de por el bug que busca.
func catalogoConStock(db *gorm.DB) service.CatalogoService {
	return service.NewCatalogoService(
		repository.NewCategoriaRepository(db),
		repository.NewRecursoRepository(db),
		repository.NewServicioRepository(db),
		repository.NewCoberturaRepository(db),
		service.ConCupoEnCatalogo(
			repository.NewCupoRepository(db),
			repository.NewJornadaRepository(db),
		),
		service.ConRecetasEnCatalogo(repository.NewRecetaRepository(db)),
	)
}

// descontadorDe arma el enrutador de descuentos como producción: plato con
// receta baja insumos, plato con cupo baja el cupo del día.
func descontadorDe(db *gorm.DB) service.DescontadorStock {
	return service.NewDescontadorStock(
		repository.NewRecetaRepository(db),
		repository.NewInsumoRepository(db),
		repository.NewCupoRepository(db),
	)
}

// exigirLimitante: el plato dice CUÁL insumo le fijó las porciones y con qué
// números. Un plato que se apaga solo y no dice por qué es indistinguible de un
// bug, y el dueño lo resuelve apagando la feature entera.
//
// La unidad se exige junto a los números y no como un extra: "quedan 2" no dice
// nada si no se sabe si son dos gramos o dos panes, y ésa es exactamente la
// frase que el dueño lee cuando un plato se apagó solo.
func exigirLimitante(t *testing.T, s model.Servicio, insumo, unidad string, stock, pide int) {
	t.Helper()
	if s.Limitante == nil {
		t.Fatalf("%s: no viajó el insumo limitante", s.Nombre)
	}
	if s.Limitante.Insumo != insumo {
		t.Errorf("%s: el limitante es %q, esperaba %q", s.Nombre, s.Limitante.Insumo, insumo)
	}
	if s.Limitante.Unidad != unidad {
		t.Errorf("%s: el limitante viaja en %q, esperaba %q", s.Nombre, s.Limitante.Unidad, unidad)
	}
	if s.Limitante.Stock != stock || s.Limitante.PideLaReceta != pide {
		t.Errorf("%s: el limitante dice stock=%d pide=%d, esperaba %d/%d",
			s.Nombre, s.Limitante.Stock, s.Limitante.PideLaReceta, stock, pide)
	}
}

// ── Las porciones posibles se derivan, no se guardan ────────────────────────

// TestLasPorcionesSalenDelInsumoMasEscaso cubre los cuatro escenarios del
// min(floor()) sobre el MISMO listado, que es como se leen: la carta se pide de
// una y cada plato tiene que contar su verdad.
//
// Los cuatro son el mismo cálculo mirado desde cuatro ángulos, y cada uno es un
// error distinto de implementación: tomar el primero en vez del mínimo,
// redondear para arriba, confundir 0 con null, y apagar el plato al que le
// vaciaron la receta.
func TestLasPorcionesSalenDelInsumoMasEscaso(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConStock(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)

	medallon := altaInsumo(t, db, neg.ID, "medallón", model.UnidadUnidad, 40, nil)
	pan := altaInsumo(t, db, neg.ID, "pan de papa", model.UnidadUnidad, 12, nil)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 1000, nil)
	queso := altaInsumo(t, db, neg.ID, "provolone", model.UnidadGramo, 0, nil)

	hamburguesa := crearServicio(t, db, neg.ID, "Hamburguesa", "9500")
	milanesa := crearServicio(t, db, neg.ID, "Milanesa", "9800")
	provoleta := crearServicio(t, db, neg.ID, "Provoleta", "6800")
	vaciada := crearServicio(t, db, neg.ID, "Empanadas", "4500")

	guardarReceta(t, db, neg.ID, hamburguesa.ID, linea(medallon.ID, 1), linea(pan.ID, 1))
	guardarReceta(t, db, neg.ID, milanesa.ID, linea(carne.ID, 300))
	guardarReceta(t, db, neg.ID, provoleta.ID, linea(queso.ID, 150))
	// A las empanadas se le cargó una receta y después se le borraron todas las
	// líneas. Es el caso que motivó la decisión: NO puede quedar agotado.
	guardarReceta(t, db, neg.ID, vaciada.ID, linea(carne.ID, 100))
	guardarReceta(t, db, neg.ID, vaciada.ID)

	servicios, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar servicios: %v", err)
	}
	if len(servicios) != 4 {
		t.Fatalf("esperaba los 4 platos de la carta, obtuve %v", nombres(servicios))
	}

	t.Run("el insumo más escaso manda", func(t *testing.T) {
		// 40 medallones y 12 panes, uno de cada por porción → 12, no 40.
		h := buscar(t, servicios, "Hamburguesa")
		exigirRestante(t, h, 12, false)
		exigirLimitante(t, h, "pan de papa", model.UnidadUnidad, 12, 1)
	})

	t.Run("cantidades que no dividen exacto dan 3 y no 3.33", func(t *testing.T) {
		// 1000 g de carne, la receta pide 300 → 3 porciones. Redondear para
		// arriba es prometer un plato que no se puede cocinar.
		m := buscar(t, servicios, "Milanesa")
		exigirRestante(t, m, 3, false)
		exigirLimitante(t, m, "carne picada", model.UnidadGramo, 1000, 300)
	})

	t.Run("un insumo en cero apaga el plato", func(t *testing.T) {
		p := buscar(t, servicios, "Provoleta")
		exigirRestante(t, p, 0, true)
		exigirLimitante(t, p, "provolone", model.UnidadGramo, 0, 150)
	})

	t.Run("receta vacía es ilimitado, no agotado", func(t *testing.T) {
		e := buscar(t, servicios, "Empanadas")
		exigirIlimitado(t, e)
		if e.Limitante != nil {
			t.Errorf("un plato sin receta no puede tener limitante: %+v", e.Limitante)
		}
	})
}

// TestLosInsumosCompartidosNoSonIndependientes: el bife y las empanadas comen
// de la misma carne. Vender un bife baja también las porciones de las
// empanadas, y el catálogo tiene que decirlo nombrando la carne en los dos —
// no dos números que parezcan sumables.
func TestLosInsumosCompartidosNoSonIndependientes(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConStock(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	cli := crearCliente(t, db, neg.ID, "5492611000801", "Juana", nil)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 1200, nil)
	bife := crearServicio(t, db, neg.ID, "Bife", "14500")
	empanadas := crearServicio(t, db, neg.ID, "Empanadas", "4500")

	guardarReceta(t, db, neg.ID, bife.ID, linea(carne.ID, 200))
	guardarReceta(t, db, neg.ID, empanadas.ID, linea(carne.ID, 100))

	antes, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	exigirRestante(t, buscar(t, antes, "Bife"), 6, false)       // 1200/200
	exigirRestante(t, buscar(t, antes, "Empanadas"), 12, false) // 1200/100

	// Se vende un bife: 200 g menos de carne.
	pedido := crearCompromisoDirecto(t, db, neg.ID, cli.ID, bife.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoConfirmado, "14500")
	if err := descontadorDe(db).Consumir(ctx, neg.ID, "", pedido.ID, map[string]int{bife.ID: 1}); err != nil {
		t.Fatalf("consumir el bife: %v", err)
	}

	despues, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	exigirRestante(t, buscar(t, despues, "Bife"), 5, false)
	// Y las empanadas bajaron SOLAS: nadie vendió una empanada.
	exigirRestante(t, buscar(t, despues, "Empanadas"), 10, false)
	exigirLimitante(t, buscar(t, despues, "Empanadas"), "carne picada", model.UnidadGramo, 1000, 100)
	exigirLimitante(t, buscar(t, despues, "Bife"), "carne picada", model.UnidadGramo, 1000, 200)
}

// TestUnaCompraAMitadDelServicioReactivaElPlato: entra mercadería a las 21:30
// con la caja abierta desde las 20:00. La lectura siguiente del catálogo ya
// ofrece el plato, y NO hace falta cerrar ni reabrir la jornada.
//
// Es exactamente el escenario que descartó materializar las porciones en
// cupo_jornada al abrir la caja: ese cupo habría quedado calculado con el stock
// de las 20:00.
func TestUnaCompraAMitadDelServicioReactivaElPlato(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConStock(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	pan := altaInsumo(t, db, neg.ID, "pan de papa", model.UnidadUnidad, 0, nil)
	hamburguesa := crearServicio(t, db, neg.ID, "Hamburguesa", "9500")
	guardarReceta(t, db, neg.ID, hamburguesa.ID, linea(pan.ID, 1))

	j := abrirJornada(t, db, neg.ID)

	agotada, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	exigirRestante(t, buscar(t, agotada, "Hamburguesa"), 0, true)

	// Llegó el panadero.
	if _, err := insumosDe(db).RegistrarCompra(ctx, neg.ID, pan.ID,
		dto.RegistrarCompraInput{Cantidad: 20}); err != nil {
		t.Fatalf("registrar compra: %v", err)
	}

	viva, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	exigirRestante(t, buscar(t, viva, "Hamburguesa"), 20, false)

	t.Run("la jornada nunca se tocó", func(t *testing.T) {
		var cerrada *string
		if err := db.Raw(`SELECT cerrada_en FROM jornada WHERE id = ?`, j.ID).Scan(&cerrada).Error; err != nil {
			t.Fatalf("leer jornada: %v", err)
		}
		if cerrada != nil {
			t.Error("la jornada se cerró: reactivar un plato no puede pedir cerrar la caja")
		}
		var jornadas int64
		db.Raw(`SELECT COUNT(*) FROM jornada WHERE negocio_id = ?`, neg.ID).Scan(&jornadas)
		if jornadas != 1 {
			t.Errorf("aparecieron %d jornadas: la compra abrió un día nuevo", jornadas)
		}
	})
}

// TestCorregirElSaldoDevuelveElPlatoALaVenta: el stock estaba mal cargado y el
// plato se apagó por eso. La salida NO es forzar la venta con el interruptor
// —un plato agotado por receta ya tiene disponible en true, y aunque se pudiera
// forzar, confirmar el pedido fallaría igual con ErrSinStock—, sino corregir el
// saldo del insumo.
//
// Es la salida buena y no un reemplazo pobre: arregla el número equivocado en
// vez de taparlo, y deja un movimiento de `ajuste` que explica qué pasó.
func TestCorregirElSaldoDevuelveElPlatoALaVenta(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConStock(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	pan := altaInsumo(t, db, neg.ID, "pan de papa", model.UnidadUnidad, 0, nil)
	hamburguesa := crearServicio(t, db, neg.ID, "Hamburguesa", "9500")
	guardarReceta(t, db, neg.ID, hamburguesa.ID, linea(pan.ID, 1))

	apagada, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	h := buscar(t, apagada, "Hamburguesa")
	exigirRestante(t, h, 0, true)
	// El interruptor manual sigue en true: el plato no está apagado por el
	// dueño, está agotado por el stock. Son dos estados distintos y por eso el
	// interruptor no es la salida de este problema.
	if !h.Disponible {
		t.Error("un plato agotado por receta no puede venir con disponible=false: son dos cosas distintas")
	}
	exigirLimitante(t, h, "pan de papa", model.UnidadUnidad, 0, 1)

	// El dueño mira la heladera: había 30 panes, el saldo estaba mal.
	motivo := "estaba mal cargado, conté 30"
	if _, err := insumosDe(db).Ajustar(ctx, neg.ID, pan.ID, dto.AjustarStockInput{
		Stock: ptr(30), Motivo: &motivo,
	}); err != nil {
		t.Fatalf("ajustar: %v", err)
	}

	viva, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	exigirRestante(t, buscar(t, viva, "Hamburguesa"), 30, false)

	t.Run("y la corrección queda registrada como ajuste", func(t *testing.T) {
		movs := movimientosDe(t, db, pan.ID)
		ultimo := movs[len(movs)-1]
		if ultimo.Tipo != model.MovAjuste {
			t.Fatalf("esperaba un `ajuste`, obtuve %q", ultimo.Tipo)
		}
		if ultimo.SaldoResultante != 30 {
			t.Errorf("el ajuste dejó el saldo en %d, esperaba 30", ultimo.SaldoResultante)
		}
		if ultimo.Motivo == nil || *ultimo.Motivo != motivo {
			t.Errorf("el ajuste tiene que guardar el porqué, guardó %v", ultimo.Motivo)
		}
	})
}

// TestLaRecetaNoDependeDeLaJornadaYElCupoSi es la asimetría del cambio, y no
// unificarla es la decisión: el insumo es un SALDO del negocio y el cupo es una
// FOTO del día.
//
// Un plato con receta calcula sus porciones con la caja cerrada, porque la
// carne está en la heladera exista o no una jornada abierta. Uno con cupo
// manual sin jornada abierta es ilimitado, porque su cupo literalmente no
// existe todavía. Unificar las dos "por consistencia" rompe una de las dos.
func TestLaRecetaNoDependeDeLaJornadaYElCupoSi(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := catalogoConStock(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 1200, nil)
	conReceta := crearServicio(t, db, neg.ID, "Bife", "14500")
	conCupo := crearServicio(t, db, neg.ID, "Provoleta", "6800")

	guardarReceta(t, db, neg.ID, conReceta.ID, linea(carne.ID, 200))

	// Ayer hubo cupo para la provoleta y quedaron 5. Hoy la caja está cerrada.
	ayer := abrirJornada(t, db, neg.ID)
	cargarCupo(t, db, neg.ID, ayer.ID, conCupo.ID, 7, 2)
	cerrarJornada(t, db, ayer.ID)

	servicios, err := catalogo.ListarServicios(ctx, neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("sin jornada abierta el catálogo no puede fallar: %v", err)
	}

	t.Run("con receta y sin jornada abierta calcula igual", func(t *testing.T) {
		b := buscar(t, servicios, "Bife")
		exigirRestante(t, b, 6, false)
		exigirLimitante(t, b, "carne picada", model.UnidadGramo, 1200, 200)
	})

	t.Run("con cupo manual y sin jornada abierta es ilimitado", func(t *testing.T) {
		exigirIlimitado(t, buscar(t, servicios, "Provoleta"))
	})
}

// ── Una sola consulta ───────────────────────────────────────────────────────

// TestLasRecetasDelCatalogoSalenEnUnaSolaConsulta: el camino ingenuo —por cada
// plato traer su receta, por cada línea traer su insumo— es un N+1 sobre DOS
// tablas, y el catálogo se pide en cada mensaje de cada conversación.
//
// Se cuenta el SQL de verdad, no las llamadas al repositorio: si mañana el
// merge se hace de otra forma el test sigue valiendo; si alguien mete un bucle,
// falla con el número exacto. Mismo instrumento que usa el test del cupo.
func TestLasRecetasDelCatalogoSalenEnUnaSolaConsulta(t *testing.T) {
	_, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)

	// Carta grande, recetas de VARIOS insumos: si hay N+1, es proporcional a
	// los platos; si el N+1 está en la resolución del insumo, es proporcional a
	// las líneas. Con 40 platos de 3 líneas los dos se ven.
	const platos = 40
	const lineasPorPlato = 3
	insumos := make([]string, 0, 12)
	for i := 0; i < 12; i++ {
		in := altaInsumo(t, db, neg.ID, "insumo "+strconv.Itoa(i), model.UnidadGramo, 5000, nil)
		insumos = append(insumos, in.ID)
	}
	for i := 0; i < platos; i++ {
		sv := crearServicio(t, db, neg.ID, "Plato "+strconv.Itoa(i), "1000")
		items := make([]dto.LineaRecetaInput, 0, lineasPorPlato)
		for k := 0; k < lineasPorPlato; k++ {
			items = append(items, linea(insumos[(i+k)%len(insumos)], 100+k))
		}
		guardarReceta(t, db, neg.ID, sv.ID, items...)
	}

	contador := &contadorSQL{}
	espiado := db.Session(&gorm.Session{Logger: contador})
	catalogo := catalogoConStock(espiado)
	contador.reiniciar()

	servicios, err := catalogo.ListarServicios(context.Background(), neg.ID, repository.FiltroServicios{})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	if len(servicios) != platos {
		t.Fatalf("esperaba %d platos, obtuve %d", platos, len(servicios))
	}

	consultas := contador.contra("receta_item")
	if len(consultas) != 1 {
		t.Errorf("el listado resolvió las recetas en %d consultas a receta_item; el contrato es UNA sola.\n"+
			"Con %d platos de %d líneas esto es un N+1 sobre dos tablas en cada llamada del agente. Sentencias:\n  %s",
			len(consultas), platos, lineasPorPlato, strings.Join(consultas, "\n  "))
	}

	// Y el stock de los insumos sale en esa MISMA consulta: si aparece una
	// segunda tanda contra `insumo`, el N+1 se mudó de tabla en vez de irse.
	deInsumo := contador.contra("insumo")
	if len(deInsumo) != 1 {
		t.Errorf("el stock de los insumos se resolvió en %d consultas, esperaba 1 (la misma de la receta):\n  %s",
			len(deInsumo), strings.Join(deInsumo, "\n  "))
	}
}
