package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"copiloto/core/internal/dto"
)

// Tests de la capability `hora-local`.
//
// El bug que los origina: localizar la hora era opt-in —`EnTimezone` existía
// una sola vez, en `CompromisoResponse`, llamado desde dos lugares— y seis de
// siete endpoints con timestamps salían en la TZ del proceso, que en el
// contenedor es UTC. Una consulta hecha 22:48 en Mendoza se leía 01:48 del día
// siguiente.
//
// Lo que estos tests protegen no es el arreglo de esos seis: es que el séptimo
// no pueda nacer mal.

// rfc3339EnZ encuentra timestamps serializados en UTC dentro de un JSON
// cualquiera. Se busca sobre el cuerpo crudo y no sobre structs tipados a
// propósito: un campo nuevo que alguien agregue mañana entra en el barrido sin
// que nadie tenga que acordarse de sumarlo a una lista.
var rfc3339EnZ = regexp.MustCompile(`"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z"`)

// exigirSinZ falla si el cuerpo trae alguna hora en UTC.
func exigirSinZ(t *testing.T, r respuesta, que string) {
	t.Helper()
	if m := rfc3339EnZ.FindAllString(string(r.Cuerpo), -1); len(m) > 0 {
		t.Errorf("%s devolvió %d hora(s) en UTC: %s\n  cuerpo: %s",
			que, len(m), strings.Join(m, ", "), string(r.Cuerpo))
	}
}

// TestNingunaRutaDeNegocioDevuelveHorasEnUTC es el barrido: recorre el producto
// entero dejando rastro en cada tabla que guarda un timestamp, y después releé
// cada endpoint exigiendo que ninguno mande `Z`.
//
// Es la versión ejecutable de `openspec/changes/la-hora-del-negocio/medicion.sh`,
// que al abrir el cambio daba 6 mal y 3 bien.
func TestNingunaRutaDeNegocioDevuelveHorasEnUTC(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	negocioID, token := negocioListo(t, admin.AccessToken, "Parrilla Husos", "duenio-husos")
	_ = negocioID

	// ── Dejar rastro en cada tabla con timestamps ────────────────────────
	var cliente struct {
		ID string `json:"id"`
	}
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": "+5491168429999", "nombre": "Marcela Husos",
	}, token).exigir(http.StatusCreated).en(&cliente)

	hacer(t, http.MethodPost, "/api/jornada/abrir", nil, token).exigir(http.StatusCreated)

	hacer(t, http.MethodPost, "/api/consultas", map[string]any{
		"cliente_id": cliente.ID, "pregunta": "¿hacen sin TACC?",
	}, token).exigir(http.StatusCreated)

	var insumo struct {
		ID string `json:"id"`
	}
	hacer(t, http.MethodPost, "/api/insumos", map[string]any{
		"nombre": "Carne", "unidad": "g", "stock_inicial": 10000,
	}, token).exigir(http.StatusCreated).en(&insumo)
	hacer(t, http.MethodPost, "/api/insumos/"+insumo.ID+"/compras", map[string]any{
		"cantidad": 5000,
	}, token).exigir(http.StatusOK)

	servicio := crearServicio(t, token, "Bife", 0, 18500)
	var pedido dto.CompromisoResponse
	hacer(t, http.MethodPost, "/api/compromisos", map[string]any{
		"cliente_id": cliente.ID, "tipo": "pedido", "origen": "whatsapp", "entrega": "retira",
		"lineas": []map[string]any{{"servicio_id": servicio.ID, "cantidad": 1}},
	}, token).exigir(http.StatusCreated).en(&pedido)

	for _, estado := range []string{"confirmado", "en_curso", "listo", "completado"} {
		hacer(t, http.MethodPatch, "/api/compromisos/"+pedido.ID+"/estado",
			map[string]any{"estado": estado}, token).exigir(http.StatusOK)
	}
	hacer(t, http.MethodPost, "/api/cobros", map[string]any{
		"compromiso_id": pedido.ID, "medio_pago": "efectivo",
	}, token).exigir(http.StatusCreated)

	// ── El barrido ───────────────────────────────────────────────────────
	rutas := []string{
		"/api/compromisos",
		"/api/compromisos/" + pedido.ID,
		"/api/consultas",
		"/api/clientes",
		"/api/jornada/actual",
		"/api/insumos/" + insumo.ID + "/movimientos",
		"/api/cobros/" + pedido.ID,
		"/api/lista-espera",
	}
	for _, ruta := range rutas {
		t.Run(ruta, func(t *testing.T) {
			r := hacer(t, http.MethodGet, ruta, nil, token).exigir(http.StatusOK)
			exigirSinZ(t, r, ruta)
		})
	}
}

