package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// CompromisoACobrar es lo mínimo que el service necesita para decidir si un
// compromiso se puede cobrar y por cuánto. Sale de un solo viaje a la base
// porque el cobro es la operación que el mostrador hace con el cliente delante.
type CompromisoACobrar struct {
	ID        string
	Estado    model.EstadoCompromiso
	Total     decimal.Decimal
	ClienteID string
	// Documento del cliente: define si la factura sale identificada (DNI) o a
	// consumidor final. Puede venir vacío, que es lo normal.
	Documento string
	Inicio    *time.Time
	Fin       *time.Time
}

// ResumenCierre es el corte del día que mira el dueño antes de irse.
type ResumenCierre struct {
	Compromisos int
	Completados int
	Cancelados  int
	Ausentes    int
	PorOrigen   map[string]int
	// Vendido es el total de lo entregado del día (compromisos completados),
	// haya entrado o no por la caja de ARCA. Es lo que faltaba: antes el cierre
	// sólo mostraba lo cobrado y el dueño no veía lo que salió de la cocina.
	Vendido      decimal.Decimal
	Cobros       int
	TotalCobrado decimal.Decimal
	PorMedioPago map[string]decimal.Decimal
	Emitidos     int
	Pendientes   int
	ConError     int
}

// ComprobantePendiente es la proyección que arma el request al sidecar: todo
// lo que hace falta en una sola fila, porque el worker no puede hacer cinco
// viajes por cada factura.
//
// Los PEM vienen CIFRADOS: el descifrado ocurre en el worker, justo antes del
// POST, y el texto plano no se guarda en ninguna variable de larga vida.
type ComprobantePendiente struct {
	ComprobanteID   string
	NegocioID       string
	NegocioNombre   string
	Timezone        string
	WaPhoneID       string
	TipoCbte        int
	PuntoVenta      int
	ReceptorDocTipo int
	ReceptorDocNro  string
	Importe         decimal.Decimal
	RetryCount      int
	// El tag es obligatorio: la convención de GORM no mapea un nombre todo en
	// mayúsculas a la columna cuit, y sin esto el CUIT llegaría vacío al
	// sidecar (que respondería un error críptico de ARCA).
	CUIT           string `gorm:"column:cuit"`
	Modo           string
	CertPEMCifrado string
	KeyPEMCifrado  string
	ClienteNombre  string
	Telefono       string
	// ServicioDesde/Hasta: concepto 2 (servicios) de WSFEv1 obliga a informar
	// el período prestado. Para un turno es su rango; si el compromiso no tenía
	// horario, es el día del cobro.
	ServicioDesde time.Time
	ServicioHasta time.Time
}

// ResultadoFactura es lo que el worker sella cuando ARCA devuelve CAE.
type ResultadoFactura struct {
	Numero   int64
	CAE      string
	CAEVence *time.Time
}

// CobroRepository es tenant-scoped salvo ComprobantesPendientes, que es del
// worker y por definición barre todos los negocios (ver su comentario).
type CobroRepository interface {
	// CompromisoACobrar devuelve nil (sin error) si el compromiso no es de este
	// negocio: desde afuera "no existe" y "es de otro" son lo mismo.
	CompromisoACobrar(ctx context.Context, negocioID, compromisoID string) (*CompromisoACobrar, error)
	// CrearCobro inserta cobro y (si hay comprobante) su comprobante en una
	// sola transacción: no existe un cobro facturable sin su comprobante.
	// Devuelve ErrCobroDuplicado si el compromiso ya tenía cobro.
	CrearCobro(ctx context.Context, c *model.Cobro, comp *model.Comprobante) error
	// PorCompromiso devuelve el cobro del compromiso y su comprobante, ambos
	// nil si todavía no se cobró.
	PorCompromiso(ctx context.Context, negocioID, compromisoID string) (*model.Cobro, *model.Comprobante, error)
	// Cierre agrega el día completo en el rango [desde, hasta) ya resuelto en
	// la timezone del negocio por el service.
	Cierre(ctx context.Context, negocioID string, desde, hasta time.Time) (*ResumenCierre, error)

	ConfigFiscal(ctx context.Context, negocioID string) (*model.ConfigFiscal, error)
	GuardarConfigFiscal(ctx context.Context, cf *model.ConfigFiscal) error

	// ── Sólo para el worker facturador ──────────────────────────────────
	//
	// ComprobantesPendientes es EL método cross-tenant del módulo: el barrido
	// del facturador mira todos los negocios porque es un proceso de fondo, no
	// un request. No hay negocioID que pasarle: ningún token llega hasta acá.
	ComprobantesPendientes(ctx context.Context, ahora time.Time, limite int) ([]ComprobantePendiente, error)
	// TomarComprobante es EL candado contra la doble facturación: UPDATE
	// condicional que además corre next_retry_at hacia adelante (lease). Dos
	// ticks o dos réplicas compiten por la fila y sólo una gana; la perdedora
	// ve el lease vigente y ni siquiera llama al sidecar.
	TomarComprobante(ctx context.Context, comprobanteID string, ahora time.Time, lease time.Duration) (bool, error)
	// SellarComprobante cierra el circuito: CAE, número y estado emitido.
	SellarComprobante(ctx context.Context, comprobanteID string, r ResultadoFactura, cuando time.Time) error
	// ProgramarReintento anota el error y la próxima ventana. estadoFinal
	// distingue "seguimos intentando" de "se agotaron los intentos".
	ProgramarReintento(ctx context.Context, comprobanteID string, intentos int, proximo *time.Time, motivo string, estado model.EstadoComprobante) error
}

