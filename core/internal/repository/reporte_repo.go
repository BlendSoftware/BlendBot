package repository

import (
	"context"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// TotalDia es lo vendido y lo cobrado de un día calendario del negocio.
// Vendido = total de los compromisos entregados (estado completado) de ese día;
// Cobrado = plata que entró por caja ese día. Los dos números casi nunca son
// iguales: un pedido puede entregarse sin cobrarse por el panel, y ese es
// justo el agujero que el dueño vio (lo entregado no aparecía).
type TotalDia struct {
	Fecha   string
	Vendido decimal.Decimal
	Cobrado decimal.Decimal
}

// ReporteRepository arma los informes por día. Es sólo lectura y agrega sobre
// compromiso y cobro; tenant-scoped como todo lo demás.
type ReporteRepository interface {
	// TotalesPorDia devuelve, por fecha local (YYYY-MM-DD en la zona del
	// negocio), lo vendido y lo cobrado dentro del rango [desde, hasta) que el
	// service ya resolvió. tz es el nombre de la zona para bucketear por día
	// calendario local, no por el día UTC.
	TotalesPorDia(ctx context.Context, negocioID string, desde, hasta time.Time, tz string) (map[string]TotalDia, error)
}

type reporteRepo struct{ db *gorm.DB }

func NewReporteRepository(db *gorm.DB) ReporteRepository { return &reporteRepo{db: db} }

func (r *reporteRepo) TotalesPorDia(ctx context.Context, negocioID string, desde, hasta time.Time, tz string) (map[string]TotalDia, error) {
	out := map[string]TotalDia{}

	// Lo vendido se cuenta por cerrado_en (cuándo se entregó), no por cuándo se
	// pidió: un pedido tomado ayer y entregado hoy es de hoy. El AT TIME ZONE
	// baja el timestamptz a la pared local del negocio antes de recortar el día.
	var vendidos []struct {
		Fecha   string
		Vendido decimal.Decimal
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT to_char((cerrado_en AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS fecha,
		       COALESCE(SUM(total), 0) AS vendido
		FROM compromiso
		WHERE negocio_id = ? AND estado = 'completado'
		  AND cerrado_en >= ? AND cerrado_en < ?
		GROUP BY fecha
	`, tz, negocioID, desde, hasta).Scan(&vendidos).Error
	if err != nil {
		return nil, err
	}
	for _, v := range vendidos {
		out[v.Fecha] = TotalDia{Fecha: v.Fecha, Vendido: v.Vendido, Cobrado: decimal.Zero}
	}

	var cobrados []struct {
		Fecha   string
		Cobrado decimal.Decimal
	}
	err = r.db.WithContext(ctx).Raw(`
		SELECT to_char((cobrado_en AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS fecha,
		       COALESCE(SUM(monto), 0) AS cobrado
		FROM cobro
		WHERE negocio_id = ?
		  AND cobrado_en >= ? AND cobrado_en < ?
		GROUP BY fecha
	`, tz, negocioID, desde, hasta).Scan(&cobrados).Error
	if err != nil {
		return nil, err
	}
	for _, c := range cobrados {
		d := out[c.Fecha] // vale el cero-value si el día no vendió nada
		d.Fecha = c.Fecha
		d.Cobrado = c.Cobrado
		if d.Vendido.IsZero() {
			d.Vendido = decimal.Zero
		}
		out[c.Fecha] = d
	}

	return out, nil
}
