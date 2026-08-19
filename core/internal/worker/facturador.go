package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"copiloto/core/internal/infra"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/rs/zerolog/log"
)

const (
	facturadorIntervaloDefault = 30 * time.Second
	facturadorLote             = 20
	facturadorTimeoutHTTP      = 25 * time.Second

	// facturadorLease es cuánto se reserva un comprobante al tomarlo. Tiene que
	// sobrar sobre el timeout HTTP: si el lease venciera con la llamada todavía
	// en vuelo, otro tick facturaría lo mismo por segunda vez.
	facturadorLease = 2 * time.Minute

	// FacturadorMaxIntentos: a los diez el comprobante queda en error y nadie
	// lo vuelve a tocar sin que un humano lo mire. Insistir para siempre contra
	// un dato mal cargado sólo llena la base de ruido.
	FacturadorMaxIntentos = 10

	backoffBase = time.Minute
	backoffTope = 6 * time.Hour

	// ConceptoServicios es el concepto 2 de WSFEv1. Un turno es una prestación,
	// no un producto, y eso obliga a informar el período de servicio.
	ConceptoServicios = 2
)

// FacturadorConfig son las dependencias del barrido fiscal.
type FacturadorConfig struct {
	Repo     repository.CobroRepository
	Pub      Publicador
	Cifrador infra.Cifrador // nil = no hay clave: el worker no arranca

	SidecarURL    string
	InternalToken string

	// HTTP es inyectable: los tests le apuntan un httptest.Server y nunca sale
	// un paquete a la red.
	HTTP *http.Client
	// Ahora es el reloj inyectable. nil = time.Now.
	Ahora func() time.Time
	// Intervalo entre ticks. 0 = 30s.
	Intervalo time.Duration
}

// Facturador lleva cada comprobante pendiente hasta el CAE. Es el proceso que
// hace que el consultorio no entre nunca más al portal de ARCA.
type Facturador struct {
	repo      repository.CobroRepository
	pub       Publicador
	cifrador  infra.Cifrador
	url       string
	token     string
	http      *http.Client
	ahora     func() time.Time
	intervalo time.Duration
}

// NewFacturador devuelve nil si le falta lo indispensable (repo, cifrador o
// URL del sidecar): un facturador a medias que falla en cada tick es peor que
// no tenerlo, y main lo loguea al arrancar.
func NewFacturador(cfg FacturadorConfig) *Facturador {
	if cfg.Repo == nil || cfg.Cifrador == nil || strings.TrimSpace(cfg.SidecarURL) == "" {
		return nil
	}
	w := &Facturador{
		repo:      cfg.Repo,
		pub:       cfg.Pub,
		cifrador:  cfg.Cifrador,
		url:       strings.TrimRight(strings.TrimSpace(cfg.SidecarURL), "/"),
		token:     cfg.InternalToken,
		http:      cfg.HTTP,
		ahora:     cfg.Ahora,
		intervalo: cfg.Intervalo,
	}
	if w.http == nil {
		w.http = &http.Client{Timeout: facturadorTimeoutHTTP}
	}
	if w.ahora == nil {
		w.ahora = time.Now
	}
	if w.intervalo <= 0 {
		w.intervalo = facturadorIntervaloDefault
	}
	return w
}

// Start lanza el ticker y lo corta con el ctx de shutdown del proceso.
func (w *Facturador) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(w.intervalo)
		defer ticker.Stop()

		log.Info().Dur("intervalo", w.intervalo).Msg("worker facturador: arrancó")

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("worker facturador: cortando")
				return
			case <-ticker.C:
				if _, err := w.Tick(ctx); err != nil {
					log.Error().Err(err).Msg("worker facturador: tick con error")
				}
			}
		}
	}()
}

