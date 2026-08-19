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

// exigirW4A salta el test si la ruta del cobro todavía no está montada.
// Distinguir "no existe el endpoint" de "el endpoint contestó 404" ahorra media
// hora persiguiendo el bug equivocado (mismo criterio que exigirW2A).
func exigirW4A(t *testing.T, metodo, ruta string) {
	t.Helper()
	if !rutaMontada(metodo, ruta) {
		t.Skipf("pendiente wiring de E8: %s %s no está montada en router.New", metodo, ruta)
	}
}

// cuitDeTest pasa el dígito verificador de ARCA: el core lo valida y un número
// inventado al azar rebotaría con 422.
const cuitDeTest = "20304050609"

// turnoAtendido deja un turno cobrable: cliente, compromiso y la máquina de
// estados hasta completado, todo por HTTP.
func turnoAtendido(t *testing.T, token, servicioID, telefono, documento string) dto.CompromisoResponse {
	t.Helper()

	cuerpoCliente := map[string]any{"telefono": telefono, "nombre": "Juana Pérez"}
	if documento != "" {
		cuerpoCliente["documento"] = documento
	}
	var cliente model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", cuerpoCliente, token).
		exigir(http.StatusCreated).en(&cliente)

	var turno dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "turno",
		"origen":     "whatsapp",
		"lineas":     []map[string]any{{"servicio_id": servicioID, "cantidad": 1}},
	}, token).exigir(http.StatusCreated).en(&turno)

	for _, estado := range []string{"confirmado", "en_curso", "completado"} {
		hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
			"estado": estado,
		}, token).exigir(http.StatusOK).en(&turno)
	}
	return turno
}

// cargarFiscal deja al negocio en condiciones de facturar (sin certificados:
// alcanza para que nazca el comprobante).
func cargarFiscal(t *testing.T, tokenAdmin, negocioID string) {
	t.Helper()
	hacer(t, http.MethodPut, "/api/admin/negocios/"+negocioID+"/fiscal", map[string]any{
		"cuit":         cuitDeTest,
		"razon_social": "Consultorio Gómez",
		"punto_venta":  3,
		"modo":         "homologacion",
	}, tokenAdmin).exigir(http.StatusOK)
}

// TestCobrarPorHTTP recorre el circuito del mostrador: se atiende, se cobra, y
// el cobro queda leíble. Con el doble cobro y el aislamiento de tenant pegados,
// que son las dos formas de que la plata quede mal contada.
func TestCobrarPorHTTP(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodPost, "/api/cobros")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	negocioID, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Consultorio Ruiz", "ruiz")

	// Los datos de ARCA los carga la plataforma, no el dueño.
	cargarFiscal(t, admin.AccessToken, negocioID)

	servicio := crearServicio(t, token, "Consulta", 30, 18500)
	turno := turnoAtendido(t, token, servicio.ID, "5492611000080", "30111222")

	// ── El cobro ────────────────────────────────────────────────────────────
	var cobro dto.CobroResponse
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turno.ID,
		"medio_pago":    "efectivo",
	}, token).exigir(http.StatusCreated).en(&cobro)

	noVacio(t, cobro.ID, "id del cobro")
	igual(t, cobro.CompromisoID, turno.ID, "compromiso del cobro")
	igual(t, cobro.MedioPago, string(model.MedioEfectivo), "medio de pago")
	// El monto NO viaja en el request: sale del total congelado del compromiso.
	if !cobro.Monto.Equal(decimal.RequireFromString("18500")) {
		t.Errorf("monto del cobro: esperaba 18500 (el total del turno), obtuvo %s", cobro.Monto)
	}
	if cobro.Comprobante == nil {
		t.Fatal("con datos de ARCA cargados, el cobro tiene que dejar un comprobante")
	}
	igual(t, cobro.Comprobante.Estado, string(model.ComprobantePendiente), "estado del comprobante")
	igual(t, cobro.Comprobante.TipoCbte, model.TipoCbteFacturaC, "tipo de comprobante (Factura C)")
	igual(t, cobro.Comprobante.PuntoVenta, 3, "punto de venta de la config fiscal")
	noVacio(t, cobro.Facturacion, "frase de facturación para el panel")

	// ── Leerlo después ──────────────────────────────────────────────────────
	var leido dto.CobroResponse
	hacer(t, http.MethodGet, "/api/cobros/"+turno.ID, nil, token).
		exigir(http.StatusOK).en(&leido)
	igual(t, leido.ID, cobro.ID, "el cobro que se lee es el que se hizo")

	// ── Doble cobro ─────────────────────────────────────────────────────────
	repetido := hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turno.ID,
		"medio_pago":    "transferencia",
	}, token).exigir(http.StatusConflict)
	// El panel traduce este detalle a "Este turno ya lo cobraron": si el texto
	// deja de hablar de cobro, la secretaria lee un mensaje genérico.
	if !strings.Contains(strings.ToLower(repetido.detalle()), "cobrad") {
		t.Errorf("el detalle del doble cobro tiene que hablar de cobro: %q", repetido.detalle())
	}

	// ── Aislamiento ─────────────────────────────────────────────────────────
	hacer(t, http.MethodGet, "/api/cobros/"+turno.ID, nil, tokenAjeno).
		exigir(http.StatusNotFound)

	otroServicio := crearServicio(t, tokenAjeno, "Consulta", 30, 9000)
	turnoAjeno := turnoAtendido(t, tokenAjeno, otroServicio.ID, "5492611000081", "")
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turnoAjeno.ID,
		"medio_pago":    "efectivo",
	}, token).exigir(http.StatusNotFound)
}

