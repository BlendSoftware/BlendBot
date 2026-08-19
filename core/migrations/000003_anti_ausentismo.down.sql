DROP INDEX IF EXISTS idx_lista_espera_servicio;
DROP INDEX IF EXISTS idx_lista_espera_negocio;
DROP TABLE IF EXISTS lista_espera;

DROP INDEX IF EXISTS idx_compromiso_recordatorio;
ALTER TABLE compromiso DROP COLUMN IF EXISTS recordatorio_enviado_en;
