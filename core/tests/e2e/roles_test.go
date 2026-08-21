package e2e

import (
	"net/http"
	"testing"
	"time"

	"copiloto/core/internal/dto"
)

// TestH8AgenteNoAlcanzaLaPlata: el token del agente (cop_) sólo entra a lo que
// necesita para atender WhatsApp. Cobros, cierre, reportes, jornada, y las
// escrituras de catálogo/horarios le dan 403 — no 401 (está autenticado) ni
// 404 (la ruta existe): es una restricción de permisos.
func TestH8AgenteNoAlcanzaLaPlata(t *testing.T) {
	nuevoCaso(t)
	if !autenticacionDualMontada() {
		t.Skip("pendiente wiring W2-A: AutenticacionDual no está montada")
	}

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, _ := negocioListo(t, admin.AccessToken, "Burger House", "burger.h8")
	tokenAgente := rotarTokenAgente(t, admin.AccessToken, negocioID)

	// ── Lo que el agente SÍ necesita ────────────────────────────────────────
	permitido := []struct {
		metodo, ruta string
	}{
		{http.MethodGet, "/api/negocio"},
		{http.MethodGet, "/api/servicios"},
		{http.MethodGet, "/api/categorias"},
		{http.MethodGet, "/api/recursos"},
		{http.MethodGet, "/api/coberturas"},
	}
	for _, c := range permitido {
		t.Run("permitido "+c.ruta, func(t *testing.T) {
			hacer(t, c.metodo, c.ruta, nil, tokenAgente).exigir(http.StatusOK)
		})
	}

	// ── La plata y las escrituras de config: 403 ────────────────────────────
	unUUID := "00000000-0000-0000-0000-000000000000"
	prohibido := []struct {
		metodo, ruta string
	}{
		{http.MethodPost, "/api/cobros"},
		{http.MethodGet, "/api/cobros/" + unUUID},
		{http.MethodGet, "/api/cierre"},
		{http.MethodGet, "/api/reportes"},
		{http.MethodGet, "/api/jornada/actual"},
		{http.MethodPost, "/api/jornada/abrir"},
		{http.MethodPost, "/api/jornada/cerrar"},
		{http.MethodPost, "/api/servicios"},
		{http.MethodPatch, "/api/servicios/" + unUUID},
		{http.MethodPut, "/api/servicios/" + unUUID + "/precios"}, // escribir precio, no
		{http.MethodPost, "/api/recursos/" + unUUID + "/horarios"},
		{http.MethodGet, "/api/clientes"}, // el padrón entero no es del agente
		{http.MethodGet, "/api/lista-espera"},
	}
	for _, c := range prohibido {
		t.Run("prohibido "+c.metodo+" "+c.ruta, func(t *testing.T) {
			r := hacer(t, c.metodo, c.ruta, nil, tokenAgente).exigir(http.StatusForbidden)
			noVacio(t, r.detalle(), "detalle del 403")
		})
	}
}

// TestH8OperadorNoVeLaPlata: el operador maneja el mostrador (catálogo,
// clientes, agenda) pero la caja es del dueño. Cobros, cierre, reportes y
// jornada le dan 403.
func TestH8OperadorNoVeLaPlata(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodGet, "/api/cierre")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, _ := negocioListo(t, admin.AccessToken, "Burger House", "burger.op")
	tokenOperador := crearOperador(t, negocioID, "cajero.op")

	// El mostrador sí.
	permitido := []string{"/api/servicios", "/api/clientes", "/api/negocio", "/api/categorias"}
	for _, ruta := range permitido {
		t.Run("permitido "+ruta, func(t *testing.T) {
			hacer(t, http.MethodGet, ruta, nil, tokenOperador).exigir(http.StatusOK)
		})
	}

	// La plata no.
	prohibido := []struct {
		metodo, ruta string
	}{
		{http.MethodPost, "/api/cobros"},
		{http.MethodGet, "/api/cierre"},
		{http.MethodGet, "/api/reportes"},
		{http.MethodGet, "/api/jornada/actual"},
		{http.MethodPost, "/api/jornada/abrir"},
	}
	for _, c := range prohibido {
		t.Run("prohibido "+c.metodo+" "+c.ruta, func(t *testing.T) {
			r := hacer(t, c.metodo, c.ruta, nil, tokenOperador).exigir(http.StatusForbidden)
			noVacio(t, r.detalle(), "detalle del 403")
		})
	}
}

// TestH8DuenoVeLaPlata: el 403 del operador y del agente es por el rol, no
// porque la ruta esté rota. El dueño de ese mismo negocio entra a la caja.
func TestH8DuenoVeLaPlata(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodGet, "/api/cierre")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	_, tokenDueno := negocioListo(t, admin.AccessToken, "Burger House", "burger.dueno")

	hoy := time.Now().In(zonaNegocio(t)).Format("2006-01-02")

	var cierre dto.CierreResponse
	hacer(t, http.MethodGet, "/api/cierre?fecha="+hoy, nil, tokenDueno).
		exigir(http.StatusOK).en(&cierre)
	igual(t, cierre.Fecha, hoy, "el dueño lee el cierre de su negocio")

	hacer(t, http.MethodGet, "/api/jornada/actual", nil, tokenDueno).exigir(http.StatusOK)
	hacer(t, http.MethodGet, "/api/reportes?rango=semanal", nil, tokenDueno).exigir(http.StatusOK)
}
