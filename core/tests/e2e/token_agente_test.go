package e2e

import (
	"net/http"
	"strings"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// rotarTokenAgente pide un token nuevo para el negocio. Acepta 200 o 201: la
// rotación siempre devuelve un token nuevo y el contrato no fija cuál de los
// dos status usa.
func rotarTokenAgente(t *testing.T, tokenAdmin, negocioID string) string {
	t.Helper()
	r := hacer(t, http.MethodPost, "/api/admin/negocios/"+negocioID+"/token-agente", nil, tokenAdmin)
	if r.Status != http.StatusOK && r.Status != http.StatusCreated {
		t.Fatalf("rotar token de %s: esperaba 200 o 201, obtuvo %d — cuerpo: %s",
			negocioID, r.Status, string(r.Cuerpo))
	}
	var resp dto.TokenAgenteResponse
	r.en(&resp)
	igual(t, resp.NegocioID, negocioID, "negocio del token rotado")
	// El token en claro viaja UNA sola vez: en la base queda sólo su sha256.
	if !strings.HasPrefix(resp.Token, "cop_") || len(resp.Token) <= len("cop_") {
		t.Fatalf("el token del agente tiene que arrancar con cop_ y traer cuerpo: %q", resp.Token)
	}
	return resp.Token
}

// TestTokenDeAgente cubre lo que hace posible que el agente MCP hable con el
// core sin un usuario humano: un token propio del negocio, revocable, que no
// puede ver un milímetro fuera de su tenant.
func TestTokenDeAgente(t *testing.T) {
	nuevoCaso(t)
	exigirW2A(t, http.MethodPost, "/api/admin/negocios/:id/token-agente")
	if !autenticacionDualMontada() {
		t.Skip("pendiente wiring W2-A: middleware.AutenticacionDual no está en el grupo protegido " +
			"(se infiere de que GET /api/negocio no está montada)")
	}

	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	negocioA, duenaA := negocioListo(t, admin.AccessToken, "Consultorio A", "dueno.a")
	negocioB, duenoB := negocioListo(t, admin.AccessToken, "Consultorio B", "dueno.b")

	var coberturaA model.Cobertura
	hacer(t, http.MethodPost, "/api/coberturas", map[string]any{"nombre": "OSDE"}, duenaA).
		exigir(http.StatusCreated).en(&coberturaA)

	servicioA := crearServicio(t, duenaA, "Consulta A", 30, 8500)
	servicioB := crearServicio(t, duenoB, "Consulta B", 45, 12000)

	tokenA := rotarTokenAgente(t, admin.AccessToken, negocioA)

	// ── El agente lee los datos de SU negocio ───────────────────────────────
	t.Run("datos del negocio", func(t *testing.T) {
		var n dto.NegocioDatosResponse
		hacer(t, http.MethodGet, "/api/negocio", nil, tokenA).exigir(http.StatusOK).en(&n)

		igual(t, n.Nombre, "Consultorio A", "nombre del negocio")
		igual(t, n.Vertical, model.VerticalSalud, "vertical del negocio")
		igual(t, n.Timezone, tzNegocio, "timezone del negocio")
		if len(n.Coberturas) != 1 || n.Coberturas[0].Nombre != "OSDE" {
			t.Errorf("coberturas del negocio: esperaba [OSDE], obtuvo %+v", n.Coberturas)
		}
		igual(t, n.ID, negocioA, "id del negocio")
		// La ficha del agente no expone nada de la plataforma (wa_phone_id y
		// compañía): config viaja, pero como JSON del negocio y nada más.
		if len(n.Config) == 0 {
			t.Error("config del negocio: esperaba al menos {}")
		}
	})

	// ── Un token inventado no entra ─────────────────────────────────────────
	t.Run("token trucho", func(t *testing.T) {
		tabla := []struct {
			nombre string
			token  string
		}{
			{"con prefijo cop_ pero inventado", "cop_estonoexisteniahoraninunca000000000000"},
			{"prefijo cop_ vacío", "cop_"},
			{"basura sin prefijo", "no-es-un-token"},
		}
		for _, c := range tabla {
			t.Run(c.nombre, func(t *testing.T) {
				hacer(t, http.MethodGet, "/api/negocio", nil, c.token).exigir(http.StatusUnauthorized)
			})
		}
	})

	// ── Aislamiento de tenant: EL test del producto ─────────────────────────
	t.Run("aislamiento entre negocios", func(t *testing.T) {
		tokenB := rotarTokenAgente(t, admin.AccessToken, negocioB)
		if tokenB == tokenA {
			t.Fatal("dos negocios distintos no pueden compartir token de agente")
		}

		var deA []model.Servicio
		hacer(t, http.MethodGet, "/api/servicios", nil, tokenA).exigir(http.StatusOK).en(&deA)
		if len(deA) != 1 || deA[0].ID != servicioA.ID {
			t.Fatalf("el token de A tiene que ver sólo su catálogo, obtuvo: %+v", deA)
		}
		igual(t, deA[0].NegocioID, negocioA, "tenant del servicio que ve A")

		var deB []model.Servicio
		hacer(t, http.MethodGet, "/api/servicios", nil, tokenB).exigir(http.StatusOK).en(&deB)
		if len(deB) != 1 || deB[0].ID != servicioB.ID {
			t.Fatalf("el token de B tiene que ver sólo su catálogo, obtuvo: %+v", deB)
		}

		// Y ni de casualidad el detalle del otro: 404, no 403 — desde afuera
		// "de otro tenant" y "no existe" tienen que ser indistinguibles.
		hacer(t, http.MethodGet, "/api/servicios/"+servicioB.ID+"/precios", nil, tokenA).
			exigir(http.StatusNotFound)

		var negB dto.NegocioDatosResponse
		hacer(t, http.MethodGet, "/api/negocio", nil, tokenB).exigir(http.StatusOK).en(&negB)
		igual(t, negB.Nombre, "Consultorio B", "el token de B lee su propio negocio")
	})

	// ── Rotar quema el token anterior ───────────────────────────────────────
	t.Run("rotación revoca el token viejo", func(t *testing.T) {
		nuevo := rotarTokenAgente(t, admin.AccessToken, negocioA)
		if nuevo == tokenA {
			t.Fatal("rotar tiene que devolver un token distinto")
		}
		hacer(t, http.MethodGet, "/api/negocio", nil, tokenA).exigir(http.StatusUnauthorized)
		hacer(t, http.MethodGet, "/api/negocio", nil, nuevo).exigir(http.StatusOK)
	})

	// ── El agente no es admin de la plataforma ──────────────────────────────
	t.Run("el token de agente no entra al panel admin", func(t *testing.T) {
		tokenActual := rotarTokenAgente(t, admin.AccessToken, negocioA)
		hacer(t, http.MethodGet, "/api/admin/negocios", nil, tokenActual).exigir(http.StatusForbidden)
	})
}

// TestDuenoNoAccedeAlPanelAdmin no depende de W2-A: el panel de la plataforma
// es del admin y de nadie más. Un dueño con token válido tiene que rebotar con
// 403 (autenticado pero sin permisos), no con 401.
func TestDuenoNoAccedeAlPanelAdmin(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)

	admin := login(t, usuarioAdmin, passwordAdmin)
	_, duena := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "dra.gomez")

	tabla := []struct {
		nombre string
		metodo string
		ruta   string
		cuerpo any
	}{
		{"listar negocios", http.MethodGet, "/api/admin/negocios", nil},
		{"dar de alta otro negocio", http.MethodPost, "/api/admin/negocios", map[string]any{
			"nombre": "Consultorio Trucho", "vertical": "salud", "usuario_dueno": "colado",
		}},
	}

	for _, c := range tabla {
		t.Run(c.nombre, func(t *testing.T) {
			r := hacer(t, c.metodo, c.ruta, c.cuerpo, duena).exigir(http.StatusForbidden)
			noVacio(t, r.detalle(), "detalle del 403")
		})
	}

	// El mismo request con el token del admin sí pasa: el 403 es por el rol y
	// no porque la ruta esté rota.
	hacer(t, http.MethodGet, "/api/admin/negocios", nil, admin.AccessToken).exigir(http.StatusOK)

	// Y el dueño tampoco puede colarse mandando otro tenant: el negocio sale
	// del token, no del request.
	var servicios []model.Servicio
	hacer(t, http.MethodGet, "/api/servicios?negocio_id=00000000-0000-0000-0000-000000000000", nil, duena).
		exigir(http.StatusOK).en(&servicios)
	igual(t, len(servicios), 0, "catálogo propio (vacío) pese al negocio_id colado en la query")
}
