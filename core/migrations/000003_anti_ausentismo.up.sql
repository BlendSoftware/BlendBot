-- 000003_anti_ausentismo: la feature que se le vende al consultorio.
-- Recordatorio 24h antes, liberación del hueco al cancelar y lista de espera.

-- Sello del recordatorio. NULL = todavía no se mandó. El worker lo pisa con un
-- UPDATE condicional (WHERE recordatorio_enviado_en IS NULL), así que esta
-- columna ES el candado contra el doble aviso: dos réplicas o dos ticks
-- compiten por la misma fila y sólo una la gana.
ALTER TABLE compromiso ADD COLUMN recordatorio_enviado_en TIMESTAMPTZ;

-- El barrido del worker mira turnos futuros a los que todavía les falta el
-- aviso; el índice parcial deja fuera toda la historia ya notificada.
CREATE INDEX idx_compromiso_recordatorio ON compromiso (inicio)
  WHERE recordatorio_enviado_en IS NULL AND inicio IS NOT NULL;

-- ─── Lista de espera ────────────────────────────────────────────────
-- Quién quiere ese servicio si se libera un hueco. La cola es por orden de
-- llegada dentro de (negocio, servicio); notificado_en marca al que ya recibió
-- una oferta para que no se le ofrezca dos veces.
CREATE TABLE lista_espera (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id              UUID         NOT NULL REFERENCES negocio(id),
  cliente_id              UUID         NOT NULL REFERENCES cliente(id),
  servicio_id             UUID         NOT NULL REFERENCES servicio(id),
  nota                    TEXT,
  creado_en               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notificado_en           TIMESTAMPTZ,
  compromiso_ofrecido_id  UUID         REFERENCES compromiso(id)
);
CREATE INDEX idx_lista_espera_negocio  ON lista_espera (negocio_id, creado_en);
CREATE INDEX idx_lista_espera_servicio ON lista_espera (negocio_id, servicio_id, creado_en);
