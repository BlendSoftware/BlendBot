package integration

import (
	"context"
	"errors"
	"strings"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"gorm.io/gorm"
)

// ── Helpers de la Capa 2 ────────────────────────────────────────────────────

func insumosDe(db *gorm.DB) service.InsumoService {
	return service.NewInsumoService(repository.NewInsumoRepository(db))
}

// altaInsumo da de alta materia prima por el service, que es el camino que usa
// el panel. El stock inicial NO entra por el INSERT: el service crea en cero y
// después registra una `compra`. Sembrar esto con GORM directo taparía
// exactamente el invariante que el módulo promete —que no existe un write a
// insumo.stock sin su movimiento—, así que acá se siembra por el service.
func altaInsumo(t *testing.T, db *gorm.DB, negocioID, nombre, unidad string, inicial int, minimo *int) dto.InsumoResponse {
	t.Helper()
	in := dto.CrearInsumoInput{Nombre: nombre, Unidad: unidad, StockMinimo: minimo}
	if inicial > 0 {
		in.StockInicial = &inicial
	}
	r, err := insumosDe(db).Crear(context.Background(), negocioID, in)
	if err != nil {
		t.Fatalf("alta de %q: %v", nombre, err)
	}
	return *r
}

// stockDe relee el saldo de la base. Se relee y no se confía en lo que devolvió
// la operación: el saldo lo escribe una transacción y el único que sabe en qué
// terminó es Postgres.
func stockDe(t *testing.T, db *gorm.DB, insumoID string) int {
	t.Helper()
	var stock int
	if err := db.Raw(`SELECT stock FROM insumo WHERE id = ?`, insumoID).Scan(&stock).Error; err != nil {
		t.Fatalf("leer stock de %s: %v", insumoID, err)
	}
	return stock
}

// movimientosDe devuelve la historia completa de un insumo, del más viejo al
// más nuevo, sin pasar por el repositorio: el sujeto del test es justamente si
// el repositorio escribe lo que dice escribir.
func movimientosDe(t *testing.T, db *gorm.DB, insumoID string) []model.MovimientoInsumo {
	t.Helper()
	var movs []model.MovimientoInsumo
	err := db.Raw(`
		SELECT id, insumo_id, tipo, cantidad, saldo_resultante, compromiso_id, motivo, creado_en
		  FROM movimiento_insumo WHERE insumo_id = ? ORDER BY creado_en ASC, id ASC
	`, insumoID).Scan(&movs).Error
	if err != nil {
		t.Fatalf("leer movimientos de %s: %v", insumoID, err)
	}
	return movs
}

// ── El negocio lleva su materia prima como saldo corriente ──────────────────

