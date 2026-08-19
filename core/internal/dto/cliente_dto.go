package dto

// CrearClienteRequest: mínimo dato necesario (Ley 25.326). Nada de motivo de
// consulta libre — el tipo de práctica ya vive en el servicio.
type CrearClienteRequest struct {
	Telefono    string  `json:"telefono" binding:"required"`
	Nombre      *string `json:"nombre"`
	Documento   *string `json:"documento"`
	CoberturaID *string `json:"cobertura_id" binding:"omitempty,uuid"`
	Notas       *string `json:"notas"`
}

type ActualizarClienteRequest struct {
	Nombre      *string `json:"nombre"`
	Documento   *string `json:"documento"`
	CoberturaID *string `json:"cobertura_id" binding:"omitempty,uuid"`
	Notas       *string `json:"notas"`
}
