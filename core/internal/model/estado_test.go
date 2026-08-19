package model

import "testing"

func TestTransicionesValidas(t *testing.T) {
	validas := []struct{ desde, hacia EstadoCompromiso }{
		{EstadoPendiente, EstadoConfirmado},
		{EstadoPendiente, EstadoRechazado},
		{EstadoPendiente, EstadoCancelado},
		{EstadoPendiente, EstadoAusente},
		{EstadoConfirmado, EstadoEnCurso},
		{EstadoConfirmado, EstadoCancelado},
		{EstadoConfirmado, EstadoAusente},
		{EstadoEnCurso, EstadoListo},
		{EstadoEnCurso, EstadoCompletado}, // salud saltea LISTO
		{EstadoListo, EstadoCompletado},
	}
	for _, tt := range validas {
		if !tt.desde.PuedeTransicionarA(tt.hacia) {
			t.Errorf("%s → %s debería ser válida", tt.desde, tt.hacia)
		}
	}
}

func TestTransicionesInvalidas(t *testing.T) {
	invalidas := []struct{ desde, hacia EstadoCompromiso }{
		{EstadoPendiente, EstadoCompletado}, // la que el agente podría intentar
		{EstadoPendiente, EstadoEnCurso},
		{EstadoPendiente, EstadoListo},
		{EstadoConfirmado, EstadoCompletado},
		{EstadoConfirmado, EstadoRechazado}, // rechazar es sólo desde pendiente
		{EstadoEnCurso, EstadoCancelado},    // en curso ya no se cancela
		{EstadoEnCurso, EstadoAusente},
		{EstadoListo, EstadoCancelado},
		{EstadoCompletado, EstadoPendiente},
		{EstadoCancelado, EstadoConfirmado},
		{EstadoAusente, EstadoConfirmado},
		{EstadoRechazado, EstadoPendiente},
	}
	for _, tt := range invalidas {
		if tt.desde.PuedeTransicionarA(tt.hacia) {
			t.Errorf("%s → %s debería ser inválida", tt.desde, tt.hacia)
		}
	}
}

func TestTerminales(t *testing.T) {
	terminales := []EstadoCompromiso{EstadoCompletado, EstadoRechazado, EstadoCancelado, EstadoAusente}
	for _, e := range terminales {
		if !e.EsTerminal() {
			t.Errorf("%s debería ser terminal", e)
		}
	}
	noTerminales := []EstadoCompromiso{EstadoPendiente, EstadoConfirmado, EstadoEnCurso, EstadoListo}
	for _, e := range noTerminales {
		if e.EsTerminal() {
			t.Errorf("%s no debería ser terminal", e)
		}
	}
}
