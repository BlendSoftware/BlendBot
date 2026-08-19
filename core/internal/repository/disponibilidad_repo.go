package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// CompromisoAgenda es una fila de la agenda del día: el compromiso con los
// datos del cliente ya resueltos. El modelo no tiene la relación cargada y la
// agenda la necesita sí o sí (quién viene y a qué teléfono avisarle).
type CompromisoAgenda struct {
	ID              string                 `gorm:"column:id"`
	RecursoID       *string                `gorm:"column:recurso_id"`
	ClienteID       string                 `gorm:"column:cliente_id"`
	Tipo            model.TipoCompromiso   `gorm:"column:tipo"`
	Estado          model.EstadoCompromiso `gorm:"column:estado"`
	Inicio          *time.Time             `gorm:"column:inicio"`
	Fin             *time.Time             `gorm:"column:fin"`
	Total           decimal.Decimal        `gorm:"column:total"`
	Nota            *string                `gorm:"column:nota"`
	ClienteNombre   *string                `gorm:"column:cliente_nombre"`
	ClienteTelefono string                 `gorm:"column:cliente_telefono"`
	// CobroID no nil = el turno ya está cobrado. ComprobanteEstado es nil
	// cuando no hay cobro o cuando el cobro salió sin factura (el negocio no
	// tiene datos de ARCA cargados).
	CobroID           *string                  `gorm:"column:cobro_id"`
	ComprobanteEstado *model.EstadoComprobante `gorm:"column:comprobante_estado"`
}

// DisponibilidadRepository son las lecturas que alimentan el cálculo de huecos
// y la agenda del día. Todo método recibe negocioID y filtra por él; horario,
// excepcion y hold no tienen negocio_id, así que se acotan por subconsulta
// contra recurso, que es donde vive el tenant.
type DisponibilidadRepository interface {
	Negocio(ctx context.Context, negocioID string) (*model.Negocio, error)
	// ServicioDisponible devuelve nil (sin error) si el servicio no existe para
	// el tenant, está inactivo o tiene el interruptor apagado.
	ServicioDisponible(ctx context.Context, negocioID, servicioID string) (*model.Servicio, error)
	// RecursosDeServicio son los recursos activos vinculados por
	// servicio_recurso; si el servicio no declara ningún vínculo, todos los
	// recursos activos de tipo profesional del tenant.
	RecursosDeServicio(ctx context.Context, negocioID, servicioID string) ([]model.Recurso, error)
	RecursosActivos(ctx context.Context, negocioID string) ([]model.Recurso, error)
	HorariosDeRecursos(ctx context.Context, negocioID string, recursoIDs []string) ([]model.Horario, error)
	ExcepcionesEnRango(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta time.Time) ([]model.Excepcion, error)
	// CompromisosEnRango son los no terminales con horario asignado: los que
	// realmente ocupan la agenda.
	CompromisosEnRango(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta time.Time) ([]model.Compromiso, error)
	HoldsVigentesEnRango(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta, ahora time.Time) ([]model.Hold, error)
	// AgendaEnRango son los compromisos del rango que siguen en pie
	// (ni cancelados ni rechazados), con el cliente resuelto.
	AgendaEnRango(ctx context.Context, negocioID string, desde, hasta time.Time) ([]CompromisoAgenda, error)
}

type disponibilidadRepo struct{ db *gorm.DB }

func NewDisponibilidadRepository(db *gorm.DB) DisponibilidadRepository {
	return &disponibilidadRepo{db: db}
}

// recursosDelTenant es la subconsulta que acota horario, excepcion y hold a los
// recursos del negocio.
func (r *disponibilidadRepo) recursosDelTenant(negocioID string) *gorm.DB {
	return r.db.Model(&model.Recurso{}).Select("id").Where("negocio_id = ?", negocioID)
}

