package service

import "errors"

// Errores sentinel del motor. Los handlers los mapean a HTTP:
//
//	ErrTransicionInvalida → 409
//	ErrNoDisponible       → 422
//	ErrSolapado           → 409
//	ErrNoEncontrado       → 404
var (
	// ErrTransicionInvalida: el paso de estado no existe en la máquina, o la
	// regla de negocio lo prohíbe (ausente fuera de un turno), o alguien ganó
	// la carrera y el compromiso ya no está en el estado que se leyó.
	ErrTransicionInvalida = errors.New("transicion de estado invalida")

	// ErrNoDisponible: el servicio no existe para el tenant, está inactivo o
	// tiene el interruptor apagado.
	ErrNoDisponible = errors.New("servicio no disponible")

	// ErrSolapado: el recurso ya está ocupado por otro compromiso o por un
	// hold vigente en ese rango.
	ErrSolapado = errors.New("el recurso ya esta ocupado en ese horario")

	// ErrNoEncontrado: no existe para este negocio. Nunca distinguir "no
	// existe" de "es de otro tenant": desde afuera es lo mismo.
	ErrNoEncontrado = errors.New("no encontrado")
)

// Errores del cobro y la facturación (E8). El mapeo a HTTP vive en
// handler.responderErrorMotor:
//
//	ErrYaCobrado            → 409
//	ErrNoCobrable           → 409
//	ErrMedioPagoInvalido    → 422
//	ErrCUITInvalido         → 422
//	ErrPuntoVentaInvalido   → 422
//	ErrModoFiscalInvalido   → 422
//	ErrTimezoneInvalida     → 422
//	ErrCifradoNoConfigurado → 503
var (
	// ErrYaCobrado: ese compromiso ya tiene su cobro. Lo dispara el UNIQUE de
	// la base, así que aguanta dos requests simultáneos.
	ErrYaCobrado = errors.New("el compromiso ya fue cobrado")

	// ErrNoCobrable: sólo se cobra lo que ya se prestó. Un turno pendiente o
	// confirmado todavía no ocurrió.
	ErrNoCobrable = errors.New("solo se puede cobrar un compromiso completado")

	// ErrMedioPagoInvalido: el medio no es uno de los cinco del CHECK.
	ErrMedioPagoInvalido = errors.New("medio de pago invalido")

	// ErrCUITInvalido: un CUIT son 11 dígitos, con o sin guiones.
	ErrCUITInvalido = errors.New("el CUIT tiene que tener 11 digitos")

	// ErrPuntoVentaInvalido: el punto de venta lo da ARCA y arranca en 1.
	ErrPuntoVentaInvalido = errors.New("punto de venta invalido")

	// ErrModoFiscalInvalido: sólo homologacion o produccion.
	ErrModoFiscalInvalido = errors.New("modo fiscal invalido: homologacion o produccion")

	// ErrTimezoneInvalida: la zona del negocio está mal cargada y el cierre
	// del día no se puede calcular sin ella.
	ErrTimezoneInvalida = errors.New("timezone invalida del negocio")

	// ErrCifradoNoConfigurado: falta FISCAL_CIPHER_KEY. Guardar un certificado
	// en claro no es una alternativa: la operación se rechaza.
	ErrCifradoNoConfigurado = errors.New("el cifrado fiscal no esta configurado en el servidor")
)
