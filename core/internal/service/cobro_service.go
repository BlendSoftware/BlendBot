package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/infra"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// CobroService es lo que convierte el asistente en un sistema de gestión: se
// cobra el turno atendido y, si el negocio tiene configuración fiscal, nace el
// comprobante que el worker facturador va a llevar hasta el CAE.
type CobroService interface {
	Cobrar(ctx context.Context, negocioID string, usuarioID *string, in dto.CobrarInput) (*dto.CobroResponse, error)
	PorCompromiso(ctx context.Context, negocioID, compromisoID string) (*dto.CobroResponse, error)
	CierreDelDia(ctx context.Context, negocioID string, fecha time.Time) (*dto.CierreResponse, error)

	// Fiscal: sólo admin de la plataforma. El negocio llega por la URL, no por
	// el token, porque un admin no tiene tenant.
	ConfigurarFiscal(ctx context.Context, negocioID string, in dto.ConfigFiscalInput) (*dto.ConfigFiscalResponse, error)
	ObtenerFiscal(ctx context.Context, negocioID string) (*dto.ConfigFiscalResponse, error)
}

type cobroService struct {
	repo     repository.CobroRepository
	negocios repository.NegocioDatosRepository
	cifrador infra.Cifrador // nil = no hay FISCAL_CIPHER_KEY configurada
}

// NewCobroService recibe el cifrador ya construido; nil significa que el
// módulo fiscal no puede guardar certificados y lo va a decir con
// ErrCifradoNoConfigurado en vez de guardarlos en claro.
func NewCobroService(repo repository.CobroRepository, negocios repository.NegocioDatosRepository, cifrador infra.Cifrador) CobroService {
	return &cobroService{repo: repo, negocios: negocios, cifrador: cifrador}
}

// ── Cobrar ────────────────────────────────────────────────────────────────
//
// Sólo se cobra un compromiso COMPLETADO: cobrar algo que todavía no se
// prestó es exactamente el problema que la factura electrónica no perdona.
// El monto sale del total congelado del compromiso, nunca del request.
func (s *cobroService) Cobrar(ctx context.Context, negocioID string, usuarioID *string, in dto.CobrarInput) (*dto.CobroResponse, error) {
	if !model.EsMedioPagoValido(in.MedioPago) {
		return nil, ErrMedioPagoInvalido
	}

	comp, err := s.repo.CompromisoACobrar(ctx, negocioID, in.CompromisoID)
	if err != nil {
		return nil, err
	}
	if comp == nil {
		return nil, ErrNoEncontrado
	}
	if comp.Estado != model.EstadoCompletado {
		return nil, ErrNoCobrable
	}

	// Chequeo temprano por cortesía: el árbitro real es el UNIQUE de la base,
	// que es lo único que resuelve dos clicks simultáneos.
	yaCobro, _, err := s.repo.PorCompromiso(ctx, negocioID, in.CompromisoID)
	if err != nil {
		return nil, err
	}
	if yaCobro != nil {
		return nil, ErrYaCobrado
	}

	cobro := &model.Cobro{
		NegocioID:    negocioID,
		CompromisoID: in.CompromisoID,
		UsuarioID:    usuarioID,
		MedioPago:    model.MedioPago(in.MedioPago),
		Monto:        comp.Total,
	}

	comprobante, err := s.armarComprobante(ctx, negocioID, comp)
	if err != nil {
		return nil, err
	}

	if err := s.repo.CrearCobro(ctx, cobro, comprobante); err != nil {
		if errors.Is(err, repository.ErrCobroDuplicado) {
			return nil, ErrYaCobrado
		}
		return nil, err
	}

	return dto.CobroDesdeModel(cobro, comprobante), nil
}

