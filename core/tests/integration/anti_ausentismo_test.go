package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	// tzdata embebida: el mensaje se arma en la zona del negocio y el test no
	// puede depender de que la imagen donde corre traiga /usr/share/zoneinfo.
	_ "time/tzdata"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"
	"copiloto/core/internal/worker"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// ── Andamio del anti-ausentismo ─────────────────────────────────────────────

// cola levanta un Redis en memoria y devuelve el publicador real (el mismo que
// usa producción) más un lector de lo que quedó encolado. Se prueba contra la
// cola de verdad y no contra un doble porque el payload ES el contrato con el
// gateway (E5): un campo renombrado acá rompe el otro lado en silencio.
type cola struct {
	pub worker.Publicador
	rdb *redis.Client
}

func nuevaCola(t *testing.T) *cola {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = rdb.Close()
		mr.Close()
	})
	return &cola{pub: worker.NewPublicador(rdb), rdb: rdb}
}

// mensajes devuelve la cola entera, del más viejo al más nuevo (el core hace
// LPUSH, así que el orden natural de LRANGE está al revés).
func (c *cola) mensajes(t *testing.T, ctx context.Context) []worker.MensajeSalida {
	t.Helper()
	crudos, err := c.rdb.LRange(ctx, worker.ColaSalidas, 0, -1).Result()
	if err != nil {
		t.Fatalf("leer %s: %v", worker.ColaSalidas, err)
	}
	out := make([]worker.MensajeSalida, 0, len(crudos))
	for i := len(crudos) - 1; i >= 0; i-- {
		var m worker.MensajeSalida
		if err := json.Unmarshal([]byte(crudos[i]), &m); err != nil {
			t.Fatalf("payload invalido en la cola (%v): %s", err, crudos[i])
		}
		out = append(out, m)
	}
	return out
}

func setWhatsApp(t *testing.T, db *gorm.DB, negocioID, waPhoneID string) {
	t.Helper()
	err := db.Model(&model.Negocio{}).
		Where("id = ?", negocioID).
		Update("wa_phone_id", waPhoneID).Error
	if err != nil {
		t.Fatalf("set wa_phone_id: %v", err)
	}
}

func setConfigNegocio(t *testing.T, db *gorm.DB, negocioID, cfgJSON string) {
	t.Helper()
	err := db.Model(&model.Negocio{}).
		Where("id = ?", negocioID).
		Update("config", datatypes.JSON([]byte(cfgJSON))).Error
	if err != nil {
		t.Fatalf("set config: %v", err)
	}
}

func anotarEnEspera(t *testing.T, db *gorm.DB, negocioID, clienteID, servicioID string, creadoEn time.Time) *model.ListaEspera {
	t.Helper()
	le := &model.ListaEspera{
		NegocioID:  negocioID,
		ClienteID:  clienteID,
		ServicioID: servicioID,
		CreadoEn:   creadoEn,
	}
	if err := db.Create(le).Error; err != nil {
		t.Fatalf("anotar en lista de espera: %v", err)
	}
	return le
}

func recordatorioEnviadoEn(t *testing.T, db *gorm.DB, compromisoID string) *time.Time {
	t.Helper()
	var c model.Compromiso
	if err := db.Where("id = ?", compromisoID).First(&c).Error; err != nil {
		t.Fatalf("releer compromiso: %v", err)
	}
	return c.RecordatorioEnviadoEn
}

func releerEspera(t *testing.T, db *gorm.DB, id string) model.ListaEspera {
	t.Helper()
	var le model.ListaEspera
	if err := db.Where("id = ?", id).First(&le).Error; err != nil {
		t.Fatalf("releer lista_espera %s: %v", id, err)
	}
	return le
}

// ── Recordatorio 24h antes ──────────────────────────────────────────────────