// TestCobrarSinDatosDeARCA: el consultorio recién dado de alta todavía no cargó
// su CUIT. La caja no se puede frenar por un trámite: se cobra y el response
// explica que no hay factura.
func TestCobrarSinDatosDeARCA(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodPost, "/api/cobros")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	_, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")

	servicio := crearServicio(t, token, "Consulta", 30, 12000)
	turno := turnoAtendido(t, token, servicio.ID, "5492611000085", "")

	var cobro dto.CobroResponse
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turno.ID,
		"medio_pago":    "transferencia",
	}, token).exigir(http.StatusCreated).en(&cobro)

	if cobro.Comprobante != nil {
		t.Errorf("sin config fiscal no hay comprobante: %+v", cobro.Comprobante)
	}
	noVacio(t, cobro.Facturacion, "explicación de por qué no hay factura")
}

// TestNoSeCobraLoQueNoSeAtendio: el botón de cobrar sólo aparece en un turno
// terminado, pero la regla vive en el core y no en el panel.
func TestNoSeCobraLoQueNoSeAtendio(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodPost, "/api/cobros")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")
	cargarFiscal(t, admin.AccessToken, negocioID)

	servicio := crearServicio(t, token, "Consulta", 30, 18500)

	var cliente model.Cliente
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": "5492611000082", "nombre": "Pedro",
	}, token).exigir(http.StatusCreated).en(&cliente)

	var turno dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID,
		"tipo":       "turno",
		"origen":     "whatsapp",
		"lineas":     []map[string]any{{"servicio_id": servicio.ID, "cantidad": 1}},
	}, token).exigir(http.StatusCreated).en(&turno)

	// Pendiente: no se cobra (409, ErrNoCobrable).
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turno.ID,
		"medio_pago":    "efectivo",
	}, token).exigir(http.StatusConflict)

	// Y no quedó nada colgado.
	hacer(t, http.MethodGet, "/api/cobros/"+turno.ID, nil, token).
		exigir(http.StatusNotFound)

	// Un medio de pago que no existe tampoco entra.
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "confirmado",
	}, token).exigir(http.StatusOK)
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "en_curso",
	}, token).exigir(http.StatusOK)
	hacer(t, http.MethodPatch, "/api/compromisos/"+turno.ID+"/estado", map[string]any{
		"estado": "completado",
	}, token).exigir(http.StatusOK)

	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": turno.ID,
		"medio_pago":    "cripto",
	}, token).exigir(http.StatusUnprocessableEntity)
}

// TestCierreDelDiaPorHTTP: los números que el dueño mira antes de apagar la luz.
// Lo del día es del día, y lo del otro consultorio no es de nadie más.
func TestCierreDelDiaPorHTTP(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodGet, "/api/cierre")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")
	_, tokenAjeno := negocioListo(t, admin.AccessToken, "Consultorio Ruiz", "ruiz")
	cargarFiscal(t, admin.AccessToken, negocioID)

	servicio := crearServicio(t, token, "Consulta", 30, 10000)

	uno := turnoAtendido(t, token, servicio.ID, "5492611000090", "")
	dos := turnoAtendido(t, token, servicio.ID, "5492611000091", "")

	for id, medio := range map[string]string{uno.ID: "efectivo", dos.ID: "qr"} {
		hacer(t, http.MethodPost, "/api/cobros", map[string]any{
			"compromiso_id": id, "medio_pago": medio,
		}, token).exigir(http.StatusCreated)
	}

	hoy := time.Now().In(zonaNegocio(t)).Format("2006-01-02")

	var cierre dto.CierreResponse
	hacer(t, http.MethodGet, "/api/cierre?fecha="+hoy, nil, token).
		exigir(http.StatusOK).en(&cierre)

	igual(t, cierre.Fecha, hoy, "fecha del cierre")
	igual(t, cierre.Timezone, tzNegocio, "el cierre se agrega en la zona del negocio")
	igual(t, cierre.Completados, 2, "atendidos del día")
	igual(t, cierre.Cobros, 2, "cobros del día")
	if !cierre.TotalCobrado.Equal(decimal.RequireFromString("20000")) {
		t.Errorf("total cobrado del día: esperaba 20000, obtuvo %s", cierre.TotalCobrado)
	}
	if !cierre.TicketPromedio.Equal(decimal.RequireFromString("10000")) {
		t.Errorf("ticket promedio: esperaba 10000, obtuvo %s", cierre.TicketPromedio)
	}
	if len(cierre.PorMedioPago) != 2 {
		t.Errorf("medios de pago del día: esperaba 2, obtuvo %+v", cierre.PorMedioPago)
	}
	if cierre.PorOrigen[string(model.OrigenWhatsApp)] != 2 {
		t.Errorf("por WhatsApp: esperaba 2, obtuvo %+v", cierre.PorOrigen)
	}
	// Las dos facturas quedaron esperando al facturador, que en el e2e no corre.
	if cierre.Comprobantes.Pendientes != 2 {
		t.Errorf("comprobantes pendientes del día: %+v", cierre.Comprobantes)
	}

	// El consultorio de al lado cerró el día en cero.
	var ajeno dto.CierreResponse
	hacer(t, http.MethodGet, "/api/cierre?fecha="+hoy, nil, tokenAjeno).
		exigir(http.StatusOK).en(&ajeno)
	if ajeno.Cobros != 0 || !ajeno.TotalCobrado.IsZero() || ajeno.Compromisos != 0 {
		t.Errorf("el cierre del otro consultorio trae plata ajena: %+v", ajeno)
	}

	// Sin fecha, hoy. Es lo que pide el panel al abrir la pantalla.
	var sinFecha dto.CierreResponse
	hacer(t, http.MethodGet, "/api/cierre", nil, token).
		exigir(http.StatusOK).en(&sinFecha)
	igual(t, sinFecha.Fecha, hoy, "cierre sin fecha = hoy")

	// Una fecha que no es una fecha se rechaza antes de tocar la base.
	hacer(t, http.MethodGet, "/api/cierre?fecha=ayer", nil, token).
		exigir(http.StatusBadRequest)
}

