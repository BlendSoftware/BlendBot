package e2e

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
)

// Los payloads de W2-A se decodifican en sus DTO reales (dto.HuecosResponse,
// dto.AgendaResponse): así, si el contrato deriva, el test no compila en vez de
// pasar en verde contra una forma inventada. dto.Hueco lleva inicio/fin como
// string a propósito y este test se apoya en eso: lo que se prueba es la
// REPRESENTACIÓN — un hueco serializado en UTC ("...T12:00:00Z") es un bug
// aunque apunte al mismo instante, porque el agente le dicta esa hora al
// paciente por WhatsApp.

// TestFlujoCompletoConsultorio es el producto entero por HTTP: la plataforma da
// de alta un consultorio, el dueño lo configura, el agente busca un hueco, lo
// bloquea, saca el turno y el turno recorre la máquina de estados hasta cerrar.
// Si este test pasa, un consultorio puede operar.
func TestFlujoCompletoConsultorio(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)

	// ── 1. El admin de la plataforma entra ──────────────────────────────────
	admin := login(t, usuarioAdmin, passwordAdmin)
	igual(t, admin.Usuario.Rol, "admin", "rol del admin")
	igual(t, admin.TokenType, "bearer", "token_type")
	if admin.Usuario.NegocioID != nil {
		t.Errorf("el admin de la plataforma no debería tener negocio: %v", *admin.Usuario.NegocioID)
	}

	// ── 2. Alta del consultorio ─────────────────────────────────────────────
	alta := altaNegocio(t, admin.AccessToken, "Consultorio Gómez", "dra.gomez")
	noVacio(t, alta.NegocioID, "negocio_id del alta")
	igual(t, alta.Nombre, "Consultorio Gómez", "nombre del negocio")
	igual(t, alta.Vertical, "salud", "vertical del negocio")
	igual(t, alta.UsuarioDueno.Username, "dra.gomez", "username del dueño")
	igual(t, alta.UsuarioDueno.Rol, "dueno", "rol del dueño")
	igual(t, alta.UsuarioDueno.MustChangePassword, true, "el dueño arranca obligado a cambiar la password")
	noVacio(t, alta.PasswordTemporal, "password temporal")
	if alta.UsuarioDueno.NegocioID == nil || *alta.UsuarioDueno.NegocioID != alta.NegocioID {
		t.Fatalf("el dueño quedó colgado del negocio equivocado: %v (esperaba %s)",
			alta.UsuarioDueno.NegocioID, alta.NegocioID)
	}

	// ── 3. El dueño entra con la temporal y la cambia ───────────────────────
	temporal := login(t, "dra.gomez", alta.PasswordTemporal)
	igual(t, temporal.Usuario.MustChangePassword, true, "must_change_password con la temporal")
	if temporal.Usuario.NegocioID == nil || *temporal.Usuario.NegocioID != alta.NegocioID {
		t.Fatalf("el token del dueño no trae su negocio: %v", temporal.Usuario.NegocioID)
	}

	const passwordDefinitiva = "consultorio-gomez-2026"
	hacer(t, http.MethodPost, "/api/auth/cambiar-password", map[string]any{
		"password_nueva": passwordDefinitiva,
	}, temporal.AccessToken).exigir(http.StatusOK)

	// La temporal ya no sirve; la nueva sí, y el flag se apagó.
	hacer(t, http.MethodPost, "/api/auth/login", map[string]any{
		"username": "dra.gomez", "password": alta.PasswordTemporal,
	}, "").exigir(http.StatusUnauthorized)

	duena := login(t, "dra.gomez", passwordDefinitiva)
	igual(t, duena.Usuario.MustChangePassword, false, "must_change_password después del cambio")
	token := duena.AccessToken

	// ── 4. Configuración del consultorio ────────────────────────────────────
	var cobertura model.Cobertura
	hacer(t, http.MethodPost, "/api/coberturas", map[string]any{
		"nombre": "OSDE",
	}, token).exigir(http.StatusCreated).en(&cobertura)
	noVacio(t, cobertura.ID, "id de la cobertura")
	igual(t, cobertura.NegocioID, alta.NegocioID, "tenant de la cobertura")

	servicio := crearServicio(t, token, "Consulta", 30, 8500)
	igual(t, servicio.Nombre, "Consulta", "nombre del servicio")
	igual(t, servicio.NegocioID, alta.NegocioID, "tenant del servicio")
	igual(t, servicio.Disponible, true, "el servicio nace disponible")
	if servicio.DuracionMin == nil || *servicio.DuracionMin != 30 {
		t.Fatalf("duracion_min del servicio: esperaba 30, obtuvo %v", servicio.DuracionMin)
	}
	if !servicio.PrecioBase.Equal(decimal.RequireFromString("8500")) {
		t.Errorf("precio_base del servicio: esperaba 8500, obtuvo %s", servicio.PrecioBase)
	}

	recurso := crearRecurso(t, token, "Dra. Gómez")
	igual(t, recurso.Tipo, model.RecursoProfesional, "tipo del recurso")
	igual(t, recurso.Activo, true, "el recurso nace activo")

	// Agenda: lunes a viernes de 09:00 a 13:00.
	dias := []struct {
		nombre string
		dia    int
	}{
		{"lunes", 1}, {"martes", 2}, {"miércoles", 3}, {"jueves", 4}, {"viernes", 5},
	}
	for _, d := range dias {
		t.Run("horario/"+d.nombre, func(t *testing.T) {
			var h dto.HorarioResponse
			hacer(t, http.MethodPost, "/api/recursos/"+recurso.ID+"/horarios", map[string]any{
				"dia_semana": d.dia,
				"desde":      "09:00",
				"hasta":      "13:00",
			}, token).exigir(http.StatusCreated).en(&h)
			igual(t, h.RecursoID, recurso.ID, "recurso del horario")
			igual(t, h.DiaSemana, d.dia, "dia_semana")
			igual(t, h.Desde, "09:00:00", "hora desde normalizada")
			igual(t, h.Hasta, "13:00:00", "hora hasta normalizada")
		})
	}

	var horarios []dto.HorarioResponse
	hacer(t, http.MethodGet, "/api/recursos/"+recurso.ID+"/horarios", nil, token).
		exigir(http.StatusOK).en(&horarios)
	igual(t, len(horarios), 5, "franjas cargadas")

	// ── 5. Disponibilidad ───────────────────────────────────────────────────
	//
	// El hueco objetivo: próximo lunes 09:00–09:30 hora de Mendoza. Se calcula
	// acá y no se toma del primer hueco de la respuesta a propósito: si el
	// cálculo de disponibilidad se corriera de hora, tomarlo de ahí haría pasar
	// igual al resto del flujo. El test tiene que saber a qué hora es el turno.
	loc := zonaNegocio(t)
	lunes := proximoLunes(t)
	inicioTurno := time.Date(lunes.Year(), lunes.Month(), lunes.Day(), 9, 0, 0, 0, loc)
	finTurno := inicioTurno.Add(30 * time.Minute)

	t.Run("disponibilidad", func(t *testing.T) {
		exigirW2A(t, http.MethodPost, "/api/disponibilidad/consultar")

		var huecos dto.HuecosResponse
		hacer(t, http.MethodPost, "/api/disponibilidad/consultar", map[string]any{
			"servicio_id": servicio.ID,
			"desde":       lunes.Format("2006-01-02"),
			"dias":        1,
		}, token).exigir(http.StatusOK).en(&huecos)

		igual(t, huecos.ServicioID, servicio.ID, "servicio consultado")
		igual(t, huecos.ServicioNombre, "Consulta", "nombre del servicio consultado")
		igual(t, huecos.Timezone, tzNegocio, "timezone de la respuesta")
		igual(t, huecos.DuracionMin, 30, "duración del slot")
		igual(t, huecos.Desde, lunes.Format("2006-01-02"), "día consultado")
		igual(t, huecos.Dias, 1, "días consultados")
		igual(t, huecos.Truncado, false, "un solo día no llega al tope de huecos")

		// 09:00 a 13:00 con paso de 30 minutos son ocho turnos.
		igual(t, len(huecos.Huecos), 8, "cantidad de huecos del lunes")
		if len(huecos.Huecos) == 0 {
			t.FailNow()
		}

		primero := huecos.Huecos[0]
		igual(t, primero.RecursoID, recurso.ID, "recurso del primer hueco")
		igual(t, primero.Inicio, inicioTurno.Format(time.RFC3339), "inicio del primer hueco")
		igual(t, primero.Fin, finTurno.Format(time.RFC3339), "fin del primer hueco")

		// El offset es parte del contrato: el agente le dicta esta hora al
		// paciente. Un "Z" acá son turnos a las 6 de la mañana.
		for i, h := range huecos.Huecos {
			if !strings.HasSuffix(h.Inicio, offsetNegocio) {
				t.Errorf("hueco %d: inicio %q no está en %s (%s)", i, h.Inicio, tzNegocio, offsetNegocio)
			}
			if !strings.HasSuffix(h.Fin, offsetNegocio) {
				t.Errorf("hueco %d: fin %q no está en %s (%s)", i, h.Fin, tzNegocio, offsetNegocio)
			}
		}

		// Orden cronológico estricto y sin pisarse.
		for i := 1; i < len(huecos.Huecos); i++ {
			previo, err := time.Parse(time.RFC3339, huecos.Huecos[i-1].Fin)
			if err != nil {
				t.Fatalf("hueco %d: fin ilegible %q: %v", i-1, huecos.Huecos[i-1].Fin, err)
			}
			actual, err := time.Parse(time.RFC3339, huecos.Huecos[i].Inicio)
			if err != nil {
				t.Fatalf("hueco %d: inicio ilegible %q: %v", i, huecos.Huecos[i].Inicio, err)
			}
			if actual.Before(previo) {
				t.Errorf("hueco %d arranca (%s) antes de que termine el anterior (%s)",
					i, actual, previo)
			}
		}

		// El último arranca 12:30: 13:00 no entra porque no cabe media hora.
		ultimo := huecos.Huecos[len(huecos.Huecos)-1]
		esperadoUltimo := time.Date(lunes.Year(), lunes.Month(), lunes.Day(), 12, 30, 0, 0, loc)
		igual(t, ultimo.Inicio, esperadoUltimo.Format(time.RFC3339), "inicio del último hueco")
	})

	// ── 6. El agente bloquea el hueco ───────────────────────────────────────
	const sesion = "5492611000001"

	var hold dto.HoldResponse
	hacer(t, http.MethodPost, "/api/holds", map[string]any{
		"recurso_id": recurso.ID,
		"inicio":     inicioTurno.Format(time.RFC3339),
		"fin":        finTurno.Format(time.RFC3339),
		"sesion":     sesion,
	}, token).exigir(http.StatusCreated).en(&hold)
	noVacio(t, hold.ID, "id del hold")
	igual(t, hold.RecursoID, recurso.ID, "recurso del hold")
	igual(t, hold.Sesion, sesion, "sesión del hold")
	if !hold.Inicio.Equal(inicioTurno) {
		t.Errorf("inicio del hold: esperaba %s, obtuvo %s", inicioTurno, hold.Inicio)
	}
	if !hold.ExpiraEn.After(time.Now()) {
		t.Errorf("el hold nació expirado: expira_en=%s", hold.ExpiraEn)
	}

	// Otra sesión no puede robar el mismo hueco mientras el hold vive.
	hacer(t, http.MethodPost, "/api/holds", map[string]any{
		"recurso_id": recurso.ID,
		"inicio":     inicioTurno.Format(time.RFC3339),
		"fin":        finTurno.Format(time.RFC3339),
		"sesion":     "5492619999999",
	}, token).exigir(http.StatusConflict)

	// ── 7. La paciente y el turno ───────────────────────────────────────────
	var cliente model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono":     sesion,
		"nombre":       "Juana Pérez",
		"cobertura_id": cobertura.ID,
	}, token).exigir(http.StatusCreated).en(&cliente)
	noVacio(t, cliente.ID, "id del cliente")
	igual(t, cliente.NegocioID, alta.NegocioID, "tenant del cliente")

	var turno dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "turno",
		"origen":     "whatsapp",
		"recurso_id": recurso.ID,
		"inicio":     inicioTurno.Format(time.RFC3339),
		"fin":        finTurno.Format(time.RFC3339),
		// Misma sesión que el hold: el propio bloqueo no cuenta como solape.
		"sesion": sesion,
		"lineas": []map[string]any{
			{"servicio_id": servicio.ID, "cantidad": 1},
		},
	}, token).exigir(http.StatusCreated).en(&turno)

	noVacio(t, turno.ID, "id del turno")
	igual(t, turno.NegocioID, alta.NegocioID, "tenant del turno")
	igual(t, turno.Tipo, model.CompromisoTurno, "tipo del turno")
	igual(t, turno.Estado, model.EstadoPendiente, "estado inicial")
	igual(t, turno.Origen, model.OrigenWhatsApp, "origen del turno")
	if turno.RecursoID == nil || *turno.RecursoID != recurso.ID {
		t.Fatalf("recurso del turno: esperaba %s, obtuvo %v", recurso.ID, turno.RecursoID)
	}
	if turno.Inicio == nil || !turno.Inicio.Equal(inicioTurno) {
		t.Errorf("inicio del turno: esperaba %s, obtuvo %v", inicioTurno, turno.Inicio)
	}
	if turno.ConfirmadoEn != nil {
		t.Errorf("un turno pendiente no tiene confirmado_en: %v", turno.ConfirmadoEn)
	}
	// El precio se congela en el core desde el catálogo: nunca viaja en el request.
	if !turno.Total.Equal(decimal.RequireFromString("8500")) {
		t.Errorf("total del turno: esperaba 8500, obtuvo %s", turno.Total)
	}
	if len(turno.Lineas) != 1 {
		t.Fatalf("líneas del turno: esperaba 1, obtuvo %d", len(turno.Lineas))
	}
	igual(t, turno.Lineas[0].ServicioID, servicio.ID, "servicio de la línea")
	igual(t, turno.Lineas[0].Cantidad, 1, "cantidad de la línea")
	if !turno.Lineas[0].PrecioUnit.Equal(decimal.RequireFromString("8500")) {
		t.Errorf("precio congelado de la línea: esperaba 8500, obtuvo %s", turno.Lineas[0].PrecioUnit)
	}

	// ── 8. La máquina de estados ────────────────────────────────────────────
	var confirmado dto.CompromisoResponse
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "confirmado",
	}, token).exigir(http.StatusOK).en(&confirmado)
	igual(t, confirmado.Estado, model.EstadoConfirmado, "estado tras confirmar")
	if confirmado.ConfirmadoEn == nil {
		t.Error("confirmar tiene que sellar confirmado_en")
	}
	if confirmado.CerradoEn != nil {
		t.Errorf("confirmado no es terminal: cerrado_en=%v", confirmado.CerradoEn)
	}

	// El tablero filtrado lo muestra.
	var tablero []dto.CompromisoResponse
	hacer(t, http.MethodGet, "/api/compromisos?estado=confirmado", nil, token).
		exigir(http.StatusOK).en(&tablero)
	if len(tablero) != 1 || tablero[0].ID != turno.ID {
		t.Fatalf("tablero de confirmados: esperaba sólo %s, obtuvo %d resultado(s): %+v",
			turno.ID, len(tablero), tablero)
	}
	igual(t, tablero[0].Estado, model.EstadoConfirmado, "estado en el tablero")

	// Y no aparece entre los pendientes.
	var pendientes []dto.CompromisoResponse
	hacer(t, http.MethodGet, "/api/compromisos?estado=pendiente", nil, token).
		exigir(http.StatusOK).en(&pendientes)
	igual(t, len(pendientes), 0, "pendientes tras confirmar")

	// Saltarse en_curso está prohibido: la máquina de estados vive en el core.
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "completado",
	}, token).exigir(http.StatusConflict)

	var enCurso dto.CompromisoResponse
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "en_curso",
	}, token).exigir(http.StatusOK).en(&enCurso)
	igual(t, enCurso.Estado, model.EstadoEnCurso, "estado tras arrancar la consulta")

	var completado dto.CompromisoResponse
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "completado",
	}, token).exigir(http.StatusOK).en(&completado)
	igual(t, completado.Estado, model.EstadoCompletado, "estado final")
	if completado.CerradoEn == nil {
		t.Error("completado es terminal: tiene que sellar cerrado_en")
	}

	// Terminal es terminal.
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "cancelado",
	}, token).exigir(http.StatusConflict)

	var cerrados []dto.CompromisoResponse
	hacer(t, http.MethodGet, "/api/compromisos?estado=completado", nil, token).
		exigir(http.StatusOK).en(&cerrados)
	if len(cerrados) != 1 || cerrados[0].ID != turno.ID {
		t.Fatalf("tablero de completados: esperaba %s, obtuvo %+v", turno.ID, cerrados)
	}

	// ── 9. La agenda del día (W2-A) ─────────────────────────────────────────
	t.Run("agenda", func(t *testing.T) {
		exigirW2A(t, http.MethodGet, "/api/agenda")

		var agenda dto.AgendaResponse
		hacer(t, http.MethodGet, "/api/agenda?fecha="+lunes.Format("2006-01-02"), nil, token).
			exigir(http.StatusOK).en(&agenda)

		igual(t, agenda.Fecha, lunes.Format("2006-01-02"), "fecha de la agenda")
		igual(t, agenda.Timezone, tzNegocio, "timezone de la agenda")
		igual(t, len(agenda.SinRecurso), 0, "compromisos sin recurso asignado")

		if len(agenda.Recursos) != 1 {
			t.Fatalf("recursos en la agenda: esperaba 1, obtuvo %d", len(agenda.Recursos))
		}
		col := agenda.Recursos[0]
		igual(t, col.RecursoID, recurso.ID, "recurso de la agenda")
		igual(t, col.RecursoNombre, "Dra. Gómez", "nombre del profesional")
		if len(col.Horarios) != 1 {
			t.Fatalf("franjas declaradas del lunes: esperaba 1, obtuvo %+v", col.Horarios)
		}
		if !strings.HasPrefix(col.Horarios[0].Desde, "09:00") || !strings.HasPrefix(col.Horarios[0].Hasta, "13:00") {
			t.Errorf("franja del lunes: esperaba 09:00–13:00, obtuvo %s–%s",
				col.Horarios[0].Desde, col.Horarios[0].Hasta)
		}

		if len(col.Turnos) != 1 {
			t.Fatalf("turnos del día: esperaba 1, obtuvo %d", len(col.Turnos))
		}
		c := col.Turnos[0]
		igual(t, c.CompromisoID, turno.ID, "turno en la agenda")
		igual(t, c.Tipo, model.CompromisoTurno, "tipo del turno en la agenda")
		igual(t, c.Estado, model.EstadoCompletado, "estado del turno en la agenda")
		igual(t, c.ClienteID, cliente.ID, "paciente del turno")
		igual(t, c.ClienteTelefono, sesion, "teléfono del paciente en la agenda")
		if c.ClienteNombre == nil || *c.ClienteNombre != "Juana Pérez" {
			t.Errorf("nombre del paciente en la agenda: esperaba Juana Pérez, obtuvo %v", c.ClienteNombre)
		}
		if !strings.HasSuffix(c.Inicio, offsetNegocio) {
			t.Errorf("inicio en la agenda %q no está en %s", c.Inicio, tzNegocio)
		}
		// Atendido pero todavía sin cobrar: el panel dibuja el botón "Cobrar"
		// con esto, sin preguntar por cada turno (E9/W5-C).
		if c.Cobrado {
			t.Error("el turno no se cobró: la agenda no puede decir que sí")
		}
		if c.ComprobanteEstado != nil {
			t.Errorf("sin cobro no hay comprobante: %v", *c.ComprobanteEstado)
		}
	})
}