// TestRecordatorioSeEncolaUnaSolaVez es EL test de la feature: el paciente
// recibe un aviso, no dos. Dos ticks (o dos réplicas del core corriendo el
// mismo barrido) tienen que producir un solo LPUSH, y el candado es el UPDATE
// condicional sobre recordatorio_enviado_en.
func TestRecordatorioSeEncolaUnaSolaVez(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)

	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-uno")

	ahora := time.Now().Truncate(time.Second)
	inicio := ahora.Add(24 * time.Hour)
	fin := inicio.Add(30 * time.Minute)
	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &inicio, &fin, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	w := worker.NewRecordatorios(worker.RecordatoriosConfig{
		Repo:  repository.NewAvisoRepository(e.db),
		Pub:   c.pub,
		Ahora: func() time.Time { return ahora },
	})

	n, err := w.Tick(ctx)
	if err != nil {
		t.Fatalf("primer tick: %v", err)
	}
	if n != 1 {
		t.Fatalf("el primer tick tenía que encolar 1 recordatorio, encoló %d", n)
	}

	if sello := recordatorioEnviadoEn(t, e.db, turno.ID); sello == nil {
		t.Fatal("el turno quedó sin sello de recordatorio: el candado no se escribió")
	}

	// Segundo tick: mismo reloj, mismo turno. No puede salir nada.
	n, err = w.Tick(ctx)
	if err != nil {
		t.Fatalf("segundo tick: %v", err)
	}
	if n != 0 {
		t.Errorf("el segundo tick encoló %d recordatorios: el aviso se manda una sola vez", n)
	}

	msgs := c.mensajes(t, ctx)
	if len(msgs) != 1 {
		t.Fatalf("la cola quedó con %d mensajes, esperaba 1: %+v", len(msgs), msgs)
	}

	m := msgs[0]
	if m.NegocioID != e.negocio.ID {
		t.Errorf("negocio_id: esperaba %s, obtuvo %s", e.negocio.ID, m.NegocioID)
	}
	if m.WaPhoneID != "wa-phone-uno" {
		t.Errorf("wa_phone_id: esperaba wa-phone-uno, obtuvo %q", m.WaPhoneID)
	}
	if m.Telefono != e.cliente.Telefono {
		t.Errorf("telefono: esperaba %s, obtuvo %s", e.cliente.Telefono, m.Telefono)
	}
	if m.Tipo != worker.TipoPlantilla {
		t.Errorf("tipo: esperaba plantilla, obtuvo %q", m.Tipo)
	}
	if m.Plantilla != worker.PlantillaRecordatorio {
		t.Errorf("plantilla: esperaba %s, obtuvo %q", worker.PlantillaRecordatorio, m.Plantilla)
	}
	if m.CompromisoID != turno.ID {
		t.Errorf("compromiso_id: esperaba %s, obtuvo %s", turno.ID, m.CompromisoID)
	}
	for _, v := range []string{"nombre", "fecha_hora_local", "negocio"} {
		if m.Variables[v] == "" {
			t.Errorf("la plantilla necesita la variable %q y vino vacía: %+v", v, m.Variables)
		}
	}
	if m.Variables["negocio"] != e.negocio.Nombre {
		t.Errorf("variable negocio: esperaba %q, obtuvo %q", e.negocio.Nombre, m.Variables["negocio"])
	}
}

// TestRecordatorioSoloEnLaVentana: el aviso sale en la franja de las 24h, no
// antes ni después. Un recordatorio que llega con tres días de anticipación no
// sirve, y uno que llega dos horas antes tampoco.
func TestRecordatorioSoloEnLaVentana(t *testing.T) {
	casos := []struct {
		nombre  string
		desfase time.Duration // inicio = ahora + desfase
		tipo    model.TipoCompromiso
		estado  model.EstadoCompromiso
		encola  bool
	}{
		{"justo en el borde de las 24h", 24 * time.Hour, model.CompromisoTurno, model.EstadoConfirmado, true},
		{"dentro del margen de 5 min", 24*time.Hour - 4*time.Minute, model.CompromisoTurno, model.EstadoConfirmado, true},
		{"un minuto antes de entrar", 24*time.Hour + time.Minute, model.CompromisoTurno, model.EstadoConfirmado, false},
		{"ya pasó la ventana", 24*time.Hour - 10*time.Minute, model.CompromisoTurno, model.EstadoConfirmado, false},
		{"pasado mañana", 48 * time.Hour, model.CompromisoTurno, model.EstadoConfirmado, false},
		{"en dos horas", 2 * time.Hour, model.CompromisoTurno, model.EstadoConfirmado, false},
		{"turno sin confirmar", 24 * time.Hour, model.CompromisoTurno, model.EstadoPendiente, false},
		{"turno cancelado", 24 * time.Hour, model.CompromisoTurno, model.EstadoCancelado, false},
		{"un pedido no se recuerda", 24 * time.Hour, model.CompromisoPedido, model.EstadoConfirmado, false},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud)
			c := nuevaCola(t)
			setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-ventana")

			ahora := time.Now().Truncate(time.Second)
			inicio := ahora.Add(caso.desfase)
			fin := inicio.Add(30 * time.Minute)
			crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
				&e.recurso.ID, &inicio, &fin, caso.tipo, caso.estado, "1000.00")

			w := worker.NewRecordatorios(worker.RecordatoriosConfig{
				Repo:  repository.NewAvisoRepository(e.db),
				Pub:   c.pub,
				Ahora: func() time.Time { return ahora },
			})

			n, err := w.Tick(ctx)
			if err != nil {
				t.Fatalf("tick: %v", err)
			}
			esperado := 0
			if caso.encola {
				esperado = 1
			}
			if n != esperado {
				t.Fatalf("encoló %d recordatorios, esperaba %d", n, esperado)
			}
			if len(c.mensajes(t, ctx)) != esperado {
				t.Errorf("la cola no coincide con lo encolado")
			}
		})
	}
}

