package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"

	"gorm.io/gorm"
)

// ErrSinDuracion: el servicio no declara duracion_min, así que no hay cómo
// partir la agenda en huecos. El handler lo mapea a 422, igual que
// ErrNoDisponible: es un dato que falta cargar en el catálogo, no un bug.
var ErrSinDuracion = errors.New("el servicio no tiene duracion configurada")

const (
	diasDisponibilidadDefault = 7
	diasDisponibilidadMax     = 30
	// maxHuecos es el tope de la respuesta: al agente no le sirve una lista de
	// cien horarios, le sirven los primeros para ofrecer dos o tres.
	maxHuecos = 50
)

// DisponibilidadService responde las dos preguntas de la agenda: "¿cuándo
// puedo?" (el agente, antes de tomar un turno) y "¿qué tengo hoy?" (el panel).
//
// Todo el cálculo vive en la timezone del negocio: los horarios semanales son
// TIME local (un consultorio abre a las 9 de SU reloj) mientras que
// compromisos, holds y excepciones son instantes absolutos. Mezclarlos sin
// time.LoadLocation es EL bug de este módulo.
type DisponibilidadService interface {
	Consultar(ctx context.Context, negocioID string, in dto.ConsultarDisponibilidadInput) (*dto.HuecosResponse, error)
	// AgendaDelDia trata fecha como día calendario: se usan su año, mes y día
	// tal cual vienen y se los planta en la timezone del negocio.
	AgendaDelDia(ctx context.Context, negocioID string, fecha time.Time) (*dto.AgendaResponse, error)
}

type disponibilidadService struct {
	repo repository.DisponibilidadRepository
}

func NewDisponibilidadService(repo repository.DisponibilidadRepository) DisponibilidadService {
	return &disponibilidadService{repo: repo}
}

// intervalo es un rango ocupado, ya normalizado a instantes absolutos.
type intervalo struct {
	inicio time.Time
	fin    time.Time
}

func (i intervalo) pisa(desde, hasta time.Time) bool {
	return i.inicio.Before(hasta) && i.fin.After(desde)
}

// ── Consultar ─────────────────────────────────────────────────────────────
//
// Para cada día del rango, en la timezone del negocio: por recurso habilitado
// para el servicio, se toman sus franjas de ese día de semana y se les restan
// excepciones, compromisos vivos y holds vigentes. Lo que queda se parte en
// slots de duracion_min, con paso igual a la duración.
func (s *disponibilidadService) Consultar(ctx context.Context, negocioID string, in dto.ConsultarDisponibilidadInput) (*dto.HuecosResponse, error) {
	neg, err := s.repo.Negocio(ctx, negocioID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}
	loc, err := ubicacionDe(neg)
	if err != nil {
		return nil, err
	}

	sv, err := s.repo.ServicioDisponible(ctx, negocioID, in.ServicioID)
	if err != nil {
		return nil, err
	}
	if sv == nil {
		return nil, fmt.Errorf("%w: %s", ErrNoDisponible, in.ServicioID)
	}
	if sv.DuracionMin == nil || *sv.DuracionMin <= 0 {
		return nil, fmt.Errorf("%w: %s", ErrSinDuracion, sv.Nombre)
	}
	duracion := time.Duration(*sv.DuracionMin) * time.Minute

	dias := in.Dias
	if dias <= 0 {
		dias = diasDisponibilidadDefault
	}
	if dias > diasDisponibilidadMax {
		dias = diasDisponibilidadMax
	}

	primerDia, err := diaInicial(in.Desde, loc)
	if err != nil {
		return nil, err
	}

	recursos, err := s.repo.RecursosDeServicio(ctx, negocioID, in.ServicioID)
	if err != nil {
		return nil, err
	}
	if in.RecursoID != nil {
		recursos = soloRecurso(recursos, *in.RecursoID)
		if len(recursos) == 0 {
			return nil, ErrNoEncontrado
		}
	}

	resp := &dto.HuecosResponse{
		ServicioID:     sv.ID,
		ServicioNombre: sv.Nombre,
		DuracionMin:    *sv.DuracionMin,
		Timezone:       neg.Timezone,
		Desde:          primerDia.Format("2006-01-02"),
		Dias:           dias,
		Huecos:         []dto.Hueco{},
	}
	if len(recursos) == 0 {
		return resp, nil
	}

	ids := idsDeRecursos(recursos)
	desde := primerDia
	hasta := primerDia.AddDate(0, 0, dias)

	horarios, err := s.repo.HorariosDeRecursos(ctx, negocioID, ids)
	if err != nil {
		return nil, err
	}
	ocupados, err := s.ocupacion(ctx, negocioID, ids, desde, hasta)
	if err != nil {
		return nil, err
	}

	porRecurso := map[string][]model.Horario{}
	for _, h := range horarios {
		porRecurso[h.RecursoID] = append(porRecurso[h.RecursoID], h)
	}

	huecos := []dto.Hueco{}
	for i := 0; i < dias; i++ {
		dia := time.Date(primerDia.Year(), primerDia.Month(), primerDia.Day()+i, 0, 0, 0, 0, loc)
		for _, rec := range recursos {
			for _, h := range porRecurso[rec.ID] {
				if h.DiaSemana != int(dia.Weekday()) {
					continue
				}
				ini, fin, ok := franjaDelDia(dia, h, loc)
				if !ok {
					continue
				}
				for t := ini; !t.Add(duracion).After(fin); t = t.Add(duracion) {
					corte := t.Add(duracion)
					// Bifurca por tipo de recurso: profesional/mesa son 1 por
					// franja; cocina admite varios en paralelo hasta su capacidad.
					disponible, cupo := cupoDeSlot(rec, ocupados[rec.ID], t, corte)
					if !disponible {
						continue
					}
					huecos = append(huecos, dto.Hueco{
						RecursoID:     rec.ID,
						RecursoNombre: rec.Nombre,
						Inicio:        t.Format(time.RFC3339),
						Fin:           corte.Format(time.RFC3339),
						Cupo:          cupo,
					})
				}
			}
		}
	}

	// Cronológico; a igual horario, por recurso, para que la lista sea estable.
	sort.SliceStable(huecos, func(i, j int) bool {
		if huecos[i].Inicio != huecos[j].Inicio {
			return huecos[i].Inicio < huecos[j].Inicio
		}
		return huecos[i].RecursoNombre < huecos[j].RecursoNombre
	})
	if len(huecos) > maxHuecos {
		huecos = huecos[:maxHuecos]
		resp.Truncado = true
	}
	resp.Huecos = huecos
	return resp, nil
}

