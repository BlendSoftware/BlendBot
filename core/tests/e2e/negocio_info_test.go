package e2e

import (
	"net/http"
	"testing"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"gorm.io/datatypes"
)

// TestDescripcionServicio: la descripción del plato viaja de ida (POST/PATCH) y
// de vuelta (GET). Es lo que el agente usa para responder "¿qué lleva la Doble
// bacon?" sin inventar.
func TestDescripcionServicio(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	_, token := negocioListo(t, admin.AccessToken, "Burger Gómez", "gomez")

	// Alta con descripción.
	var creado model.Servicio
	hacer(t, http.MethodPost, "/api/servicios", map[string]any{
		"nombre":      "Doble bacon",
		"precio_base": 8500,
		"descripcion": "Dos medallones, doble cheddar, bacon y salsa de la casa.",
	}, token).exigir(http.StatusCreated).en(&creado)
	if creado.Descripcion == nil || *creado.Descripcion != "Dos medallones, doble cheddar, bacon y salsa de la casa." {
		t.Fatalf("descripción en el alta: %v", creado.Descripcion)
	}

	// El listado la trae.
	var lista []model.Servicio
	hacer(t, http.MethodGet, "/api/servicios", nil, token).exigir(http.StatusOK).en(&lista)
	igual(t, len(lista), 1, "servicios listados")
	if lista[0].Descripcion == nil || *lista[0].Descripcion == "" {
		t.Fatalf("la descripción no volvió en el listado: %+v", lista[0])
	}

	// PATCH la cambia.
	var actualizado model.Servicio
	hacer(t, http.MethodPatch, "/api/servicios/"+creado.ID, map[string]any{
		"descripcion": "Ahora con cebolla caramelizada.",
	}, token).exigir(http.StatusOK).en(&actualizado)
	if actualizado.Descripcion == nil || *actualizado.Descripcion != "Ahora con cebolla caramelizada." {
		t.Fatalf("descripción tras PATCH: %v", actualizado.Descripcion)
	}
	// El nombre no se tocó: el PATCH parcial no lo pisó.
	igual(t, actualizado.Nombre, "Doble bacon", "nombre intacto tras PATCH de descripción")
}

// TestPatchNegocioInfo: el PATCH mergea config.info sin pisar el resto de la
// config, y un segundo PATCH parcial conserva lo ya cargado.
func TestPatchNegocioInfo(t *testing.T) {
	nuevoCaso(t)
	bootstrapAdmin(t)
	admin := login(t, usuarioAdmin, passwordAdmin)

	negocioID, token := negocioListo(t, admin.AccessToken, "Burger Gómez", "gomez")

	// Sembramos una config con confirmación y delivery: es lo que el PATCH NO
	// debe pisar al escribir info.
	if err := env.DB.Model(&model.Negocio{}).
		Where("id = ?", negocioID).
		Update("config", datatypes.JSON([]byte(
			`{"confirmacion":{"pedido":"humana"},"acepta_delivery":true,"radio_delivery_km":5}`,
		))).Error; err != nil {
		t.Fatalf("sembrar config: %v", err)
	}

	// Primer PATCH: dirección + teléfono.
	hacer(t, http.MethodPatch, "/api/negocio", map[string]any{
		"info": map[string]any{
			"direccion": "San Martín 123",
			"telefono":  "0261-4000000",
		},
	}, token).exigir(http.StatusOK)

	cfg := leerConfig(t, token)
	igual(t, cfg.Info.Direccion, "San Martín 123", "dirección tras primer PATCH")
	igual(t, cfg.Info.Telefono, "0261-4000000", "teléfono tras primer PATCH")
	// La confirmación y el delivery quedaron intactos.
	igual(t, cfg.Confirmacion["pedido"], "humana", "confirmación preservada")
	if !cfg.AceptaDelivery {
		t.Error("acepta_delivery se pisó: el PATCH de info no debe tocar el resto de la config")
	}

	// Segundo PATCH: sólo horarios. La dirección y el teléfono ya cargados se
	// conservan (merge a nivel de claves, no reemplazo del objeto info).
	hacer(t, http.MethodPatch, "/api/negocio", map[string]any{
		"info": map[string]any{
			"horarios": "Lun a Sáb 20 a 24hs",
		},
	}, token).exigir(http.StatusOK)

	cfg = leerConfig(t, token)
	igual(t, cfg.Info.Horarios, "Lun a Sáb 20 a 24hs", "horarios tras segundo PATCH")
	igual(t, cfg.Info.Direccion, "San Martín 123", "dirección conservada tras segundo PATCH")
	igual(t, cfg.Info.Telefono, "0261-4000000", "teléfono conservado tras segundo PATCH")
	igual(t, cfg.Confirmacion["pedido"], "humana", "confirmación sigue intacta")
}

// leerConfig hace GET /api/negocio y parsea el config crudo a la vista tipada.
func leerConfig(t *testing.T, token string) model.ConfigNegocio {
	t.Helper()
	var resp dto.NegocioDatosResponse
	hacer(t, http.MethodGet, "/api/negocio", nil, token).exigir(http.StatusOK).en(&resp)
	cfg, err := model.ParseConfigNegocio(datatypes.JSON(resp.Config))
	if err != nil {
		t.Fatalf("parsear config: %v — %s", err, string(resp.Config))
	}
	return cfg
}
