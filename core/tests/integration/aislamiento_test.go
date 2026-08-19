package integration

import (
	"errors"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"gorm.io/gorm"
)

// tenantSembrado es un negocio con un dato de cada tabla que un repo puede tocar.
type tenantSembrado struct {
	negocio    *model.Negocio
	recurso    *model.Recurso
	categoria  *model.Categoria
	cobertura  *model.Cobertura
	servicio   *model.Servicio
	cliente    *model.Cliente
	compromiso *model.Compromiso
	hold       *model.Hold
}

func sembrarTenant(t *testing.T, db *gorm.DB, nombre string, vertical model.Vertical, telefono string, base time.Time) *tenantSembrado {
	t.Helper()

	neg := crearNegocio(t, db, nombre, vertical)
	rec := crearRecurso(t, db, neg.ID, nombre+" · recurso", model.RecursoProfesional)
	cat := crearCategoria(t, db, neg.ID, nombre+" · categoría")
	cob := crearCobertura(t, db, neg.ID, nombre+" · OSEP")
	srv := crearServicio(t, db, neg.ID, nombre+" · servicio", "1000.00")
	cli := crearCliente(t, db, neg.ID, telefono, nombre+" · cliente", &cob.ID)

	inicio := base
	fin := base.Add(30 * time.Minute)
	comp := crearCompromisoDirecto(t, db, neg.ID, cli.ID, srv.ID, &rec.ID, &inicio, &fin,
		model.CompromisoTurno, model.EstadoPendiente, "1000.00")

	hold := crearHold(t, db, rec.ID, base.Add(2*time.Hour), base.Add(150*time.Minute),
		time.Now().Add(10*time.Minute), telefono)

	return &tenantSembrado{
		negocio: neg, recurso: rec, categoria: cat, cobertura: cob,
		servicio: srv, cliente: cli, compromiso: comp, hold: hold,
	}
}