// TestAltaDeInsumoDejaElSaldoYSuExplicacion cubre el escenario "Alta de un
// insumo" del spec `insumos`, y de paso el invariante que lo hace posible: el
// alta con stock son DOS pasos —crear en cero y registrar una `compra`— para
// que el único camino que escribe insumo.stock siga siendo Mover. Si el INSERT
// pudiera nacer con 40000, la historia arrancaría con un saldo que no explica
// de dónde salió.
func TestAltaDeInsumoDejaElSaldoYSuExplicacion(t *testing.T) {
	ctx, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 40000, ptr(5000))

	if carne.Unidad != model.UnidadGramo {
		t.Errorf("la unidad tiene que viajar siempre al lado del saldo, vino %q", carne.Unidad)
	}
	if carne.Stock != 40000 {
		t.Errorf("stock esperado 40000, obtenido %d", carne.Stock)
	}
	if got := stockDe(t, db, carne.ID); got != 40000 {
		t.Errorf("en la base el saldo quedó en %d, no en 40000", got)
	}
	if carne.BajoMinimo {
		t.Error("40000 con mínimo 5000 no está bajo mínimo")
	}

	t.Run("pertenece únicamente a su negocio", func(t *testing.T) {
		var deQuien string
		if err := db.Raw(`SELECT negocio_id FROM insumo WHERE id = ?`, carne.ID).Scan(&deQuien).Error; err != nil {
			t.Fatalf("leer negocio_id: %v", err)
		}
		if deQuien != neg.ID {
			t.Errorf("el insumo quedó colgado de %s y no de %s", deQuien, neg.ID)
		}
	})

	t.Run("el saldo inicial entró como una compra, no como un INSERT", func(t *testing.T) {
		movs := movimientosDe(t, db, carne.ID)
		if len(movs) != 1 {
			t.Fatalf("esperaba un solo movimiento de carga inicial, obtuve %d", len(movs))
		}
		if movs[0].Tipo != model.MovCompra {
			t.Errorf("el saldo inicial tiene que ser una `compra`, vino %q", movs[0].Tipo)
		}
		if movs[0].Cantidad != 40000 || movs[0].SaldoResultante != 40000 {
			t.Errorf("el movimiento de carga dice cantidad=%d saldo=%d, esperaba 40000/40000",
				movs[0].Cantidad, movs[0].SaldoResultante)
		}
	})

	t.Run("Crear ignora el stock que le pasen: el INSERT nace en cero", func(t *testing.T) {
		// Se llama al repositorio pelado con un stock cargado en el modelo. Si
		// el INSERT lo respetara, existiría un camino que escribe el saldo sin
		// dejar movimiento y el libro mayor dejaría de explicar la heladera.
		repo := repository.NewInsumoRepository(db)
		colado := &model.Insumo{Nombre: "pan de papa", Unidad: model.UnidadUnidad, Stock: 999, Activo: true}
		if err := repo.Crear(ctx, neg.ID, colado); err != nil {
			t.Fatalf("crear: %v", err)
		}
		if got := stockDe(t, db, colado.ID); got != 0 {
			t.Errorf("el alta entró con stock %d: hay un camino que escribe el saldo sin movimiento", got)
		}
		if movs := movimientosDe(t, db, colado.ID); len(movs) != 0 {
			t.Errorf("un alta en cero no puede dejar movimientos, dejó %d", len(movs))
		}
	})
}

// TestElSaldoDeUnInsumoCruzaElCierreDelDia: el insumo NO es una foto del día.
// La carne que sobra hoy sigue estando mañana, así que cerrar y abrir la caja
// no puede tocarle un gramo. Es la diferencia estructural con el cupo y la
// razón por la que la tabla no tiene jornada_id.
func TestElSaldoDeUnInsumoCruzaElCierreDelDia(t *testing.T) {
	_, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 12000, nil)

	hoy := abrirJornada(t, db, neg.ID)
	cerrarJornada(t, db, hoy.ID)
	abrirJornada(t, db, neg.ID) // la jornada siguiente

	if got := stockDe(t, db, carne.ID); got != 12000 {
		t.Errorf("al abrir la jornada siguiente el saldo es %d y tiene que seguir siendo 12000", got)
	}
	if movs := movimientosDe(t, db, carne.ID); len(movs) != 1 {
		t.Errorf("cerrar y abrir la caja no puede generar movimientos: hay %d", len(movs))
	}
}

