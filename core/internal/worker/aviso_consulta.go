package worker

import (
	"context"

	"copiloto/core/internal/service"
)

// avisadorConsulta implementa service.AvisadorConsulta publicando a la cola de
// salidas de WhatsApp. Cuando el dueño responde una consulta, el cliente se
// entera por el mismo canal por el que preguntó.
type avisadorConsulta struct {
	pub Publicador
}

// NewAvisadorConsulta arma el avisador sobre el mismo publicador de Redis que
// usa el resto de las salidas.
func NewAvisadorConsulta(pub Publicador) service.AvisadorConsulta {
	return &avisadorConsulta{pub: pub}
}

func (a *avisadorConsulta) ConsultaRespondida(ctx context.Context, av service.AvisoConsultaRespondida) error {
	texto := "Sobre tu consulta: " + av.Respuesta
	return a.pub.Publicar(ctx, MensajeSalida{
		NegocioID: av.NegocioID,
		WaPhoneID: av.WaPhoneID,
		Telefono:  av.ClienteTelefono,
		Tipo:      TipoTexto,
		Texto:     texto,
	})
}
