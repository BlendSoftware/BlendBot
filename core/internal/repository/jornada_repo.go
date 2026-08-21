package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// ErrJornadaYaAbierta: el negocio ya tiene una caja abierta. Lo levanta el
// índice único parcial (una jornada abierta por negocio), así que aguanta dos
// requests simultáneos: el segundo choca y se vuelve un 409.
var ErrJornadaYaAbierta = errors.New("el negocio ya tiene una jornada abierta")

// JornadaRepository maneja el ciclo de la caja del día. Tenant-scoped: todo
// método recibe negocioID y filtra por él.
type JornadaRepository interface {
	// Actual devuelve la jornada abierta del negocio, o nil si no hay ninguna.
	Actual(ctx context.Context, negocioID string) (*model.Jornada, error)
	// Abrir inserta una jornada abierta. Devuelve ErrJornadaYaAbierta si ya
	// había una (lo arbitra el índice único parcial, no un chequeo previo).
	Abrir(ctx context.Context, j *model.Jornada) error
	// Cerrar cierra la jornada abierta del negocio y la devuelve ya cerrada.
	// Devuelve nil (sin error) si no había ninguna abierta.
	Cerrar(ctx context.Context, negocioID string, usuarioID *string, ahora time.Time) (*model.Jornada, error)
}

type jornadaRepo struct{ db *gorm.DB }

func NewJornadaRepository(db *gorm.DB) JornadaRepository { return &jornadaRepo{db: db} }

func (r *jornadaRepo) Actual(ctx context.Context, negocioID string) (*model.Jornada, error) {
	var j model.Jornada
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND cerrada_en IS NULL", negocioID).
		Take(&j).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (r *jornadaRepo) Abrir(ctx context.Context, j *model.Jornada) error {
	err := r.db.WithContext(ctx).Create(j).Error
	if err != nil && esViolacionDeUnicidad(err) {
		return ErrJornadaYaAbierta
	}
	return err
}

func (r *jornadaRepo) Cerrar(ctx context.Context, negocioID string, usuarioID *string, ahora time.Time) (*model.Jornada, error) {
	j, err := r.Actual(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	if j == nil {
		return nil, nil
	}
	// La condición sobre cerrada_en deja el cierre idempotente: si otra pestaña
	// ganó la carrera entre el Actual y este UPDATE, no afecta filas y se
	// devuelve nil en vez de pisar el cerrada_en bueno.
	res := r.db.WithContext(ctx).
		Model(&model.Jornada{}).
		Where("id = ? AND cerrada_en IS NULL", j.ID).
		Updates(map[string]any{"cerrada_en": ahora, "cerrada_por": usuarioID})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, nil
	}
	j.CerradaEn = &ahora
	j.CerradaPor = usuarioID
	return j, nil
}
