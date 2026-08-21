package e2e

import (
	"net/http"
	"testing"
	"time"

	"copiloto/core/internal/dto"

	"github.com/shopspring/decimal"
)

// TestJornadaAbrirYCerrar recorre la caja del día: se abre, no se puede abrir
// dos veces, se cierra, y cerrar sin nada abierto no rompe nada. Con el
// aislamiento de tenant pegado, que es lo único que no puede fallar.
func TestJornadaAbrirYCerrar(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodPost, "/api/jornada/abrir")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	_, token := negocioListo(t, admin.AccessToken, "Burger House", "burger")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Pizza Nostra", "pizza")

	// Recién dado de alta, la caja está cerrada.
	var actual dto.JornadaActualResponse
	hacer(t, http.MethodGet, "/api/jornada/actual", nil, token).
		exigir(http.StatusOK).en(&actual)
	igual(t, actual.Abierta, false, "sin abrir, la caja está cerrada")
	if actual.Jornada != nil {
		t.Fatalf("sin jornada abierta, jornada tiene que venir null: %+v", actual.Jornada)
	}

	// Abrir el día.
	var abierta dto.JornadaResponse
	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).
		exigir(http.StatusCreated).en(&abierta)
	igual(t, abierta.Abierta, true, "recién abierta, la jornada está abierta")
	noVacio(t, abierta.ID, "id de la jornada")

	// Y ahora la actual es esa.
	var actual2 dto.JornadaActualResponse
	hacer(t, http.MethodGet, "/api/jornada/actual", nil, token).
		exigir(http.StatusOK).en(&actual2)
	igual(t, actual2.Abierta, true, "la caja quedó abierta")
	if actual2.Jornada == nil || actual2.Jornada.ID != abierta.ID {
		t.Fatalf("la jornada actual tiene que ser la que se abrió: %+v", actual2.Jornada)
	}

	// Abrir dos veces no abre dos cajas.
	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).
		exigir(http.StatusConflict)

	// El negocio de al lado sigue con la caja cerrada: la jornada es del tenant.
	var ajeno dto.JornadaActualResponse
	hacer(t, http.MethodGet, "/api/jornada/actual", nil, tokenAjeno).
		exigir(http.StatusOK).en(&ajeno)
	igual(t, ajeno.Abierta, false, "la jornada de un negocio no abre la del otro")

	// Cerrar el día.
	var cerrada dto.JornadaResponse
	hacer(t, http.MethodPost, "/api/jornada/cerrar", nil, token).
		exigir(http.StatusOK).en(&cerrada)
	igual(t, cerrada.Abierta, false, "cerrada, la jornada ya no está abierta")
	if cerrada.CerradaEn == nil {
		t.Fatal("una jornada cerrada tiene cerrada_en")
	}

	// Y la actual vuelve a ser "cerrada".
	var actual3 dto.JornadaActualResponse
	hacer(t, http.MethodGet, "/api/jornada/actual", nil, token).
		exigir(http.StatusOK).en(&actual3)
	igual(t, actual3.Abierta, false, "después de cerrar, no hay caja abierta")

	// Cerrar sin nada abierto es un 409, no un 500.
	hacer(t, http.MethodPost, "/api/jornada/cerrar", nil, token).
		exigir(http.StatusConflict)

	// Se puede abrir de nuevo (otro turno del mismo día, otra caja).
	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).
		exigir(http.StatusCreated)
}

