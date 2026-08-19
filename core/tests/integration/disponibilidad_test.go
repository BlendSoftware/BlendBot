package integration

import (
	"errors"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"

	"gorm.io/gorm"
)

func crearHorarioDePrueba(t *testing.T, db *gorm.DB, recursoID string, dia int, desde, hasta string) {
	t.Helper()
	h := &model.Horario{RecursoID: recursoID, DiaSemana: dia, Desde: desde, Hasta: hasta}
	if err := db.Create(h).Error; err != nil {
		t.Fatalf("crear horario: %v", err)
	}
}

func TestDisponibilidadAlgoritmo(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewDisponibilidadRepository(db)
	svc := service.NewDisponibilidadService(repo)

	neg := crearNegocio(t, db, "Consultorio", model.VerticalSalud)
	rec := crearRecurso(t, db, neg.ID, "Dra. Gomez", model.RecursoProfesional)
	sv := crearServicio(t, db, neg.ID, "Consulta", "1000")

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	dia := time.Date(2026, 9, 15, 0, 0, 0, 0, loc)
	crearHorarioDePrueba(t, db, rec.ID, int(dia.Weekday()), "09:00:00", "11:00:00")

	in := dto.ConsultarDisponibilidadInput{ServicioID: sv.ID, Desde: "2026-09-15", Dias: 1}

	r, err := svc.Consultar(ctx, neg.ID, in)
	if err != nil {
		t.Fatalf("consultar: %v", err)
	}
	if len(r.Huecos) != 4 {
		t.Fatalf("esperaba 4 huecos, hubo %d: %+v", len(r.Huecos), r.Huecos)
	}
	if r.Huecos[0].Inicio != "2026-09-15T09:00:00-03:00" || r.Huecos[0].Fin != "2026-09-15T09:30:00-03:00" {
		t.Fatalf("primer hueco mal: %+v", r.Huecos[0])
	}
	if r.Timezone != "America/Argentina/Mendoza" || r.DuracionMin != 30 || r.Truncado {
		t.Fatalf("cabecera mal: %+v", r)
	}

	// Un compromiso vivo come su slot.
	cli := crearCliente(t, db, neg.ID, "5492611111111", "Juana", nil)
	ini := time.Date(2026, 9, 15, 9, 30, 0, 0, loc)
	fin := ini.Add(30 * time.Minute)
	crearCompromisoDirecto(t, db, neg.ID, cli.ID, sv.ID, &rec.ID, &ini, &fin,
		model.CompromisoTurno, model.EstadoConfirmado, "1000")

	r, _ = svc.Consultar(ctx, neg.ID, in)
	if len(r.Huecos) != 3 {
		t.Fatalf("tras compromiso esperaba 3, hubo %d", len(r.Huecos))
	}

	// Un hold vigente también.
	hIni := time.Date(2026, 9, 15, 10, 0, 0, 0, loc)
	crearHold(t, db, rec.ID, hIni, hIni.Add(30*time.Minute), time.Now().Add(10*time.Minute), "549261")
	r, _ = svc.Consultar(ctx, neg.ID, in)
	if len(r.Huecos) != 2 {
		t.Fatalf("tras hold esperaba 2, hubo %d", len(r.Huecos))
	}

	// Un hold expirado NO.
	env.Limpiar(t)
	neg = crearNegocio(t, db, "Consultorio", model.VerticalSalud)
	rec = crearRecurso(t, db, neg.ID, "Dra. Gomez", model.RecursoProfesional)
	sv = crearServicio(t, db, neg.ID, "Consulta", "1000")
	crearHorarioDePrueba(t, db, rec.ID, int(dia.Weekday()), "09:00:00", "11:00:00")
	crearHold(t, db, rec.ID, hIni, hIni.Add(30*time.Minute), time.Now().Add(-time.Minute), "549261")
	in.ServicioID = sv.ID
	r, _ = svc.Consultar(ctx, neg.ID, in)
	if len(r.Huecos) != 4 {
		t.Fatalf("hold expirado bloqueó: %d huecos", len(r.Huecos))
	}

	// Excepción del día.
	exc := &model.Excepcion{
		RecursoID: rec.ID,
		Desde:     time.Date(2026, 9, 15, 10, 0, 0, 0, loc),
		Hasta:     time.Date(2026, 9, 15, 11, 0, 0, 0, loc),
	}
	if err := db.Create(exc).Error; err != nil {
		t.Fatalf("crear excepcion: %v", err)
	}
	r, _ = svc.Consultar(ctx, neg.ID, in)
	if len(r.Huecos) != 2 {
		t.Fatalf("tras excepcion esperaba 2, hubo %d", len(r.Huecos))
	}

	// Default: hoy, 7 días.
	rDef, err := svc.Consultar(ctx, neg.ID, dto.ConsultarDisponibilidadInput{ServicioID: sv.ID})
	if err != nil {
		t.Fatalf("consultar default: %v", err)
	}
	hoy := time.Now().In(loc).Format("2006-01-02")
	if rDef.Dias != 7 || rDef.Desde != hoy {
		t.Fatalf("defaults mal: dias=%d desde=%s (hoy=%s)", rDef.Dias, rDef.Desde, hoy)
	}

	// Sin duración → ErrSinDuracion.
	if err := db.Model(&model.Servicio{}).Where("id = ?", sv.ID).Update("duracion_min", nil).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Consultar(ctx, neg.ID, in); !errors.Is(err, service.ErrSinDuracion) {
		t.Fatalf("esperaba ErrSinDuracion, hubo %v", err)
	}

	// Interruptor apagado → ErrNoDisponible.
	setDisponible(t, db, sv.ID, false)
	if _, err := svc.Consultar(ctx, neg.ID, in); !errors.Is(err, service.ErrNoDisponible) {
		t.Fatalf("esperaba ErrNoDisponible, hubo %v", err)
	}
}