// TestLaHoraDePAredEsLaDelNegocio comprueba que no sólo cambió el sufijo del
// string sino el número que una persona lee. Sin esto, mandar el instante
// correcto con el offset pegado al final pasaría igual el barrido.
func TestLaHoraDeParedEsLaDelNegocio(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	_, token := negocioListo(t, admin.AccessToken, "Parrilla Pared", "duenio-pared")

	antes := time.Now().In(zonaNegocio(t))

	var cliente struct {
		ID string `json:"id"`
	}
	hacer(t, http.MethodPost, "/api/clientes", map[string]any{
		"telefono": "+5491168428888",
	}, token).exigir(http.StatusCreated).en(&cliente)

	var lista []dto.ClienteResumen
	hacer(t, http.MethodGet, "/api/clientes", nil, token).exigir(http.StatusOK).en(&lista)
	if len(lista) == 0 {
		t.Fatal("el listado de clientes vino vacío")
	}

	creado := lista[0].CreadoEn
	if _, offset := creado.Time().Zone(); offset != -3*3600 {
		t.Errorf("offset %d; esperaba -10800 (%s)", offset, offsetNegocio)
	}
	// La hora de pared tiene que estar en el mismo día y hora que el reloj del
	// negocio, no tres horas adelante.
	if h := creado.Time().Hour(); h != antes.Hour() && h != antes.Add(time.Minute).Hour() {
		t.Errorf("hora de pared %02d; el reloj del negocio marcaba %02d — se corrió el huso",
			h, antes.Hour())
	}
	if d := creado.Time().Day(); d != antes.Day() {
		t.Errorf("día %d; el negocio está en el %d — el timestamp saltó de día", d, antes.Day())
	}
}

// TestDosNegociosEnHusosDistintosNoSeMezclan: cada dueño ve sus horas en SU
// huso. Es el test que un middleware que resolviera la timezone una sola vez
// para todo el proceso —en vez de por request— no pasaría.
func TestDosNegociosEnHusosDistintosNoSeMezclan(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	// Kolkata tiene offset +05:30: no entero, y del otro lado del meridiano.
	// Un bug de "asumo husos de horas redondas" se ve acá y no con dos zonas
	// argentinas.
	casos := []struct {
		nombre string
		tz     string
		offset int // segundos
	}{
		{"Parrilla Mendoza", tzNegocio, -3 * 3600},
		{"Curry House", "Asia/Kolkata", 5*3600 + 30*60},
	}

	for i, c := range casos {
		var alta dto.AltaNegocioResponse
		hacer(t, http.MethodPost, "/api/admin/negocios", map[string]any{
			"nombre":        c.nombre,
			"vertical":      "gastronomia",
			"timezone":      c.tz,
			"usuario_dueno": fmt.Sprintf("duenio-huso-%d", i),
		}, admin.AccessToken).exigir(http.StatusCreated).en(&alta)

		tmp := login(t, alta.UsuarioDueno.Username, alta.PasswordTemporal)
		hacer(t, http.MethodPost, "/api/auth/cambiar-password",
			map[string]any{"password_nueva": "clave-de-prueba-2026"}, tmp.AccessToken).
			exigir(http.StatusOK)
		sesion := login(t, alta.UsuarioDueno.Username, "clave-de-prueba-2026")

		hacer(t, http.MethodPost, "/api/clientes", map[string]any{
			"telefono": fmt.Sprintf("+54911684277%02d", i),
		}, sesion.AccessToken).exigir(http.StatusCreated)

		var lista []dto.ClienteResumen
		hacer(t, http.MethodGet, "/api/clientes", nil, sesion.AccessToken).
			exigir(http.StatusOK).en(&lista)
		if len(lista) != 1 {
			t.Fatalf("%s: esperaba 1 cliente, hay %d", c.nombre, len(lista))
		}

		if _, offset := lista[0].CreadoEn.Time().Zone(); offset != c.offset {
			t.Errorf("%s (%s): offset %d, esperaba %d — está leyendo el huso de otro negocio",
				c.nombre, c.tz, offset, c.offset)
		}
	}
}