func (r *disponibilidadRepo) Negocio(ctx context.Context, negocioID string) (*model.Negocio, error) {
	var n model.Negocio
	if err := r.db.WithContext(ctx).First(&n, "id = ?", negocioID).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func (r *disponibilidadRepo) ServicioDisponible(ctx context.Context, negocioID, servicioID string) (*model.Servicio, error) {
	var s model.Servicio
	err := r.db.WithContext(ctx).
		Where("id = ? AND negocio_id = ?", servicioID, negocioID).
		Where("activo = TRUE AND disponible = TRUE").
		First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *disponibilidadRepo) RecursosDeServicio(ctx context.Context, negocioID, servicioID string) ([]model.Recurso, error) {
	// El conteo va contra los vínculos declarados, no contra los recursos
	// activos: un servicio con todos sus profesionales de baja no tiene que
	// caer al fallback y ofrecer a cualquiera.
	var vinculos int64
	err := r.db.WithContext(ctx).
		Model(&model.ServicioRecurso{}).
		Joins("JOIN servicio ON servicio.id = servicio_recurso.servicio_id AND servicio.negocio_id = ?", negocioID).
		Where("servicio_recurso.servicio_id = ?", servicioID).
		Count(&vinculos).Error
	if err != nil {
		return nil, err
	}

	if vinculos == 0 {
		var todos []model.Recurso
		err := r.db.WithContext(ctx).
			Where("negocio_id = ? AND activo = TRUE AND tipo = ?", negocioID, model.RecursoProfesional).
			Order("nombre ASC").
			Find(&todos).Error
		if err != nil {
			return nil, err
		}
		return todos, nil
	}

	var rs []model.Recurso
	err = r.db.WithContext(ctx).
		Model(&model.Recurso{}).
		Joins("JOIN servicio_recurso ON servicio_recurso.recurso_id = recurso.id").
		Where("servicio_recurso.servicio_id = ?", servicioID).
		Where("recurso.negocio_id = ? AND recurso.activo = TRUE", negocioID).
		Order("recurso.nombre ASC").
		Find(&rs).Error
	if err != nil {
		return nil, err
	}
	return rs, nil
}

func (r *disponibilidadRepo) RecursosActivos(ctx context.Context, negocioID string) ([]model.Recurso, error) {
	var rs []model.Recurso
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND activo = TRUE", negocioID).
		Order("nombre ASC").
		Find(&rs).Error
	if err != nil {
		return nil, err
	}
	return rs, nil
}

func (r *disponibilidadRepo) HorariosDeRecursos(ctx context.Context, negocioID string, recursoIDs []string) ([]model.Horario, error) {
	if len(recursoIDs) == 0 {
		return nil, nil
	}
	var hs []model.Horario
	err := r.db.WithContext(ctx).
		Where("recurso_id IN ?", recursoIDs).
		Where("recurso_id IN (?)", r.recursosDelTenant(negocioID)).
		Order("dia_semana ASC, desde ASC").
		Find(&hs).Error
	if err != nil {
		return nil, err
	}
	return hs, nil
}

func (r *disponibilidadRepo) ExcepcionesEnRango(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta time.Time) ([]model.Excepcion, error) {
	if len(recursoIDs) == 0 {
		return nil, nil
	}
	var es []model.Excepcion
	err := r.db.WithContext(ctx).
		Where("recurso_id IN ?", recursoIDs).
		Where("recurso_id IN (?)", r.recursosDelTenant(negocioID)).
		Where("desde < ? AND hasta > ?", hasta, desde).
		Order("desde ASC").
		Find(&es).Error
	if err != nil {
		return nil, err
	}
	return es, nil
}

func (r *disponibilidadRepo) CompromisosEnRango(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta time.Time) ([]model.Compromiso, error) {
	if len(recursoIDs) == 0 {
		return nil, nil
	}
	var cs []model.Compromiso
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND recurso_id IN ?", negocioID, recursoIDs).
		Where("estado NOT IN ?", estadosTerminales()).
		Where("inicio IS NOT NULL AND fin IS NOT NULL").
		Where("inicio < ? AND fin > ?", hasta, desde).
		Order("inicio ASC").
		Find(&cs).Error
	if err != nil {
		return nil, err
	}
	return cs, nil
}

func (r *disponibilidadRepo) HoldsVigentesEnRango(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta, ahora time.Time) ([]model.Hold, error) {
	if len(recursoIDs) == 0 {
		return nil, nil
	}
	var hs []model.Hold
	err := r.db.WithContext(ctx).
		Where("recurso_id IN ?", recursoIDs).
		Where("recurso_id IN (?)", r.recursosDelTenant(negocioID)).
		Where("expira_en > ?", ahora).
		Where("inicio < ? AND fin > ?", hasta, desde).
		Order("inicio ASC").
		Find(&hs).Error
	if err != nil {
		return nil, err
	}
	return hs, nil
}

func (r *disponibilidadRepo) AgendaEnRango(ctx context.Context, negocioID string, desde, hasta time.Time) ([]CompromisoAgenda, error) {
	var filas []CompromisoAgenda
	err := r.db.WithContext(ctx).
		Model(&model.Compromiso{}).
		Select(`compromiso.id, compromiso.recurso_id, compromiso.cliente_id,
			compromiso.tipo, compromiso.estado, compromiso.inicio, compromiso.fin,
			compromiso.total, compromiso.nota,
			cliente.nombre AS cliente_nombre, cliente.telefono AS cliente_telefono,
			cobro.id AS cobro_id, comprobante.estado AS comprobante_estado`).
		Joins("JOIN cliente ON cliente.id = compromiso.cliente_id AND cliente.negocio_id = compromiso.negocio_id").
		// El estado del cobro viaja con el turno para que el panel no pregunte
		// una vez por turno. Los dos LEFT JOIN son 1:1 (UNIQUE de cobro sobre
		// compromiso_id y de comprobante sobre cobro_id): no multiplican filas.
		// El negocio va repetido en la condición aunque cobro cuelgue del
		// compromiso: un join que no nombra el tenant es un cruce esperando a
		// pasar.
		Joins("LEFT JOIN cobro ON cobro.compromiso_id = compromiso.id AND cobro.negocio_id = compromiso.negocio_id").
		Joins("LEFT JOIN comprobante ON comprobante.cobro_id = cobro.id AND comprobante.negocio_id = compromiso.negocio_id").
		Where("compromiso.negocio_id = ?", negocioID).
		Where("compromiso.estado NOT IN ?", []model.EstadoCompromiso{model.EstadoCancelado, model.EstadoRechazado}).
		Where("compromiso.inicio >= ? AND compromiso.inicio < ?", desde, hasta).
		Order("compromiso.inicio ASC").
		Scan(&filas).Error
	if err != nil {
		return nil, err
	}
	return filas, nil
}

// ─── Datos del negocio y token del agente ────────────────────────────────────

// NegocioDatosRepository es la ficha que lee el agente (`datos_del_negocio`) y
// el hash del token con el que se autentica.
//
// Vive junto a la disponibilidad y no en negocio_repo.go porque
// token_agente_hash no está en model.Negocio: es una columna que sólo toca
// este flujo, y el modelo del tenant no tiene por qué cargar un secreto.
type NegocioDatosRepository interface {
	Negocio(ctx context.Context, negocioID string) (*model.Negocio, error)
	Coberturas(ctx context.Context, negocioID string) ([]model.Cobertura, error)
	// NegocioPorTokenHash devuelve "" si ningún negocio ACTIVO tiene ese hash.
	NegocioPorTokenHash(ctx context.Context, hashHex string) (string, error)
	// SetTokenAgenteHash pisa el token anterior: rotar invalida el viejo.
	SetTokenAgenteHash(ctx context.Context, negocioID, hashHex string) error
}

type negocioDatosRepo struct{ db *gorm.DB }

func NewNegocioDatosRepository(db *gorm.DB) NegocioDatosRepository {
	return &negocioDatosRepo{db: db}
}

func (r *negocioDatosRepo) Negocio(ctx context.Context, negocioID string) (*model.Negocio, error) {
	var n model.Negocio
	if err := r.db.WithContext(ctx).First(&n, "id = ?", negocioID).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func (r *negocioDatosRepo) Coberturas(ctx context.Context, negocioID string) ([]model.Cobertura, error) {
	var cs []model.Cobertura
	err := r.db.WithContext(ctx).
		Where("negocio_id = ?", negocioID).
		Order("nombre ASC").
		Find(&cs).Error
	if err != nil {
		return nil, err
	}
	return cs, nil
}

func (r *negocioDatosRepo) NegocioPorTokenHash(ctx context.Context, hashHex string) (string, error) {
	if hashHex == "" {
		return "", nil
	}
	var ids []string
	// Un tenant dado de baja no autentica: apagar el negocio apaga su agente.
	err := r.db.WithContext(ctx).
		Model(&model.Negocio{}).
		Where("token_agente_hash = ? AND activo = TRUE", hashHex).
		Limit(1).
		Pluck("id", &ids).Error
	if err != nil {
		return "", err
	}
	if len(ids) == 0 {
		return "", nil
	}
	return ids[0], nil
}

func (r *negocioDatosRepo) SetTokenAgenteHash(ctx context.Context, negocioID, hashHex string) error {
	res := r.db.WithContext(ctx).
		Model(&model.Negocio{}).
		Where("id = ?", negocioID).
		Update("token_agente_hash", hashHex)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