// TestElStockDeUnInsumoNoPuedeQuedarNegativo: el spec pide que la garantía esté
// en la BASE y no solamente en el service. Se prueban los dos caminos, y el
// segundo es el que importa: un UPDATE a mano, salteándose todo el Go, tiene
// que rebotar contra insumo_stock_no_negativo.
func TestElStockDeUnInsumoNoPuedeQuedarNegativo(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewInsumoRepository(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 500, nil)

	t.Run("el descuento de más falla y nombra el insumo", func(t *testing.T) {
		err := repo.Mover(ctx, neg.ID, []model.MovimientoInsumo{
			{InsumoID: carne.ID, Tipo: model.MovConsumo, Cantidad: 900},
		})
		if !errors.Is(err, repository.ErrSinStock) {
			t.Fatalf("esperaba ErrSinStock, obtuve %v", err)
		}
		var det *repository.ErrStockDeInsumo
		if !errors.As(err, &det) {
			t.Fatalf("el error tiene que nombrar el insumo que faltó, vino %T", err)
		}
		if det.Insumo != "carne picada" || det.Pedido != 900 || det.Hay != 500 {
			t.Errorf("el error dice insumo=%q pedido=%d hay=%d; esperaba carne picada/900/500",
				det.Insumo, det.Pedido, det.Hay)
		}
	})

	t.Run("el stock queda intacto y sin movimiento", func(t *testing.T) {
		if got := stockDe(t, db, carne.ID); got != 500 {
			t.Errorf("el saldo quedó en %d después de un descuento que falló", got)
		}
		if movs := movimientosDe(t, db, carne.ID); len(movs) != 1 {
			t.Errorf("un descuento que falló no puede dejar movimiento: hay %d", len(movs))
		}
	})

	t.Run("el árbitro final es Postgres, no el service", func(t *testing.T) {
		err := db.Exec(`UPDATE insumo SET stock = stock - 900 WHERE id = ?`, carne.ID).Error
		if err == nil {
			t.Fatal("un UPDATE a mano dejó el stock negativo: falta el CHECK en la tabla")
		}
		if !strings.Contains(err.Error(), "insumo_stock_no_negativo") {
			t.Errorf("rebotó, pero no por el CHECK esperado: %v", err)
		}
		if got := stockDe(t, db, carne.ID); got != 500 {
			t.Errorf("el saldo quedó en %d tras el UPDATE rechazado", got)
		}
	})
}

// TestLosInsumosNoSeFiltranEntreNegocios: dos parrillas con "carne picada". Cada
// una lee y modifica únicamente la suya, y el uuid de la otra no es una llave
// que abra nada.
func TestLosInsumosNoSeFiltranEntreNegocios(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewInsumoRepository(db)

	a := crearNegocio(t, db, "Parrilla A", model.VerticalGastronomia)
	b := crearNegocio(t, db, "Parrilla B", model.VerticalGastronomia)
	deA := altaInsumo(t, db, a.ID, "carne picada", model.UnidadGramo, 40000, nil)
	deB := altaInsumo(t, db, b.ID, "carne picada", model.UnidadGramo, 1000, nil)

	t.Run("cada uno lee sólo lo suyo", func(t *testing.T) {
		lista, err := repo.Listar(ctx, a.ID)
		if err != nil {
			t.Fatalf("listar A: %v", err)
		}
		if len(lista) != 1 || lista[0].ID != deA.ID {
			t.Fatalf("A tiene que ver un solo insumo, el suyo; vio %+v", lista)
		}
		if _, err := repo.GetByID(ctx, a.ID, deB.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Errorf("A leyó el insumo de B: %v", err)
		}
	})

	t.Run("no se puede mover el saldo del otro", func(t *testing.T) {
		err := repo.Mover(ctx, a.ID, []model.MovimientoInsumo{
			{InsumoID: deB.ID, Tipo: model.MovConsumo, Cantidad: 100},
		})
		if err == nil {
			t.Fatal("A descontó del insumo de B pasando su uuid")
		}
		if got := stockDe(t, db, deB.ID); got != 1000 {
			t.Errorf("el saldo de B quedó en %d: se lo tocaron desde otro negocio", got)
		}
	})

	t.Run("la historia tampoco se cruza", func(t *testing.T) {
		movs, err := repo.Movimientos(ctx, a.ID, deB.ID, 50)
		if err != nil {
			t.Fatalf("movimientos: %v", err)
		}
		if len(movs) != 0 {
			t.Errorf("A leyó %d movimientos del insumo de B", len(movs))
		}
	})
}

// ── El insumo bajo mínimo se ve ─────────────────────────────────────────────