// TestRutasDePlataformaVanEnUTC es el otro lado de la regla (design §4): admin
// lista negocios de husos distintos y no tiene una TZ única de la cual tomar la
// hora. UTC ahí es elegido, no un olvido.
func TestRutasDePlataformaVanEnUTC(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)
	altaNegocio(t, admin.AccessToken, "Negocio Plataforma", "duenio-plataforma")

	r := hacer(t, http.MethodGet, "/api/admin/negocios", nil, admin.AccessToken).
		exigir(http.StatusOK)

	var negocios []map[string]json.RawMessage
	r.en(&negocios)
	if len(negocios) == 0 {
		t.Fatal("el listado de plataforma vino vacío")
	}
	var creado string
	if err := json.Unmarshal(negocios[0]["creado_en"], &creado); err != nil {
		t.Fatalf("creado_en no es string: %s", negocios[0]["creado_en"])
	}
	if !strings.HasSuffix(creado, "Z") {
		t.Errorf("creado_en de plataforma salió en %s; se espera UTC (design §4)", creado)
	}
}

// TestElListadoDePlataformaSeLeeComoSecuencia es el argumento que sostiene la
// decisión de usar UTC en admin: si cada fila se rindiera en su propio huso, un
// negocio dado de alta DESPUÉS podría mostrar una hora de pared ANTERIOR, y la
// columna dejaría de leerse como orden.
func TestElListadoDePlataformaSeLeeComoSecuencia(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	// Primero uno en Kolkata (+05:30), después uno en Mendoza (-03:00). Con
	// husos por fila, el segundo se vería casi nueve horas "antes" que el
	// primero pese a haberse creado después.
	for i, tz := range []string{"Asia/Kolkata", tzNegocio} {
		hacer(t, http.MethodPost, "/api/admin/negocios", map[string]any{
			"nombre":        fmt.Sprintf("Negocio Orden %d", i),
			"vertical":      "gastronomia",
			"timezone":      tz,
			"usuario_dueno": fmt.Sprintf("duenio-orden-%d", i),
		}, admin.AccessToken).exigir(http.StatusCreated)
	}

	var negocios []struct {
		Nombre   string   `json:"nombre"`
		CreadoEn dto.Hora `json:"creado_en"`
	}
	hacer(t, http.MethodGet, "/api/admin/negocios", nil, admin.AccessToken).
		exigir(http.StatusOK).en(&negocios)

	var cero, uno *time.Time
	for i := range negocios {
		v := negocios[i].CreadoEn.Time()
		switch negocios[i].Nombre {
		case "Negocio Orden 0":
			cero = &v
		case "Negocio Orden 1":
			uno = &v
		}
	}
	if cero == nil || uno == nil {
		t.Fatalf("no encontré los dos negocios en el listado (%d filas)", len(negocios))
	}
	// Leídos como hora de pared —que es lo que hace el panel— el orden tiene que
	// coincidir con el orden real de alta.
	paredCero := cero.Format("2006-01-02T15:04:05.000000000")
	paredUno := uno.Format("2006-01-02T15:04:05.000000000")
	if paredCero >= paredUno {
		t.Errorf("la lista no se lee como secuencia: el primero dice %s y el segundo %s",
			paredCero, paredUno)
	}
}
