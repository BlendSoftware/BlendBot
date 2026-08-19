package integration

import (
	"testing"

	"copiloto/core/internal/model"
	"copiloto/core/internal/service"
)

// TestCaminoFelizDelTurno recorre el ciclo completo y exige los timestamps:
// confirmado_en y cerrado_en no son adorno, son de donde salen las métricas que
// se le venden al consultorio (demora de confirmación, duración real).
func TestCaminoFelizDelTurno(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	c, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
	if err != nil {
		t.Fatalf("crear: %v", err)
	}
	if c.Estado != model.EstadoPendiente {
		t.Fatalf("un compromiso nuevo nace pendiente, nació %s", c.Estado)
	}
	if c.ConfirmadoEn != nil || c.CerradoEn != nil {
		t.Errorf("un compromiso nuevo no tiene timestamps de cierre: %+v", c)
	}

	demora := 15
	c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, model.EstadoConfirmado,
		service.OpcionesTransicion{DemoraMin: &demora, RecursoID: &e.recurso.ID})
	if err != nil {
		t.Fatalf("pendiente → confirmado: %v", err)
	}
	if c.Estado != model.EstadoConfirmado {
		t.Fatalf("quedó en %s", c.Estado)
	}
	if c.ConfirmadoEn == nil {
		t.Error("confirmar tiene que sellar confirmado_en")
	}
	if c.DemoraMin == nil || *c.DemoraMin != demora {
		t.Errorf("la demora del local no se guardó: %v", c.DemoraMin)
	}
	if c.RecursoID == nil || *c.RecursoID != e.recurso.ID {
		t.Errorf("el recurso asignado no se guardó: %v", c.RecursoID)
	}

	c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, model.EstadoEnCurso, service.OpcionesTransicion{})
	if err != nil {
		t.Fatalf("confirmado → en_curso: %v", err)
	}
	if c.CerradoEn != nil {
		t.Error("en_curso todavía no cierra nada")
	}

	c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, model.EstadoCompletado, service.OpcionesTransicion{})
	if err != nil {
		t.Fatalf("en_curso → completado: %v", err)
	}
	if c.Estado != model.EstadoCompletado {
		t.Fatalf("quedó en %s", c.Estado)
	}
	if c.CerradoEn == nil {
		t.Error("completar tiene que sellar cerrado_en")
	}
	if c.ConfirmadoEn == nil {
		t.Error("completar no puede borrar confirmado_en")
	}

	// Y quedó persistido, no sólo en la respuesta.
	guardado, err := e.compromisos.GetByID(ctx, e.negocio.ID, c.ID)
	if err != nil {
		t.Fatalf("releer: %v", err)
	}
	if guardado.Estado != model.EstadoCompletado || guardado.CerradoEn == nil {
		t.Errorf("la base no refleja el cierre: %+v", guardado)
	}
}

// TestTransicionesInvalidasSonRechazadas: el salto que el agente podría intentar
// (pendiente → completado) es exactamente el que el core tiene que frenar.
func TestTransicionesInvalidasSonRechazadas(t *testing.T) {
	casos := []struct {
		nombre string
		camino []model.EstadoCompromiso // transiciones válidas previas
		ilegal model.EstadoCompromiso
	}{
		{"pendiente no salta a completado", nil, model.EstadoCompletado},
		{"pendiente no salta a en_curso", nil, model.EstadoEnCurso},
		{"pendiente no salta a listo", nil, model.EstadoListo},
		{"confirmado no salta a completado", []model.EstadoCompromiso{model.EstadoConfirmado}, model.EstadoCompletado},
		{"confirmado ya no se rechaza", []model.EstadoCompromiso{model.EstadoConfirmado}, model.EstadoRechazado},
		{"en curso ya no se cancela", []model.EstadoCompromiso{model.EstadoConfirmado, model.EstadoEnCurso}, model.EstadoCancelado},
		{"en curso ya no se marca ausente", []model.EstadoCompromiso{model.EstadoConfirmado, model.EstadoEnCurso}, model.EstadoAusente},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud)

			c, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
			if err != nil {
				t.Fatalf("crear: %v", err)
			}
			for _, paso := range caso.camino {
				c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, paso, service.OpcionesTransicion{})
				if err != nil {
					t.Fatalf("preparar el estado %s: %v", paso, err)
				}
			}
			estadoPrevio := c.Estado

			_, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, caso.ilegal, service.OpcionesTransicion{})
			exigirError(t, err, service.ErrTransicionInvalida, string(estadoPrevio)+" → "+string(caso.ilegal))

			guardado, err := e.compromisos.GetByID(ctx, e.negocio.ID, c.ID)
			if err != nil {
				t.Fatalf("releer: %v", err)
			}
			if guardado.Estado != estadoPrevio {
				t.Errorf("una transición rechazada movió el estado: %s → %s", estadoPrevio, guardado.Estado)
			}
		})
	}
}