// Tick hace una pasada y devuelve cuántas facturas se emitieron. Es público
// porque es el sujeto de los tests.
//
// El barrido es CROSS-TENANT a propósito: es un proceso de fondo, no un
// request, y no hay token del que sacar un negocio. El aislamiento lo da que
// cada fila se procesa con los datos fiscales de SU negocio y nada se mezcla.
//
// El orden es el mismo que el del recordatorio y no es negociable: primero la
// toma condicional, y sólo si la fila fue nuestra se llama al sidecar. Al
// revés, dos réplicas facturarían dos veces el mismo cobro y eso ante ARCA no
// se deshace.
func (w *Facturador) Tick(ctx context.Context) (int, error) {
	ahora := w.ahora()

	pendientes, err := w.repo.ComprobantesPendientes(ctx, ahora, facturadorLote)
	if err != nil {
		return 0, err
	}

	emitidos := 0
	for _, p := range pendientes {
		mio, err := w.repo.TomarComprobante(ctx, p.ComprobanteID, ahora, facturadorLease)
		if err != nil {
			log.Error().Err(err).Str("comprobante_id", p.ComprobanteID).
				Msg("worker facturador: no se pudo tomar el comprobante")
			continue
		}
		if !mio {
			// Otro tick u otra réplica lo tiene reservado.
			continue
		}
		if w.procesar(ctx, p) {
			emitidos++
		}
	}

	return emitidos, nil
}

// procesar hace la llamada al sidecar y sella o programa el reintento.
// Devuelve true sólo si salió el CAE.
func (w *Facturador) procesar(ctx context.Context, p repository.ComprobantePendiente) bool {
	// El texto plano del certificado sólo vive dentro de esta función, entre el
	// descifrado y el POST. No se loguea, no se guarda, no vuelve en ningún
	// response.
	cert, err := w.cifrador.Descifrar(p.CertPEMCifrado)
	if err != nil {
		// Clave rotada sin re-cifrar los certificados, o dato alterado. No es
		// transitorio: no tiene sentido gastar diez intentos.
		w.fallar(ctx, p, "no se pudo descifrar el certificado fiscal", true)
		return false
	}
	key, err := w.cifrador.Descifrar(p.KeyPEMCifrado)
	if err != nil {
		w.fallar(ctx, p, "no se pudo descifrar la clave privada fiscal", true)
		return false
	}

	loc, errZona := time.LoadLocation(p.Timezone)
	if errZona != nil || loc == nil {
		loc = time.UTC
	}
	desde := p.ServicioDesde.In(loc)
	hasta := p.ServicioHasta.In(loc)
	if hasta.Before(desde) {
		hasta = desde
	}

	req := solicitudFactura{
		CUITEmisor:    p.CUIT,
		PuntoVenta:    p.PuntoVenta,
		Modo:          p.Modo,
		CertPEM:       cert,
		KeyPEM:        key,
		TipoCbte:      p.TipoCbte,
		Concepto:      ConceptoServicios,
		DocTipo:       p.ReceptorDocTipo,
		DocNro:        docNroOCero(p.ReceptorDocNro),
		ImporteTotal:  p.Importe.StringFixed(2),
		Fecha:         w.ahora().In(loc).Format("2006-01-02"),
		ServicioDesde: desde.Format("2006-01-02"),
		ServicioHasta: hasta.Format("2006-01-02"),
	}

	resp, err := w.llamarSidecar(ctx, req)
	if err != nil {
		// Un 422 es el sidecar diciendo que el request nunca va a servir así
		// (CUIT con dígito verificador malo, documento con letras). Reintentarlo
		// diez veces es tiempo perdido: va derecho a error para que alguien lo
		// corrija.
		w.fallar(ctx, p, err.Error(), esErrorPermanente(err))
		return false
	}
	// ARCA rechazando es una respuesta HTTP 200 con ok=false: mirar sólo el
	// status daría por emitida una factura que no existe.
	if !resp.OK || resp.CAE == "" {
		motivo := resp.Error
		if motivo == "" {
			motivo = "el sidecar no devolvio CAE"
		}
		w.fallar(ctx, p, motivo, false)
		return false
	}

	ahora := w.ahora()
	resultado := repository.ResultadoFactura{
		Numero:   resp.Numero,
		CAE:      resp.CAE,
		CAEVence: parseFechaCAE(resp.CAEVencimiento),
	}
	if err := w.repo.SellarComprobante(ctx, p.ComprobanteID, resultado, ahora); err != nil {
		// El CAE existe en ARCA pero no quedó en la base. Es el peor caso del
		// módulo y por eso se loguea con todo lo que hace falta para repararlo
		// a mano; el lease evita que se vuelva a facturar en el próximo tick.
		log.Error().Err(err).
			Str("comprobante_id", p.ComprobanteID).
			Str("cae", resp.CAE).
			Int64("numero", resp.Numero).
			Msg("worker facturador: CAE obtenido pero no persistido")
		return false
	}

	log.Info().
		Str("comprobante_id", p.ComprobanteID).
		Str("negocio_id", p.NegocioID).
		Msg("worker facturador: factura emitida")

	w.avisarAlCliente(ctx, p, resp)
	return true
}