// TestAislamientoDeTenant es EL test del producto. Un negocio no puede leer ni
// tocar los datos de otro por NINGÚN método de repositorio, ni siquiera
// conociendo el UUID exacto del registro ajeno. Todo lo que se prueba acá es lo
// que impide que el consultorio de al lado vea la agenda de sus pacientes.
func TestAislamientoDeTenant(t *testing.T) {
	ctx, db := nuevoCaso(t)
	base := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Minute)

	a := sembrarTenant(t, db, "Negocio A", model.VerticalSalud, "5492610000001", base)
	b := sembrarTenant(t, db, "Negocio B", model.VerticalGastronomia, "5492610000002", base)

	// El negocio A es siempre el atacante: usa SU negocioID contra los ids de B.
	atacante := a.negocio.ID

	servicios := repository.NewServicioRepository(db)
	categorias := repository.NewCategoriaRepository(db)
	recursos := repository.NewRecursoRepository(db)
	clientes := repository.NewClienteRepository(db)
	coberturas := repository.NewCoberturaRepository(db)
	compromisos := repository.NewCompromisoRepository(db)
	holds := repository.NewHoldRepository(db)
	motor := service.NewMotorService(compromisos, holds)
	holdSvc := service.NewHoldService(holds, compromisos)

	t.Run("servicios", func(t *testing.T) {
		s, err := servicios.GetByID(ctx, atacante, b.servicio.ID)
		exigirVacio(t, s, err, "ServicioRepository.GetByID contra otro tenant")

		lista, err := servicios.List(ctx, atacante, repository.FiltroServicios{IncluirInactivos: true})
		exigirSinError(t, err, "ServicioRepository.List")
		exigirNoContiene(t, ids(lista, func(s model.Servicio) string { return s.ID }), b.servicio.ID, "List")

		disp, err := servicios.ListDisponibles(ctx, atacante)
		exigirSinError(t, err, "ServicioRepository.ListDisponibles")
		exigirNoContiene(t, ids(disp, func(s model.Servicio) string { return s.ID }), b.servicio.ID, "ListDisponibles")

		// Escrituras: el interruptor de B no se puede apagar desde A.
		_ = servicios.SetDisponible(ctx, atacante, b.servicio.ID, false)
		_ = servicios.Desactivar(ctx, atacante, b.servicio.ID)
		ajeno := *b.servicio
		ajeno.Nombre = "pisado por A"
		_ = servicios.Update(ctx, atacante, &ajeno)

		var enBase model.Servicio
		if err := db.First(&enBase, "id = ?", b.servicio.ID).Error; err != nil {
			t.Fatalf("releer servicio de B: %v", err)
		}
		if !enBase.Disponible || !enBase.Activo || enBase.Nombre != b.servicio.Nombre {
			t.Errorf("A modificó el servicio de B: %+v", enBase)
		}
	})

	t.Run("categorias", func(t *testing.T) {
		c, err := categorias.GetByID(ctx, atacante, b.categoria.ID)
		exigirVacio(t, c, err, "CategoriaRepository.GetByID contra otro tenant")

		lista, err := categorias.List(ctx, atacante, true)
		exigirSinError(t, err, "CategoriaRepository.List")
		exigirNoContiene(t, ids(lista, func(c model.Categoria) string { return c.ID }), b.categoria.ID, "List")
	})

	t.Run("recursos", func(t *testing.T) {
		r, err := recursos.GetByID(ctx, atacante, b.recurso.ID)
		exigirVacio(t, r, err, "RecursoRepository.GetByID contra otro tenant")

		lista, err := recursos.List(ctx, atacante, true)
		exigirSinError(t, err, "RecursoRepository.List")
		exigirNoContiene(t, ids(lista, func(r model.Recurso) string { return r.ID }), b.recurso.ID, "List")

		_ = recursos.Desactivar(ctx, atacante, b.recurso.ID)
		var enBase model.Recurso
		if err := db.First(&enBase, "id = ?", b.recurso.ID).Error; err != nil {
			t.Fatalf("releer recurso de B: %v", err)
		}
		if !enBase.Activo {
			t.Error("A desactivó el recurso de B")
		}
	})

	t.Run("clientes", func(t *testing.T) {
		c, err := clientes.GetByID(ctx, atacante, b.cliente.ID)
		exigirVacio(t, c, err, "ClienteRepository.GetByID contra otro tenant")

		// El teléfono es EL identificador del cliente en WhatsApp: si esta
		// consulta cruzara tenants, el agente saludaría por su nombre a un
		// paciente de otro consultorio.
		porTel, err := clientes.GetByTelefono(ctx, atacante, b.cliente.Telefono)
		exigirVacio(t, porTel, err, "ClienteRepository.GetByTelefono contra otro tenant")

		lista, err := clientes.List(ctx, atacante, 100)
		exigirSinError(t, err, "ClienteRepository.List")
		exigirNoContiene(t, ids(lista, func(c model.Cliente) string { return c.ID }), b.cliente.ID, "List")
	})

	t.Run("coberturas", func(t *testing.T) {
		c, err := coberturas.GetByID(ctx, atacante, b.cobertura.ID)
		exigirVacio(t, c, err, "CoberturaRepository.GetByID contra otro tenant")

		lista, err := coberturas.List(ctx, atacante)
		exigirSinError(t, err, "CoberturaRepository.List")
		exigirNoContiene(t, ids(lista, func(c model.Cobertura) string { return c.ID }), b.cobertura.ID, "List")
	})

	t.Run("compromisos", func(t *testing.T) {
		c, err := compromisos.GetByID(ctx, atacante, b.compromiso.ID)
		exigirVacio(t, c, err, "CompromisoRepository.GetByID contra otro tenant")

		tablero, err := compromisos.ListTablero(ctx, atacante, nil, nil, nil)
		exigirSinError(t, err, "CompromisoRepository.ListTablero")
		exigirNoContiene(t, ids(tablero, func(c model.Compromiso) string { return c.ID }), b.compromiso.ID, "ListTablero")

		agenda, err := compromisos.ListPorRecurso(ctx, atacante, b.recurso.ID, base.Add(-time.Hour), base.Add(time.Hour))
		exigirSinError(t, err, "CompromisoRepository.ListPorRecurso")
		if len(agenda) != 0 {
			t.Errorf("ListPorRecurso expuso la agenda de otro tenant: %d filas", len(agenda))
		}

		ok, err := compromisos.UpdateEstado(ctx, atacante, b.compromiso.ID, model.EstadoPendiente,
			repository.CambioEstado{Nuevo: model.EstadoCancelado})
		exigirSinError(t, err, "CompromisoRepository.UpdateEstado")
		if ok {
			t.Error("A canceló un compromiso de B")
		}
		var enBase model.Compromiso
		if err := db.First(&enBase, "id = ?", b.compromiso.ID).Error; err != nil {
			t.Fatalf("releer compromiso de B: %v", err)
		}
		if enBase.Estado != model.EstadoPendiente {
			t.Errorf("el compromiso de B quedó en %s", enBase.Estado)
		}
	})

	t.Run("consultas de apoyo del motor", func(t *testing.T) {
		srv, err := compromisos.ServiciosDisponibles(ctx, atacante, []string{b.servicio.ID})
		exigirSinError(t, err, "ServiciosDisponibles")
		if len(srv) != 0 {
			t.Errorf("ServiciosDisponibles devolvió servicios de otro tenant: %v", srv)
		}

		_, existe, err := compromisos.CoberturaDeCliente(ctx, atacante, b.cliente.ID)
		exigirSinError(t, err, "CoberturaDeCliente")
		if existe {
			t.Error("CoberturaDeCliente reconoció a un cliente de otro tenant")
		}

		activo, err := compromisos.RecursoActivo(ctx, atacante, b.recurso.ID)
		exigirSinError(t, err, "RecursoActivo")
		if activo {
			t.Error("RecursoActivo aceptó un recurso de otro tenant")
		}
	})

	t.Run("holds", func(t *testing.T) {
		activo, err := holds.RecursoActivo(ctx, atacante, b.recurso.ID)
		exigirSinError(t, err, "HoldRepository.RecursoActivo")
		if activo {
			t.Error("HoldRepository.RecursoActivo aceptó un recurso de otro tenant")
		}

		borrado, err := holds.Delete(ctx, atacante, b.hold.ID, b.hold.Sesion)
		exigirSinError(t, err, "HoldRepository.Delete")
		if borrado {
			t.Error("A liberó el hold de B")
		}
		var quedan int64
		db.Model(&model.Hold{}).Where("id = ?", b.hold.ID).Count(&quedan)
		if quedan != 1 {
			t.Error("el hold de B desapareció")
		}

		// El service no puede bloquear la agenda de un recurso ajeno.
		_, err = holdSvc.Crear(ctx, atacante, b.recurso.ID, base.Add(5*time.Hour), base.Add(6*time.Hour), "5492610000001")
		exigirError(t, err, service.ErrNoEncontrado, "HoldService.Crear sobre recurso ajeno")
	})

	t.Run("motor", func(t *testing.T) {
		// Crear con el servicio de otro tenant: el catálogo ajeno no existe.
		in := dto.CrearCompromisoInput{
			ClienteID: a.cliente.ID,
			Tipo:      model.CompromisoTurno,
			Origen:    model.OrigenWhatsApp,
			Lineas:    []dto.LineaCompromisoInput{{ServicioID: b.servicio.ID, Cantidad: 1}},
		}
		_, err := motor.Crear(ctx, atacante, in)
		exigirError(t, err, service.ErrNoDisponible, "MotorService.Crear con servicio ajeno")

		// Crear a nombre de un cliente de otro tenant.
		in2 := dto.CrearCompromisoInput{
			ClienteID: b.cliente.ID,
			Tipo:      model.CompromisoTurno,
			Origen:    model.OrigenWhatsApp,
			Lineas:    []dto.LineaCompromisoInput{{ServicioID: a.servicio.ID, Cantidad: 1}},
		}
		_, err = motor.Crear(ctx, atacante, in2)
		exigirError(t, err, service.ErrNoEncontrado, "MotorService.Crear con cliente ajeno")

		// Leer y transicionar un compromiso ajeno.
		_, err = motor.Obtener(ctx, atacante, b.compromiso.ID)
		exigirError(t, err, service.ErrNoEncontrado, "MotorService.Obtener ajeno")

		_, err = motor.Transicionar(ctx, atacante, b.compromiso.ID, model.EstadoConfirmado, service.OpcionesTransicion{})
		exigirError(t, err, service.ErrNoEncontrado, "MotorService.Transicionar ajeno")

		var enBase model.Compromiso
		if err := db.First(&enBase, "id = ?", b.compromiso.ID).Error; err != nil {
			t.Fatalf("releer compromiso de B: %v", err)
		}
		if enBase.Estado != model.EstadoPendiente || enBase.ConfirmadoEn != nil {
			t.Errorf("A confirmó el compromiso de B: %+v", enBase)
		}

		lista, err := motor.Listar(ctx, atacante, dto.FiltroCompromisos{})
		exigirSinError(t, err, "MotorService.Listar")
		exigirNoContiene(t, ids(lista, func(c dto.CompromisoResponse) string { return c.ID }), b.compromiso.ID, "Listar")
	})
}