// TestRecordatorioRespetaLaConfigDelNegocio: recordatorio_horas_antes es del
// tenant. Un consultorio que quiere avisar con 2h de anticipación no recibe el
// default de 24.
func TestRecordatorioRespetaLaConfigDelNegocio(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-config")
	setConfigNegocio(t, e.db, e.negocio.ID, `{"hold_minutos":10,"recordatorio_horas_antes":2}`)

	ahora := time.Now().Truncate(time.Second)

	// A 24h no le toca: este negocio avisa con 2 horas.
	lejos := ahora.Add(24 * time.Hour)
	finLejos := lejos.Add(30 * time.Minute)
	crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &lejos, &finLejos, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	otro := crearCliente(t, e.db, e.negocio.ID, "5492611000099", "Pedro", nil)
	cerca := ahora.Add(2 * time.Hour)
	finCerca := cerca.Add(30 * time.Minute)
	elQueVa := crearCompromisoDirecto(t, e.db, e.negocio.ID, otro.ID, e.servicio.ID,
		&e.recurso.ID, &cerca, &finCerca, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	w := worker.NewRecordatorios(worker.RecordatoriosConfig{
		Repo:  repository.NewAvisoRepository(e.db),
		Pub:   c.pub,
		Ahora: func() time.Time { return ahora },
	})

	n, err := w.Tick(ctx)
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if n != 1 {
		t.Fatalf("encoló %d recordatorios, esperaba 1 (el de las 2h)", n)
	}
	msgs := c.mensajes(t, ctx)
	if len(msgs) != 1 || msgs[0].CompromisoID != elQueVa.ID {
		t.Fatalf("se recordó el turno equivocado: %+v", msgs)
	}
}

// TestRecordatorioSinWhatsAppNoSeMarca: sin wa_phone_id el gateway no tiene por
// dónde mandar nada. Lo importante es que el turno NO quede sellado, así que
// cuando el consultorio conecte WhatsApp el circuito arranca solo.
func TestRecordatorioSinWhatsAppNoSeMarca(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)

	ahora := time.Now().Truncate(time.Second)
	inicio := ahora.Add(24 * time.Hour)
	fin := inicio.Add(30 * time.Minute)
	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &inicio, &fin, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	w := worker.NewRecordatorios(worker.RecordatoriosConfig{
		Repo:  repository.NewAvisoRepository(e.db),
		Pub:   c.pub,
		Ahora: func() time.Time { return ahora },
	})

	n, err := w.Tick(ctx)
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if n != 0 {
		t.Fatalf("encoló %d recordatorios sin WhatsApp configurado", n)
	}
	if sello := recordatorioEnviadoEn(t, e.db, turno.ID); sello != nil {
		t.Error("se selló un recordatorio que nunca se pudo mandar")
	}
}

// ── Liberación del hueco ────────────────────────────────────────────────────

