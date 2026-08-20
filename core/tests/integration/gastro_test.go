// gastro_test cubre el vertical gastronomía (E10 / W6-A): capacidad de cocina y
// mesa en la disponibilidad, validación de delivery contra la config, y el
// flujo pedido → confirmado con demora. Todo es ADITIVO: el motor no se toca y
// los tests de salud siguen verdes.
package integration

import (
	"errors"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// setCapacidad ajusta la capacidad de un recurso por UPDATE: GORM omitiría del
// INSERT un valor que coincide con el default, así que el fixture lo pisa acá.
func setCapacidad(t *testing.T, db *gorm.DB, recursoID string, capacidad int) {
	t.Helper()
	if err := db.Model(&model.Recurso{}).Where("id = ?", recursoID).
		Update("capacidad", capacidad).Error; err != nil {
		t.Fatalf("set capacidad=%d en %s: %v", capacidad, recursoID, err)
	}
}

func vincularServicioRecurso(t *testing.T, db *gorm.DB, servicioID, recursoID string) {
	t.Helper()
	if err := db.Create(&model.ServicioRecurso{ServicioID: servicioID, RecursoID: recursoID}).Error; err != nil {
		t.Fatalf("vincular servicio %s a recurso %s: %v", servicioID, recursoID, err)
	}
}

func setConfig(t *testing.T, db *gorm.DB, negocioID, configJSON string) {
	t.Helper()
	if err := db.Model(&model.Negocio{}).Where("id = ?", negocioID).
		Update("config", datatypes.JSON([]byte(configJSON))).Error; err != nil {
		t.Fatalf("set config en %s: %v", negocioID, err)
	}
}

// TestCocinaCapacidadEnParalelo: una cocina con capacidad 3 admite 3 pedidos en
// la misma franja y a partir del 4º la franja deja de ofrecerse. El camino de
// profesional no se altera (eso lo prueba disponibilidad_test.go).
func TestCocinaCapacidadEnParalelo(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewDisponibilidadRepository(db)
	svc := service.NewDisponibilidadService(repo)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	cocina := crearRecurso(t, db, neg.ID, "Cocina", model.RecursoCocina)
	setCapacidad(t, db, cocina.ID, 3)
	sv := crearServicio(t, db, neg.ID, "Doble cheddar", "8900")
	vincularServicioRecurso(t, db, sv.ID, cocina.ID)
	cli := crearCliente(t, db, neg.ID, "5492611222333", "Juani", nil)

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	dia := time.Date(2026, 9, 15, 0, 0, 0, 0, loc)
	// Una sola franja de 30 min: un único slot 12:00–12:30.
	crearHorarioDePrueba(t, db, cocina.ID, int(dia.Weekday()), "12:00:00", "12:30:00")

	in := dto.ConsultarDisponibilidadInput{ServicioID: sv.ID, Desde: "2026-09-15", Dias: 1}

	// Sin pedidos: el slot está, con cupo lleno = 3.
	r, err := svc.Consultar(ctx, neg.ID, in)
	if err != nil {
		t.Fatalf("consultar: %v", err)
	}
	if len(r.Huecos) != 1 {
		t.Fatalf("esperaba 1 slot de cocina, hubo %d: %+v", len(r.Huecos), r.Huecos)
	}
	if r.Huecos[0].Cupo == nil || *r.Huecos[0].Cupo != 3 {
		t.Fatalf("cupo inicial esperado 3, fue %v", r.Huecos[0].Cupo)
	}

	ini := time.Date(2026, 9, 15, 12, 0, 0, 0, loc)
	fin := ini.Add(30 * time.Minute)
	ocupar := func() {
		crearCompromisoDirecto(t, db, neg.ID, cli.ID, sv.ID, &cocina.ID, &ini, &fin,
			model.CompromisoPedido, model.EstadoConfirmado, "8900")
	}

	// Dos pedidos: la cocina acepta, queda 1 de cupo.
	ocupar()
	ocupar()
	r, _ = svc.Consultar(ctx, neg.ID, in)
	if len(r.Huecos) != 1 || r.Huecos[0].Cupo == nil || *r.Huecos[0].Cupo != 1 {
		t.Fatalf("con 2 pedidos esperaba slot con cupo 1, fue %+v", r.Huecos)
	}

	// Tercer pedido: se acepta (llegamos a 3), pero la franja ya no ofrece más.
	ocupar()
	r, _ = svc.Consultar(ctx, neg.ID, in)
	if len(r.Huecos) != 0 {
		t.Fatalf("con 3 pedidos (capacidad llena) la franja no debe ofrecerse, hubo %+v", r.Huecos)
	}
}

// TestCocinaCapacidadTenantScoped: los pedidos de otro negocio no consumen el
// cupo de esta cocina. La capacidad se mide por tenant.
func TestCocinaCapacidadTenantScoped(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewDisponibilidadRepository(db)
	svc := service.NewDisponibilidadService(repo)

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	dia := time.Date(2026, 9, 15, 0, 0, 0, 0, loc)
	ini := time.Date(2026, 9, 15, 12, 0, 0, 0, loc)
	fin := ini.Add(30 * time.Minute)

	// Negocio A: cocina capacidad 1, sin pedidos → el slot está.
	a := crearNegocio(t, db, "A", model.VerticalGastronomia)
	cocA := crearRecurso(t, db, a.ID, "Cocina A", model.RecursoCocina)
	svA := crearServicio(t, db, a.ID, "Burger", "8900")
	vincularServicioRecurso(t, db, svA.ID, cocA.ID)
	crearHorarioDePrueba(t, db, cocA.ID, int(dia.Weekday()), "12:00:00", "12:30:00")

	// Negocio B llena SU cocina en la misma franja.
	b := crearNegocio(t, db, "B", model.VerticalGastronomia)
	cocB := crearRecurso(t, db, b.ID, "Cocina B", model.RecursoCocina)
	svB := crearServicio(t, db, b.ID, "Burger", "8900")
	vincularServicioRecurso(t, db, svB.ID, cocB.ID)
	cliB := crearCliente(t, db, b.ID, "5492611999000", "Otro", nil)
	crearCompromisoDirecto(t, db, b.ID, cliB.ID, svB.ID, &cocB.ID, &ini, &fin,
		model.CompromisoPedido, model.EstadoConfirmado, "8900")

	r, err := svc.Consultar(ctx, a.ID, dto.ConsultarDisponibilidadInput{ServicioID: svA.ID, Desde: "2026-09-15", Dias: 1})
	if err != nil {
		t.Fatalf("consultar A: %v", err)
	}
	if len(r.Huecos) != 1 || r.Huecos[0].Cupo == nil || *r.Huecos[0].Cupo != 1 {
		t.Fatalf("el pedido de B contaminó el cupo de A: %+v", r.Huecos)
	}
}

// TestMesaNoSeReReserva: una mesa la ocupa una reserva por su duración; una
// segunda reserva que pisa ese rango la rechaza el motor (ErrSolapado). La mesa
// se comporta como 1 por franja aunque su capacidad (cubiertos) sea mayor.
func TestMesaNoSeReReserva(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)
	motor := service.NewMotorService(compromisos, holdRepo)

	neg := crearNegocio(t, db, "Bodegón", model.VerticalGastronomia)
	mesa := crearRecurso(t, db, neg.ID, "Mesa 4", model.RecursoMesa)
	setCapacidad(t, db, mesa.ID, 4) // 4 cubiertos, pero 1 reserva por franja
	sv := crearServicio(t, db, neg.ID, "Reserva mesa", "0")
	cli := crearCliente(t, db, neg.ID, "5492611444555", "Ana", nil)

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	ini := time.Date(2026, 9, 15, 21, 0, 0, 0, loc)
	fin := ini.Add(90 * time.Minute)

	reservar := func(desde, hasta time.Time) (*dto.CompromisoResponse, error) {
		return motor.Crear(ctx, neg.ID, dto.CrearCompromisoInput{
			ClienteID: cli.ID,
			Tipo:      model.CompromisoReserva,
			Origen:    model.OrigenWhatsApp,
			RecursoID: &mesa.ID,
			Inicio:    &desde,
			Fin:       &hasta,
			Lineas:    []dto.LineaCompromisoInput{{ServicioID: sv.ID, Cantidad: 1}},
		})
	}

	if _, err := reservar(ini, fin); err != nil {
		t.Fatalf("primera reserva: %v", err)
	}
	// Una segunda que pisa el rango: rechazada.
	if _, err := reservar(ini.Add(30*time.Minute), fin.Add(30*time.Minute)); !errors.Is(err, service.ErrSolapado) {
		t.Fatalf("esperaba ErrSolapado en re-reserva, hubo %v", err)
	}
	// Una que no pisa (arranca cuando termina la primera): pasa.
	if _, err := reservar(fin, fin.Add(90*time.Minute)); err != nil {
		t.Fatalf("reserva contigua no debería solaparse: %v", err)
	}
}

