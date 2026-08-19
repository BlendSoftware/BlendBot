package e2e

import (
	"net/http"
	"testing"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// TestLaAgendaTraeElEstadoDeCobro: el panel dibuja el botón "Cobrar" en cada
// turno completado y refresca la agenda cada quince segundos. Si el estado del
// cobro no viniera con el turno, cada refresco serían N requests más
// (GET /api/cobros/:id por turno). Este test fija ese contrato: la agenda dice
// sola si el turno está cobrado y en qué anda su factura.
func TestLaAgendaTraeElEstadoDeCobro(t *testing.T) {
	nuevoCaso(t)
	exigirW2A(t, http.MethodGet, "/api/agenda")
	exigirW4A(t, http.MethodPost, "/api/cobros")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Consultorio Ruiz", "ruiz")
	cargarFiscal(t, admin.AccessToken, negocioID)

	servicio := crearServicio(t, token, "Consulta", 30, 18500)
	recurso := crearRecurso(t, token, "Dra. Gómez")

	loc := zonaNegocio(t)
	lunes := proximoLunes(t)
	inicio := time.Date(lunes.Year(), lunes.Month(), lunes.Day(), 9, 0, 0, 0, loc)
	dia := lunes.Format("2006-01-02")

	var cliente model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": "5492611000200",
		"nombre":   "Juana Pérez",
	}, token).exigir(http.StatusCreated).en(&cliente)

	var turno dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "turno",
		"origen":     "whatsapp",
		"recurso_id": recurso.ID,
		"inicio":     inicio.Format(time.RFC3339),
		"fin":        inicio.Add(30 * time.Minute).Format(time.RFC3339),
		"lineas":     []map[string]any{{"servicio_id": servicio.ID, "cantidad": 1}},
	}, token).exigir(http.StatusCreated).en(&turno)

	for _, estado := range []string{"confirmado", "en_curso", "completado"} {
		hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
			"estado": estado,
		}, token).exigir(http.StatusOK).en(&turno)
	}

	// ── Antes de cobrar ─────────────────────────────────────────────────────
	antes := turnoDeLaAgenda(t, token, dia, turno.ID)
	if antes.Cobrado {
		t.Error("el turno todavía no se cobró y la agenda dice que sí")
	}
	if antes.ComprobanteEstado != nil {
		t.Errorf("sin cobro no hay comprobante: %v", *antes.ComprobanteEstado)
	}

	// ── Después de cobrar ───────────────────────────────────────────────────
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turno.ID,
		"medio_pago":    "efectivo",
	}, token).exigir(http.StatusCreated)

	despues := turnoDeLaAgenda(t, token, dia, turno.ID)
	if !despues.Cobrado {
		t.Fatal("el turno se cobró y la agenda sigue diciendo que no")
	}
	if despues.ComprobanteEstado == nil {
		t.Fatal("con datos de ARCA cargados el turno cobrado tiene comprobante")
	}
	// El facturador no corre en el e2e: la factura queda esperándolo, que es
	// exactamente lo que el panel cuenta como "Facturando…".
	igual(t, *despues.ComprobanteEstado, model.ComprobantePendiente, "estado del comprobante en la agenda")

	// El LEFT JOIN no puede multiplicar el turno ni traer el cobro de otro.
	igual(t, len(agendaDelDia(t, token, dia).Recursos[0].Turnos), 1, "turnos del día tras el cobro")

	var ajena dto.AgendaResponse
	hacer(t, http.MethodGet, "/api/agenda?fecha="+dia, nil, tokenAjeno).
		exigir(http.StatusOK).en(&ajena)
	for _, col := range ajena.Recursos {
		if len(col.Turnos) > 0 {
			t.Errorf("la agenda del otro consultorio trae turnos ajenos: %+v", col.Turnos)
		}
	}
}

// agendaDelDia pide la agenda del negocio del token.
func agendaDelDia(t *testing.T, token, dia string) dto.AgendaResponse {
	t.Helper()
	var ag dto.AgendaResponse
	hacer(t, http.MethodGet, "/api/agenda?fecha="+dia, nil, token).
		exigir(http.StatusOK).en(&ag)
	return ag
}

// turnoDeLaAgenda busca un compromiso en la agenda del día y corta el test si
// no está: sin él, las aserciones de abajo no dirían nada.
func turnoDeLaAgenda(t *testing.T, token, dia, compromisoID string) dto.TurnoAgenda {
	t.Helper()
	ag := agendaDelDia(t, token, dia)
	for _, col := range ag.Recursos {
		for _, turno := range col.Turnos {
			if turno.CompromisoID == compromisoID {
				return turno
			}
		}
	}
	for _, turno := range ag.SinRecurso {
		if turno.CompromisoID == compromisoID {
			return turno
		}
	}
	t.Fatalf("el turno %s no aparece en la agenda del %s: %+v", compromisoID, dia, ag)
	return dto.TurnoAgenda{}
}
