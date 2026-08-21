package model

import (
	"time"

	"github.com/shopspring/decimal"
)

// MedioPago es cómo pagó el cliente. El CHECK de la migración manda: acá sólo
// están los cinco que el panel ofrece.
type MedioPago string

const (
	MedioEfectivo      MedioPago = "efectivo"
	MedioTransferencia MedioPago = "transferencia"
	MedioDebito        MedioPago = "debito"
	MedioCredito       MedioPago = "credito"
	MedioQR            MedioPago = "qr"
)

// MediosPagoValidos devuelve los medios aceptados, en el orden en que los
// muestra el panel.
func MediosPagoValidos() []MedioPago {
	return []MedioPago{MedioEfectivo, MedioTransferencia, MedioDebito, MedioCredito, MedioQR}
}

// EsMedioPagoValido responde si el string es uno de los cinco medios.
func EsMedioPagoValido(s string) bool {
	for _, m := range MediosPagoValidos() {
		if string(m) == s {
			return true
		}
	}
	return false
}

// Cobro es la plata que entró por un compromiso completado. Uno por
// compromiso: el UNIQUE de la base lo garantiza incluso con dos clicks a la vez.
type Cobro struct {
	ID           string          `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID    string          `gorm:"type:uuid;not null" json:"negocio_id"`
	CompromisoID string          `gorm:"type:uuid;not null" json:"compromiso_id"`
	UsuarioID    *string         `gorm:"type:uuid" json:"usuario_id"` // nil si cobró el agente
	MedioPago    MedioPago       `gorm:"not null" json:"medio_pago"`
	Monto        decimal.Decimal `gorm:"type:numeric(12,2);not null" json:"monto"`
	CobradoEn    time.Time       `gorm:"autoCreateTime" json:"cobrado_en"`
}

func (Cobro) TableName() string { return "cobro" }

// EstadoComprobante: pendiente mientras la cola de reintentos lo sigue
// intentando, emitido cuando ARCA devolvió CAE, error cuando se agotaron los
// intentos y hace falta que mire un humano.
type EstadoComprobante string

const (
	ComprobantePendiente EstadoComprobante = "pendiente"
	ComprobanteEmitido   EstadoComprobante = "emitido"
	ComprobanteError     EstadoComprobante = "error"
)

// TipoCbteFacturaC es el código WSFEv1 de la Factura C, la que emite un
// monotributista.
const TipoCbteFacturaC = 11

// DocTipoConsumidorFinal es el código de "sin identificar" de ARCA: se usa
// cuando el cliente no dejó DNI.
const DocTipoConsumidorFinal = 99

// DocTipoDNI identifica al receptor cuando el cliente sí dejó su documento.
const DocTipoDNI = 96

// Comprobante es la factura del cobro. Nace pendiente y el worker facturador
// la lleva a emitido (con CAE) o a error después de agotar los reintentos.
type Comprobante struct {
	ID          string            `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	NegocioID   string            `gorm:"type:uuid;not null" json:"negocio_id"`
	CobroID     string            `gorm:"type:uuid;not null" json:"cobro_id"`
	TipoCbte    int               `gorm:"not null;default:11" json:"tipo_cbte"`
	PuntoVenta  int               `gorm:"not null;default:1" json:"punto_venta"`
	Numero      *int64            `json:"numero"`
	CAE         *string           `gorm:"column:cae" json:"cae"`
	CAEVence    *time.Time        `gorm:"column:cae_vence;type:date" json:"cae_vence"`
	Estado      EstadoComprobante `gorm:"not null;default:pendiente" json:"estado"`
	RetryCount  int               `gorm:"not null;default:0" json:"retry_count"`
	NextRetryAt *time.Time        `json:"next_retry_at"`
	LastError   *string           `json:"last_error"`
	// ReceptorDocTipo/Nro: 99 y vacío si el cliente no dejó documento.
	ReceptorDocTipo int             `gorm:"not null;default:99" json:"receptor_doc_tipo"`
	ReceptorDocNro  *string         `json:"receptor_doc_nro"`
	Importe         decimal.Decimal `gorm:"type:numeric(12,2);not null" json:"importe"`
	EmitidoEn       *time.Time      `json:"emitido_en"`
	CreadoEn        time.Time       `gorm:"autoCreateTime" json:"creado_en"`
}

func (Comprobante) TableName() string { return "comprobante" }

// ConfigFiscal son los datos con los que el negocio factura. Los dos PEM se
// guardan CIFRADOS (infra.Cifrador) y llevan json:"-" a propósito: no hay
// ningún camino por el que un certificado salga en un response.
type ConfigFiscal struct {
	NegocioID      string    `gorm:"type:uuid;primaryKey" json:"negocio_id"`
	CUIT           string    `gorm:"column:cuit;not null" json:"cuit"`
	RazonSocial    *string   `json:"razon_social"`
	Condicion      string    `gorm:"not null;default:monotributo" json:"condicion"`
	PuntoVenta     int       `gorm:"not null;default:1" json:"punto_venta"`
	Modo           string    `gorm:"not null;default:homologacion" json:"modo"`
	CertPEMCifrado *string   `gorm:"column:cert_pem_cifrado" json:"-"`
	KeyPEMCifrado  *string   `gorm:"column:key_pem_cifrado" json:"-"`
	ActualizadoEn  time.Time `json:"actualizado_en"`
}

func (ConfigFiscal) TableName() string { return "config_fiscal" }

// TieneCertificados responde si el negocio ya subió el par con el que se
// firma contra ARCA. Sin eso el facturador no puede intentar nada.
func (c *ConfigFiscal) TieneCertificados() bool {
	return c != nil &&
		c.CertPEMCifrado != nil && *c.CertPEMCifrado != "" &&
		c.KeyPEMCifrado != nil && *c.KeyPEMCifrado != ""
}

// ModosFiscales son los dos entornos de ARCA. Se prueba en homologación antes
// de tocar producción, siempre.
const (
	ModoHomologacion = "homologacion"
	ModoProduccion   = "produccion"
)

// EsModoFiscalValido valida el entorno declarado.
func EsModoFiscalValido(s string) bool {
	return s == ModoHomologacion || s == ModoProduccion
}
