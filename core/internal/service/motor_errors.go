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
