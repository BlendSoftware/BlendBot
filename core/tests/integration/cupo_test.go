package integration

import (
	"context"
	"errors"
	"sync"
	"testing"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

func abrirJornada(t *testing.T, db *gorm.DB, negocioID string) *model.Jornada {
	t.Helper()
	j := &model.Jornada{NegocioID: negocioID}
	if err := db.Create(j).Error; err != nil {
		t.Fatalf("abrir jornada: %v", err)
	}
	return j
}

// cerrarJornada baja la caja. Hace falta antes de abrir la siguiente: el
// índice único parcial sólo tolera UNA jornada abierta por negocio.
func cerrarJornada(t *testing.T, db *gorm.DB, jornadaID string) {
	t.Helper()
	if err := db.Exec(`UPDATE jornada SET cerrada_en = NOW() WHERE id = ?`, jornadaID).Error; err != nil {
		t.Fatalf("cerrar jornada: %v", err)
	}
}

func cupoDe(t *testing.T, db *gorm.DB, jornadaID, servicioID string) model.CupoJornada {
	t.Helper()
	var c model.CupoJornada
	err := db.Where("jornada_id = ? AND servicio_id = ?", jornadaID, servicioID).First(&c).Error
	if err != nil {
		t.Fatalf("leer cupo: %v", err)
	}
	return c
}

// TestCupoNoSeSobrevende es EL test de este módulo: veinte confirmaciones
// simultáneas sobre un cupo de cinco tienen que dejar exactamente cinco
// vendidas. Ni seis por una carrera, ni cuatro por un lock de más.
//
// Corre contra Postgres de verdad y en goroutines de verdad: un mock del
// repositorio probaría que el mock sabe sumar, no que la base impide la
// sobreventa.
func TestCupoNoSeSobrevende(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Milanesa", "9500")
	j := abrirJornada(t, db, neg.ID)

	const cupo = 5
	const intentos = 20
	if _, err := repo.Set(ctx, neg.ID, j.ID, sv.ID, cupo); err != nil {
		t.Fatalf("set cupo: %v", err)
	}

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		exitosos int
		sinCupo  int
	)
	arranquen := make(chan struct{})

	for i := 0; i < intentos; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-arranquen // largan todas juntas: sin esto se serializan solas
			err := repo.Consumir(context.Background(), j.ID, map[string]int{sv.ID: 1})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				exitosos++
			case errors.Is(err, repository.ErrSinCupo):
				sinCupo++
			default:
				t.Errorf("error inesperado al consumir: %v", err)
			}
		}()
	}
	close(arranquen)
	wg.Wait()

	if exitosos != cupo {
		t.Errorf("se vendieron %d porciones con un cupo de %d", exitosos, cupo)
	}
	if sinCupo != intentos-cupo {
		t.Errorf("esperaba %d rechazos por falta de cupo, hubo %d", intentos-cupo, sinCupo)
	}
	if c := cupoDe(t, db, j.ID, sv.ID); c.Consumido != cupo {
		t.Errorf("la base quedó con consumido=%d, esperaba %d", c.Consumido, cupo)
	}
}

// TestCupoPedidoDeVariosPlatosEsTodoONada: si un plato del pedido no tiene
// cupo, el pedido entero se rechaza y NINGÚN plato queda descontado. Sin esto
// un pedido de tres platos dejaría dos porciones reservadas para un pedido que
// nunca existió.
func TestCupoPedidoDeVariosPlatosEsTodoONada(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	hay := crearServicio(t, db, neg.ID, "Provoleta", "6800")
	noHay := crearServicio(t, db, neg.ID, "Bife", "14500")
	j := abrirJornada(t, db, neg.ID)

	if _, err := repo.Set(ctx, neg.ID, j.ID, hay.ID, 10); err != nil {
		t.Fatalf("set cupo hay: %v", err)
	}
	if _, err := repo.Set(ctx, neg.ID, j.ID, noHay.ID, 0); err != nil {
		t.Fatalf("set cupo noHay: %v", err)
	}

	err := repo.Consumir(ctx, j.ID, map[string]int{hay.ID: 2, noHay.ID: 1})
	if !errors.Is(err, repository.ErrSinCupo) {
		t.Fatalf("esperaba ErrSinCupo, hubo: %v", err)
	}
	if c := cupoDe(t, db, j.ID, hay.ID); c.Consumido != 0 {
		t.Errorf("el plato que SÍ tenía cupo quedó descontado en %d: la transacción no revirtió", c.Consumido)
	}
}

