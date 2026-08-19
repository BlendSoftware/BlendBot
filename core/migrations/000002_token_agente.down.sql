DROP INDEX IF EXISTS idx_negocio_token_agente_hash;

ALTER TABLE negocio DROP COLUMN IF EXISTS token_agente_hash;