// TestLaMarcaDeBajoMinimoSoloSaleSiHayMinimo cubre los dos escenarios del
// requirement "El insumo bajo mínimo se ve", y el segundo es el que importa:
// sin mínimo cargado NUNCA se marca. Si el default fuera avisar, el panel
// arrancaría todo en rojo el primer día y el dueño aprendería a ignorar la
// marca, que es la única forma en que un aviso muere.
func TestLaMarcaDeBajoMinimoSoloSaleSiHayMinimo(t *testing.T) {
	ctx, db := nuevoCaso(t)
	svc := insumosDe(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	conMinimo := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 4200, ptr(5000))
	sinMinimo := altaInsumo(t, db, neg.ID, "pan de papa", model.UnidadUnidad, 1, nil)

	lista, err := svc.Listar(ctx, neg.ID)
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	porID := make(map[string]dto.InsumoResponse, len(lista))
	for _, i := range lista {
		porID[i.ID] = i
	}

	if !porID[conMinimo.ID].BajoMinimo {
		t.Error("un insumo con mínimo 5000 y stock 4200 tiene que venir marcado")
	}
	if porID[sinMinimo.ID].BajoMinimo {
		t.Error("un insumo sin mínimo cargado en 1 NO se marca: sin mínimo es «no me avises»")
	}
}

// ── La unidad es del insumo y no se convierte ───────────────────────────────

// TestCambiarLaUnidadDeUnInsumoConRecetaRebota: las cantidades de las recetas
// están expresadas en la unidad vieja. Cambiarla por abajo las multiplicaría o
// dividiría por mil en silencio, que es el bug que apaga la cocina entera sin
// que nadie entienda por qué. Se rechaza, se explica, y no se toca nada.
func TestCambiarLaUnidadDeUnInsumoConRecetaRebota(t *testing.T) {
	ctx, db := nuevoCaso(t)
	svc := insumosDe(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 1000, nil)
	bife := crearServicio(t, db, neg.ID, "Bife", "14500")
	guardarReceta(t, db, neg.ID, bife.ID, linea(carne.ID, 300))

	ml := model.UnidadML
	_, err := svc.Actualizar(ctx, neg.ID, carne.ID, dto.ActualizarInsumoInput{
		Nombre: "carne picada", Unidad: &ml,
	})
	if !errors.Is(err, service.ErrInsumoConRecetas) {
		t.Fatalf("esperaba ErrInsumoConRecetas, obtuve %v", err)
	}
	if !strings.Contains(err.Error(), "receta") {
		t.Errorf("el rechazo tiene que explicar que hay recetas en la unidad vieja, dijo: %q", err)
	}

	t.Run("el stock y la receta quedan intactos", func(t *testing.T) {
		var unidad string
		if err := db.Raw(`SELECT unidad FROM insumo WHERE id = ?`, carne.ID).Scan(&unidad).Error; err != nil {
			t.Fatalf("leer unidad: %v", err)
		}
		if unidad != model.UnidadGramo {
			t.Errorf("la unidad quedó en %q: el rechazo no fue atómico", unidad)
		}
		if got := stockDe(t, db, carne.ID); got != 1000 {
			t.Errorf("el saldo quedó en %d", got)
		}
		items, err := repository.NewRecetaRepository(db).DeServicio(ctx, neg.ID, bife.ID)
		if err != nil {
			t.Fatalf("leer receta: %v", err)
		}
		if len(items) != 1 || items[0].Cantidad != 300 {
			t.Errorf("la receta quedó en %+v, esperaba una línea de 300", items)
		}
	})

	t.Run("sin recetas vivas la unidad sí se puede corregir", func(t *testing.T) {
		// El control de que el rechazo es POR las recetas y no un «nunca se
		// puede»: el dueño que se equivocó de unidad antes de usar el insumo
		// tiene que poder arreglarlo.
		guardarReceta(t, db, neg.ID, bife.ID) // vaciar la receta
		if _, err := svc.Actualizar(ctx, neg.ID, carne.ID, dto.ActualizarInsumoInput{
			Nombre: "carne picada", Unidad: &ml,
		}); err != nil {
			t.Fatalf("sin recetas el cambio de unidad tiene que pasar: %v", err)
		}
	})
}