// TestCupoSinFilaEsIlimitado: el cupo es opt-in. Un plato sin cupo cargado se
// vende siempre, que es como se comportaban todos los negocios antes de este
// módulo.
func TestCupoSinFilaEsIlimitado(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Empanadas", "4500")
	j := abrirJornada(t, db, neg.ID)

	for i := 0; i < 50; i++ {
		if err := repo.Consumir(ctx, j.ID, map[string]int{sv.ID: 3}); err != nil {
			t.Fatalf("un plato sin cupo tiene que venderse siempre: %v", err)
		}
	}
}

// TestCupoSeDevuelve: lo que se descuenta al confirmar vuelve al cancelar. Sin
// esto cada pedido cancelado se come stock para siempre.
func TestCupoSeDevuelve(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Pastas", "9800")
	j := abrirJornada(t, db, neg.ID)

	if _, err := repo.Set(ctx, neg.ID, j.ID, sv.ID, 4); err != nil {
		t.Fatalf("set cupo: %v", err)
	}
	if err := repo.Consumir(ctx, j.ID, map[string]int{sv.ID: 3}); err != nil {
		t.Fatalf("consumir: %v", err)
	}
	if err := repo.Devolver(ctx, j.ID, map[string]int{sv.ID: 2}); err != nil {
		t.Fatalf("devolver: %v", err)
	}

	if c := cupoDe(t, db, j.ID, sv.ID); c.Consumido != 1 || c.Restante() != 3 {
		t.Errorf("consumido=%d restante=%d; esperaba 1 y 3", c.Consumido, c.Restante())
	}
}

// TestCupoDevolverDeMasNoRompe: un doble reintegro (una compensación que corre
// dos veces) no puede dejar el consumido en negativo.
func TestCupoDevolverDeMasNoRompe(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Flan", "3500")
	j := abrirJornada(t, db, neg.ID)

	if _, err := repo.Set(ctx, neg.ID, j.ID, sv.ID, 5); err != nil {
		t.Fatalf("set cupo: %v", err)
	}
	if err := repo.Consumir(ctx, j.ID, map[string]int{sv.ID: 1}); err != nil {
		t.Fatalf("consumir: %v", err)
	}
	for i := 0; i < 3; i++ {
		if err := repo.Devolver(ctx, j.ID, map[string]int{sv.ID: 1}); err != nil {
			t.Fatalf("devolver: %v", err)
		}
	}

	if c := cupoDe(t, db, j.ID, sv.ID); c.Consumido != 0 {
		t.Errorf("consumido quedó en %d, tendría que haber tocado piso en 0", c.Consumido)
	}
}