// TestAislamientoCadaTenantVeLoSuyo es el control del test anterior: si todo
// diera vacío por un bug del fixture, aquel pasaría igual. Este exige que el
// dueño legítimo SÍ vea su dato.
func TestAislamientoCadaTenantVeLoSuyo(t *testing.T) {
	ctx, db := nuevoCaso(t)
	base := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Minute)

	a := sembrarTenant(t, db, "Negocio A", model.VerticalSalud, "5492610000001", base)
	b := sembrarTenant(t, db, "Negocio B", model.VerticalGastronomia, "5492610000002", base)

	servicios := repository.NewServicioRepository(db)
	clientes := repository.NewClienteRepository(db)
	compromisos := repository.NewCompromisoRepository(db)

	for _, tn := range []*tenantSembrado{a, b} {
		neg := tn.negocio.ID

		if s, err := servicios.GetByID(ctx, neg, tn.servicio.ID); err != nil || s == nil {
			t.Errorf("%s no ve su propio servicio: %v", tn.negocio.Nombre, err)
		}
		if c, err := clientes.GetByTelefono(ctx, neg, tn.cliente.Telefono); err != nil || c == nil {
			t.Errorf("%s no ve su propio cliente por teléfono: %v", tn.negocio.Nombre, err)
		}
		if c, err := compromisos.GetByID(ctx, neg, tn.compromiso.ID); err != nil || c == nil {
			t.Errorf("%s no ve su propio compromiso: %v", tn.negocio.Nombre, err)
		}
		agenda, err := compromisos.ListPorRecurso(ctx, neg, tn.recurso.ID, base.Add(-time.Hour), base.Add(time.Hour))
		if err != nil || len(agenda) != 1 {
			t.Errorf("%s no ve su propia agenda: %d filas, err=%v", tn.negocio.Nombre, len(agenda), err)
		}
	}
}