// TestCierreCuentaLoVendido es el bug del dueño: el cierre sólo miraba lo
// facturado por ARCA, así que lo entregado sin cobrar por el panel no aparecía.
// Ahora "vendido" cuenta lo completado del día, se haya cobrado o no.
func TestCierreCuentaLoVendido(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodGet, "/api/cierre")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	_, token := negocioListo(t, admin.AccessToken, "Burger House", "burger")

	servicio := crearServicio(t, token, "Doble cheddar", 30, 10000)

	// Dos pedidos entregados (completados) de 10000 cada uno.
	uno := turnoAtendido(t, token, servicio.ID, "5492611000100", "")
	turnoAtendido(t, token, servicio.ID, "5492611000101", "")

	// Sólo uno se cobra por el panel: el otro se entregó y punto.
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": uno.ID, "medio_pago": "efectivo",
	}, token).exigir(http.StatusCreated)

	hoy := time.Now().In(zonaNegocio(t)).Format("2006-01-02")

	var cierre dto.CierreResponse
	hacer(t, http.MethodGet, "/api/cierre?fecha="+hoy, nil, token).
		exigir(http.StatusOK).en(&cierre)

	igual(t, cierre.Completados, 2, "entregados del día")
	// Lo vendido es lo entregado, aunque sólo se haya cobrado la mitad.
	if !cierre.Vendido.Equal(decimal.RequireFromString("20000")) {
		t.Errorf("vendido del día: esperaba 20000 (los dos entregados), obtuvo %s", cierre.Vendido)
	}
	if !cierre.TotalCobrado.Equal(decimal.RequireFromString("10000")) {
		t.Errorf("cobrado del día: esperaba 10000 (uno solo), obtuvo %s", cierre.TotalCobrado)
	}
}

// TestReportesPorRango: el informe por día que el panel dibuja debajo del
// cierre. Semanal son 7 días, mensual 30, cada uno con lo vendido y lo cobrado,
// y todo tenant-scoped.
func TestReportesPorRango(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodGet, "/api/reportes")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	_, token := negocioListo(t, admin.AccessToken, "Burger House", "burger")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Pizza Nostra", "pizza")

	servicio := crearServicio(t, token, "Doble cheddar", 30, 15000)
	uno := turnoAtendido(t, token, servicio.ID, "5492611000110", "")
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": uno.ID, "medio_pago": "qr",
	}, token).exigir(http.StatusCreated)

	hoy := time.Now().In(zonaNegocio(t)).Format("2006-01-02")

	var semanal dto.ReporteResponse
	hacer(t, http.MethodGet, "/api/reportes?rango=semanal", nil, token).
		exigir(http.StatusOK).en(&semanal)
	igual(t, semanal.Rango, "semanal", "rango del informe")
	igual(t, len(semanal.Dias), 7, "el informe semanal trae los 7 días, ceros incluidos")
	igual(t, semanal.Hasta, hoy, "el informe llega hasta hoy")
	if !semanal.TotalVendido.Equal(decimal.RequireFromString("15000")) {
		t.Errorf("total vendido de la semana: esperaba 15000, obtuvo %s", semanal.TotalVendido)
	}
	if !semanal.TotalCobrado.Equal(decimal.RequireFromString("15000")) {
		t.Errorf("total cobrado de la semana: esperaba 15000, obtuvo %s", semanal.TotalCobrado)
	}
	// El último día de la serie es hoy y trae la venta.
	ultimo := semanal.Dias[len(semanal.Dias)-1]
	igual(t, ultimo.Fecha, hoy, "el último día del informe es hoy")
	if !ultimo.Vendido.Equal(decimal.RequireFromString("15000")) {
		t.Errorf("vendido de hoy en el informe: esperaba 15000, obtuvo %s", ultimo.Vendido)
	}

	// Mensual: la misma serie, más larga.
	var mensual dto.ReporteResponse
	hacer(t, http.MethodGet, "/api/reportes?rango=mensual", nil, token).
		exigir(http.StatusOK).en(&mensual)
	igual(t, len(mensual.Dias), 30, "el informe mensual trae 30 días")

	// Un rango que no existe se rechaza.
	hacer(t, http.MethodGet, "/api/reportes?rango=anual", nil, token).
		exigir(http.StatusUnprocessableEntity)
	hacer(t, http.MethodGet, "/api/reportes", nil, token).
		exigir(http.StatusUnprocessableEntity)

	// El negocio de al lado no ve ni un peso del otro.
	var ajeno dto.ReporteResponse
	hacer(t, http.MethodGet, "/api/reportes?rango=semanal", nil, tokenAjeno).
		exigir(http.StatusOK).en(&ajeno)
	if !ajeno.TotalVendido.IsZero() || !ajeno.TotalCobrado.IsZero() {
		t.Errorf("el informe del otro negocio trae plata ajena: %+v", ajeno)
	}
}
