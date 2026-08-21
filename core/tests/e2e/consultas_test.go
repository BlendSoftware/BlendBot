package e2e

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/worker"
)

// crearCliente da de alta un cliente del tenant del token por HTTP.
func crearClienteHTTP(t *testing.T, token, telefono, nombre string) model.Cliente {
	t.Helper()
	var c model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": telefono,
		"nombre":   nombre,
	}, token).exigir(http.StatusCreated).en(&c)
	return c
}

// setWaPhoneID le pone un wa_phone_id al negocio por INSERT directo: sin él el
// gateway no tiene a qué número de la plataforma mandar, y el aviso no se encola.
func setWaPhoneID(t *testing.T, negocioID, waPhoneID string) {
	t.Helper()
	wa := waPhoneID
	if err := env.DB.Model(&model.Negocio{}).
		Where("id = ?", negocioID).
		Update("wa_phone_id", &wa).Error; err != nil {
		t.Fatalf("set wa_phone_id: %v", err)
	}
}

// TestConsultasPorHTTP recorre el inbox de preguntas: el agente la deja, el
// dueño la lista y responde (y eso le encola un WhatsApp al cliente). De paso
// exige el aislamiento y los permisos por rol.
func TestConsultasPorHTTP(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	negocioID, token := negocioListo(t, admin.AccessToken, "Burger Gómez", "gomez")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Pizza Ruiz", "ruiz")
	setWaPhoneID(t, negocioID, "5490000000001")

	cliente := crearClienteHTTP(t, token, "5492611000090", "Juana Pérez")

	// El agente (token cop_) deja la consulta: es lo único de consultas que puede.
	tokenAgente := rotarTokenAgente(t, admin.AccessToken, negocioID)
	var creada dto.ConsultaResponse
	hacer(t, http.MethodPost, "/api/consultas", map[string]any{
		"cliente_id": cliente.ID,
		"pregunta":   "¿Tienen opciones sin TACC?",
	}, tokenAgente).exigir(http.StatusCreated).en(&creada)
	noVacio(t, creada.ID, "id de la consulta")
	igual(t, creada.Estado, model.ConsultaPendiente, "estado inicial")
	igual(t, creada.Pregunta, "¿Tienen opciones sin TACC?", "pregunta")
	igual(t, creada.Telefono, "5492611000090", "teléfono congelado en la consulta")
	if creada.ClienteNombre == nil || *creada.ClienteNombre != "Juana Pérez" {
		t.Errorf("nombre del cliente en la consulta: esperaba Juana Pérez, obtuvo %v", creada.ClienteNombre)
	}
	if creada.Respuesta != nil {
		t.Error("una consulta nueva no puede venir ya respondida")
	}

	// El agente NO puede listar ni responder: sólo dejar. Su allowlist lo corta.
	hacer(t, http.MethodGet, "/api/consultas", nil, tokenAgente).exigir(http.StatusForbidden)
	hacer(t, http.MethodPatch, "/api/consultas/"+creada.ID+"/responder",
		map[string]any{"respuesta": "sí"}, tokenAgente).exigir(http.StatusForbidden)

	// El dueño la ve en el inbox.
	var pendientes []dto.ConsultaResponse
	hacer(t, http.MethodGet, "/api/consultas?estado=pendiente", nil, token).
		exigir(http.StatusOK).en(&pendientes)
	igual(t, len(pendientes), 1, "pendientes del negocio")
	igual(t, pendientes[0].ID, creada.ID, "la consulta pendiente")

	// El otro negocio no ve nada.
	var colaAjena []dto.ConsultaResponse
	hacer(t, http.MethodGet, "/api/consultas", nil, tokenAjeno).
		exigir(http.StatusOK).en(&colaAjena)
	igual(t, len(colaAjena), 0, "el otro negocio no ve esta consulta")

	// Responder desde el token ajeno es 404: no existe para ese tenant.
	hacer(t, http.MethodPatch, "/api/consultas/"+creada.ID+"/responder",
		map[string]any{"respuesta": "sí, tenemos"}, tokenAjeno).exigir(http.StatusNotFound)

	// El dueño responde: marca respondida y ENCOLA el aviso al cliente.
	var respondida dto.ConsultaResponse
	hacer(t, http.MethodPatch, "/api/consultas/"+creada.ID+"/responder",
		map[string]any{"respuesta": "Sí, la hamburguesa de garbanzos es sin TACC."}, token).
		exigir(http.StatusOK).en(&respondida)
	igual(t, respondida.Estado, model.ConsultaRespondida, "estado tras responder")
	if respondida.Respuesta == nil || *respondida.Respuesta == "" {
		t.Fatalf("la respuesta no volvió en el cuerpo: %+v", respondida)
	}
	if respondida.RespondidaEn == nil {
		t.Error("respondida_en tiene que quedar sellada")
	}

	// El aviso quedó en la cola de salidas de WhatsApp (texto, al teléfono del
	// cliente, con el wa_phone_id del negocio).
	msgs, err := rdb.LRange(context.Background(), worker.ColaSalidas, 0, -1).Result()
	if err != nil {
		t.Fatalf("leer la cola de salidas: %v", err)
	}
	igual(t, len(msgs), 1, "mensajes encolados tras responder")
	var m worker.MensajeSalida
	if err := json.Unmarshal([]byte(msgs[0]), &m); err != nil {
		t.Fatalf("mensaje de salida inválido: %v — %s", err, msgs[0])
	}
	igual(t, m.Tipo, worker.TipoTexto, "tipo del aviso")
	igual(t, m.Telefono, "5492611000090", "teléfono del aviso")
	igual(t, m.WaPhoneID, "5490000000001", "wa_phone_id del aviso")
	igual(t, m.Texto, "Sobre tu consulta: Sí, la hamburguesa de garbanzos es sin TACC.", "texto del aviso")

	// Ya respondida: el filtro pendiente queda vacío.
	var pend2 []dto.ConsultaResponse
	hacer(t, http.MethodGet, "/api/consultas?estado=pendiente", nil, token).
		exigir(http.StatusOK).en(&pend2)
	igual(t, len(pend2), 0, "no quedan pendientes")
}

// TestConsultasPermisoOperador exige la matriz de roles: el operador ve el inbox
// pero no puede crear ni responder (contrato: crear = agente/dueño, responder =
// dueño).
func TestConsultasPermisoOperador(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	negocioID, token := negocioListo(t, admin.AccessToken, "Burger Gómez", "gomez")
	tokenOperador := crearOperador(t, negocioID, "operador-gomez")

	cliente := crearClienteHTTP(t, token, "5492611000091", "Pedro")

	// El operador puede listar.
	hacer(t, http.MethodGet, "/api/consultas", nil, tokenOperador).exigir(http.StatusOK)

	// Pero no puede crear…
	hacer(t, http.MethodPost, "/api/consultas", map[string]any{
		"cliente_id": cliente.ID,
		"pregunta":   "¿algo?",
	}, tokenOperador).exigir(http.StatusForbidden)

	// El dueño sí crea.
	var creada dto.ConsultaResponse
	hacer(t, http.MethodPost, "/api/consultas", map[string]any{
		"cliente_id": cliente.ID,
		"pregunta":   "¿algo?",
	}, token).exigir(http.StatusCreated).en(&creada)

	// …y el operador tampoco puede responder.
	hacer(t, http.MethodPatch, "/api/consultas/"+creada.ID+"/responder",
		map[string]any{"respuesta": "sí"}, tokenOperador).exigir(http.StatusForbidden)
}