// TestDeliveryValidadoContraConfig: un pedido con entrega=delivery se rechaza
// (422 / ErrDeliveryNoAceptado) si el negocio no ofrece delivery, y se acepta
// si sí. La validación es del decorador de gastronomía, no del motor.
func TestDeliveryValidadoContraConfig(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)
	negDatos := repository.NewNegocioDatosRepository(db)
	motor := service.NewMotorGastro(service.NewMotorService(compromisos, holdRepo), negDatos)

	// Negocio que NO acepta delivery (config sin acepta_delivery).
	sinDelivery := crearNegocio(t, db, "Solo retira", model.VerticalGastronomia)
	svS := crearServicio(t, db, sinDelivery.ID, "Empanada", "900")
	cliS := crearCliente(t, db, sinDelivery.ID, "5492611000111", "Leo", nil)

	pedidoDelivery := func(neg, cli, sv string) dto.CrearCompromisoInput {
		return dto.CrearCompromisoInput{
			ClienteID: cli,
			Tipo:      model.CompromisoPedido,
			Origen:    model.OrigenWhatsApp,
			Entrega:   ptr(model.EntregaDelivery),
			Direccion: ptr("Av. Siempreviva 742"),
			Lineas:    []dto.LineaCompromisoInput{{ServicioID: sv, Cantidad: 2}},
		}
	}

	if _, err := motor.Crear(ctx, sinDelivery.ID, pedidoDelivery(sinDelivery.ID, cliS.ID, svS.ID)); !errors.Is(err, service.ErrDeliveryNoAceptado) {
		t.Fatalf("esperaba ErrDeliveryNoAceptado, hubo %v", err)
	}

	// El mismo negocio con retira sí acepta (no se mira la config de delivery).
	retira := pedidoDelivery(sinDelivery.ID, cliS.ID, svS.ID)
	retira.Entrega = ptr(model.EntregaRetira)
	retira.Direccion = nil
	if _, err := motor.Crear(ctx, sinDelivery.ID, retira); err != nil {
		t.Fatalf("un pedido para retirar no debería tocar la validación de delivery: %v", err)
	}

	// Negocio que SÍ acepta delivery.
	conDelivery := crearNegocio(t, db, "Con cadete", model.VerticalGastronomia)
	setConfig(t, db, conDelivery.ID, `{"acepta_delivery":true,"radio_delivery_km":3}`)
	svC := crearServicio(t, db, conDelivery.ID, "Pizza", "12000")
	cliC := crearCliente(t, db, conDelivery.ID, "5492611000222", "Sofi", nil)

	resp, err := motor.Crear(ctx, conDelivery.ID, pedidoDelivery(conDelivery.ID, cliC.ID, svC.ID))
	if err != nil {
		t.Fatalf("delivery aceptado debería crear el pedido: %v", err)
	}
	if resp.Entrega == nil || *resp.Entrega != model.EntregaDelivery {
		t.Fatalf("el pedido no conservó la entrega delivery: %+v", resp.Entrega)
	}
}

