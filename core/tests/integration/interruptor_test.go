package integration

import (
	"testing"

	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/service"
)

// TestInterruptorApagaElServicioParaElAgente: `disponible=false` es EL botón del
// panel. Se apreta cuando se acabó el cheddar o el doctor se enfermó, y tiene
// que sacar el servicio del catálogo del bot en el mismo instante, sin borrar
// nada ni perder el histórico.
func TestInterruptorApagaElServicioParaElAgente(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	// Prendido: se lista y se puede pedir.
	disponibles, err := e.servicios.ListDisponibles(ctx, e.negocio.ID)
	if err != nil {
		t.Fatalf("ListDisponibles: %v", err)
	}
	if len(disponibles) != 1 || disponibles[0].ID != e.servicio.ID {
		t.Fatalf("el servicio prendido tiene que estar en el catálogo del agente: %d resultados", len(disponibles))
	}

	if err := e.servicios.SetDisponible(ctx, e.negocio.ID, e.servicio.ID, false); err != nil {
		t.Fatalf("SetDisponible(false): %v", err)
	}

	t.Run("desaparece del catálogo del agente", func(t *testing.T) {
		disponibles, err := e.servicios.ListDisponibles(ctx, e.negocio.ID)
		if err != nil {
			t.Fatalf("ListDisponibles: %v", err)
		}
		if len(disponibles) != 0 {
			t.Errorf("el agente todavía ve un servicio apagado: %+v", disponibles)
		}
	})

	t.Run("sigue estando para el panel", func(t *testing.T) {
		// El interruptor no es una baja: el dueño tiene que poder volver a
		// prenderlo desde la misma pantalla.
		todos, err := e.servicios.List(ctx, e.negocio.ID, repository.FiltroServicios{})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(todos) != 1 {
			t.Fatalf("el servicio apagado desapareció del panel: %d resultados", len(todos))
		}
		if todos[0].Disponible {
			t.Error("el panel muestra disponible=true tras apagarlo")
		}
	})

	t.Run("no se puede pedir", func(t *testing.T) {
		_, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
		exigirError(t, err, service.ErrNoDisponible, "crear con un servicio apagado")
	})

	t.Run("volver a prenderlo lo devuelve", func(t *testing.T) {
		if err := e.servicios.SetDisponible(ctx, e.negocio.ID, e.servicio.ID, true); err != nil {
			t.Fatalf("SetDisponible(true): %v", err)
		}
		disponibles, err := e.servicios.ListDisponibles(ctx, e.negocio.ID)
		if err != nil {
			t.Fatalf("ListDisponibles: %v", err)
		}
		if len(disponibles) != 1 {
			t.Errorf("prendido de nuevo, el servicio tiene que volver: %d resultados", len(disponibles))
		}
		if _, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1)); err != nil {
			t.Errorf("prendido de nuevo, se tiene que poder pedir: %v", err)
		}
	})
}

// TestServicioInactivoTampocoSePuedePedir: `activo=false` es la baja (el
// servicio que ya no se ofrece más), distinta del interruptor. Ninguna de las
// dos puede entrar a un compromiso nuevo.
func TestServicioInactivoTampocoSePuedePedir(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	if err := e.servicios.Desactivar(ctx, e.negocio.ID, e.servicio.ID); err != nil {
		t.Fatalf("Desactivar: %v", err)
	}

	disponibles, err := e.servicios.ListDisponibles(ctx, e.negocio.ID)
	if err != nil {
		t.Fatalf("ListDisponibles: %v", err)
	}
	if len(disponibles) != 0 {
		t.Errorf("un servicio dado de baja sigue en el catálogo del agente: %+v", disponibles)
	}

	_, err = e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
	exigirError(t, err, service.ErrNoDisponible, "crear con un servicio inactivo")
}

// TestServicioInexistenteNoSePuedePedir: un uuid inventado por el modelo tiene
// que morir en el core, no crear una línea fantasma.
func TestServicioInexistenteNoSePuedePedir(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	in := e.crearInput(model.CompromisoTurno, 1)
	in.Lineas[0].ServicioID = "00000000-0000-0000-0000-000000000000"

	_, err := e.motor.Crear(ctx, e.negocio.ID, in)
	exigirError(t, err, service.ErrNoDisponible, "crear con un servicio inexistente")

	var compromisos int64
	e.db.Model(&model.Compromiso{}).Count(&compromisos)
	if compromisos != 0 {
		t.Errorf("un Crear fallido dejó %d compromisos escritos", compromisos)
	}
}