// motorConListaEspera arma el motor con el hook puesto, como en producción.
func motorConListaEspera(t *testing.T, e *escenario, c *cola, ahora time.Time) service.MotorService {
	t.Helper()
	notif := worker.NewListaEsperaNotificador(
		repository.NewListaEsperaRepository(e.db),
		repository.NewAvisoRepository(e.db),
		c.pub,
		func() time.Time { return ahora },
	)
	return service.NewMotorService(e.compromisos, e.holdRepo, service.ConNotificador(notif))
}

// TestCancelarTurnoFuturoOfreceElHueco: cancelar un turno de mañana tiene que
// ofrecerle el hueco al primero de la cola de ESE servicio, marcarlo como
// notificado, y no tocar a nadie más.
func TestCancelarTurnoFuturoOfreceElHueco(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-hueco")

	ahora := time.Now().Truncate(time.Second)
	otroServicio := crearServicio(t, e.db, e.negocio.ID, "Control", "800.00")

	primero := crearCliente(t, e.db, e.negocio.ID, "5492611000010", "Ana", nil)
	segundo := crearCliente(t, e.db, e.negocio.ID, "5492611000011", "Bruno", nil)
	ajeno := crearCliente(t, e.db, e.negocio.ID, "5492611000012", "Carla", nil)

	lePrimero := anotarEnEspera(t, e.db, e.negocio.ID, primero.ID, e.servicio.ID, ahora.Add(-2*time.Hour))
	leSegundo := anotarEnEspera(t, e.db, e.negocio.ID, segundo.ID, e.servicio.ID, ahora.Add(-1*time.Hour))
	leAjeno := anotarEnEspera(t, e.db, e.negocio.ID, ajeno.ID, otroServicio.ID, ahora.Add(-3*time.Hour))

	inicio := ahora.Add(30 * time.Hour)
	fin := inicio.Add(30 * time.Minute)
	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &inicio, &fin, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	motor := motorConListaEspera(t, e, c, ahora)
	if _, err := motor.Transicionar(ctx, e.negocio.ID, turno.ID, model.EstadoCancelado, service.OpcionesTransicion{}); err != nil {
		t.Fatalf("cancelar: %v", err)
	}

	msgs := c.mensajes(t, ctx)
	if len(msgs) != 1 {
		t.Fatalf("la cancelación tenía que ofrecer el hueco una vez, encoló %d: %+v", len(msgs), msgs)
	}
	m := msgs[0]
	if m.Plantilla != worker.PlantillaHuecoLiberado {
		t.Errorf("plantilla: esperaba %s, obtuvo %q", worker.PlantillaHuecoLiberado, m.Plantilla)
	}
	if m.Telefono != primero.Telefono {
		t.Errorf("la oferta fue a %s; le tocaba al primero de la cola (%s)", m.Telefono, primero.Telefono)
	}
	if m.CompromisoID != turno.ID {
		t.Errorf("compromiso_id: esperaba %s, obtuvo %s", turno.ID, m.CompromisoID)
	}
	if m.Variables["servicio"] != e.servicio.Nombre {
		t.Errorf("variable servicio: esperaba %q, obtuvo %q", e.servicio.Nombre, m.Variables["servicio"])
	}

	if releerEspera(t, e.db, lePrimero.ID).NotificadoEn == nil {
		t.Error("el primero recibió la oferta pero quedó sin notificado_en")
	}
	if ofrecido := releerEspera(t, e.db, lePrimero.ID).CompromisoOfrecidoID; ofrecido == nil || *ofrecido != turno.ID {
		t.Errorf("no quedó registrado qué hueco se ofreció: %v", ofrecido)
	}
	if releerEspera(t, e.db, leSegundo.ID).NotificadoEn != nil {
		t.Error("el segundo de la cola quedó marcado sin haber recibido nada")
	}
	if releerEspera(t, e.db, leAjeno.ID).NotificadoEn != nil {
		t.Error("se notificó a alguien anotado para OTRO servicio")
	}

	// Un segundo hueco del mismo servicio le toca al segundo de la cola.
	inicio2 := ahora.Add(31 * time.Hour)
	fin2 := inicio2.Add(30 * time.Minute)
	turno2 := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &inicio2, &fin2, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")
	if _, err := motor.Transicionar(ctx, e.negocio.ID, turno2.ID, model.EstadoCancelado, service.OpcionesTransicion{}); err != nil {
		t.Fatalf("cancelar el segundo turno: %v", err)
	}

	msgs = c.mensajes(t, ctx)
	if len(msgs) != 2 {
		t.Fatalf("esperaba 2 ofertas, hay %d", len(msgs))
	}
	if msgs[1].Telefono != segundo.Telefono {
		t.Errorf("la segunda oferta fue a %s; le tocaba a %s", msgs[1].Telefono, segundo.Telefono)
	}
	if releerEspera(t, e.db, leSegundo.ID).NotificadoEn == nil {
		t.Error("el segundo recibió la oferta pero quedó sin notificado_en")
	}
}

