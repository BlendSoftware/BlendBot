package model

// EstadoCompromiso es el estado del motor. Las transiciones se validan acá,
// en el core — nunca en el agente. Si el modelo intenta pasar de PENDIENTE a
// COMPLETADO, el core lo rechaza.
type EstadoCompromiso string

const (
	EstadoPendiente  EstadoCompromiso = "pendiente"
	EstadoConfirmado EstadoCompromiso = "confirmado"
	EstadoEnCurso    EstadoCompromiso = "en_curso"
	EstadoListo      EstadoCompromiso = "listo"
	EstadoCompletado EstadoCompromiso = "completado"
	EstadoRechazado  EstadoCompromiso = "rechazado"
	EstadoCancelado  EstadoCompromiso = "cancelado"
	EstadoAusente    EstadoCompromiso = "ausente"
)

// transiciones define el grafo de la máquina de estados (docs/ARQUITECTURA.md).
//
//   - EN_CURSO → COMPLETADO directo existe porque en salud no hay LISTO:
//     el paciente sale del consultorio y el turno se completa.
//   - AUSENTE aplica sólo al vertical salud; esa regla es de negocio y se
//     valida en el service, no acá: este grafo es puramente estructural.
var transiciones = map[EstadoCompromiso][]EstadoCompromiso{
	EstadoPendiente:  {EstadoConfirmado, EstadoRechazado, EstadoCancelado, EstadoAusente},
	EstadoConfirmado: {EstadoEnCurso, EstadoCancelado, EstadoAusente},
	EstadoEnCurso:    {EstadoListo, EstadoCompletado},
	EstadoListo:      {EstadoCompletado},
	// COMPLETADO, RECHAZADO, CANCELADO y AUSENTE son terminales.
}

// PuedeTransicionarA responde si el paso e → destino es válido.
func (e EstadoCompromiso) PuedeTransicionarA(destino EstadoCompromiso) bool {
	for _, d := range transiciones[e] {
		if d == destino {
			return true
		}
	}
	return false
}

// EsTerminal responde si el estado no admite más transiciones.
func (e EstadoCompromiso) EsTerminal() bool {
	return len(transiciones[e]) == 0
}

// EstadosValidos lista todos los estados conocidos (para validar input).
func EstadosValidos() []EstadoCompromiso {
	return []EstadoCompromiso{
		EstadoPendiente, EstadoConfirmado, EstadoEnCurso, EstadoListo,
		EstadoCompletado, EstadoRechazado, EstadoCancelado, EstadoAusente,
	}
}