// TestCupoNoSePuedeBajarDeLoVendido: si ya vendiste 7, no podés declarar que
// el cupo era 5. O se deja como está, o se cancelan pedidos.
func TestCupoNoSePuedeBajarDeLoVendido(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Helado", "3200")
	j := abrirJornada(t, db, neg.ID)

	if _, err := repo.Set(ctx, neg.ID, j.ID, sv.ID, 10); err != nil {
		t.Fatalf("set cupo: %v", err)
	}
	if err := repo.Consumir(ctx, j.ID, map[string]int{sv.ID: 7}); err != nil {
		t.Fatalf("consumir: %v", err)
	}

	if _, err := repo.Set(ctx, neg.ID, j.ID, sv.ID, 5); !errors.Is(err, repository.ErrCupoMenorAlConsumido) {
		t.Fatalf("esperaba ErrCupoMenorAlConsumido, hubo: %v", err)
	}
	// Subirlo sí se puede: llegó mercadería.
	if _, err := repo.Set(ctx, neg.ID, j.ID, sv.ID, 12); err != nil {
		t.Fatalf("subir el cupo tiene que poder: %v", err)
	}
	if c := cupoDe(t, db, j.ID, sv.ID); c.Asignado != 12 || c.Consumido != 7 {
		t.Errorf("asignado=%d consumido=%d; esperaba 12 y 7", c.Asignado, c.Consumido)
	}
}

// TestCupoEsDeSuJornada: cerrar el día y abrir otro arranca de cero. El cupo
// es del día, no del plato.
func TestCupoEsDeSuJornada(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	neg := crearNegocio(t, db, "Parrilla", model.VerticalGastronomia)
	sv := crearServicio(t, db, neg.ID, "Milanesa", "9500")

	ayer := abrirJornada(t, db, neg.ID)
	if _, err := repo.Set(ctx, neg.ID, ayer.ID, sv.ID, 3); err != nil {
		t.Fatalf("set cupo ayer: %v", err)
	}
	if err := repo.Consumir(ctx, ayer.ID, map[string]int{sv.ID: 3}); err != nil {
		t.Fatalf("consumir ayer: %v", err)
	}
	if err := repo.Consumir(ctx, ayer.ID, map[string]int{sv.ID: 1}); !errors.Is(err, repository.ErrSinCupo) {
		t.Fatalf("ayer tendría que estar agotado, hubo: %v", err)
	}

	cerrarJornada(t, db, ayer.ID)
	hoy := abrirJornada(t, db, neg.ID)
	restantes, err := repo.RestantePorServicio(ctx, neg.ID, hoy.ID)
	if err != nil {
		t.Fatalf("restantes de hoy: %v", err)
	}
	if len(restantes) != 0 {
		t.Errorf("la jornada nueva arrancó con cupos heredados: %+v", restantes)
	}
	// Y sin cupo cargado, hoy se vende sin tope.
	if err := repo.Consumir(ctx, hoy.ID, map[string]int{sv.ID: 10}); err != nil {
		t.Fatalf("hoy sin cupo tiene que ser ilimitado: %v", err)
	}
}

// TestCupoNoSeMezclaEntreNegocios: el cupo de un restaurante no puede leerse
// ni pisarse desde otro. Mismo criterio que el resto de los repositorios.
func TestCupoNoSeMezclaEntreNegocios(t *testing.T) {
	ctx, db := nuevoCaso(t)
	repo := repository.NewCupoRepository(db)

	a := crearNegocio(t, db, "Parrilla A", model.VerticalGastronomia)
	b := crearNegocio(t, db, "Parrilla B", model.VerticalGastronomia)
	svA := crearServicio(t, db, a.ID, "Milanesa", "9500")
	jA := abrirJornada(t, db, a.ID)
	jB := abrirJornada(t, db, b.ID)

	if _, err := repo.Set(ctx, a.ID, jA.ID, svA.ID, 4); err != nil {
		t.Fatalf("set cupo A: %v", err)
	}

	deB, err := repo.DeJornada(ctx, b.ID, jB.ID)
	if err != nil {
		t.Fatalf("listar cupos de B: %v", err)
	}
	if len(deB) != 0 {
		t.Errorf("B ve cupos de A: %+v", deB)
	}

	restantesB, err := repo.RestantePorServicio(ctx, b.ID, jA.ID)
	if err != nil {
		t.Fatalf("restantes de B sobre la jornada de A: %v", err)
	}
	if len(restantesB) != 0 {
		t.Errorf("con la jornada de A, B leyó cupos ajenos: %+v", restantesB)
	}
}
