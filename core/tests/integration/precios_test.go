package integration

import (
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"
)

// TestPrecioSeCongelaAlCrear: subir la lista de precios no puede reescribir lo
// que ya se le cotizó a un cliente. Es la razón por la que precio_unit vive en
// la línea y no se lee del catálogo al mostrar el compromiso.
func TestPrecioSeCongelaAlCrear(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud) // servicio a 1000.00

	c, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 2))
	if err != nil {
		t.Fatalf("crear: %v", err)
	}
	if len(c.Lineas) != 1 {
		t.Fatalf("se esperaba 1 línea, hay %d", len(c.Lineas))
	}
	igualDecimal(t, c.Lineas[0].PrecioUnit, "1000.00", "precio congelado")
	igualDecimal(t, c.Total, "2000.00", "total (2 × 1000)")

	// Aumento de la lista después de cotizar.
	setPrecioBase(t, e.db, e.servicio.ID, "5000.00")

	relectura, err := e.motor.Obtener(ctx, e.negocio.ID, c.ID)
	if err != nil {
		t.Fatalf("obtener: %v", err)
	}
	igualDecimal(t, relectura.Lineas[0].PrecioUnit, "1000.00", "la línea conserva el precio del momento")
	igualDecimal(t, relectura.Total, "2000.00", "el total no se recalcula")

	// Un compromiso nuevo sí toma el precio nuevo: el congelado es por línea,
	// no un catálogo que quedó congelado para siempre.
	nuevo, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
	if err != nil {
		t.Fatalf("crear el segundo: %v", err)
	}
	igualDecimal(t, nuevo.Lineas[0].PrecioUnit, "5000.00", "el compromiso nuevo toma el precio nuevo")
}

// TestPrecioPorCobertura: el paciente con obra social paga lo que dice
// precio_cobertura, no el precio de particular. Es lo que hace que el mismo
// catálogo sirva para OSEP, OSDE y particular sin duplicar servicios.
func TestPrecioPorCobertura(t *testing.T) {
	casos := []struct {
		nombre         string
		conCobertura   bool
		conListaPropia bool
		esperado       string
	}{
		{"con cobertura y precio propio toma el de la cobertura", true, true, "700.00"},
		{"con cobertura pero sin precio propio cae al base", true, false, "1000.00"},
		{"sin cobertura paga el base", false, false, "1000.00"},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud) // servicio a 1000.00

			var coberturaID *string
			if caso.conCobertura {
				cob := crearCobertura(t, e.db, e.negocio.ID, "OSEP")
				coberturaID = &cob.ID
				if caso.conListaPropia {
					crearPrecioCobertura(t, e.db, e.servicio.ID, cob.ID, "700.00")
				}
			}
			paciente := crearCliente(t, e.db, e.negocio.ID, "5492611000777", "Paciente", coberturaID)

			in := dto.CrearCompromisoInput{
				ClienteID: paciente.ID,
				Tipo:      model.CompromisoTurno,
				Origen:    model.OrigenWhatsApp,
				Lineas:    []dto.LineaCompromisoInput{{ServicioID: e.servicio.ID, Cantidad: 1}},
			}
			c, err := e.motor.Crear(ctx, e.negocio.ID, in)
			if err != nil {
				t.Fatalf("crear: %v", err)
			}
			igualDecimal(t, c.Lineas[0].PrecioUnit, caso.esperado, "precio unitario")
			igualDecimal(t, c.Total, caso.esperado, "total")
		})
	}
}

// TestTotalConVariasLineas: el total es la suma de cantidad × precio congelado.
func TestTotalConVariasLineas(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud) // "Consulta" a 1000.00

	radiografia := crearServicio(t, e.db, e.negocio.ID, "Radiografía", "250.50")

	in := dto.CrearCompromisoInput{
		ClienteID: e.cliente.ID,
		Tipo:      model.CompromisoTurno,
		Origen:    model.OrigenWhatsApp,
		Lineas: []dto.LineaCompromisoInput{
			{ServicioID: e.servicio.ID, Cantidad: 2},
			{ServicioID: radiografia.ID, Cantidad: 3},
		},
	}
	c, err := e.motor.Crear(ctx, e.negocio.ID, in)
	if err != nil {
		t.Fatalf("crear: %v", err)
	}
	if len(c.Lineas) != 2 {
		t.Fatalf("se esperaban 2 líneas, hay %d", len(c.Lineas))
	}
	igualDecimal(t, c.Total, "2751.50", "2×1000 + 3×250.50")
}

