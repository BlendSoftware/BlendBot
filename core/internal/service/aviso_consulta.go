package service

import "context"

// AvisoConsultaRespondida son los datos para avisarle al cliente que su
// consulta ya tiene respuesta. Lo arma ConsultaService al responder y lo
// consume un avisador que publica a la cola de salidas de WhatsApp.
type AvisoConsultaRespondida struct {
	NegocioID       string
	ConsultaID      string
	WaPhoneID       string
	ClienteTelefono string
	ClienteNombre   string
	Respuesta       string
}

// AvisadorConsulta publica el aviso al cliente. La implementación vive en el
// paquete worker (habla con Redis); el service sólo conoce esta interfaz, así
// no hay ciclo de imports y los tests pueden doblar el avisador.
type AvisadorConsulta interface {
	ConsultaRespondida(ctx context.Context, a AvisoConsultaRespondida) error
}