// ErrCobroDuplicado: el compromiso ya tenía cobro. Lo levanta el UNIQUE de la
// base, que es el único árbitro confiable con dos requests simultáneos.
var ErrCobroDuplicado = errors.New("el compromiso ya fue cobrado")

type cobroRepo struct{ db *gorm.DB }

func NewCobroRepository(db *gorm.DB) CobroRepository { return &cobroRepo{db: db} }

func (r *cobroRepo) CompromisoACobrar(ctx context.Context, negocioID, compromisoID string) (*CompromisoACobrar, error) {
	var out CompromisoACobrar
	// El JOIN ancla el cliente al mismo negocio: un compromiso de otro tenant
	// no devuelve fila y el service lo traduce a "no encontrado".
	err := r.db.WithContext(ctx).Raw(`
		SELECT c.id                     AS id,
		       c.estado                 AS estado,
		       c.total                  AS total,
		       c.cliente_id             AS cliente_id,
		       COALESCE(cl.documento, '') AS documento,
		       c.inicio                 AS inicio,
		       c.fin                    AS fin
		FROM compromiso c
		JOIN cliente cl ON cl.id = c.cliente_id AND cl.negocio_id = c.negocio_id
		WHERE c.negocio_id = ? AND c.id = ?
	`, negocioID, compromisoID).Take(&out).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (r *cobroRepo) CrearCobro(ctx context.Context, c *model.Cobro, comp *model.Comprobante) error {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(c).Error; err != nil {
			return err
		}
		if comp == nil {
			return nil
		}
		comp.NegocioID = c.NegocioID
		comp.CobroID = c.ID
		return tx.Create(comp).Error
	})
	if err != nil && esViolacionDeUnicidad(err) {
		return ErrCobroDuplicado
	}
	return err
}

func (r *cobroRepo) PorCompromiso(ctx context.Context, negocioID, compromisoID string) (*model.Cobro, *model.Comprobante, error) {
	var c model.Cobro
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND compromiso_id = ?", negocioID, compromisoID).
		Take(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}

	var comp model.Comprobante
	err = r.db.WithContext(ctx).
		Where("negocio_id = ? AND cobro_id = ?", negocioID, c.ID).
		Take(&comp).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &c, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &c, &comp, nil
}

