package service

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/repository"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// ErrRangoInvalido: el informe sólo sabe de dos ventanas, semanal y mensual.
// El handler lo mapea a 422.
var ErrRangoInvalido = errors.New("rango invalido: semanal o mensual")

// diasDeRango: cuántos días calendario cubre cada informe, contando hasta hoy
// inclusive. Son ventanas móviles, no la semana o el mes del calendario: al
// dueño le importa "los últimos siete días", no "desde el lunes".
var diasDeRango = map[string]int{
	"semanal": 7,
	"mensual": 30,
}

// ReporteService arma los informes por día que el panel dibuja debajo del
// cierre. Todo en la zona del negocio.
type ReporteService interface {
	PorRango(ctx context.Context, negocioID, rango string) (*dto.ReporteResponse, error)
}

type reporteService struct {
	repo     repository.ReporteRepository
	negocios repository.NegocioDatosRepository
}

func NewReporteService(repo repository.ReporteRepository, negocios repository.NegocioDatosRepository) ReporteService {
	return &reporteService{repo: repo, negocios: negocios}
}

func (s *reporteService) PorRango(ctx context.Context, negocioID, rango string) (*dto.ReporteResponse, error) {
	dias, ok := diasDeRango[rango]
	if !ok {
		return nil, ErrRangoInvalido
	}

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

	// La ventana termina al final de hoy (mañana a las 00:00, exclusivo) y
	// arranca `dias` días atrás, todo en la pared local del negocio.
	ahora := time.Now().In(loc)
	finExclusivo := time.Date(ahora.Year(), ahora.Month(), ahora.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	desde := finExclusivo.AddDate(0, 0, -dias)

	porDia, err := s.repo.TotalesPorDia(ctx, negocioID, desde, finExclusivo, neg.Timezone)
	if err != nil {
		return nil, err
	}

	out := &dto.ReporteResponse{
		Rango:        rango,
		Desde:        desde.Format("2006-01-02"),
		Hasta:        finExclusivo.AddDate(0, 0, -1).Format("2006-01-02"),
		Timezone:     neg.Timezone,
		Dias:         make([]dto.ReporteDia, 0, dias),
		TotalVendido: decimal.Zero,
		TotalCobrado: decimal.Zero,
	}

	// Se recorre día por día para rellenar los ceros: la serie tiene que tener
	// todas las barras, así el panel no dibuja una tabla con huecos.
	for i := 0; i < dias; i++ {
		fecha := desde.AddDate(0, 0, i).Format("2006-01-02")
		t := porDia[fecha]
		vendido, cobrado := t.Vendido, t.Cobrado
		if vendido.IsZero() {
			vendido = decimal.Zero
		}
		if cobrado.IsZero() {
			cobrado = decimal.Zero
		}
		out.Dias = append(out.Dias, dto.ReporteDia{Fecha: fecha, Vendido: vendido, Cobrado: cobrado})
		out.TotalVendido = out.TotalVendido.Add(vendido)
		out.TotalCobrado = out.TotalCobrado.Add(cobrado)
	}

	return out, nil
}
