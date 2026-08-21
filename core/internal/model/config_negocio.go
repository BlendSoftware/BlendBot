package model

import (
	"encoding/json"

	"gorm.io/datatypes"
)

// ConfirmacionPolitica: quién confirma un compromiso. La agenda de un
// consultorio sabe si un hueco está libre y confirma sola; la cocina se satura
// y decide el humano. Es configuración, no código (docs/ARQUITECTURA.md).
type ConfirmacionPolitica string

const (
	ConfirmacionHumana     ConfirmacionPolitica = "humana"
	ConfirmacionAutomatica ConfirmacionPolitica = "automatica"
)

// ConfigNegocio es la vista tipada de negocio.config (JSONB). El almacenamiento
// sigue siendo libre; esto sólo entiende las claves que el core necesita mirar.
// Lo que no venga cae a su cero, que es el default seguro: sin delivery, sin
// presets, confirmación no automática.
type ConfigNegocio struct {
	// Confirmacion["pedido"|"reserva"|"turno"] = "humana" | "automatica".
	Confirmacion           map[string]string `json:"confirmacion"`
	HoldMinutos            int               `json:"hold_minutos"`
	RecordatorioHorasAntes int               `json:"recordatorio_horas_antes"`
	// DemorasSugeridas son presets para el selector del panel; siempre hay campo
	// libre además, así que esto es una comodidad, no un límite.
	DemorasSugeridas []int   `json:"demoras_sugeridas"`
	AceptaDelivery   bool    `json:"acepta_delivery"`
	RadioDeliveryKm  float64 `json:"radio_delivery_km"`
	// Info es lo que el cliente pregunta y no está en la carta: dirección,
	// horarios, teléfono, notas. Vive en config para no migrar columnas por cada
	// dato nuevo del local; el agente la lee para responder sin inventar.
	Info InfoNegocio `json:"info"`
}

// InfoNegocio son los datos del local. Todos opcionales: un negocio recién dado
// de alta no cargó nada y eso es válido — el agente entonces deja la consulta en
// vez de inventar.
type InfoNegocio struct {
	Direccion string `json:"direccion,omitempty"`
	Horarios  string `json:"horarios,omitempty"`
	Telefono  string `json:"telefono,omitempty"`
	Notas     string `json:"notas,omitempty"`
}

// ParseConfigNegocio lee la config del tenant. Una config vacía o `{}` es
// válida y devuelve la estructura en cero.
func ParseConfigNegocio(raw datatypes.JSON) (ConfigNegocio, error) {
	var c ConfigNegocio
	if len(raw) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	return c, nil
}

// ConfirmacionDe devuelve la política de confirmación para un tipo de
// compromiso. Vacía si no está declarada: el llamador decide el default.
func (c ConfigNegocio) ConfirmacionDe(tipo TipoCompromiso) ConfirmacionPolitica {
	if c.Confirmacion == nil {
		return ""
	}
	return ConfirmacionPolitica(c.Confirmacion[string(tipo)])
}