func TestAgendaYTokenAgente(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewDisponibilidadRepository(db)
	svc := service.NewDisponibilidadService(repo)

	neg := crearNegocio(t, db, "Consultorio", model.VerticalSalud)
	otro := crearNegocio(t, db, "Otro", model.VerticalSalud)
	rec := crearRecurso(t, db, neg.ID, "Dra. Gomez", model.RecursoProfesional)
	sv := crearServicio(t, db, neg.ID, "Consulta", "1000")
	cli := crearCliente(t, db, neg.ID, "5492611111111", "Juana", nil)

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	dia := time.Date(2026, 9, 15, 0, 0, 0, 0, loc)
	crearHorarioDePrueba(t, db, rec.ID, int(dia.Weekday()), "09:00:00", "11:00:00")

	ini := time.Date(2026, 9, 15, 9, 30, 0, 0, loc)
	fin := ini.Add(30 * time.Minute)
	crearCompromisoDirecto(t, db, neg.ID, cli.ID, sv.ID, &rec.ID, &ini, &fin,
		model.CompromisoTurno, model.EstadoConfirmado, "1000")
	// Cancelado: no aparece.
	crearCompromisoDirecto(t, db, neg.ID, cli.ID, sv.ID, &rec.ID, &ini, &fin,
		model.CompromisoTurno, model.EstadoCancelado, "1000")

	// La fecha llega como día calendario (así la parsea el handler).
	fecha, _ := time.Parse("2006-01-02", "2026-09-15")
	ag, err := svc.AgendaDelDia(ctx, neg.ID, fecha)
	if err != nil {
		t.Fatalf("agenda: %v", err)
	}
	if ag.Fecha != "2026-09-15" || len(ag.Recursos) != 1 {
		t.Fatalf("agenda mal: %+v", ag)
	}
	col := ag.Recursos[0]
	if len(col.Horarios) != 1 || col.Horarios[0].Desde != "09:00:00" {
		t.Fatalf("horarios mal: %+v", col.Horarios)
	}
	if len(col.Turnos) != 1 {
		t.Fatalf("esperaba 1 turno vivo, hubo %d", len(col.Turnos))
	}
	if col.Turnos[0].Inicio != "2026-09-15T09:30:00-03:00" || col.Turnos[0].ClienteTelefono != "5492611111111" {
		t.Fatalf("turno mal: %+v", col.Turnos[0])
	}

	// Token de agente.
	negRepo := repository.NewNegocioDatosRepository(db)
	tokSvc := service.NewNegocioTokenService(negRepo)

	tok, err := tokSvc.RotarTokenAgente(ctx, neg.ID)
	if err != nil {
		t.Fatalf("rotar: %v", err)
	}
	if len(tok.Token) < 20 || tok.Token[:4] != "cop_" {
		t.Fatalf("token mal formado: %q", tok.Token)
	}
	id, err := negRepo.NegocioPorTokenHash(ctx, middleware.HashTokenAgente(tok.Token))
	if err != nil || id != neg.ID {
		t.Fatalf("lookup por hash: id=%q err=%v", id, err)
	}
	if id, _ := negRepo.NegocioPorTokenHash(ctx, middleware.HashTokenAgente("cop_trucho")); id != "" {
		t.Fatalf("token trucho resolvió a %q", id)
	}

	// Rotar invalida el anterior.
	tok2, _ := tokSvc.RotarTokenAgente(ctx, neg.ID)
	if id, _ := negRepo.NegocioPorTokenHash(ctx, middleware.HashTokenAgente(tok.Token)); id != "" {
		t.Fatalf("el token viejo sigue vivo: %q", id)
	}
	if id, _ := negRepo.NegocioPorTokenHash(ctx, middleware.HashTokenAgente(tok2.Token)); id != neg.ID {
		t.Fatal("el token nuevo no resuelve")
	}

	// Negocio inactivo no autentica.
	db.Model(&model.Negocio{}).Where("id = ?", neg.ID).Update("activo", false)
	if id, _ := negRepo.NegocioPorTokenHash(ctx, middleware.HashTokenAgente(tok2.Token)); id != "" {
		t.Fatal("un negocio dado de baja autenticó")
	}

	// Negocio inexistente → ErrNegocioNoExiste.
	if _, err := tokSvc.RotarTokenAgente(ctx, "11111111-1111-1111-1111-111111111111"); !errors.Is(err, service.ErrNegocioNoExiste) {
		t.Fatalf("esperaba ErrNegocioNoExiste, hubo %v", err)
	}
	_ = otro
}