// TestElHookNoDisparaCuandoNoCorresponde: el hueco liberado es una promesa al
// paciente, así que sólo sale cuando de verdad hay algo que ofrecer. Un turno
// que ya pasó no es un hueco, y un pedido cancelado no libera agenda.
func TestElHookNoDisparaCuandoNoCorresponde(t *testing.T) {
	casos := []struct {
		nombre  string
		desfase time.Duration
		tipo    model.TipoCompromiso
	}{
		{"turno que ya pasó", -2 * time.Hour, model.CompromisoTurno},
		{"pedido cancelado", 30 * time.Hour, model.CompromisoPedido},
		{"reserva cancelada", 30 * time.Hour, model.CompromisoReserva},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud)
			c := nuevaCola(t)
			setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-nohook")

			ahora := time.Now().Truncate(time.Second)
			esperando := crearCliente(t, e.db, e.negocio.ID, "5492611000020", "Ana", nil)
			le := anotarEnEspera(t, e.db, e.negocio.ID, esperando.ID, e.servicio.ID, ahora.Add(-time.Hour))

			inicio := ahora.Add(caso.desfase)
			fin := inicio.Add(30 * time.Minute)
			cmp := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
				&e.recurso.ID, &inicio, &fin, caso.tipo, model.EstadoConfirmado, "1000.00")

			motor := motorConListaEspera(t, e, c, ahora)
			if _, err := motor.Transicionar(ctx, e.negocio.ID, cmp.ID, model.EstadoCancelado, service.OpcionesTransicion{}); err != nil {
				t.Fatalf("cancelar: %v", err)
			}

			if msgs := c.mensajes(t, ctx); len(msgs) != 0 {
				t.Errorf("se ofreció un hueco que no existe: %+v", msgs)
			}
			if releerEspera(t, e.db, le.ID).NotificadoEn != nil {
				t.Error("se marcó como notificado a alguien que no recibió nada")
			}
		})
	}
}

// TestUnTurnoSinListaDeEsperaNoRompeNada: la cancelación es del panel y no
// puede fallar porque no haya nadie anotado.
func TestUnTurnoSinListaDeEsperaNoRompeNada(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)
	c := nuevaCola(t)
	setWhatsApp(t, e.db, e.negocio.ID, "wa-phone-vacio")

	ahora := time.Now().Truncate(time.Second)
	inicio := ahora.Add(30 * time.Hour)
	fin := inicio.Add(30 * time.Minute)
	turno := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID,
		&e.recurso.ID, &inicio, &fin, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	motor := motorConListaEspera(t, e, c, ahora)
	resp, err := motor.Transicionar(ctx, e.negocio.ID, turno.ID, model.EstadoCancelado, service.OpcionesTransicion{})
	if err != nil {
		t.Fatalf("cancelar sin lista de espera: %v", err)
	}
	if resp.Estado != model.EstadoCancelado {
		t.Fatalf("quedó en %s", resp.Estado)
	}
	if msgs := c.mensajes(t, ctx); len(msgs) != 0 {
		t.Errorf("no había nadie esperando y se encoló algo: %+v", msgs)
	}
}

// ── Aislamiento de tenant ───────────────────────────────────────────────────

