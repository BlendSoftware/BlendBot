package integration

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"copiloto/core/internal/model"
	"copiloto/core/internal/service"
)

// franja devuelve un rango cómodo de mañana, alineado al minuto: los tests de
// solape se leen mucho mejor con horas redondas.
func franja(desdeMin, hastaMin int) (time.Time, time.Time) {
	base := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)
	return base.Add(time.Duration(desdeMin) * time.Minute), base.Add(time.Duration(hastaMin) * time.Minute)
}

// TestHoldSolapadoEsRechazado: sin esto, dos personas sacan el mismo turno
// mientras completan sus datos. Es el motivo por el que la tabla hold existe.
func TestHoldSolapadoEsRechazado(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	inicio, fin := franja(0, 30)
	primero, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, "5492611000001")
	if err != nil {
		t.Fatalf("primer hold: %v", err)
	}
	if primero.ExpiraEn.Before(time.Now()) {
		t.Errorf("el hold nace expirado: %v", primero.ExpiraEn)
	}

	solapes := []struct {
		nombre     string
		desde, has int
	}{
		{"el mismo rango", 0, 30},
		{"arranca adentro", 15, 45},
		{"termina adentro", -15, 15},
		{"lo contiene entero", -15, 45},
		{"está contenido", 10, 20},
	}
	for _, s := range solapes {
		t.Run(s.nombre, func(t *testing.T) {
			i, f := franja(s.desde, s.has)
			_, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, i, f, "5492611000002")
			exigirError(t, err, service.ErrSolapado, "segundo hold que "+s.nombre)
		})
	}

	t.Run("pegado pero sin pisar entra", func(t *testing.T) {
		i, f := franja(30, 60)
		if _, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, i, f, "5492611000003"); err != nil {
			t.Errorf("un hold que arranca justo cuando termina el otro no solapa: %v", err)
		}
	})

	t.Run("otro recurso a la misma hora entra", func(t *testing.T) {
		otro := crearRecurso(t, e.db, e.negocio.ID, "Dr. Suárez", model.RecursoProfesional)
		i, f := franja(0, 30)
		if _, err := e.holds.Crear(ctx, e.negocio.ID, otro.ID, i, f, "5492611000004"); err != nil {
			t.Errorf("cada recurso tiene su propia agenda: %v", err)
		}
	})
}

// TestHoldConcurrenteSoloUnoGana es el test de H3: varias sesiones piden el
// mismo hueco a la vez. Sin el lock del recurso las verificaciones ven el hueco
// vacío todas y crean todas; con él, exactamente una gana y el resto choca.
func TestHoldConcurrenteSoloUnoGana(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	inicio, fin := franja(0, 30)

	const n = 8
	results := make(chan error, n)
	arranquen := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sesion := fmt.Sprintf("54926110%05d", i)
		go func(s string) {
			defer wg.Done()
			<-arranquen // que todas lleguen juntas a la línea de largada
			_, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, s)
			results <- err
		}(sesion)
	}
	close(arranquen)
	wg.Wait()
	close(results)

	ganadores, solapados := 0, 0
	for err := range results {
		switch {
		case err == nil:
			ganadores++
		case errors.Is(err, service.ErrSolapado):
			solapados++
		default:
			t.Fatalf("error inesperado en Crear concurrente: %v", err)
		}
	}
	if ganadores != 1 || solapados != n-1 {
		t.Fatalf("esperaba 1 ganador y %d solapados, obtuve ganadores=%d solapados=%d", n-1, ganadores, solapados)
	}

	var quedan int64
	e.db.Model(&model.Hold{}).Count(&quedan)
	if quedan != 1 {
		t.Fatalf("el lock tenía que dejar un solo hold, quedaron %d", quedan)
	}
}

// TestHoldExpiradoNoBloquea: el hold caducado es basura, no una reserva. Si
// bloqueara, cada cliente que abandona la conversación mataría un hueco por
// el resto del día.
func TestHoldExpiradoNoBloquea(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	inicio, fin := franja(0, 30)
	crearHold(t, e.db, e.recurso.ID, inicio, fin, time.Now().Add(-time.Minute), "5492611009999")

	if _, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, "5492611000001"); err != nil {
		t.Fatalf("un hold vencido no puede bloquear el hueco: %v", err)
	}

	// Y el motor tampoco lo tiene en cuenta.
	in := e.crearInput(model.CompromisoTurno, 1)
	in.RecursoID = &e.recurso.ID
	in.Inicio, in.Fin = &inicio, &fin
	in.Sesion = ptr("5492611000001")
	if _, err := e.motor.Crear(ctx, e.negocio.ID, in); err != nil {
		t.Fatalf("crear sobre un hold vencido (propio de esa sesión): %v", err)
	}
}