// armarComprobante devuelve nil (sin error) si el negocio todavía no cargó su
// CUIT: se cobra igual y el response lo aclara. El onboarding fiscal es un
// trámite aparte y no puede bloquear la caja.
func (s *cobroService) armarComprobante(ctx context.Context, negocioID string, c *repository.CompromisoACobrar) (*model.Comprobante, error) {
	cf, err := s.repo.ConfigFiscal(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	if cf == nil || strings.TrimSpace(cf.CUIT) == "" {
		return nil, nil
	}
	// ARCA no acepta un comprobante en cero. Una prestación bonificada se
	// registra como cobro y punto: no hay factura que emitir, y crear una sería
	// condenarla a quedar en error para siempre.
	if !c.Total.IsPositive() {
		return nil, nil
	}

	// El documento del paciente es texto libre: si no quedan dígitos usables,
	// la factura sale a consumidor final en vez de irse a un 422 permanente.
	docTipo := model.DocTipoConsumidorFinal
	var docNro *string
	if d := soloDigitos(c.Documento); d != "" {
		docTipo = model.DocTipoDNI
		docNro = &d
	}

	return &model.Comprobante{
		TipoCbte:        model.TipoCbteFacturaC,
		PuntoVenta:      cf.PuntoVenta,
		Estado:          model.ComprobantePendiente,
		ReceptorDocTipo: docTipo,
		ReceptorDocNro:  docNro,
		Importe:         c.Total,
	}, nil
}

func (s *cobroService) PorCompromiso(ctx context.Context, negocioID, compromisoID string) (*dto.CobroResponse, error) {
	cobro, comp, err := s.repo.PorCompromiso(ctx, negocioID, compromisoID)
	if err != nil {
		return nil, err
	}
	if cobro == nil {
		return nil, ErrNoEncontrado
	}
	return dto.CobroDesdeModel(cobro, comp), nil
}

// ── Cierre del día ────────────────────────────────────────────────────────
//
// fecha se trata como día calendario: se toman año, mes y día tal cual vienen
// y se los planta en la timezone del negocio. Un cierre calculado en UTC le
// mete al consultorio de Mendoza las tres primeras horas del día siguiente.
func (s *cobroService) CierreDelDia(ctx context.Context, negocioID string, fecha time.Time) (*dto.CierreResponse, error) {
	neg, err := s.negocios.Negocio(ctx, negocioID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}
	loc, err := time.LoadLocation(neg.Timezone)
	if err != nil {
		return nil, ErrTimezoneInvalida
	}

	desde := time.Date(fecha.Year(), fecha.Month(), fecha.Day(), 0, 0, 0, 0, loc)
	hasta := desde.AddDate(0, 0, 1)

	r, err := s.repo.Cierre(ctx, negocioID, desde, hasta)
	if err != nil {
		return nil, err
	}

	ticket := decimal.Zero
	if r.Cobros > 0 {
		ticket = r.TotalCobrado.Div(decimal.NewFromInt(int64(r.Cobros))).Round(2)
	}

	return &dto.CierreResponse{
		Fecha:          desde.Format("2006-01-02"),
		Timezone:       neg.Timezone,
		Compromisos:    r.Compromisos,
		Completados:    r.Completados,
		Cancelados:     r.Cancelados,
		Ausentes:       r.Ausentes,
		PorOrigen:      r.PorOrigen,
		Cobros:         r.Cobros,
		TotalCobrado:   r.TotalCobrado,
		TicketPromedio: ticket,
		PorMedioPago:   r.PorMedioPago,
		Comprobantes: dto.ResumenComprobantes{
			Emitidos:   r.Emitidos,
			Pendientes: r.Pendientes,
			ConError:   r.ConError,
		},
	}, nil
}

// ── Configuración fiscal ──────────────────────────────────────────────────

func (s *cobroService) ConfigurarFiscal(ctx context.Context, negocioID string, in dto.ConfigFiscalInput) (*dto.ConfigFiscalResponse, error) {
	if _, err := s.negocios.Negocio(ctx, negocioID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNoEncontrado
		}
		return nil, err
	}

	// El dígito verificador se valida acá y no en el sidecar: un CUIT mal
	// tipeado que pasa la validación se descubre recién cuando la primera
	// factura queda en error, y para entonces el paciente ya se fue.
	cuit := soloDigitos(in.CUIT)
	if len(cuit) != 11 || !cuitValido(cuit) {
		return nil, ErrCUITInvalido
	}

	actual, err := s.repo.ConfigFiscal(ctx, negocioID)
	if err != nil {
		return nil, err
	}

	cf := &model.ConfigFiscal{
		NegocioID:     negocioID,
		CUIT:          cuit,
		RazonSocial:   in.RazonSocial,
		Condicion:     "monotributo",
		PuntoVenta:    1,
		Modo:          model.ModoHomologacion,
		ActualizadoEn: time.Now(),
	}
	if actual != nil {
		cf.Condicion, cf.PuntoVenta, cf.Modo = actual.Condicion, actual.PuntoVenta, actual.Modo
	}
	if in.Condicion != nil && strings.TrimSpace(*in.Condicion) != "" {
		cf.Condicion = strings.TrimSpace(*in.Condicion)
	}
	if in.PuntoVenta != nil {
		if *in.PuntoVenta <= 0 {
			return nil, ErrPuntoVentaInvalido
		}
		cf.PuntoVenta = *in.PuntoVenta
	}
	if in.Modo != nil && strings.TrimSpace(*in.Modo) != "" {
		m := strings.TrimSpace(*in.Modo)
		if !model.EsModoFiscalValido(m) {
			return nil, ErrModoFiscalInvalido
		}
		cf.Modo = m
	}

	// Los PEM son opcionales en el PUT: mandarlos vacíos deja los que ya
	// estaban. Lo que nunca pasa es guardarlos sin cifrar.
	if cert, err := s.cifrarPEM(in.CertPEM); err != nil {
		return nil, err
	} else if cert != nil {
		cf.CertPEMCifrado = cert
	}
	if key, err := s.cifrarPEM(in.KeyPEM); err != nil {
		return nil, err
	} else if key != nil {
		cf.KeyPEMCifrado = key
	}

	if err := s.repo.GuardarConfigFiscal(ctx, cf); err != nil {
		return nil, err
	}

	// Se relee para que TieneCertificados refleje también los que ya estaban.
	guardada, err := s.repo.ConfigFiscal(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	return dto.ConfigFiscalDesdeModel(guardada), nil
}

// cifrarPEM devuelve nil si no hay nada que guardar. Si hay PEM y no hay
// cifrador, falla: un certificado en claro en la base no es una opción.
func (s *cobroService) cifrarPEM(pem *string) (*string, error) {
	if pem == nil || strings.TrimSpace(*pem) == "" {
		return nil, nil
	}
	if s.cifrador == nil {
		return nil, ErrCifradoNoConfigurado
	}
	cifrado, err := s.cifrador.Cifrar(strings.TrimSpace(*pem))
	if err != nil {
		return nil, err
	}
	return &cifrado, nil
}

func (s *cobroService) ObtenerFiscal(ctx context.Context, negocioID string) (*dto.ConfigFiscalResponse, error) {
	cf, err := s.repo.ConfigFiscal(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	if cf == nil {
		return nil, ErrNoEncontrado
	}
	return dto.ConfigFiscalDesdeModel(cf), nil
}

func soloDigitos(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// cuitValido verifica el dígito verificador (módulo 11 sobre los pesos de
// ARCA). Es la única validación que atrapa un 20123456780 mal tipeado antes de
// que ARCA lo rechace.
func cuitValido(cuit string) bool {
	if len(cuit) != 11 {
		return false
	}
	pesos := [10]int{5, 4, 3, 2, 7, 6, 5, 4, 3, 2}
	suma := 0
	for i := 0; i < 10; i++ {
		suma += int(cuit[i]-'0') * pesos[i]
	}
	verificador := 11 - suma%11
	switch verificador {
	case 11:
		verificador = 0
	case 10:
		verificador = 9
	}
	return verificador == int(cuit[10]-'0')
}