// ── AgendaDelDia ──────────────────────────────────────────────────────────
func (s *disponibilidadService) AgendaDelDia(ctx context.Context, negocioID string, fecha time.Time) (*dto.AgendaResponse, error) {
	neg, err := s.repo.Negocio(ctx, negocioID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoEncontrado
	}
	if err != nil {
		return nil, err
	}
	loc, err := ubicacionDe(neg)
	if err != nil {
		return nil, err
	}

	dia := time.Date(fecha.Year(), fecha.Month(), fecha.Day(), 0, 0, 0, 0, loc)
	finDia := dia.AddDate(0, 0, 1)

	recursos, err := s.repo.RecursosActivos(ctx, negocioID)
	if err != nil {
		return nil, err
	}
	horarios, err := s.repo.HorariosDeRecursos(ctx, negocioID, idsDeRecursos(recursos))
	if err != nil {
		return nil, err
	}
	filas, err := s.repo.AgendaEnRango(ctx, negocioID, dia, finDia)
	if err != nil {
		return nil, err
	}

	franjas := map[string][]dto.FranjaHoraria{}
	for _, h := range horarios {
		if h.DiaSemana != int(dia.Weekday()) {
			continue
		}
		franjas[h.RecursoID] = append(franjas[h.RecursoID], dto.FranjaHoraria{
			Desde: h.Desde,
			Hasta: h.Hasta,
		})
	}

	turnos := map[string][]dto.TurnoAgenda{}
	sinRecurso := []dto.TurnoAgenda{}
	for _, f := range filas {
		t := turnoDesdeFila(f, loc)
		if f.RecursoID == nil {
			sinRecurso = append(sinRecurso, t)
			continue
		}
		turnos[*f.RecursoID] = append(turnos[*f.RecursoID], t)
	}

	cols := make([]dto.AgendaRecurso, 0, len(recursos))
	for _, rec := range recursos {
		col := dto.AgendaRecurso{
			RecursoID:     rec.ID,
			RecursoNombre: rec.Nombre,
			Horarios:      franjas[rec.ID],
			Turnos:        turnos[rec.ID],
		}
		if col.Horarios == nil {
			col.Horarios = []dto.FranjaHoraria{}
		}
		if col.Turnos == nil {
			col.Turnos = []dto.TurnoAgenda{}
		}
		cols = append(cols, col)
	}

	return &dto.AgendaResponse{
		Fecha:      dia.Format("2006-01-02"),
		Timezone:   neg.Timezone,
		Recursos:   cols,
		SinRecurso: sinRecurso,
	}, nil
}

// ── Apoyo ─────────────────────────────────────────────────────────────────

