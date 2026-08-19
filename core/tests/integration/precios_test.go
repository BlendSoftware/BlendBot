package integration

import (
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
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
