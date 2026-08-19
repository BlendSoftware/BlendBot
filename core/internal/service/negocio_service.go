package service

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var (
	ErrNegocioNoExiste  = errors.New("negocio no encontrado")
	ErrUsuarioDuplicado = errors.New("el username ya esta tomado")
)

// NegocioService es el alta de tenants: sólo el rol admin de la plataforma.
type NegocioService interface {
	// Alta crea el negocio y su usuario dueño en una sola transacción.
	Alta(ctx context.Context, req dto.AltaNegocioRequest) (*dto.AltaNegocioResponse, error)
	List(ctx context.Context) ([]model.Negocio, error)
	GetByID(ctx context.Context, id string) (*model.Negocio, error)
	Update(ctx context.Context, id string, req dto.ActualizarNegocioRequest) (*model.Negocio, error)
	// Baja es soft: activo=false. No se borra un tenant con historia.
	Baja(ctx context.Context, id string) error
}

type negocioService struct {
	db       *gorm.DB
	negocios repository.NegocioRepository
	usuarios repository.UsuarioRepository
}

func NewNegocioService(db *gorm.DB, negocios repository.NegocioRepository, usuarios repository.UsuarioRepository) NegocioService {
	return &negocioService{db: db, negocios: negocios, usuarios: usuarios}
}

func (s *negocioService) Alta(ctx context.Context, req dto.AltaNegocioRequest) (*dto.AltaNegocioResponse, error) {
	if _, err := s.usuarios.GetByUsername(ctx, req.UsuarioDueno); err == nil {
		return nil, ErrUsuarioDuplicado
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	passwordTemporal, err := generarPasswordTemporal()
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(passwordTemporal), costoBcrypt)
	if err != nil {
		return nil, err
	}

	negocio := &model.Negocio{
		Nombre:    req.Nombre,
		Vertical:  model.Vertical(req.Vertical),
		Timezone:  req.Timezone,
		WaPhoneID: req.WaPhoneID,
		WaWabaID:  req.WaWabaID,
		Config:    datatypes.JSON(`{}`),
		Activo:    true,
	}
	if negocio.Timezone == "" {
		negocio.Timezone = "America/Argentina/Mendoza"
	}
	if len(req.Config) > 0 {
		negocio.Config = datatypes.JSON(req.Config)
	}

	dueno := &model.Usuario{
		Username:     req.UsuarioDueno,
		PasswordHash: string(hash),
		Rol:          middleware.RolDueno,
		Activo:       true,
		// El dueño entra con una contraseña temporal y la cambia sí o sí.
		MustChangePassword: true,
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.negocios.WithTx(tx).Create(ctx, negocio); err != nil {
			return err
		}
		dueno.NegocioID = &negocio.ID
		return s.usuarios.WithTx(tx).Create(ctx, dueno)
	})
	if err != nil {
		return nil, err
	}

	return &dto.AltaNegocioResponse{
		NegocioID: negocio.ID,
		Nombre:    negocio.Nombre,
		Vertical:  string(negocio.Vertical),
		UsuarioDueno: dto.UsuarioDTO{
			ID:                 dueno.ID,
			Username:           dueno.Username,
			Rol:                dueno.Rol,
			NegocioID:          dueno.NegocioID,
			MustChangePassword: dueno.MustChangePassword,
		},
		PasswordTemporal: passwordTemporal, // se muestra una sola vez
	}, nil
}

func (s *negocioService) List(ctx context.Context) ([]model.Negocio, error) {
	return s.negocios.List(ctx)
}

func (s *negocioService) GetByID(ctx context.Context, id string) (*model.Negocio, error) {
	n, err := s.negocios.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNegocioNoExiste
	}
	return n, err
}

func (s *negocioService) Update(ctx context.Context, id string, req dto.ActualizarNegocioRequest) (*model.Negocio, error) {
	n, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if req.Nombre != nil {
		n.Nombre = *req.Nombre
	}
	if req.Timezone != nil {
		n.Timezone = *req.Timezone
	}
	if req.WaPhoneID != nil {
		n.WaPhoneID = req.WaPhoneID
	}
	if req.WaWabaID != nil {
		n.WaWabaID = req.WaWabaID
	}
	if len(req.Config) > 0 {
		n.Config = datatypes.JSON(req.Config)
	}
	if req.Activo != nil {
		n.Activo = *req.Activo
	}
	if err := s.negocios.Update(ctx, n); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNegocioNoExiste
		}
		return nil, err
	}
	return n, nil
}

func (s *negocioService) Baja(ctx context.Context, id string) error {
	n, err := s.GetByID(ctx, id)
	if err != nil {
		return err
	}
	n.Activo = false
	if err := s.negocios.Update(ctx, n); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNegocioNoExiste
		}
		return err
	}
	return nil
}

// alfabetoTemporal evita caracteres que se confunden al dictarlos por teléfono
// (0/O, 1/l/I): la contraseña se le pasa al dueño a mano una única vez.
const alfabetoTemporal = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generarPasswordTemporal() (string, error) {
	const largo = 14
	b := make([]byte, largo)
	max := big.NewInt(int64(len(alfabetoTemporal)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b[i] = alfabetoTemporal[n.Int64()]
	}
	return string(b), nil
}
