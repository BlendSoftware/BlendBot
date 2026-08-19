-- 000004_cobro: el cobro y el comprobante fiscal (ARCA, Factura C).
-- Fuente: docs/ARCA.md. Acá el producto deja de ser un asistente y pasa a ser
-- el sistema de gestión: se cobra el compromiso completado y sale la factura.

-- ─── Configuración fiscal por tenant ────────────────────────────────────
-- Un CUIT, un punto de venta y UN PAR DE CERTIFICADOS POR NEGOCIO, nunca
-- compartidos. Los PEM se guardan cifrados (AES-256-GCM, clave fuera de la
-- base en FISCAL_CIPHER_KEY): la base robada no alcanza para facturar a nombre
-- de nadie. Estas dos columnas jamás salen en un response ni en un log.
CREATE TABLE config_fiscal (
  negocio_id        UUID         PRIMARY KEY REFERENCES negocio(id),
  cuit              TEXT         NOT NULL,
  razon_social      TEXT,
  condicion         TEXT         NOT NULL DEFAULT 'monotributo',
  punto_venta       INT          NOT NULL DEFAULT 1 CHECK (punto_venta > 0),
  modo              TEXT         NOT NULL DEFAULT 'homologacion'
                                 CHECK (modo IN ('homologacion', 'produccion')),
  cert_pem_cifrado  TEXT,
  key_pem_cifrado   TEXT,
  actualizado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── El cobro ───────────────────────────────────────────────────────────
-- UNIQUE sobre compromiso_id: la base es la que garantiza que un turno se
-- cobra una sola vez. Dos clicks simultáneos en "Cobrar" chocan contra el
-- índice y el segundo se convierte en un 409, no en dos cobros.
CREATE TABLE cobro (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     UUID           NOT NULL REFERENCES negocio(id),
  compromiso_id  UUID           NOT NULL UNIQUE REFERENCES compromiso(id),
  usuario_id     UUID           REFERENCES usuario(id),
  medio_pago     TEXT           NOT NULL
                                CHECK (medio_pago IN ('efectivo', 'transferencia',
                                                      'debito', 'credito', 'qr')),
  monto          NUMERIC(12,2)  NOT NULL,
  cobrado_en     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
-- el cierre del día: cobros de un negocio en un rango
CREATE INDEX idx_cobro_negocio ON cobro (negocio_id, cobrado_en);

-- ─── El comprobante ─────────────────────────────────────────────────────
-- Factura C (tipo 11) por defecto: el monotributista no discrimina IVA.
-- Un comprobante por cobro (UNIQUE), y el trío retry_count/next_retry_at/
-- last_error es la cola de reintentos heredada de BlendPos (migración 000003):
-- ARCA se cae, y cuando se cae no puede trabarse el cobro del consultorio.
CREATE TABLE comprobante (
  id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id         UUID           NOT NULL REFERENCES negocio(id),
  cobro_id           UUID           NOT NULL UNIQUE REFERENCES cobro(id) ON DELETE CASCADE,
  tipo_cbte          INT            NOT NULL DEFAULT 11,
  punto_venta        INT            NOT NULL DEFAULT 1,
  numero             BIGINT,
  cae                TEXT,
  cae_vence          DATE,
  estado             TEXT           NOT NULL DEFAULT 'pendiente'
                                    CHECK (estado IN ('pendiente', 'emitido', 'error')),
  retry_count        INT            NOT NULL DEFAULT 0,
  next_retry_at      TIMESTAMPTZ,
  last_error         TEXT,
  receptor_doc_tipo  INT            NOT NULL DEFAULT 99,   -- 99 = consumidor final
  receptor_doc_nro   TEXT,
  importe            NUMERIC(12,2)  NOT NULL,
  emitido_en         TIMESTAMPTZ,
  creado_en          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- El barrido del facturador: sólo pendientes vencidos. Índice parcial para que
-- la historia ya emitida no pese en cada tick (patrón BlendPos 000003).
CREATE INDEX idx_comprobante_pendiente ON comprobante (next_retry_at)
  WHERE estado = 'pendiente';
-- el cierre del día: estado de los comprobantes de un negocio
CREATE INDEX idx_comprobante_negocio ON comprobante (negocio_id, creado_en);
