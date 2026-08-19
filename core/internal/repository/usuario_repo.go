package repository

import (
	"context"

	"copiloto/core/internal/model"

	"gorm.io/gorm"
)

// UsuarioRepository maneja los usuarios del panel. El username es único a nivel
// plataforma (no por negocio), así el login no necesita saber el tenant.
type UsuarioRepository interface {
	Create(ctx context.Context, u *model.Usuario) error
	GetByUsername(ctx context.Context, username string) (*model.Usuario, error)
	GetByID(ctx context.Context, id string) (*model.Usuario, error)
	Update(ctx context.Context, u *model.Usuario) error
	WithTx(tx *gorm.DB) UsuarioRepository
}

type usuarioRepository struct{ db *gorm.DB }

func NewUsuarioRepository(db *gorm.DB) UsuarioRepository {
	return &usuarioRepository{db: db}
}

func (r *usuarioRepository) WithTx(tx *gorm.DB) UsuarioRepository {
	return &usuarioRepository{db: tx}
}

func (r *usuarioRepository) Create(ctx context.Context, u *model.Usuario) error {
	return r.db.WithContext(ctx).Create(u).Error
}

func (r *usuarioRepository) GetByUsername(ctx context.Context, username string) (*model.Usuario, error) {
	var u model.Usuario
	if err := r.db.WithContext(ctx).First(&u, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *usuarioRepository) GetByID(ctx context.Context, id string) (*model.Usuario, error) {
	var u model.Usuario
	if err := r.db.WithContext(ctx).First(&u, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *usuarioRepository) Update(ctx context.Context, u *model.Usuario) error {
	res := r.db.WithContext(ctx).Model(&model.Usuario{}).
		Where("id = ?", u.ID).
		Select("password_hash", "rol", "activo", "must_change_password").
		Updates(u)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