// TestConfirmarPedidoConDemora: el flujo del board de cocina. El pedido nace
// pendiente y el local lo confirma poniéndole la demora; el motor sella
// confirmado_en y guarda la demora. Después avanza en_curso → listo → completado.
func TestConfirmarPedidoConDemora(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)
	negDatos := repository.NewNegocioDatosRepository(db)
	motor := service.NewMotorGastro(service.NewMotorService(compromisos, holdRepo), negDatos)

	neg := crearNegocio(t, db, "Cantina", model.VerticalGastronomia)
	setConfig(t, db, neg.ID, `{"confirmacion":{"pedido":"humana"},"demoras_sugeridas":[15,25,40]}`)
	sv := crearServicio(t, db, neg.ID, "Milanesa", "9500")
	cli := crearCliente(t, db, neg.ID, "5492611777888", "Facu", nil)

	pedido, err := motor.Crear(ctx, neg.ID, dto.CrearCompromisoInput{
		ClienteID: cli.ID,
		Tipo:      model.CompromisoPedido,
		Origen:    model.OrigenWhatsApp,
		Entrega:   ptr(model.EntregaRetira),
		Lineas:    []dto.LineaCompromisoInput{{ServicioID: sv.ID, Cantidad: 1}},
	})
	if err != nil {
		t.Fatalf("crear pedido: %v", err)
	}
	if pedido.Estado != model.EstadoPendiente {
		t.Fatalf("un pedido nace pendiente (política humana), nació %s", pedido.Estado)
	}

	// El local confirma con una demora libre (30, fuera de los presets).
	demora := 30
	conf, err := motor.Transicionar(ctx, neg.ID, pedido.ID, model.EstadoConfirmado,
		service.OpcionesTransicion{DemoraMin: &demora})
	if err != nil {
		t.Fatalf("confirmar con demora: %v", err)
	}
	if conf.Estado != model.EstadoConfirmado {
		t.Fatalf("quedó en %s", conf.Estado)
	}
	if conf.DemoraMin == nil || *conf.DemoraMin != demora {
		t.Fatalf("la demora del local no se guardó: %v", conf.DemoraMin)
	}
	if conf.ConfirmadoEn == nil {
		t.Fatal("confirmar tiene que sellar confirmado_en")
	}

	// Recorre el board: en cocina → listo → entregado.
	for _, paso := range []model.EstadoCompromiso{model.EstadoEnCurso, model.EstadoListo, model.EstadoCompletado} {
		conf, err = motor.Transicionar(ctx, neg.ID, pedido.ID, paso, service.OpcionesTransicion{})
		if err != nil {
			t.Fatalf("transición a %s: %v", paso, err)
		}
	}
	if conf.Estado != model.EstadoCompletado || conf.CerradoEn == nil {
		t.Fatalf("el pedido no cerró bien: %+v", conf)
	}
}