// TestAusenteSoloAplicaATurnos es la regla de negocio del vertical salud:
// AUSENTE es la métrica que se le vende al consultorio, y no significa nada
// sobre un pedido de comida.
func TestAusenteSoloAplicaATurnos(t *testing.T) {
	casos := []struct {
		nombre   string
		tipo     model.TipoCompromiso
		permitir bool
	}{
		{"un turno se marca ausente", model.CompromisoTurno, true},
		{"un pedido no se marca ausente", model.CompromisoPedido, false},
		{"una reserva no se marca ausente", model.CompromisoReserva, false},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud)

			c, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(caso.tipo, 1))
			if err != nil {
				t.Fatalf("crear: %v", err)
			}

			c2, err := e.motor.Transicionar(ctx, e.negocio.ID, c.ID, model.EstadoAusente, service.OpcionesTransicion{})
			if caso.permitir {
				if err != nil {
					t.Fatalf("un turno pendiente sí puede quedar ausente: %v", err)
				}
				if c2.Estado != model.EstadoAusente {
					t.Errorf("quedó en %s", c2.Estado)
				}
				return
			}

			exigirError(t, err, service.ErrTransicionInvalida, "ausente sobre "+string(caso.tipo))
			guardado, err := e.compromisos.GetByID(ctx, e.negocio.ID, c.ID)
			if err != nil {
				t.Fatalf("releer: %v", err)
			}
			if guardado.Estado != model.EstadoPendiente {
				t.Errorf("un %s quedó en %s", caso.tipo, guardado.Estado)
			}
		})
	}
}

// TestAusenteTambienDesdeConfirmado: el caso real es el paciente que confirmó y
// no vino.
func TestAusenteDesdeConfirmado(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	c, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
	if err != nil {
		t.Fatalf("crear: %v", err)
	}
	c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, model.EstadoConfirmado, service.OpcionesTransicion{})
	if err != nil {
		t.Fatalf("confirmar: %v", err)
	}
	c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, model.EstadoAusente, service.OpcionesTransicion{})
	if err != nil {
		t.Fatalf("confirmado → ausente: %v", err)
	}
	if c.Estado != model.EstadoAusente {
		t.Fatalf("quedó en %s", c.Estado)
	}
}

// TestEstadosTerminalesNoTransicionan: una vez cerrado, cerrado. Si esto se
// rompe, un compromiso completado y facturado podría volver a la cola.
func TestEstadosTerminalesNoTransicionan(t *testing.T) {
	casos := []struct {
		nombre   string
		camino   []model.EstadoCompromiso
		terminal model.EstadoCompromiso
	}{
		{"completado", []model.EstadoCompromiso{model.EstadoConfirmado, model.EstadoEnCurso, model.EstadoCompletado}, model.EstadoCompletado},
		{"cancelado", []model.EstadoCompromiso{model.EstadoCancelado}, model.EstadoCancelado},
		{"rechazado", []model.EstadoCompromiso{model.EstadoRechazado}, model.EstadoRechazado},
		{"ausente", []model.EstadoCompromiso{model.EstadoAusente}, model.EstadoAusente},
	}

	// Todo destino posible: desde un terminal, ninguno debe aceptarse.
	destinos := model.EstadosValidos()

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			ctx, e := montar(t, model.VerticalSalud)

			c, err := e.motor.Crear(ctx, e.negocio.ID, e.crearInput(model.CompromisoTurno, 1))
			if err != nil {
				t.Fatalf("crear: %v", err)
			}
			for _, paso := range caso.camino {
				c, err = e.motor.Transicionar(ctx, e.negocio.ID, c.ID, paso, service.OpcionesTransicion{})
				if err != nil {
					t.Fatalf("llegar a %s: %v", paso, err)
				}
			}
			if !caso.terminal.EsTerminal() {
				t.Fatalf("%s debería ser terminal", caso.terminal)
			}

			for _, destino := range destinos {
				_, err := e.motor.Transicionar(ctx, e.negocio.ID, c.ID, destino, service.OpcionesTransicion{})
				exigirError(t, err, service.ErrTransicionInvalida, string(caso.terminal)+" → "+string(destino))
			}

			guardado, err := e.compromisos.GetByID(ctx, e.negocio.ID, c.ID)
			if err != nil {
				t.Fatalf("releer: %v", err)
			}
			if guardado.Estado != caso.terminal {
				t.Errorf("el terminal %s se movió a %s", caso.terminal, guardado.Estado)
			}
		})
	}
}

// TestTransicionarInexistente: un id que no existe es un 404, no un 409.
func TestTransicionarCompromisoInexistente(t *testing.T) {
	ctx, e := montar(t, model.VerticalSalud)

	_, err := e.motor.Transicionar(ctx, e.negocio.ID, "00000000-0000-0000-0000-000000000000",
		model.EstadoConfirmado, service.OpcionesTransicion{})
	exigirError(t, err, service.ErrNoEncontrado, "transicionar un id inexistente")
}
