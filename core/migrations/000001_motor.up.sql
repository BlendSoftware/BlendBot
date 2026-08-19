-- 000001_motor: el modelo de datos del motor de compromisos.
-- Fuente: docs/ARQUITECTURA.md. Un pedido, una reserva y un turno son el mismo
-- objeto: un recurso ocupado por un rato para un cliente, con estados.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tipos ──────────────────────────────────────────────────────────
CREATE TYPE vertical_negocio  AS ENUM ('gastronomia', 'salud');
CREATE TYPE tipo_recurso      AS ENUM ('profesional', 'mesa', 'cocina');
CREATE TYPE tipo_compromiso   AS ENUM ('pedido', 'reserva', 'turno');
CREATE TYPE estado_compromiso AS ENUM (
  'pendiente', 'confirmado', 'en_curso', 'listo', 'completado',
  'rechazado', 'cancelado', 'ausente'
);
CREATE TYPE tipo_entrega      AS ENUM ('retira', 'delivery', 'en_local');
CREATE TYPE origen_compromiso AS ENUM ('whatsapp', 'panel', 'telefono');

-- ─── Tenant ─────────────────────────────────────────────────────────
CREATE TABLE negocio (
  id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT              NOT NULL,
  vertical      vertical_negocio  NOT NULL,
  timezone      TEXT              NOT NULL DEFAULT 'America/Argentina/Mendoza',
  wa_phone_id   TEXT              UNIQUE,          -- phone_number_id de Meta
  wa_waba_id    TEXT,
  config        JSONB             NOT NULL DEFAULT '{}',
  activo        BOOLEAN           NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- ─── Usuarios del panel ─────────────────────────────────────────────
-- negocio_id NULL sólo para rol 'admin' (panel de la plataforma).
CREATE TABLE usuario (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id            UUID        REFERENCES negocio(id),
  username              TEXT        NOT NULL UNIQUE,
  password_hash         TEXT        NOT NULL,
  rol                   TEXT        NOT NULL,       -- admin | dueno | operador
  activo                BOOLEAN     NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN     NOT NULL DEFAULT FALSE,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT usuario_admin_sin_negocio
    CHECK (rol = 'admin' OR negocio_id IS NOT NULL)
);

-- ─── Recursos: lo que se ocupa ──────────────────────────────────────
CREATE TABLE recurso (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  UUID          NOT NULL REFERENCES negocio(id),
  tipo        tipo_recurso  NOT NULL,
  nombre      TEXT          NOT NULL,   -- "Dra. Gómez", "Mesa 4", "Cocina"
  capacidad   INT           NOT NULL DEFAULT 1,  -- mesa: cubiertos · cocina: unidades/hora
  activo      BOOLEAN       NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_recurso_negocio ON recurso (negocio_id);

-- ─── Catálogo: lo que se pide ───────────────────────────────────────
CREATE TABLE categoria (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  UUID        NOT NULL REFERENCES negocio(id),
  nombre      TEXT        NOT NULL,   -- secciones de la carta o tipos de práctica
  orden       INT         NOT NULL DEFAULT 0,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_categoria_negocio ON categoria (negocio_id);

CREATE TABLE servicio (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id    UUID           NOT NULL REFERENCES negocio(id),
  categoria_id  UUID           REFERENCES categoria(id),
  nombre        TEXT           NOT NULL,   -- "Doble cheddar" | "Arreglo"
  duracion_min  INT,                       -- NULL = no consume tiempo (un producto)
  precio_base   NUMERIC(12,2)  NOT NULL DEFAULT 0,
  disponible    BOOLEAN        NOT NULL DEFAULT TRUE,  -- EL interruptor
  activo        BOOLEAN        NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_servicio_negocio ON servicio (negocio_id, activo, disponible);

-- qué recurso puede prestar qué servicio
CREATE TABLE servicio_recurso (
  servicio_id  UUID NOT NULL REFERENCES servicio(id) ON DELETE CASCADE,
  recurso_id   UUID NOT NULL REFERENCES recurso(id)  ON DELETE CASCADE,
  PRIMARY KEY (servicio_id, recurso_id)
);

-- ─── Disponibilidad ─────────────────────────────────────────────────
CREATE TABLE horario (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  recurso_id  UUID  NOT NULL REFERENCES recurso(id) ON DELETE CASCADE,
  dia_semana  INT   NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  desde       TIME  NOT NULL,
  hasta       TIME  NOT NULL,
  CHECK (desde < hasta)
);
CREATE INDEX idx_horario_recurso ON horario (recurso_id);

CREATE TABLE excepcion (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  recurso_id  UUID         NOT NULL REFERENCES recurso(id) ON DELETE CASCADE,
  desde       TIMESTAMPTZ  NOT NULL,
  hasta       TIMESTAMPTZ  NOT NULL,
  motivo      TEXT,                       -- feriado, congreso, vacaciones
  CHECK (desde < hasta)
);
CREATE INDEX idx_excepcion_recurso ON excepcion (recurso_id, desde);

-- ─── Clientes ───────────────────────────────────────────────────────
-- Mínimo dato necesario (Ley 25.326): nada de motivo de consulta libre.
CREATE TABLE cobertura (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  UUID  NOT NULL REFERENCES negocio(id),
  nombre      TEXT  NOT NULL              -- OSEP, OSDE 210, particular
);
CREATE INDEX idx_cobertura_negocio ON cobertura (negocio_id);

CREATE TABLE cliente (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id    UUID         NOT NULL REFERENCES negocio(id),
  telefono      TEXT         NOT NULL,    -- llega gratis por WhatsApp
  nombre        TEXT,
  documento     TEXT,                     -- cifrado a nivel campo en el service
  cobertura_id  UUID         REFERENCES cobertura(id),
  notas         TEXT,                     -- cifrado a nivel campo en el service
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (negocio_id, telefono)
);

-- precio por cobertura (patrón lista_precios de BlendPos)
CREATE TABLE precio_cobertura (
  servicio_id   UUID           NOT NULL REFERENCES servicio(id)  ON DELETE CASCADE,
  cobertura_id  UUID           NOT NULL REFERENCES cobertura(id) ON DELETE CASCADE,
  precio        NUMERIC(12,2)  NOT NULL,
  coseguro      NUMERIC(12,2),
  PRIMARY KEY (servicio_id, cobertura_id)
);

-- ─── EL MOTOR ───────────────────────────────────────────────────────
CREATE TABLE compromiso (
  id             UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     UUID               NOT NULL REFERENCES negocio(id),
  cliente_id     UUID               NOT NULL REFERENCES cliente(id),
  recurso_id     UUID               REFERENCES recurso(id),  -- NULL mientras no se asignó
  tipo           tipo_compromiso    NOT NULL,
  estado         estado_compromiso  NOT NULL DEFAULT 'pendiente',
  inicio         TIMESTAMPTZ,
  fin            TIMESTAMPTZ,
  demora_min     INT,                        -- lo que puso el local
  entrega        tipo_entrega,
  direccion      TEXT,
  total          NUMERIC(12,2)      NOT NULL DEFAULT 0,
  origen         origen_compromiso  NOT NULL,
  nota           TEXT,
  creado_en      TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  confirmado_en  TIMESTAMPTZ,
  cerrado_en     TIMESTAMPTZ
);
-- el tablero: compromisos vivos de un negocio por estado
CREATE INDEX idx_compromiso_tablero ON compromiso (negocio_id, estado, creado_en);
-- la agenda: qué tiene un recurso en un rango
CREATE INDEX idx_compromiso_agenda  ON compromiso (recurso_id, inicio)
  WHERE recurso_id IS NOT NULL AND inicio IS NOT NULL;
-- historial de un cliente
CREATE INDEX idx_compromiso_cliente ON compromiso (cliente_id, creado_en);

CREATE TABLE linea_compromiso (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  compromiso_id  UUID           NOT NULL REFERENCES compromiso(id) ON DELETE CASCADE,
  servicio_id    UUID           NOT NULL REFERENCES servicio(id),
  cantidad       INT            NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unit    NUMERIC(12,2)  NOT NULL,   -- congelado al momento
  nota           TEXT                       -- "sin cebolla"
);
CREATE INDEX idx_linea_compromiso ON linea_compromiso (compromiso_id);

-- ─── Bloqueo temporal ───────────────────────────────────────────────
-- Sin esto, dos personas sacan el mismo turno mientras completan sus datos.
CREATE TABLE hold (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  recurso_id  UUID         NOT NULL REFERENCES recurso(id) ON DELETE CASCADE,
  inicio      TIMESTAMPTZ  NOT NULL,
  fin         TIMESTAMPTZ  NOT NULL,
  expira_en   TIMESTAMPTZ  NOT NULL,   -- típico: ahora + 10 min
  sesion      TEXT         NOT NULL,   -- el número de WhatsApp
  CHECK (inicio < fin)
);
CREATE INDEX idx_hold_recurso ON hold (recurso_id, inicio, fin);
CREATE INDEX idx_hold_expira  ON hold (expira_en);

-- ─── Auditoría (de BlendPos; en salud no es opcional) ───────────────
CREATE TABLE audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  UUID         REFERENCES negocio(id),
  usuario_id  UUID         REFERENCES usuario(id),
  accion      TEXT         NOT NULL,   -- ej: cliente.leer, compromiso.confirmar
  entidad     TEXT         NOT NULL,
  entidad_id  UUID,
  detalle     JSONB,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_negocio ON audit_log (negocio_id, creado_en);
