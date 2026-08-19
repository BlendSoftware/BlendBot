package e2e

import (
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// TestListaEsperaPorHTTP recorre el ABM de la cola contra el router real y, de
// paso, exige el aislamiento: el anotado de un consultorio no se lista, ni se
// borra, desde el token de otro.
func TestListaEsperaPorHTTP(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Consultorio Ruiz", "ruiz")

	servicio := crearServicio(t, token, "Consulta", 30, 15000)

	var cliente model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": "5492611000050",
		"nombre":   "Juana Pérez",
	}, token).exigir(http.StatusCreated).en(&cliente)

	// Anotarse.
	var anotado dto.ListaEsperaResponse
	hacer(t, http.MethodPost, "/api/lista-espera", map[string]any{
		"cliente_id":  cliente.ID,
		"servicio_id": servicio.ID,
		"nota":        "cualquier horario de mañana",
	}, token).exigir(http.StatusCreated).en(&anotado)
	noVacio(t, anotado.ID, "id del anotado")
	igual(t, anotado.ServicioID, servicio.ID, "servicio del anotado")
	if anotado.NotificadoEn != nil {
		t.Error("un anotado nuevo no puede venir ya notificado")
	}
	// El panel muestra gente, no UUIDs: el alta ya vuelve con los nombres
	// resueltos, igual que el listado (E9/W5-C).
	igual(t, anotado.ServicioNombre, "Consulta", "nombre del servicio en el alta")
	igual(t, anotado.ClienteTelefono, "5492611000050", "teléfono del cliente en el alta")
	if anotado.ClienteNombre == nil || *anotado.ClienteNombre != "Juana Pérez" {
		t.Errorf("nombre del cliente en el alta: esperaba Juana Pérez, obtuvo %v", anotado.ClienteNombre)
	}

	// Listar: sólo el propio.
	var cola []dto.ListaEsperaResponse
	hacer(t, http.MethodGet, "/api/lista-espera", nil, token).
		exigir(http.StatusOK).en(&cola)
	igual(t, len(cola), 1, "tamaño de la cola del negocio")
	igual(t, cola[0].ServicioNombre, "Consulta", "nombre del servicio en la cola")
	if cola[0].ClienteNombre == nil || *cola[0].ClienteNombre != "Juana Pérez" {
		t.Errorf("nombre del cliente en la cola: esperaba Juana Pérez, obtuvo %v", cola[0].ClienteNombre)
	}

	var colaAjena []dto.ListaEsperaResponse
	hacer(t, http.MethodGet, "/api/lista-espera", nil, tokenAjeno).
		exigir(http.StatusOK).en(&colaAjena)
	igual(t, len(colaAjena), 0, "el otro consultorio no ve esta cola")

	// El cliente de otro tenant no se puede anotar acá: es un 404, no un 500.
	hacer(t, http.MethodPost, "/api/lista-espera", map[string]any{
		"cliente_id":  cliente.ID,
		"servicio_id": servicio.ID,
	}, tokenAjeno).exigir(http.StatusNotFound)

	// Borrar desde el token ajeno tampoco.
	hacer(t, http.MethodDelete, "/api/lista-espera/"+anotado.ID, nil, tokenAjeno).
		exigir(http.StatusNotFound)

	hacer(t, http.MethodDelete, "/api/lista-espera/"+anotado.ID, nil, token).
		exigir(http.StatusNoContent)
	hacer(t, http.MethodDelete, "/api/lista-espera/"+anotado.ID, nil, token).
		exigir(http.StatusNotFound)
}