// TestCompromisoNoChocaContraSuPropioHold es el flujo real del bot: bloquea el
// hueco, pide los datos, y recién ahí crea el turno. Si su propio hold lo
// frenara, no se podría reservar nada.
func TestCompromisoNoChocaContraSuPropioHold(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	sesion := "5492611000001"
	inicio, fin := franja(0, 30)
	if _, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, sesion); err != nil {
		t.Fatalf("tomar el hold: %v", err)
	}

	t.Run("la misma sesión pasa", func(t *testing.T) {
		in := e.crearInput(model.CompromisoTurno, 1)
		in.RecursoID = &e.recurso.ID
		in.Inicio, in.Fin = &inicio, &fin
		in.Sesion = &sesion

		c, err := e.motor.Crear(ctx, e.negocio.ID, in)
		if err != nil {
			t.Fatalf("el hold propio no puede bloquear al que lo tomó: %v", err)
		}
		if c.RecursoID == nil || *c.RecursoID != e.recurso.ID {
			t.Errorf("el compromiso no quedó asignado al recurso: %v", c.RecursoID)
		}
	})

	t.Run("otra sesión choca", func(t *testing.T) {
		// Ojo: acá ya existe el compromiso del subtest anterior, así que el
		// solape es doble (hold ajeno + compromiso activo). Ambos deben frenar.
		i, f := franja(10, 40)
		in := e.crearInput(model.CompromisoTurno, 1)
		in.RecursoID = &e.recurso.ID
		in.Inicio, in.Fin = &i, &f
		in.Sesion = ptr("5492611000002")

		_, err := e.motor.Crear(ctx, e.negocio.ID, in)
		exigirError(t, err, service.ErrSolapado, "crear pisando el hold de otra sesión")
	})
}

// TestCompromisoActivoBloqueaHold: la agenda ya ocupada no se puede volver a
// bloquear, aunque el bloqueo venga de otra conversación.
func TestCompromisoActivoBloqueaHold(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	inicio, fin := franja(0, 30)
	comp := crearCompromisoDirecto(t, e.db, e.negocio.ID, e.cliente.ID, e.servicio.ID, &e.recurso.ID,
		&inicio, &fin, model.CompromisoTurno, model.EstadoConfirmado, "1000.00")

	_, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio.Add(10*time.Minute), fin.Add(10*time.Minute), "5492611000002")
	exigirError(t, err, service.ErrSolapado, "hold sobre un turno confirmado")

	t.Run("un compromiso cancelado libera el hueco", func(t *testing.T) {
		if err := e.db.Model(&model.Compromiso{}).Where("id = ?", comp.ID).
			Update("estado", model.EstadoCancelado).Error; err != nil {
			t.Fatalf("cancelar: %v", err)
		}
		if _, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, "5492611000002"); err != nil {
			t.Errorf("un compromiso en estado terminal ya no ocupa agenda: %v", err)
		}
	})
}

// TestLiberarHold: sólo la sesión dueña libera su bloqueo, y liberarlo devuelve
// el hueco de inmediato.
func TestLiberarHold(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	sesion := "5492611000001"
	inicio, fin := franja(0, 30)
	h, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, sesion)
	if err != nil {
		t.Fatalf("tomar el hold: %v", err)
	}

	err = e.holds.Liberar(ctx, e.negocio.ID, h.ID, "5492619999999")
	exigirError(t, err, nil, "liberar el hold de otra sesión")

	var quedan int64
	e.db.Model(&model.Hold{}).Where("id = ?", h.ID).Count(&quedan)
	if quedan != 1 {
		t.Fatal("una sesión ajena borró el hold")
	}

	if err := e.holds.Liberar(ctx, e.negocio.ID, h.ID, sesion); err != nil {
		t.Fatalf("liberar el hold propio: %v", err)
	}
	if _, err := e.holds.Crear(ctx, e.negocio.ID, e.recurso.ID, inicio, fin, "5492611000002"); err != nil {
		t.Errorf("liberado el hold, el hueco vuelve a estar libre: %v", err)
	}
}

// TestHoldRepoListVigentesIgnoraExpirados prueba el repo directo: ListVigentes
// es lo que consulta el cálculo de huecos (E2), así que su noción de "vigente"
// tiene que ser la de la hora, no la de la tabla.
func TestHoldRepoListVigentesIgnoraExpirados(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	inicio, fin := franja(0, 30)
	vivo := crearHold(t, e.db, e.recurso.ID, inicio, fin, time.Now().Add(10*time.Minute), "vivo")
	crearHold(t, e.db, e.recurso.ID, inicio, fin, time.Now().Add(-10*time.Minute), "muerto")

	vigentes, err := e.holdRepo.ListVigentes(ctx, e.recurso.ID, inicio, fin, time.Now())
	if err != nil {
		t.Fatalf("ListVigentes: %v", err)
	}
	if len(vigentes) != 1 || vigentes[0].ID != vivo.ID {
		t.Fatalf("se esperaba sólo el hold vigente, se obtuvieron %d", len(vigentes))
	}

	borrados, err := e.holdRepo.DeleteExpirados(ctx, time.Now())
	if err != nil {
		t.Fatalf("DeleteExpirados: %v", err)
	}
	if borrados != 1 {
		t.Errorf("se esperaba borrar 1 hold expirado, se borraron %d", borrados)
	}
	var quedan int64
	e.db.Model(&model.Hold{}).Count(&quedan)
	if quedan != 1 {
		t.Errorf("la limpieza se llevó puesto un hold vigente: quedan %d", quedan)
	}
}