func (r *cobroRepo) Cierre(ctx context.Context, negocioID string, desde, hasta time.Time) (*ResumenCierre, error) {
	out := &ResumenCierre{
		PorOrigen:    map[string]int{},
		PorMedioPago: map[string]decimal.Decimal{},
		TotalCobrado: decimal.Zero,
		Vendido:      decimal.Zero,
	}

	// Lo vendido del día: la suma de los totales de lo entregado (completados),
	// por cerrado_en, sin depender de que se haya cobrado por ARCA. Es una
	// query aparte de la de conteo porque acá interesa la plata, no cuántos.
	var vendido decimal.Decimal
	err := r.db.WithContext(ctx).Raw(`
		SELECT COALESCE(SUM(total), 0)
		FROM compromiso
		WHERE negocio_id = ? AND estado = 'completado'
		  AND cerrado_en >= ? AND cerrado_en < ?
	`, negocioID, desde, hasta).Scan(&vendido).Error
	if err != nil {
		return nil, err
	}
	out.Vendido = vendido

	// Los compromisos del día se cuentan por cerrado_en: lo que se cerró hoy,
	// sin importar cuándo se pidió. Un turno tomado el lunes y atendido el
	// viernes es del viernes.
	var filas []struct {
		Estado string
		Origen string
		N      int
	}
	err = r.db.WithContext(ctx).Raw(`
		SELECT estado::text AS estado, origen::text AS origen, COUNT(*) AS n
		FROM compromiso
		WHERE negocio_id = ? AND cerrado_en >= ? AND cerrado_en < ?
		GROUP BY estado, origen
	`, negocioID, desde, hasta).Scan(&filas).Error
	if err != nil {
		return nil, err
	}
	for _, f := range filas {
		out.Compromisos += f.N
		out.PorOrigen[f.Origen] += f.N
		switch model.EstadoCompromiso(f.Estado) {
		case model.EstadoCompletado:
			out.Completados += f.N
		case model.EstadoCancelado:
			out.Cancelados += f.N
		case model.EstadoAusente:
			out.Ausentes += f.N
		}
	}

	var cobros []struct {
		MedioPago string
		N         int
		Monto     decimal.Decimal
	}
	err = r.db.WithContext(ctx).Raw(`
		SELECT medio_pago, COUNT(*) AS n, COALESCE(SUM(monto), 0) AS monto
		FROM cobro
		WHERE negocio_id = ? AND cobrado_en >= ? AND cobrado_en < ?
		GROUP BY medio_pago
	`, negocioID, desde, hasta).Scan(&cobros).Error
	if err != nil {
		return nil, err
	}
	for _, c := range cobros {
		out.Cobros += c.N
		out.TotalCobrado = out.TotalCobrado.Add(c.Monto)
		out.PorMedioPago[c.MedioPago] = out.PorMedioPago[c.MedioPago].Add(c.Monto)
	}

	// Los comprobantes se cuentan por el cobro que los originó: si el CAE llega
	// mañana, el comprobante sigue siendo del día en que se cobró.
	var comps []struct {
		Estado string
		N      int
	}
	err = r.db.WithContext(ctx).Raw(`
		SELECT cp.estado AS estado, COUNT(*) AS n
		FROM comprobante cp
		JOIN cobro co ON co.id = cp.cobro_id
		WHERE cp.negocio_id = ? AND co.cobrado_en >= ? AND co.cobrado_en < ?
		GROUP BY cp.estado
	`, negocioID, desde, hasta).Scan(&comps).Error
	if err != nil {
		return nil, err
	}
	for _, c := range comps {
		switch model.EstadoComprobante(c.Estado) {
		case model.ComprobanteEmitido:
			out.Emitidos += c.N
		case model.ComprobantePendiente:
			out.Pendientes += c.N
		case model.ComprobanteError:
			out.ConError += c.N
		}
	}

	return out, nil
}

func (r *cobroRepo) ConfigFiscal(ctx context.Context, negocioID string) (*model.ConfigFiscal, error) {
	var cf model.ConfigFiscal
	err := r.db.WithContext(ctx).Where("negocio_id = ?", negocioID).Take(&cf).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cf, nil
}

func (r *cobroRepo) GuardarConfigFiscal(ctx context.Context, cf *model.ConfigFiscal) error {
	// Upsert explícito por columnas: un PUT sin certificados no puede borrar
	// los que el negocio ya tenía cargados (el service decide qué mandar).
	campos := map[string]any{
		"cuit":           cf.CUIT,
		"razon_social":   cf.RazonSocial,
		"condicion":      cf.Condicion,
		"punto_venta":    cf.PuntoVenta,
		"modo":           cf.Modo,
		"actualizado_en": cf.ActualizadoEn,
	}
	if cf.CertPEMCifrado != nil {
		campos["cert_pem_cifrado"] = *cf.CertPEMCifrado
	}
	if cf.KeyPEMCifrado != nil {
		campos["key_pem_cifrado"] = *cf.KeyPEMCifrado
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.ConfigFiscal{}).
			Where("negocio_id = ?", cf.NegocioID).
			Updates(campos)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected > 0 {
			return nil
		}
		return tx.Create(cf).Error
	})
}

// ── Worker facturador ─────────────────────────────────────────────────────