// avisarAlCliente manda la factura por el mismo WhatsApp donde el paciente sacó
// el turno. Un error acá no vuelve atrás la factura: ya está emitida en ARCA.
func (w *Facturador) avisarAlCliente(ctx context.Context, p repository.ComprobantePendiente, resp respuestaFactura) {
	if w.pub == nil || p.WaPhoneID == "" || p.Telefono == "" {
		return
	}

	texto := fmt.Sprintf("Listo, %s. Tu factura C N° %s por %s ya está emitida. CAE %s",
		nombreOSaludo(p.ClienteNombre),
		numeroComprobante(p.PuntoVenta, resp.Numero),
		montoES(p.Importe.StringFixed(2)),
		resp.CAE,
	)
	if v := parseFechaCAE(resp.CAEVencimiento); v != nil {
		texto += fmt.Sprintf(" (vence el %02d/%02d/%d)", v.Day(), int(v.Month()), v.Year())
	}
	texto += "."

	msg := MensajeSalida{
		NegocioID: p.NegocioID,
		WaPhoneID: p.WaPhoneID,
		Telefono:  p.Telefono,
		Tipo:      TipoTexto,
		Texto:     texto,
	}
	if err := w.pub.Publicar(ctx, msg); err != nil {
		log.Error().Err(err).Str("comprobante_id", p.ComprobanteID).
			Msg("worker facturador: factura emitida pero el aviso no se encoló")
	}
}

// fallar anota el error y programa el próximo intento. permanente corta la
// serie de una: no hay reintento que arregle un certificado que no se descifra.
func (w *Facturador) fallar(ctx context.Context, p repository.ComprobantePendiente, motivo string, permanente bool) {
	intentos := p.RetryCount + 1
	estado := model.ComprobantePendiente
	var proximo *time.Time

	if permanente || intentos >= FacturadorMaxIntentos {
		estado = model.ComprobanteError
	} else {
		t := w.ahora().Add(BackoffFacturacion(intentos))
		proximo = &t
	}

	if err := w.repo.ProgramarReintento(ctx, p.ComprobanteID, intentos, proximo, motivo, estado); err != nil {
		log.Error().Err(err).Str("comprobante_id", p.ComprobanteID).
			Msg("worker facturador: no se pudo programar el reintento")
		return
	}

	ev := log.Warn()
	if estado == model.ComprobanteError {
		ev = log.Error()
	}
	// El motivo va al log, el request NO: lleva el certificado y la clave
	// privada del negocio adentro.
	ev.Str("comprobante_id", p.ComprobanteID).
		Str("negocio_id", p.NegocioID).
		Int("intentos", intentos).
		Str("estado", string(estado)).
		Str("motivo", motivo).
		Msg("worker facturador: intento fallido")
}

// BackoffFacturacion crece por cinco desde un minuto (1m, 5m, 25m, 2h05, …) y
// se planta en seis horas: si ARCA está caída medio día, no tiene sentido
// esperar una semana para el siguiente intento.
func BackoffFacturacion(intento int) time.Duration {
	if intento < 1 {
		intento = 1
	}
	d := backoffBase
	for i := 1; i < intento; i++ {
		d *= 5
		if d >= backoffTope {
			return backoffTope
		}
	}
	if d > backoffTope {
		return backoffTope
	}
	return d
}

// ── El contrato con el sidecar ────────────────────────────────────────────

// solicitudFactura es el body de POST ${ARCA_SIDECAR_URL}/facturar. Los
// nombres son parte del protocolo con W4-B: renombrar uno rompe el otro lado
// en silencio.
//
// cert_pem y key_pem viajan en claro dentro del request: por eso el sidecar
// vive en la red interna y este body no se loguea nunca, ni en debug.
type solicitudFactura struct {
	CUITEmisor    string `json:"cuit_emisor"`
	PuntoVenta    int    `json:"punto_venta"`
	Modo          string `json:"modo"`
	CertPEM       string `json:"cert_pem"`
	KeyPEM        string `json:"key_pem"`
	TipoCbte      int    `json:"tipo_cbte"`
	Concepto      int    `json:"concepto"`
	DocTipo       int    `json:"doc_tipo"`
	DocNro        string `json:"doc_nro"`
	ImporteTotal  string `json:"importe_total"`
	Fecha         string `json:"fecha"`
	ServicioDesde string `json:"servicio_desde"`
	ServicioHasta string `json:"servicio_hasta"`
}