// TestListaEsperaEsTenantScoped: la cola de un consultorio no existe para el
// otro. Ni se lista, ni se borra, ni se le ofrece un hueco ajeno.
func TestListaEsperaEsTenantScoped(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewListaEsperaRepository(db)

	negA := crearNegocio(t, db, "Consultorio A", model.VerticalSalud)
	negB := crearNegocio(t, db, "Consultorio B", model.VerticalSalud)
	cliA := crearCliente(t, db, negA.ID, "5492611000030", "Ana", nil)
	cliB := crearCliente(t, db, negB.ID, "5492611000031", "Bruno", nil)
	srvA := crearServicio(t, db, negA.ID, "Consulta A", "1000.00")
	srvB := crearServicio(t, db, negB.ID, "Consulta B", "1000.00")

	ahora := time.Now().Truncate(time.Second)
	leA := anotarEnEspera(t, db, negA.ID, cliA.ID, srvA.ID, ahora.Add(-time.Hour))
	anotarEnEspera(t, db, negB.ID, cliB.ID, srvB.ID, ahora.Add(-time.Hour))

	listaA, err := repo.List(ctx, negA.ID, repository.FiltroListaEspera{})
	if err != nil {
		t.Fatalf("listar A: %v", err)
	}
	if len(listaA) != 1 || listaA[0].ID != leA.ID {
		t.Fatalf("la cola de A trajo %d anotados y no son los suyos: %+v", len(listaA), listaA)
	}

	// El servicio de B no existe para A, ni siquiera con el id correcto.
	if primero, err := repo.PrimeroSinNotificar(ctx, negA.ID, srvB.ID); err != nil || primero != nil {
		t.Errorf("A vio la cola de B: %+v (err %v)", primero, err)
	}
	// Y el anotado de A tampoco aparece pidiéndolo desde B.
	if primero, err := repo.PrimeroSinNotificar(ctx, negB.ID, srvA.ID); err != nil || primero != nil {
		t.Errorf("B vio la cola de A: %+v (err %v)", primero, err)
	}

	if borrado, err := repo.Delete(ctx, negB.ID, leA.ID); err != nil || borrado {
		t.Errorf("B borró un anotado de A (borrado=%v, err=%v)", borrado, err)
	}
	if marcado, err := repo.MarcarNotificado(ctx, negB.ID, leA.ID, ahora, ""); err != nil || marcado {
		t.Errorf("B marcó un anotado de A (marcado=%v, err=%v)", marcado, err)
	}
	if releerEspera(t, db, leA.ID).NotificadoEn != nil {
		t.Error("el anotado de A quedó tocado por B")
	}

	// El servicio y el cliente se validan contra el tenant.
	if ok, err := repo.ServicioDelNegocio(ctx, negA.ID, srvB.ID); err != nil || ok {
		t.Errorf("el servicio de B pasó como de A (ok=%v, err=%v)", ok, err)
	}
	if ok, err := repo.ClienteDelNegocio(ctx, negA.ID, cliB.ID); err != nil || ok {
		t.Errorf("el cliente de B pasó como de A (ok=%v, err=%v)", ok, err)
	}
}

// TestMarcarNotificadoEsCondicional: dos cancelaciones simultáneas del mismo
// servicio no pueden ofrecerle el mismo hueco dos veces al mismo anotado.
func TestMarcarNotificadoEsCondicional(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewListaEsperaRepository(db)

	neg := crearNegocio(t, db, "Consultorio Gómez", model.VerticalSalud)
	cli := crearCliente(t, db, neg.ID, "5492611000040", "Ana", nil)
	srv := crearServicio(t, db, neg.ID, "Consulta", "1000.00")

	ahora := time.Now().Truncate(time.Second)
	le := anotarEnEspera(t, db, neg.ID, cli.ID, srv.ID, ahora.Add(-time.Hour))

	gano, err := repo.MarcarNotificado(ctx, neg.ID, le.ID, ahora, "")
	if err != nil || !gano {
		t.Fatalf("el primer marcado tenía que ganar (gano=%v, err=%v)", gano, err)
	}
	gano, err = repo.MarcarNotificado(ctx, neg.ID, le.ID, ahora, "")
	if err != nil {
		t.Fatalf("segundo marcado: %v", err)
	}
	if gano {
		t.Error("el segundo marcado también ganó: el anotado recibiría dos ofertas")
	}

	if primero, err := repo.PrimeroSinNotificar(ctx, neg.ID, srv.ID); err != nil || primero != nil {
		t.Errorf("un anotado ya notificado sigue apareciendo como primero: %+v (err %v)", primero, err)
	}
}
