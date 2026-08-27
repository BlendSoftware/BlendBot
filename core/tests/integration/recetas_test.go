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

// ── Helpers de recetas ──────────────────────────────────────────────────────

// recetasDe arma el service como lo arma producción (main.go): con la mitad
// "receta sobre plato con cupo" de la exclusión cableada. Sin la opción, la
// regla se puede violar entrando por el lado que quedó suelto, y un test que
// use el service pelado no probaría la regla que el spec pide.
func recetasDe(db *gorm.DB) service.RecetaService {
	return service.NewRecetaService(
		repository.NewRecetaRepository(db),
		repository.NewInsumoRepository(db),
		repository.NewServicioRepository(db),
		service.ConExclusionDeCupo(
			repository.NewCupoRepository(db),
			repository.NewJornadaRepository(db),
		),
	)
}

// cuposDe arma el CupoService con la OTRA mitad de la exclusión: "cupo sobre
// plato con receta".
func cuposDe(db *gorm.DB) service.CupoService {
	return service.NewCupoService(
		repository.NewCupoRepository(db),
		repository.NewJornadaRepository(db),
		repository.NewServicioRepository(db),
		service.ConExclusionDeReceta(repository.NewRecetaRepository(db)),
	)
}

func linea(insumoID string, cantidad int) dto.LineaRecetaInput {
	return dto.LineaRecetaInput{InsumoID: insumoID, Cantidad: cantidad}
}

// guardarReceta carga la receta de un plato por el service real. Sin items
// vacía la receta, que es como el plato vuelve a ser ilimitado.
func guardarReceta(t *testing.T, db *gorm.DB, negocioID, servicioID string, items ...dto.LineaRecetaInput) dto.RecetaResponse {
	t.Helper()
	r, err := recetasDe(db).Guardar(context.Background(), negocioID, servicioID,
		dto.GuardarRecetaInput{Items: items})
	if err != nil {
		t.Fatalf("guardar receta de %s: %v", servicioID, err)
	}
	return *r
}

// ── Un plato declara de qué está hecho ──────────────────────────────────────

// TestCargaDeUnaRecetaDejaSusLineas: la hamburguesa lleva 1 medallón y 1 pan de
// papa. Las dos líneas quedan, con la unidad de cada insumo al lado de la
// cantidad — que es la mitigación del riesgo de unidades, no un adorno.
func TestCargaDeUnaRecetaDejaSusLineas(t *testing.T) {
	ctx, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	hamburguesa := crearServicio(t, db, neg.ID, "Hamburguesa", "9500")
	medallon := altaInsumo(t, db, neg.ID, "medallón", model.UnidadUnidad, 40, nil)
	pan := altaInsumo(t, db, neg.ID, "pan de papa", model.UnidadUnidad, 12, nil)

	guardarReceta(t, db, neg.ID, hamburguesa.ID, linea(medallon.ID, 1), linea(pan.ID, 1))

	r, err := recetasDe(db).DeServicio(ctx, neg.ID, hamburguesa.ID)
	if err != nil {
		t.Fatalf("leer receta: %v", err)
	}
	if !r.TieneReceta || len(r.Items) != 2 {
		t.Fatalf("esperaba una receta de dos líneas, obtuve %+v", r)
	}
	porInsumo := make(map[string]dto.LineaRecetaResponse, 2)
	for _, it := range r.Items {
		porInsumo[it.InsumoNombre] = it
	}
	if l := porInsumo["medallón"]; l.Cantidad != 1 || l.Unidad != model.UnidadUnidad {
		t.Errorf("línea del medallón: %+v", l)
	}
	if l := porInsumo["pan de papa"]; l.Cantidad != 1 || l.Unidad != model.UnidadUnidad {
		t.Errorf("línea del pan: %+v", l)
	}
	if pan.Stock != 12 {
		t.Fatalf("fixture: el pan tiene que arrancar en 12, arrancó en %d", pan.Stock)
	}
}

// TestUnInsumoNoSeRepiteEnLaMismaReceta: la operación se rechaza y el mensaje
// ofrece la salida —cambiar la cantidad de la línea que ya está— en vez de
// mostrar un error de Postgres que no le dice nada al dueño.
func TestUnInsumoNoSeRepiteEnLaMismaReceta(t *testing.T) {
	ctx, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	hamburguesa := crearServicio(t, db, neg.ID, "Hamburguesa", "9500")
	medallon := altaInsumo(t, db, neg.ID, "medallón", model.UnidadUnidad, 40, nil)

	_, err := recetasDe(db).Guardar(ctx, neg.ID, hamburguesa.ID, dto.GuardarRecetaInput{
		Items: []dto.LineaRecetaInput{linea(medallon.ID, 1), linea(medallon.ID, 2)},
	})
	if !errors.Is(err, service.ErrInsumoRepetido) {
		t.Fatalf("esperaba ErrInsumoRepetido, obtuve %v", err)
	}
	if !strings.Contains(err.Error(), "cantidad") {
		t.Errorf("el rechazo tiene que ofrecer cambiar la cantidad de la línea existente, dijo: %q", err)
	}

	// Y el índice único es el que lo hace imposible, no sólo el service.
	var n int64
	if err := db.Raw(`
		SELECT COUNT(*) FROM pg_indexes
		 WHERE tablename = 'receta_item' AND indexdef ILIKE '%UNIQUE%servicio_id%insumo_id%'
	`).Scan(&n).Error; err != nil {
		t.Fatalf("consultar pg_indexes: %v", err)
	}
	if n == 0 {
		t.Error("falta el índice único (servicio_id, insumo_id): la regla queda sólo en Go")
	}
}