// errorPermanente marca un fallo que no mejora reintentando: el request está
// mal armado y va a estar igual de mal dentro de seis horas.
type errorPermanente struct{ error }

func (e errorPermanente) Unwrap() error { return e.error }

// esErrorPermanente decide si vale la pena volver a intentar.
func esErrorPermanente(err error) bool {
	var p errorPermanente
	return errors.As(err, &p)
}

// respuestaFactura es lo que devuelve el sidecar.
type respuestaFactura struct {
	OK             bool   `json:"ok"`
	Numero         int64  `json:"numero"`
	CAE            string `json:"cae"`
	CAEVencimiento string `json:"cae_vencimiento"`
	Error          string `json:"error"`
}

func (w *Facturador) llamarSidecar(ctx context.Context, in solicitudFactura) (respuestaFactura, error) {
	var vacia respuestaFactura

	cuerpo, err := json.Marshal(in)
	if err != nil {
		return vacia, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url+"/facturar", bytes.NewReader(cuerpo))
	if err != nil {
		return vacia, err
	}
	req.Header.Set("Content-Type", "application/json")
	if w.token != "" {
		req.Header.Set("X-Internal-Token", w.token)
	}

	res, err := w.http.Do(req)
	if err != nil {
		return vacia, fmt.Errorf("sidecar inalcanzable: %w", err)
	}
	defer func() { _ = res.Body.Close() }()

	crudo, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return vacia, fmt.Errorf("respuesta del sidecar ilegible: %w", err)
	}

	var out respuestaFactura
	errJSON := json.Unmarshal(crudo, &out)

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		detalle := out.Error
		if errJSON != nil || detalle == "" {
			detalle = strings.TrimSpace(string(crudo))
		}
		err := fmt.Errorf("sidecar HTTP %d: %s", res.StatusCode, recorte(detalle, 300))
		if res.StatusCode == http.StatusUnprocessableEntity {
			// El 401 (token interno mal configurado) SÍ se reintenta: se arregla
			// con una variable de entorno y el comprobante se cura solo.
			return vacia, errorPermanente{err}
		}
		return vacia, err
	}
	if errJSON != nil {
		return vacia, fmt.Errorf("respuesta del sidecar no es JSON: %s", recorte(string(crudo), 200))
	}
	return out, nil
}

// ── Formato ───────────────────────────────────────────────────────────────

// parseFechaCAE acepta el YYYYMMDD del WSFEv1 y también el YYYY-MM-DD que el
// sidecar puede normalizar. Devuelve nil si no entiende: una fecha rota no
// puede voltear una factura que ya tiene CAE.
func parseFechaCAE(s string) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	for _, layout := range []string{"2006-01-02", "20060102", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	return nil
}

// numeroComprobante formatea "0001-00000123", como sale impreso.
func numeroComprobante(puntoVenta int, numero int64) string {
	return fmt.Sprintf("%04d-%08d", puntoVenta, numero)
}

// docNroOCero: ARCA quiere un 0 cuando el receptor es consumidor final.
func docNroOCero(nro string) string {
	nro = strings.TrimSpace(nro)
	if nro == "" {
		return "0"
	}
	return nro
}

// montoES pasa "12500.00" a "$12.500,00": el mensaje lo lee un paciente, no un
// contador.
func montoES(fijo string) string {
	entero, decimales := fijo, "00"
	if i := strings.IndexByte(fijo, '.'); i >= 0 {
		entero, decimales = fijo[:i], fijo[i+1:]
	}
	signo := ""
	if strings.HasPrefix(entero, "-") {
		signo, entero = "-", entero[1:]
	}
	var b strings.Builder
	for i, d := range entero {
		if i > 0 && (len(entero)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(d)
	}
	return signo + "$" + b.String() + "," + decimales
}

func recorte(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max]
}