// TestLoQueCotizaElCatalogoEsLoQueCongelaElMotor: las dos puntas del precio
// tienen que dar el MISMO número. El agente cotizaba con precio_base mientras
// el motor congelaba el precio de la cobertura del cliente, así que el paciente
// con obra social confirmaba $1000 y en la caja le aparecían $700 — y con un
// aumento cargado sólo en la lista general, al revés (H4).
func TestLoQueCotizaElCatalogoEsLoQueCongelaElMotor(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud) // servicio a 1000.00
	catalogo := service.NewCatalogoService(
		repository.NewCategoriaRepository(e.db),
		repository.NewRecursoRepository(e.db),
		repository.NewServicioRepository(e.db),
		repository.NewCoberturaRepository(e.db),
	)

	cob := crearCobertura(t, e.db, e.negocio.ID, "OSEP")
	crearPrecioCobertura(t, e.db, e.servicio.ID, cob.ID, "700.00")
	paciente := crearCliente(t, e.db, e.negocio.ID, "5492611000777", "Paciente", &cob.ID)

	// Lo que ve quien cotiza, pidiendo el catálogo con la cobertura del cliente.
	servicios, err := catalogo.ListarServiciosParaCobertura(
		ctx, e.negocio.ID, repository.FiltroServicios{SoloDisponibles: true}, cob.ID)
	if err != nil {
		t.Fatalf("listar con cobertura: %v", err)
	}
	var cotizado *model.Servicio
	for i := range servicios {
		if servicios[i].ID == e.servicio.ID {
			cotizado = &servicios[i]
		}
	}
	if cotizado == nil {
		t.Fatal("el servicio no salió en el catálogo")
	}
	if cotizado.PrecioEfectivo == nil {
		t.Fatal("con ?cobertura_id= el listado tiene que traer precio_efectivo")
	}
	igualDecimal(t, *cotizado.PrecioEfectivo, "700.00", "precio cotizado")
	igualDecimal(t, cotizado.PrecioBase, "1000.00", "precio_base sigue siendo el de lista")

	// Lo que congela el motor para ese mismo cliente.
	c, err := e.motor.Crear(ctx, e.negocio.ID, dto.CrearCompromisoInput{
		ClienteID: paciente.ID,
		Tipo:      model.CompromisoTurno,
		Origen:    model.OrigenWhatsApp,
		Lineas:    []dto.LineaCompromisoInput{{ServicioID: e.servicio.ID, Cantidad: 1}},
	})
	if err != nil {
		t.Fatalf("crear: %v", err)
	}
	if !c.Lineas[0].PrecioUnit.Equal(*cotizado.PrecioEfectivo) {
		t.Errorf("se cotizó %s y se congeló %s: el cliente confirma un número y paga otro",
			cotizado.PrecioEfectivo, c.Lineas[0].PrecioUnit)
	}
}

// TestCatalogoSinCoberturaNoTraePrecioEfectivo: sin ?cobertura_id= el listado
// sale como siempre. En gastronomía nadie pide una hamburguesa con obra social
// y el panel no tiene que ver un campo de más.
func TestCatalogoSinCoberturaNoTraePrecioEfectivo(t *testing.T) {
	ctx, e := montar(t, model.VerticalGastronomia)
	catalogo := service.NewCatalogoService(
		repository.NewCategoriaRepository(e.db),
		repository.NewRecursoRepository(e.db),
		repository.NewServicioRepository(e.db),
		repository.NewCoberturaRepository(e.db),
	)

	servicios, err := catalogo.ListarServiciosParaCobertura(
		ctx, e.negocio.ID, repository.FiltroServicios{SoloDisponibles: true}, "")
	if err != nil {
		t.Fatalf("listar sin cobertura: %v", err)
	}
	for _, sv := range servicios {
		if sv.PrecioEfectivo != nil {
			t.Errorf("%s trajo precio_efectivo sin cobertura pedida", sv.Nombre)
		}
	}
}

// TestCatalogoConCoberturaDeOtroTenant: precio_cobertura no tiene negocio_id,
// así que si el listado no valida la cobertura contra el negocio del token, un
// tenant cotiza con la lista de precios de otro.
func TestCatalogoConCoberturaDeOtroTenant(t *testing.T) {
	ctx, db := nuevoCaso(t)
	catalogo := service.NewCatalogoService(
		repository.NewCategoriaRepository(db),
		repository.NewRecursoRepository(db),
		repository.NewServicioRepository(db),
		repository.NewCoberturaRepository(db),
	)

	mio := crearNegocio(t, db, "Mío", model.VerticalSalud)
	ajeno := crearNegocio(t, db, "Ajeno", model.VerticalSalud)
	crearServicio(t, db, mio.ID, "Consulta", "1000.00")
	cobAjena := crearCobertura(t, db, ajeno.ID, "OSDE del vecino")

	_, err := catalogo.ListarServiciosParaCobertura(
		ctx, mio.ID, repository.FiltroServicios{SoloDisponibles: true}, cobAjena.ID)
	if err == nil {
		t.Fatal("se aceptó una cobertura de otro negocio para cotizar")
	}
}