// ── Toda variación de stock queda registrada ────────────────────────────────

// TestLaHistoriaDeUnInsumoExplicaSuSaldo cubre los tres escenarios «felices»
// del requirement: la compra queda registrada, el consumo apunta al pedido que
// se lo llevó, y la historia deja reconstruir cómo se llegó del saldo anterior
// al actual. Es la tabla que contesta "compré 20 kg, ¿por qué me quedan 3?", y
// esa pregunta aparece el día dos.
func TestLaHistoriaDeUnInsumoExplicaSuSaldo(t *testing.T) {
	ctx, db := nuevoCaso(t)
	svc := insumosDe(db)
	repo := repository.NewInsumoRepository(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	cli := crearCliente(t, db, neg.ID, "5492611000701", "Juana", nil)
	bife := crearServicio(t, db, neg.ID, "Bife", "14500")
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 0, nil)

	t.Run("una compra queda registrada", func(t *testing.T) {
		r, err := svc.RegistrarCompra(ctx, neg.ID, carne.ID, dto.RegistrarCompraInput{Cantidad: 20000})
		if err != nil {
			t.Fatalf("registrar compra: %v", err)
		}
		if r.Stock != 20000 {
			t.Errorf("el stock subió a %d, esperaba 20000", r.Stock)
		}
		movs := movimientosDe(t, db, carne.ID)
		if len(movs) != 1 || movs[0].Tipo != model.MovCompra {
			t.Fatalf("esperaba un movimiento `compra`, obtuve %+v", movs)
		}
		if movs[0].SaldoResultante != 20000 {
			t.Errorf("el saldo resultante quedó en %d, esperaba 20000", movs[0].SaldoResultante)
		}
	})

	// El pedido que se lleva la carne. Existe de verdad porque compromiso_id es
	// una FK: un consumo que apunta a un pedido inventado no se puede escribir.
	pedido := crearCompromisoDirecto(t, db, neg.ID, cli.ID, bife.ID, nil, nil, nil,
		model.CompromisoPedido, model.EstadoConfirmado, "14500")

	t.Run("el consumo apunta al pedido que lo causó", func(t *testing.T) {
		err := repo.Mover(ctx, neg.ID, []model.MovimientoInsumo{{
			InsumoID: carne.ID, Tipo: model.MovConsumo, Cantidad: 400, CompromisoID: &pedido.ID,
		}})
		if err != nil {
			t.Fatalf("consumir: %v", err)
		}
		movs := movimientosDe(t, db, carne.ID)
		ultimo := movs[len(movs)-1]
		if ultimo.Tipo != model.MovConsumo || ultimo.Cantidad != 400 {
			t.Fatalf("esperaba un `consumo` de 400, obtuve %+v", ultimo)
		}
		if ultimo.CompromisoID == nil || *ultimo.CompromisoID != pedido.ID {
			t.Errorf("el consumo no referencia al compromiso: %v", ultimo.CompromisoID)
		}
		if ultimo.SaldoResultante != 19600 {
			t.Errorf("el saldo del consumo dice %d, esperaba 19600", ultimo.SaldoResultante)
		}
	})

	t.Run("el ajuste manda el saldo, no la diferencia", func(t *testing.T) {
		// El dueño contó la heladera: hay 3200. La cantidad del movimiento la
		// CALCULA el repositorio como |nuevo − viejo|, porque el dueño no
		// piensa en deltas.
		motivo := "conté la heladera"
		if _, err := svc.Ajustar(ctx, neg.ID, carne.ID, dto.AjustarStockInput{
			Stock: ptr(3200), Motivo: &motivo,
		}); err != nil {
			t.Fatalf("ajustar: %v", err)
		}
		movs := movimientosDe(t, db, carne.ID)
		ultimo := movs[len(movs)-1]
		if ultimo.Tipo != model.MovAjuste {
			t.Fatalf("esperaba un `ajuste`, obtuve %q", ultimo.Tipo)
		}
		if ultimo.Cantidad != 16400 {
			t.Errorf("la cantidad del ajuste es %d; 19600 → 3200 son 16400", ultimo.Cantidad)
		}
		if ultimo.SaldoResultante != 3200 {
			t.Errorf("el saldo del ajuste dice %d, esperaba 3200", ultimo.SaldoResultante)
		}
		if ultimo.Motivo == nil || *ultimo.Motivo != motivo {
			t.Errorf("el motivo del ajuste no se guardó: %v", ultimo.Motivo)
		}
	})

	t.Run("la historia reconstruye el saldo actual", func(t *testing.T) {
		// La pregunta del dueño: sumar y restar la historia de arriba abajo
		// tiene que dar exactamente lo que hay en la heladera.
		saldo := 0
		for _, m := range movimientosDe(t, db, carne.ID) {
			switch m.Tipo {
			case model.MovCompra, model.MovDevolucion:
				saldo += m.Cantidad
			case model.MovConsumo:
				saldo -= m.Cantidad
			case model.MovAjuste:
				saldo = m.SaldoResultante
			}
			if saldo != m.SaldoResultante {
				t.Fatalf("la historia no cierra: tras el %s de %d la cuenta da %d y la fila dice %d",
					m.Tipo, m.Cantidad, saldo, m.SaldoResultante)
			}
		}
		if got := stockDe(t, db, carne.ID); got != saldo {
			t.Errorf("la historia termina en %d y el insumo dice %d", saldo, got)
		}
	})
}

