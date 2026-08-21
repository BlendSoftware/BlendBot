package repository

import (
	"context"
	"errors"
	"time"

	"copiloto/core/internal/model"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// CambioEstado agrupa los campos que una transición puede tocar. Los punteros
// nil no se escriben: una transición que no trae demora no borra la anterior.
type CambioEstado struct {
	Nuevo        model.EstadoCompromiso
	DemoraMin    *int
	RecursoID    *string
	ConfirmadoEn *time.Time
	CerradoEn    *time.Time
}

// CompromisoRepository es el acceso a EL objeto del motor. Todo método recibe
// negocioID y filtra por él: el aislamiento de tenant vive acá, no en el handler.
type CompromisoRepository interface {
	Create(ctx context.Context, c *model.Compromiso) error
	GetByID(ctx context.Context, negocioID, id string) (*model.Compromiso, error)
	ListTablero(ctx context.Context, negocioID string, estados []model.EstadoCompromiso, desde, hasta *time.Time) ([]model.Compromiso, error)
	// UpdateEstado es condicional: sólo pisa la fila si sigue en `actual`.
	// Devuelve false si otra transición ganó la carrera.
	UpdateEstado(ctx context.Context, negocioID, id string, actual model.EstadoCompromiso, cambio CambioEstado) (bool, error)
	ListPorRecurso(ctx context.Context, negocioID, recursoID string, desde, hasta time.Time) ([]model.Compromiso, error)

	// Consultas de apoyo del motor: van directo a la base para no depender de
	// los repositorios de catálogo/clientes.
	ServiciosDisponibles(ctx context.Context, negocioID string, servicioIDs []string) (map[string]model.Servicio, error)
	CoberturaDeCliente(ctx context.Context, negocioID, clienteID string) (*string, bool, error)
	PreciosPorCobertura(ctx context.Context, negocioID, coberturaID string, servicioIDs []string) (map[string]decimal.Decimal, error)
	RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error)
}

type compromisoRepo struct{ db *gorm.DB }

func NewCompromisoRepository(db *gorm.DB) CompromisoRepository { return &compromisoRepo{db: db} }

// estadosTerminales son los que ya no ocupan agenda ni admiten transiciones.
func estadosTerminales() []model.EstadoCompromiso {
	out := make([]model.EstadoCompromiso, 0, 4)
	for _, e := range model.EstadosValidos() {
		if e.EsTerminal() {
			out = append(out, e)
		}
	}
	return out
}

// Create inserta el compromiso y sus líneas en una sola transacción.
func (r *compromisoRepo) Create(ctx context.Context, c *model.Compromiso) error {
	lineas := c.Lineas
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Omit("Lineas").Create(c).Error; err != nil {
			return err
		}
		if len(lineas) == 0 {
			return nil
		}
		for i := range lineas {
			lineas[i].CompromisoID = c.ID
		}
		if err := tx.Create(&lineas).Error; err != nil {
			return err
		}
		c.Lineas = lineas
		return nil
	})
	if err != nil {
		return err
	}
	// El que recién crea el pedido también quiere ver quién pidió en la
	// respuesta, no sólo el tablero; la hidratación es la misma, tenant-scoped.
	return r.hidratarCliente(ctx, c.NegocioID, c)
}

// hidratarCliente completa nombre y teléfono del cliente de cada compromiso
// desde la tabla `cliente`, acotado al tenant (negocio_id). Son datos de
// presentación —el panel muestra a quién pertenece el pedido—, no columnas de
// compromiso: viajan en campos transitorios del modelo. Se resuelve en una sola
// consulta agrupando los cliente_id, así el tablero no dispara un SELECT por
// tarjeta.
func (r *compromisoRepo) hidratarCliente(ctx context.Context, negocioID string, cs ...*model.Compromiso) error {
	if len(cs) == 0 {
		return nil
	}
	ids := make([]string, 0, len(cs))
	visto := make(map[string]struct{}, len(cs))
	for _, c := range cs {
		if c == nil || c.ClienteID == "" {
			continue
		}
		if _, ok := visto[c.ClienteID]; ok {
			continue
		}
		visto[c.ClienteID] = struct{}{}
		ids = append(ids, c.ClienteID)
	}
	if len(ids) == 0 {
		return nil
	}

	var filas []struct {
		ID       string
		Nombre   *string
		Telefono string
	}
	err := r.db.WithContext(ctx).
		Model(&model.Cliente{}).
		Select("id", "nombre", "telefono").
		Where("negocio_id = ? AND id IN ?", negocioID, ids).
		Scan(&filas).Error
	if err != nil {
		return err
	}

	type datosCliente struct {
		nombre   *string
		telefono string
	}
	porID := make(map[string]datosCliente, len(filas))
	for _, f := range filas {
		porID[f.ID] = datosCliente{nombre: f.Nombre, telefono: f.Telefono}
	}
	for _, c := range cs {
		if c == nil {
			continue
		}
		if d, ok := porID[c.ClienteID]; ok {
			c.ClienteNombre = d.nombre
			c.ClienteTelefono = d.telefono
		}
	}
	return nil
}