// ocupacion junta todo lo que bloquea agenda en el rango, por recurso.
func (s *disponibilidadService) ocupacion(ctx context.Context, negocioID string, recursoIDs []string, desde, hasta time.Time) (map[string][]intervalo, error) {
	out := map[string][]intervalo{}

	excepciones, err := s.repo.ExcepcionesEnRango(ctx, negocioID, recursoIDs, desde, hasta)
	if err != nil {
		return nil, err
	}
	for _, e := range excepciones {
		out[e.RecursoID] = append(out[e.RecursoID], intervalo{inicio: e.Desde, fin: e.Hasta})
	}

	compromisos, err := s.repo.CompromisosEnRango(ctx, negocioID, recursoIDs, desde, hasta)
	if err != nil {
		return nil, err
	}
	for _, c := range compromisos {
		if c.RecursoID == nil || c.Inicio == nil || c.Fin == nil {
			continue
		}
		out[*c.RecursoID] = append(out[*c.RecursoID], intervalo{inicio: *c.Inicio, fin: *c.Fin})
	}

	// Los holds expirados no bloquean: el corte es `ahora`, no hay que borrarlos.
	holds, err := s.repo.HoldsVigentesEnRango(ctx, negocioID, recursoIDs, desde, hasta, time.Now())
	if err != nil {
		return nil, err
	}
	for _, h := range holds {
		out[h.RecursoID] = append(out[h.RecursoID], intervalo{inicio: h.Inicio, fin: h.Fin})
	}

	return out, nil
}

func pisaAlguno(ocupados []intervalo, desde, hasta time.Time) bool {
	for _, o := range ocupados {
		if o.pisa(desde, hasta) {
			return true
		}
	}
	return false
}

// franjaDelDia planta un horario semanal (TIME local) sobre un día concreto.
func franjaDelDia(dia time.Time, h model.Horario, loc *time.Location) (time.Time, time.Time, bool) {
	desde, ok := horaLocal(dia, h.Desde, loc)
	if !ok {
		return time.Time{}, time.Time{}, false
	}
	hasta, ok := horaLocal(dia, h.Hasta, loc)
	if !ok || !hasta.After(desde) {
		return time.Time{}, time.Time{}, false
	}
	return desde, hasta, true
}

// horaLocal acepta "HH:MM:SS" o "HH:MM" (así los devuelve el driver para TIME).
func horaLocal(dia time.Time, hhmmss string, loc *time.Location) (time.Time, bool) {
	for _, layout := range []string{"15:04:05", "15:04"} {
		t, err := time.Parse(layout, hhmmss)
		if err != nil {
			continue
		}
		return time.Date(dia.Year(), dia.Month(), dia.Day(), t.Hour(), t.Minute(), t.Second(), 0, loc), true
	}
	return time.Time{}, false
}

// diaInicial resuelve el primer día del rango: vacío = hoy en la timezone del
// negocio.
func diaInicial(raw string, loc *time.Location) (time.Time, error) {
	if raw == "" {
		ahora := time.Now().In(loc)
		return time.Date(ahora.Year(), ahora.Month(), ahora.Day(), 0, 0, 0, 0, loc), nil
	}
	if t, err := time.ParseInLocation("2006-01-02", raw, loc); err == nil {
		return t, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		l := t.In(loc)
		return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc), nil
	}
	return time.Time{}, fmt.Errorf("fecha invalida en desde: se espera YYYY-MM-DD")
}

// ubicacionDe carga la timezone del negocio. Una timezone rota es un dato mal
// cargado, no un default silencioso: calcular la agenda en otro huso le da al
// paciente un horario equivocado.
func ubicacionDe(n *model.Negocio) (*time.Location, error) {
	loc, err := time.LoadLocation(n.Timezone)
	if err != nil {
		return nil, fmt.Errorf("timezone invalida del negocio: %s", n.Timezone)
	}
	return loc, nil
}

func idsDeRecursos(rs []model.Recurso) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.ID)
	}
	return out
}

func soloRecurso(rs []model.Recurso, id string) []model.Recurso {
	for _, r := range rs {
		if r.ID == id {
			return []model.Recurso{r}
		}
	}
	return nil
}

func turnoDesdeFila(f repository.CompromisoAgenda, loc *time.Location) dto.TurnoAgenda {
	t := dto.TurnoAgenda{
		CompromisoID:      f.ID,
		Tipo:              f.Tipo,
		Estado:            f.Estado,
		ClienteID:         f.ClienteID,
		ClienteNombre:     f.ClienteNombre,
		ClienteTelefono:   f.ClienteTelefono,
		Total:             f.Total,
		Nota:              f.Nota,
		Cobrado:           f.CobroID != nil,
		ComprobanteEstado: f.ComprobanteEstado,
	}
	if f.Inicio != nil {
		t.Inicio = f.Inicio.In(loc).Format(time.RFC3339)
	}
	if f.Fin != nil {
		fin := f.Fin.In(loc).Format(time.RFC3339)
		t.Fin = &fin
	}
	return t
}
