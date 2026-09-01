package dto

// CrearConsultaInput registra una pregunta que el bot no supo responder. El
// cliente ya viene resuelto (el agente lo obtiene por su teléfono antes); el
// negocio sale del token.
type CrearConsultaInput struct {
	ClienteID string `json:"cliente_id" binding:"required,uuid"`
	Pregunta  string `json:"pregunta" binding:"required"`
}

// ResponderConsultaInput es la respuesta del dueño; se le manda al cliente por
// WhatsApp.
type ResponderConsultaInput struct {
	Respuesta string `json:"respuesta" binding:"required"`
}

// FiltroConsultas acota el inbox del panel. Estado vacío = todas.
type FiltroConsultas struct {
	Estado string
}

// ConsultaResponse es una pregunta del inbox, con el cliente ya resuelto: quien
// atiende lee "Juana Pérez · ¿hacen sin TACC?", no un UUID.
type ConsultaResponse struct {
	ID            string     `json:"id"`
	NegocioID     string     `json:"negocio_id"`
	ClienteID     *string    `json:"cliente_id"`
	ClienteNombre *string    `json:"cliente_nombre"`
	Telefono      string     `json:"telefono"`
	Pregunta      string     `json:"pregunta"`
	Respuesta     *string    `json:"respuesta"`
	Estado        string     `json:"estado"`
	CreadoEn      Hora       `json:"creado_en"`
	RespondidaEn  *Hora      `json:"respondida_en"`
}
