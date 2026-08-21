package dto

import (
	"encoding/json"

	"copiloto/core/internal/model"
)

// CoberturaBreve es una obra social del negocio, sin más que id y nombre.
type CoberturaBreve struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
}

// NegocioDatosResponse es la ficha del tenant que lee la tool
// `datos_del_negocio`: el agente arranca por acá. No expone wa_phone_id ni
// nada de la plataforma — sólo lo que hace falta para atender.
type NegocioDatosResponse struct {
	ID         string           `json:"id"`
	Nombre     string           `json:"nombre"`
	Vertical   model.Vertical   `json:"vertical"`
	Timezone   string           `json:"timezone"`
	Config     json.RawMessage  `json:"config"`
	Coberturas []CoberturaBreve `json:"coberturas"`
}

// ActualizarNegocioInput es el PATCH /api/negocio del dueño: por ahora sólo la
// info del local. Los campos de Info son punteros para distinguir "no lo tocó"
// de "lo vació": sólo lo provisto se mergea en config.info, el resto de la
// config (confirmación, delivery) queda intacto.
type ActualizarNegocioInput struct {
	Info InfoNegocioInput `json:"info"`
}

// InfoNegocioInput son los datos del local a mergear. nil = no se toca esa clave.
type InfoNegocioInput struct {
	Direccion *string `json:"direccion,omitempty"`
	Horarios  *string `json:"horarios,omitempty"`
	Telefono  *string `json:"telefono,omitempty"`
	Notas     *string `json:"notas,omitempty"`
}

// TokenAgenteResponse devuelve el token en claro UNA sola vez, al rotarlo.
// Después sólo queda su sha256 en la base: no hay forma de recuperarlo.
type TokenAgenteResponse struct {
	NegocioID string `json:"negocio_id"`
	Token     string `json:"token"`
	Aviso     string `json:"aviso"`
}

// NegocioDatosDesdeModel arma la ficha a partir del tenant y sus coberturas.
func NegocioDatosDesdeModel(n *model.Negocio, cs []model.Cobertura) *NegocioDatosResponse {
	if n == nil {
		return nil
	}
	coberturas := make([]CoberturaBreve, 0, len(cs))
	for _, c := range cs {
		coberturas = append(coberturas, CoberturaBreve{ID: c.ID, Nombre: c.Nombre})
	}
	config := json.RawMessage(n.Config)
	if len(config) == 0 {
		config = json.RawMessage(`{}`)
	}
	return &NegocioDatosResponse{
		ID:         n.ID,
		Nombre:     n.Nombre,
		Vertical:   n.Vertical,
		Timezone:   n.Timezone,
		Config:     config,
		Coberturas: coberturas,
	}
}