// TestConfigFiscalEsDeLaPlataformaYNoDevuelveSecretos: los certificados de ARCA
// entran una vez y no vuelven a salir nunca. Que el GET los devolviera sería
// filtrar la identidad fiscal del consultorio por la API.
func TestConfigFiscalEsDeLaPlataformaYNoDevuelveSecretos(t *testing.T) {
	nuevoCaso(t)
	exigirW4A(t, http.MethodPut, "/api/admin/negocios/:id/fiscal")

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, token := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "gomez")

	cuerpo := map[string]any{
		"cuit":         cuitDeTest,
		"razon_social": "Consultorio Gómez",
		"punto_venta":  3,
		"modo":         "homologacion",
		"cert_pem":     "-----BEGIN CERTIFICATE-----\nMIIB-de-prueba\n-----END CERTIFICATE-----",
		"key_pem":      "-----BEGIN PRIVATE KEY-----\nMIIE-de-prueba\n-----END PRIVATE KEY-----",
	}

	// El dueño del consultorio no toca esto.
	hacer(t, http.MethodPut, "/api/admin/negocios/"+negocioID+"/fiscal", cuerpo, token).
		exigir(http.StatusForbidden)

	var guardada dto.ConfigFiscalResponse
	hacer(t, http.MethodPut, "/api/admin/negocios/"+negocioID+"/fiscal", cuerpo, admin.AccessToken).
		exigir(http.StatusOK).en(&guardada)
	igual(t, guardada.TieneCertificados, true, "el par de PEM quedó cargado")
	igual(t, guardada.PuntoVenta, 3, "punto de venta")

	leido := hacer(t, http.MethodGet, "/api/admin/negocios/"+negocioID+"/fiscal", nil, admin.AccessToken).
		exigir(http.StatusOK)

	crudo := string(leido.Cuerpo)
	for _, secreto := range []string{"BEGIN PRIVATE KEY", "MIIE-de-prueba", "MIIB-de-prueba", "cert_pem", "key_pem"} {
		if strings.Contains(crudo, secreto) {
			t.Fatalf("la config fiscal devolvió un secreto (%q): %s", secreto, crudo)
		}
	}
	if !strings.Contains(crudo, cuitDeTest) {
		t.Errorf("la config fiscal tiene que devolver el CUIT: %s", crudo)
	}

	// Un CUIT con el dígito verificador mal no se guarda: si entrara, la
	// primera factura quedaría en error y el paciente ya se fue.
	hacer(t, http.MethodPut, "/api/admin/negocios/"+negocioID+"/fiscal", map[string]any{
		"cuit": "20304050607",
	}, admin.AccessToken).exigir(http.StatusUnprocessableEntity)

	// Y un PUT sin certificados no borra los que ya estaban.
	var reconfigurada dto.ConfigFiscalResponse
	hacer(t, http.MethodPut, "/api/admin/negocios/"+negocioID+"/fiscal", map[string]any{
		"cuit":        cuitDeTest,
		"punto_venta": 4,
	}, admin.AccessToken).exigir(http.StatusOK).en(&reconfigurada)
	igual(t, reconfigurada.TieneCertificados, true, "los certificados sobreviven a un PUT sin PEM")
	igual(t, reconfigurada.PuntoVenta, 4, "punto de venta actualizado")
}