// TestUnMovimientoQueFallaNoDejaElRegistroAMedias: el pedido que se queda sin
// pan no puede dejar descontada la carne. Stock y movimiento van en la MISMA
// transacción y son todo o nada — un stock que cambió sin movimiento, o un
// movimiento sin cambio de stock, no puede existir.
func TestUnMovimientoQueFallaNoDejaElRegistroAMedias(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewInsumoRepository(db)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	// El orden de los ids decide en qué orden se aplican los movimientos, así
	// que se prueban los dos casos: el que falla es a veces el primero y a
	// veces el segundo. Con dos insumos y una tanda que pide de más en uno de
	// ellos, la única respuesta correcta es que no se mueva ninguno.
	carne := altaInsumo(t, db, neg.ID, "carne picada", model.UnidadGramo, 1000, nil)
	pan := altaInsumo(t, db, neg.ID, "pan de papa", model.UnidadUnidad, 2, nil)

	err := repo.Mover(ctx, neg.ID, []model.MovimientoInsumo{
		{InsumoID: carne.ID, Tipo: model.MovConsumo, Cantidad: 300},
		{InsumoID: pan.ID, Tipo: model.MovConsumo, Cantidad: 5}, // no alcanza
	})
	if !errors.Is(err, repository.ErrSinStock) {
		t.Fatalf("esperaba ErrSinStock, obtuve %v", err)
	}

	if got := stockDe(t, db, carne.ID); got != 1000 {
		t.Errorf("la carne quedó en %d: se descontó a pesar de que el pedido falló", got)
	}
	if got := stockDe(t, db, pan.ID); got != 2 {
		t.Errorf("el pan quedó en %d", got)
	}
	// Un movimiento cada uno: el de la carga inicial. Si el rollback no fue
	// completo, acá aparece un `consumo` fantasma.
	for _, id := range []string{carne.ID, pan.ID} {
		for _, m := range movimientosDe(t, db, id) {
			if m.Tipo == model.MovConsumo {
				t.Errorf("quedó un `consumo` escrito de una tanda que falló: %+v", m)
			}
		}
	}
}
