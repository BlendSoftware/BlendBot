package e2e

import (
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
)

// TestAltaNegocioRechazaTimezoneInvalida cubre H16: una timezone basura no puede
// entrar a la columna. Si entrara, time.LoadLocation fallaría en cada query de
// agenda/disponibilidad/cierre y ese tenant quedaría roto para siempre.
func TestAltaNegocioRechazaTimezoneInvalida(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	// "Mendoza" a secas no es una zona IANA: LoadLocation no la resuelve.
	r := hacer(t, http.MethodPost, "/api/admin/negocios", map[string]any{
		"nombre":        "Bar Basura",
		"vertical":      "gastronomia",
		"timezone":      "Mendoza",
		"usuario_dueno": "duenio-basura",
	}, admin.AccessToken)
	r.exigir(http.StatusUnprocessableEntity)
	noVacio(t, r.detalle(), "mensaje de error de timezone inválida")
}

// TestAltaNegocioAceptaTimezoneValida es el camino feliz del mismo control.
func TestAltaNegocioAceptaTimezoneValida(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	var alta dto.AltaNegocioResponse
	hacer(t, http.MethodPost, "/api/admin/negocios", map[string]any{
		"nombre":        "Bar Correcto",
		"vertical":      "gastronomia",
		"timezone":      tzNegocio,
		"usuario_dueno": "duenio-ok",
	}, admin.AccessToken).exigir(http.StatusCreated).en(&alta)
	noVacio(t, alta.NegocioID, "negocio_id del alta")
}

// TestUpdateNegocioRechazaTimezoneInvalida cubre el mismo bug en el PATCH: no
// alcanza con validar en el alta si el update deja escribir cualquier string.
func TestUpdateNegocioRechazaTimezoneInvalida(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	alta := altaNegocio(t, admin.AccessToken, "Bar Editable", "duenio-editable")

	// Update con basura → 422, sin tocar la columna.
	basura := "America/Nárnia"
	r := hacer(t, http.MethodPatch, "/api/admin/negocios/"+alta.NegocioID, map[string]any{
		"timezone": basura,
	}, admin.AccessToken)
	r.exigir(http.StatusUnprocessableEntity)
	noVacio(t, r.detalle(), "mensaje de error de timezone inválida en update")

	// Update con una zona válida → 200.
	buena := "America/Argentina/Cordoba"
	hacer(t, http.MethodPatch, "/api/admin/negocios/"+alta.NegocioID, map[string]any{
		"timezone": buena,
	}, admin.AccessToken).exigir(http.StatusOK)
}