// ── Aserciones del aislamiento ──────────────────────────────────────────────

// exigirVacio acepta las dos formas legítimas de "no existe para vos": un error
// (ErrRecordNotFound / ErrNoEncontrado) o un puntero nil sin error. Lo que NO
// se acepta es devolver el registro ajeno.
func exigirVacio[T any](t *testing.T, obtenido *T, err error, que string) {
	t.Helper()
	if err != nil {
		return
	}
	if obtenido != nil {
		t.Errorf("FUGA DE TENANT · %s devolvió el registro de otro negocio", que)
	}
}

func exigirSinError(t *testing.T, err error, que string) {
	t.Helper()
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("%s: error inesperado: %v", que, err)
	}
}

func exigirError(t *testing.T, err error, esperado error, que string) {
	t.Helper()
	if err == nil {
		t.Errorf("%s: se esperaba %v y no hubo error", que, esperado)
		return
	}
	if esperado != nil && !errors.Is(err, esperado) {
		t.Errorf("%s: se esperaba %v, se obtuvo %v", que, esperado, err)
	}
}

func exigirNoContiene(t *testing.T, encontrados []string, prohibido, que string) {
	t.Helper()
	for _, id := range encontrados {
		if id == prohibido {
			t.Errorf("FUGA DE TENANT · %s incluyó %s, que es de otro negocio", que, prohibido)
		}
	}
}

func ids[T any](xs []T, id func(T) string) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		out = append(out, id(x))
	}
	return out
}