// TestBoardAgrupaPorEstado: el board del panel se arma con ListTablero filtrando
// por estado. PENDIENTES, EN COCINA (en_curso) y LISTOS son consultas por estado
// sobre el mismo motor, sin endpoint nuevo, y scopeadas al tenant.
func TestBoardAgrupaPorEstado(t *testing.T) {
	ctx, db := nuevoCaso(t)
	compromisos := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)
	negDatos := repository.NewNegocioDatosRepository(db)
	motor := service.NewMotorGastro(service.NewMotorService(compromisos, holdRepo), negDatos)

	neg := crearNegocio(t, db, "Resto", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Papas", "4500")
	cli := crearCliente(t, db, neg.ID, "5492611333222", "Vale", nil)
	// Otro negocio con su propio pedido pendiente: no debe aparecer en el board.
	otro := crearNegocio(t, db, "Otro Resto", model.VerticalGastronomia)
	svO := crearServicio(t, db, otro.ID, "Papas", "4500")
	cliO := crearCliente(t, db, otro.ID, "5492611333999", "X", nil)

	nuevoPedido := func(negID, cliID, svID string) *dto.CompromisoResponse {
		p, err := motor.Crear(ctx, negID, dto.CrearCompromisoInput{
			ClienteID: cliID,
			Tipo:      model.CompromisoPedido,
			Origen:    model.OrigenWhatsApp,
			Entrega:   ptr(model.EntregaRetira),
			Lineas:    []dto.LineaCompromisoInput{{ServicioID: svID, Cantidad: 1}},
		})
		if err != nil {
			t.Fatalf("crear pedido: %v", err)
		}
		return p
	}
	avanzar := func(id string, pasos ...model.EstadoCompromiso) {
		for _, p := range pasos {
			if _, err := motor.Transicionar(ctx, neg.ID, id, p, service.OpcionesTransicion{}); err != nil {
				t.Fatalf("transición a %s: %v", p, err)
			}
		}
	}

	pend := nuevoPedido(neg.ID, cli.ID, sv.ID)  // queda PENDIENTE
	enCoc := nuevoPedido(neg.ID, cli.ID, sv.ID) // → EN COCINA
	listo := nuevoPedido(neg.ID, cli.ID, sv.ID) // → LISTO
	avanzar(enCoc.ID, model.EstadoConfirmado, model.EstadoEnCurso)
	avanzar(listo.ID, model.EstadoConfirmado, model.EstadoEnCurso, model.EstadoListo)
	nuevoPedido(otro.ID, cliO.ID, svO.ID) // del otro tenant

	columna := func(estado model.EstadoCompromiso) []dto.CompromisoResponse {
		r, err := motor.Listar(ctx, neg.ID, dto.FiltroCompromisos{Estados: []model.EstadoCompromiso{estado}})
		if err != nil {
			t.Fatalf("listar %s: %v", estado, err)
		}
		return r
	}

	casos := []struct {
		estado   model.EstadoCompromiso
		esperado string
	}{
		{model.EstadoPendiente, pend.ID},
		{model.EstadoEnCurso, enCoc.ID},
		{model.EstadoListo, listo.ID},
	}
	for _, c := range casos {
		col := columna(c.estado)
		if len(col) != 1 {
			t.Fatalf("columna %s: esperaba 1 pedido del tenant, hubo %d", c.estado, len(col))
		}
		if col[0].ID != c.esperado {
			t.Fatalf("columna %s: pedido equivocado", c.estado)
		}
	}
}