func (r *compromisoRepo) GetByID(ctx context.Context, negocioID, id string) (*model.Compromiso, error) {
	var c model.Compromiso
	err := r.db.WithContext(ctx).
		Preload("Lineas").
		Where("negocio_id = ? AND id = ?", negocioID, id).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	if err := r.hidratarCliente(ctx, negocioID, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *compromisoRepo) ListTablero(ctx context.Context, negocioID string, estados []model.EstadoCompromiso, desde, hasta *time.Time) ([]model.Compromiso, error) {
	q := r.db.WithContext(ctx).Preload("Lineas").Where("negocio_id = ?", negocioID)
	if len(estados) > 0 {
		q = q.Where("estado IN ?", estados)
	}
	// El tablero se ordena por creación; el rango filtra por creado_en para que
	// un compromiso incompleto (sin inicio) no desaparezca del panel.
	if desde != nil {
		q = q.Where("creado_en >= ?", *desde)
	}
	if hasta != nil {
		q = q.Where("creado_en < ?", *hasta)
	}
	var cs []model.Compromiso
	if err := q.Order("creado_en ASC").Find(&cs).Error; err != nil {
		return nil, err
	}
	punteros := make([]*model.Compromiso, len(cs))
	for i := range cs {
		punteros[i] = &cs[i]
	}
	if err := r.hidratarCliente(ctx, negocioID, punteros...); err != nil {
		return nil, err
	}
	return cs, nil
}

func (r *compromisoRepo) UpdateEstado(ctx context.Context, negocioID, id string, actual model.EstadoCompromiso, cambio CambioEstado) (bool, error) {
	campos := map[string]any{"estado": cambio.Nuevo}
	if cambio.DemoraMin != nil {
		campos["demora_min"] = *cambio.DemoraMin
	}
	if cambio.RecursoID != nil {
		campos["recurso_id"] = *cambio.RecursoID
	}
	if cambio.ConfirmadoEn != nil {
		campos["confirmado_en"] = *cambio.ConfirmadoEn
	}
	if cambio.CerradoEn != nil {
		campos["cerrado_en"] = *cambio.CerradoEn
	}

	res := r.db.WithContext(ctx).
		Model(&model.Compromiso{}).
		Where("negocio_id = ? AND id = ? AND estado = ?", negocioID, id, actual).
		Updates(campos)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *compromisoRepo) ListPorRecurso(ctx context.Context, negocioID, recursoID string, desde, hasta time.Time) ([]model.Compromiso, error) {
	var cs []model.Compromiso
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND recurso_id = ?", negocioID, recursoID).
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

// ServiciosDisponibles devuelve sólo los servicios del tenant que están activos
// y con el interruptor prendido. Lo que falte en el mapa, no se puede pedir.
func (r *compromisoRepo) ServiciosDisponibles(ctx context.Context, negocioID string, servicioIDs []string) (map[string]model.Servicio, error) {
	out := make(map[string]model.Servicio, len(servicioIDs))
	if len(servicioIDs) == 0 {
		return out, nil
	}
	var ss []model.Servicio
	err := r.db.WithContext(ctx).
		Where("negocio_id = ? AND id IN ?", negocioID, servicioIDs).
		Where("activo = TRUE AND disponible = TRUE").
		Find(&ss).Error
	if err != nil {
		return nil, err
	}
	for _, s := range ss {
		out[s.ID] = s
	}
	return out, nil
}

// CoberturaDeCliente valida de paso que el cliente sea del tenant: el segundo
// retorno es false si no existe para ese negocio.
func (r *compromisoRepo) CoberturaDeCliente(ctx context.Context, negocioID, clienteID string) (*string, bool, error) {
	var cl model.Cliente
	err := r.db.WithContext(ctx).
		Select("id", "cobertura_id").
		Where("negocio_id = ? AND id = ?", negocioID, clienteID).
		First(&cl).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return cl.CoberturaID, true, nil
}

func (r *compromisoRepo) PreciosPorCobertura(ctx context.Context, negocioID, coberturaID string, servicioIDs []string) (map[string]decimal.Decimal, error) {
	out := make(map[string]decimal.Decimal, len(servicioIDs))
	if coberturaID == "" || len(servicioIDs) == 0 {
		return out, nil
	}
	var ps []model.PrecioCobertura
	// El join contra cobertura ancla la consulta al tenant: un cobertura_id
	// ajeno (dato corrupto o bug futuro) no puede filtrar precios de otro negocio.
	err := r.db.WithContext(ctx).
		Joins("JOIN cobertura ON cobertura.id = precio_cobertura.cobertura_id AND cobertura.negocio_id = ?", negocioID).
		Where("precio_cobertura.cobertura_id = ? AND precio_cobertura.servicio_id IN ?", coberturaID, servicioIDs).
		Find(&ps).Error
	if err != nil {
		return nil, err
	}
	for _, p := range ps {
		out[p.ServicioID] = p.Precio
	}
	return out, nil
}

func (r *compromisoRepo) RecursoActivo(ctx context.Context, negocioID, recursoID string) (bool, error) {
	return recursoDelNegocio(ctx, r.db, negocioID, recursoID)
}

// recursoDelNegocio responde si el recurso existe, está activo y es del tenant.
// Lo comparten los tres repos del motor porque holds y horarios cuelgan de
// recurso, que es donde vive el negocio_id.
func recursoDelNegocio(ctx context.Context, db *gorm.DB, negocioID, recursoID string) (bool, error) {
	var n int64
	err := db.WithContext(ctx).
		Model(&model.Recurso{}).
		Where("negocio_id = ? AND id = ? AND activo = TRUE", negocioID, recursoID).
		Count(&n).Error
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