// TestNoSePuedeUsarElInsumoDeOtroNegocio: el uuid del insumo de otro
// restaurante no es una llave. Se rechaza y la receta no queda a medias.
func TestNoSePuedeUsarElInsumoDeOtroNegocio(t *testing.T) {
	ctx, db := nuevoCaso(t)

	a := crearNegocio(t, db, "Parrilla A", model.VerticalGastronomia)
	b := crearNegocio(t, db, "Parrilla B", model.VerticalGastronomia)
	platoDeA := crearServicio(t, db, a.ID, "Hamburguesa", "9500")
	propio := altaInsumo(t, db, a.ID, "medallón", model.UnidadUnidad, 40, nil)
	ajeno := altaInsumo(t, db, b.ID, "pan de papa", model.UnidadUnidad, 12, nil)

	_, err := recetasDe(db).Guardar(ctx, a.ID, platoDeA.ID, dto.GuardarRecetaInput{
		Items: []dto.LineaRecetaInput{linea(propio.ID, 1), linea(ajeno.ID, 1)},
	})
	if err == nil {
		t.Fatal("se armó una receta con el insumo de otro negocio")
	}

	items, err := repository.NewRecetaRepository(db).DeServicio(ctx, a.ID, platoDeA.ID)
	if err != nil {
		t.Fatalf("leer receta: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("la receta quedó a medias con %d línea(s): el rechazo tiene que ser atómico", len(items))
	}
}

// ── Un plato tiene receta o cupo manual, nunca los dos ──────────────────────

// TestUnPlatoTieneRecetaOCupoPeroNuncaLosDos cubre la exclusión en LOS DOS
// sentidos y la salida.
//
// Los dos sentidos hacen falta: con una sola mitad cableada, la regla se viola
// entrando por el lado que quedó suelto y el plato termina con dos fuentes para
// el mismo número. Y toda regla de precedencia es una pregunta que el dueño se
// hace en el peor momento ("¿por qué dice 3 si cargué 10?").
func TestUnPlatoTieneRecetaOCupoPeroNuncaLosDos(t *testing.T) {
	ctx, db := nuevoCaso(t)

	neg := crearNegocio(t, db, "La Parrilla", model.VerticalGastronomia)
	conReceta := crearServicio(t, db, neg.ID, "Hamburguesa", "9500")
	conCupo := crearServicio(t, db, neg.ID, "Provoleta", "6800")
	medallon := altaInsumo(t, db, neg.ID, "medallón", model.UnidadUnidad, 40, nil)
	j := abrirJornada(t, db, neg.ID)

	guardarReceta(t, db, neg.ID, conReceta.ID, linea(medallon.ID, 1))
	cargarCupo(t, db, neg.ID, j.ID, conCupo.ID, 10, 0)

	t.Run("cupo sobre un plato con receta", func(t *testing.T) {
		_, err := cuposDe(db).Set(ctx, neg.ID, dto.SetCupoInput{
			ServicioID: conReceta.ID, Asignado: ptr(10),
		})
		if !errors.Is(err, service.ErrPlatoConReceta) {
			t.Fatalf("esperaba ErrPlatoConReceta, obtuve %v", err)
		}
		if !strings.Contains(err.Error(), "receta") {
			t.Errorf("el rechazo tiene que decir que ese plato se controla por receta, dijo: %q", err)
		}
		var n int64
		db.Raw(`SELECT COUNT(*) FROM cupo_jornada WHERE jornada_id = ? AND servicio_id = ?`,
			j.ID, conReceta.ID).Scan(&n)
		if n != 0 {
			t.Error("quedó una fila de cupo sobre el plato con receta")
		}
	})

	t.Run("receta sobre un plato con cupo", func(t *testing.T) {
		_, err := recetasDe(db).Guardar(ctx, neg.ID, conCupo.ID, dto.GuardarRecetaInput{
			Items: []dto.LineaRecetaInput{linea(medallon.ID, 1)},
		})
		if !errors.Is(err, service.ErrPlatoConCupo) {
			t.Fatalf("esperaba ErrPlatoConCupo, obtuve %v", err)
		}
		if !strings.Contains(strings.ToLower(err.Error()), "cupo") {
			t.Errorf("el rechazo tiene que decir que primero hay que quitar el cupo, dijo: %q", err)
		}
		items, err := repository.NewRecetaRepository(db).DeServicio(ctx, neg.ID, conCupo.ID)
		if err != nil {
			t.Fatalf("leer receta: %v", err)
		}
		if len(items) != 0 {
			t.Error("quedaron líneas de receta sobre el plato con cupo")
		}
	})

	t.Run("vaciar la receta es la salida del plato trabado", func(t *testing.T) {
		// Con cero líneas el plato deja de controlarse por receta —receta vacía
		// es un plato SIN receta— y el cupo manual vuelve a aceptarse. Si no
		// fuera así, un plato con receta quedaría trabado para siempre sin
		// forma de volver al cupo.
		guardarReceta(t, db, neg.ID, conReceta.ID)
		c, err := cuposDe(db).Set(ctx, neg.ID, dto.SetCupoInput{
			ServicioID: conReceta.ID, Asignado: ptr(10),
		})
		if err != nil {
			t.Fatalf("con la receta vacía el cupo tiene que entrar: %v", err)
		}
		if c.Asignado != 10 {
			t.Errorf("el cupo quedó en %d, esperaba 10", c.Asignado)
		}
	})
}