func (r *cobroRepo) ComprobantesPendientes(ctx context.Context, ahora time.Time, limite int) ([]ComprobantePendiente, error) {
	if limite <= 0 || limite > 200 {
		limite = 50
	}
	var out []ComprobantePendiente
	// Un negocio sin certificados cargados queda FUERA del barrido a propósito:
	// su comprobante espera sin gastar reintentos, así que cuando el dueño sube
	// el par el circuito arranca solo en vez de encontrarse todo en error.
	err := r.db.WithContext(ctx).Raw(`
		SELECT cp.id                     AS comprobante_id,
		       cp.negocio_id             AS negocio_id,
		       cp.tipo_cbte              AS tipo_cbte,
		       cp.punto_venta            AS punto_venta,
		       cp.receptor_doc_tipo      AS receptor_doc_tipo,
		       COALESCE(cp.receptor_doc_nro, '') AS receptor_doc_nro,
		       cp.importe                AS importe,
		       cp.retry_count            AS retry_count,
		       n.nombre                  AS negocio_nombre,
		       n.timezone                AS timezone,
		       COALESCE(n.wa_phone_id, '') AS wa_phone_id,
		       cf.cuit                   AS cuit,
		       cf.modo                   AS modo,
		       cf.cert_pem_cifrado       AS cert_pem_cifrado,
		       cf.key_pem_cifrado        AS key_pem_cifrado,
		       COALESCE(cl.nombre, '')   AS cliente_nombre,
		       cl.telefono               AS telefono,
		       COALESCE(c.inicio, co.cobrado_en) AS servicio_desde,
		       COALESCE(c.fin, c.inicio, co.cobrado_en) AS servicio_hasta
		FROM comprobante cp
		JOIN cobro         co ON co.id = cp.cobro_id
		JOIN compromiso    c  ON c.id  = co.compromiso_id
		JOIN cliente       cl ON cl.id = c.cliente_id
		JOIN negocio       n  ON n.id  = cp.negocio_id
		JOIN config_fiscal cf ON cf.negocio_id = cp.negocio_id
		WHERE cp.estado = 'pendiente'
		  AND (cp.next_retry_at IS NULL OR cp.next_retry_at <= ?)
		  AND n.activo = TRUE
		  AND cf.cert_pem_cifrado IS NOT NULL AND cf.cert_pem_cifrado <> ''
		  AND cf.key_pem_cifrado  IS NOT NULL AND cf.key_pem_cifrado  <> ''
		ORDER BY cp.creado_en ASC
		LIMIT ?
	`, ahora, limite).Scan(&out).Error
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *cobroRepo) TomarComprobante(ctx context.Context, comprobanteID string, ahora time.Time, lease time.Duration) (bool, error) {
	if lease <= 0 {
		lease = time.Minute
	}
	vence := ahora.Add(lease)
	res := r.db.WithContext(ctx).
		Model(&model.Comprobante{}).
		Where("id = ? AND estado = ? AND (next_retry_at IS NULL OR next_retry_at <= ?)",
			comprobanteID, model.ComprobantePendiente, ahora).
		Update("next_retry_at", vence)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *cobroRepo) SellarComprobante(ctx context.Context, comprobanteID string, rf ResultadoFactura, cuando time.Time) error {
	campos := map[string]any{
		"estado":        model.ComprobanteEmitido,
		"cae":           rf.CAE,
		"numero":        rf.Numero,
		"emitido_en":    cuando,
		"next_retry_at": nil,
		"last_error":    nil,
	}
	if rf.CAEVence != nil {
		campos["cae_vence"] = *rf.CAEVence
	}
	// La condición sobre estado deja el sello idempotente: si otra réplica ya
	// emitió, este UPDATE no hace nada en vez de pisar el CAE bueno.
	return r.db.WithContext(ctx).
		Model(&model.Comprobante{}).
		Where("id = ? AND estado = ?", comprobanteID, model.ComprobantePendiente).
		Updates(campos).Error
}

func (r *cobroRepo) ProgramarReintento(ctx context.Context, comprobanteID string, intentos int, proximo *time.Time, motivo string, estado model.EstadoComprobante) error {
	campos := map[string]any{
		"retry_count":   intentos,
		"next_retry_at": proximo,
		"last_error":    recortar(motivo, 500),
		"estado":        estado,
	}
	return r.db.WithContext(ctx).
		Model(&model.Comprobante{}).
		Where("id = ? AND estado = ?", comprobanteID, model.ComprobantePendiente).
		Updates(campos).Error
}

// recortar acota last_error: el sidecar puede devolver un stacktrace de ARCA y
// la columna no es un log.
func recortar(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// esViolacionDeUnicidad reconoce el 23505 de PostgreSQL sin arrastrar pgconn
// como dependencia directa: alcanza con el texto del driver.
func esViolacionDeUnicidad(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") || strings.Contains(msg, "duplicate key value")
}