func TestRecursosDeServicioYAislamiento(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewDisponibilidadRepository(db)
	svc := service.NewDisponibilidadService(repo)

	a := crearNegocio(t, db, "A", model.VerticalSalud)
	b := crearNegocio(t, db, "B", model.VerticalSalud)
	recA := crearRecurso(t, db, a.ID, "Dra. A", model.RecursoProfesional)
	recA2 := crearRecurso(t, db, a.ID, "Dr. A2", model.RecursoProfesional)
	mesaA := crearRecurso(t, db, a.ID, "Mesa", model.RecursoMesa)
	svA := crearServicio(t, db, a.ID, "Consulta", "1000")

	loc, _ := time.LoadLocation("America/Argentina/Mendoza")
	dia := time.Date(2026, 9, 15, 0, 0, 0, 0, loc)
	for _, r := range []string{recA.ID, recA2.ID, mesaA.ID} {
		crearHorarioDePrueba(t, db, r, int(dia.Weekday()), "09:00:00", "10:00:00")
	}

	// Sin vínculos: sólo profesionales activos (la mesa no cuenta).
	in := dto.ConsultarDisponibilidadInput{ServicioID: svA.ID, Desde: "2026-09-15", Dias: 1}
	r, err := svc.Consultar(ctx, a.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Huecos) != 4 { // 2 profesionales x 2 slots
		t.Fatalf("esperaba 4 huecos, hubo %d: %+v", len(r.Huecos), r.Huecos)
	}

	// Con vínculo explícito: sólo el vinculado.
	if err := db.Create(&model.ServicioRecurso{ServicioID: svA.ID, RecursoID: recA.ID}).Error; err != nil {
		t.Fatal(err)
	}
	r, _ = svc.Consultar(ctx, a.ID, in)
	if len(r.Huecos) != 2 {
		t.Fatalf("con vinculo esperaba 2, hubo %d", len(r.Huecos))
	}

	// Filtro por recurso ajeno al servicio → no encontrado.
	in2 := in
	in2.RecursoID = &recA2.ID
	if _, err := svc.Consultar(ctx, a.ID, in2); !errors.Is(err, service.ErrNoEncontrado) {
		t.Fatalf("esperaba ErrNoEncontrado, hubo %v", err)
	}

	// El negocio B no ve el servicio de A.
	if _, err := svc.Consultar(ctx, b.ID, in); !errors.Is(err, service.ErrNoDisponible) {
		t.Fatalf("cruce de tenant: %v", err)
	}
}
