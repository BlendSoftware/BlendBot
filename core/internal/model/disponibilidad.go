package model

import "time"

// Horario semanal recurrente de un recurso.
type Horario struct {
	ID        string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	RecursoID string `gorm:"type:uuid;not null" json:"recurso_id"`
	DiaSemana int    `gorm:"not null" json:"dia_semana"` // 0..6, domingo = 0
	Desde     string `gorm:"type:time;not null" json:"desde"`
	Hasta     string `gorm:"type:time;not null" json:"hasta"`
}

func (Horario) TableName() string { return "horario" }

// Excepcion bloquea un rango puntual: feriado, congreso, vacaciones.
type Excepcion struct {
	ID        string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	RecursoID string    `gorm:"type:uuid;not null" json:"recurso_id"`
	Desde     time.Time `gorm:"not null" json:"desde"`
	Hasta     time.Time `gorm:"not null" json:"hasta"`
	Motivo    *string   `json:"motivo"`
}

func (Excepcion) TableName() string { return "excepcion" }

// Hold bloquea un hueco mientras el cliente completa sus datos.
// Sin esto, dos personas sacan el mismo turno a la vez.
type Hold struct {
	ID        string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	RecursoID string    `gorm:"type:uuid;not null" json:"recurso_id"`
	Inicio    time.Time `gorm:"not null" json:"inicio"`
	Fin       time.Time `gorm:"not null" json:"fin"`
	ExpiraEn  time.Time `gorm:"not null" json:"expira_en"` // típico: ahora + 10 min
	Sesion    string    `gorm:"not null" json:"sesion"`    // el número de WhatsApp
}

func (Hold) TableName() string { return "hold" }
