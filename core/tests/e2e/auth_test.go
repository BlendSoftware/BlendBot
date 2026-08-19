package e2e

import (
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
)

// TestSinTokenNoSePasa: toda ruta que no sea login o refresh exige Bearer.
// Es la tabla más aburrida del repo y la que evita el agujero más caro.
func TestSinTokenNoSePasa(t *testing.T) {
	nuevoCaso(t)

	tabla := []struct {
		nombre string
		metodo string
		ruta   string
		cuerpo any
	}{
		{"catálogo", http.MethodGet, "/api/servicios", nil},
		{"alta de servicio", http.MethodPost, "/api/servicios", map[string]any{"nombre": "X"}},
		{"recursos", http.MethodGet, "/api/recursos", nil},
		{"coberturas", http.MethodGet, "/api/coberturas", nil},
		{"tablero", http.MethodGet, "/api/compromisos", nil},
		{"crear compromiso", http.MethodPost, "/api/compromisos", map[string]any{}},
		{"crear hold", http.MethodPost, "/api/holds", map[string]any{}},
		{"cliente por teléfono", http.MethodGet, "/api/clientes/por-telefono/549261000", nil},
		{"panel admin", http.MethodGet, "/api/admin/negocios", nil},
		{"logout", http.MethodPost, "/api/auth/logout", nil},
		{"cambiar password", http.MethodPost, "/api/auth/cambiar-password", map[string]any{
			"password_nueva": "otra-clave-larga",
		}},
	}

	for _, c := range tabla {
		t.Run(c.nombre, func(t *testing.T) {
			r := hacer(t, c.metodo, c.ruta, c.cuerpo, "").exigir(http.StatusUnauthorized)
			noVacio(t, r.detalle(), "detalle del 401")
		})
	}

	// El health check es lo único abierto: sin él no hay deploy.
	hacer(t, http.MethodGet, "/health", nil, "").exigir(http.StatusOK)
}

// TestTokensMalFormados: cualquier cosa que no sea un access token válido de
// este emisor rebota con 401, nunca con 500.
func TestTokensMalFormados(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)

	admin := login(t, usuarioAdmin, passwordAdmin)
	_, duena := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "dra.gomez")
	refresh := login(t, usuarioAdmin, passwordAdmin).RefreshToken

	tabla := []struct {
		nombre string
		token  string
	}{
		{"vacío tras el Bearer", " "},
		{"basura", "esto-no-es-un-jwt"},
		{"jwt con firma cambiada", admin.AccessToken + "x"},
		{"refresh usado como access", refresh},
	}

	for _, c := range tabla {
		t.Run(c.nombre, func(t *testing.T) {
			hacer(t, http.MethodGet, "/api/servicios", nil, c.token).exigir(http.StatusUnauthorized)
		})
	}

	// Header sin Authorization: mismo 401.
	hacer(t, http.MethodGet, "/api/servicios", nil, "").exigir(http.StatusUnauthorized)

	// Control positivo: el token bueno del dueño sí entra, así que los 401 de
	// arriba son por el token y no porque la ruta esté rota.
	hacer(t, http.MethodGet, "/api/servicios", nil, duena).exigir(http.StatusOK)

	// Un admin de la plataforma tiene token válido pero no tiene tenant: en las
	// rutas del negocio eso es 403, no 401.
	hacer(t, http.MethodGet, "/api/servicios", nil, admin.AccessToken).exigir(http.StatusForbidden)
}

// TestRefreshDevuelveAccessNuevo: el refresh emite un par nuevo, el access que
// devuelve sirve, y el refresh consumido se quema (rotación: un token robado
// vale una sola vez).
func TestRefreshDevuelveAccessNuevo(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)

	admin := login(t, usuarioAdmin, passwordAdmin)
	_, duena := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "dra.gomez")
	servicio := crearServicio(t, duena, "Consulta", 30, 8500)

	viejos := login(t, "dra.gomez", "clave-nueva-dra.gomez")

	var nuevos dto.TokensDTO
	hacer(t, http.MethodPost, "/api/auth/refresh", map[string]any{
		"refresh_token": viejos.RefreshToken,
	}, "").exigir(http.StatusOK).en(&nuevos)

	noVacio(t, nuevos.AccessToken, "access token del refresh")
	noVacio(t, nuevos.RefreshToken, "refresh token del refresh")
	if nuevos.AccessToken == viejos.AccessToken {
		t.Error("el refresh tiene que emitir un access nuevo, no devolver el mismo")
	}
	if nuevos.RefreshToken == viejos.RefreshToken {
		t.Error("el refresh tiene que rotar: el token consumido no se devuelve igual")
	}
	igual(t, nuevos.Usuario.Username, "dra.gomez", "usuario del par nuevo")
	if nuevos.Usuario.NegocioID == nil || *nuevos.Usuario.NegocioID == "" {
		t.Fatal("el access nuevo perdió el tenant")
	}

	// El access nuevo opera de verdad, no sólo "se ve bien".
	var servicios []model.Servicio
	hacer(t, http.MethodGet, "/api/servicios", nil, nuevos.AccessToken).
		exigir(http.StatusOK).en(&servicios)
	if len(servicios) != 1 || servicios[0].ID != servicio.ID {
		t.Fatalf("el access del refresh no ve el catálogo del tenant: %+v", servicios)
	}

	// El refresh ya usado no vuelve a servir.
	hacer(t, http.MethodPost, "/api/auth/refresh", map[string]any{
		"refresh_token": viejos.RefreshToken,
	}, "").exigir(http.StatusUnauthorized)

	// Un refresh inventado tampoco.
	hacer(t, http.MethodPost, "/api/auth/refresh", map[string]any{
		"refresh_token": "no-es-un-token",
	}, "").exigir(http.StatusUnauthorized)
}

// TestLogoutRevocaElAccess: el logout marca el jti en Redis y el mismo token
// que funcionaba hace un request deja de funcionar. Sin esto, cerrar sesión es
// decorativo hasta que el token expira solo.
func TestLogoutRevocaElAccess(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)

	admin := login(t, usuarioAdmin, passwordAdmin)
	_, duena := negocioListo(t, admin.AccessToken, "Consultorio Gómez", "dra.gomez")

	// Antes: el token opera.
	hacer(t, http.MethodGet, "/api/servicios", nil, duena).exigir(http.StatusOK)

	hacer(t, http.MethodPost, "/api/auth/logout", nil, duena).exigir(http.StatusNoContent)

	// Después: el MISMO token, que sigue siendo criptográficamente válido y no
	// expiró, ya no entra.
	r := hacer(t, http.MethodGet, "/api/servicios", nil, duena).exigir(http.StatusUnauthorized)
	igual(t, r.detalle(), "Token revocado", "motivo del 401 tras el logout")

	// Y el logout no rompió la cuenta: se puede volver a entrar.
	deNuevo := login(t, "dra.gomez", "clave-nueva-dra.gomez")
	if deNuevo.AccessToken == duena {
		t.Fatal("el login posterior devolvió el mismo token revocado")
	}
	hacer(t, http.MethodGet, "/api/servicios", nil, deNuevo.AccessToken).exigir(http.StatusOK)
}
