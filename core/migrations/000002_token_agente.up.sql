-- 000002_token_agente: la credencial con la que el agente MCP habla con el core.
-- Se guarda SÓLO el sha256 en hex del token completo (con prefijo `cop_`); el
-- token en claro viaja una única vez, en la respuesta que lo rota.

ALTER TABLE negocio ADD COLUMN token_agente_hash TEXT;

-- Parcial: un negocio puede no tener token, pero dos no pueden compartir uno.
CREATE UNIQUE INDEX idx_negocio_token_agente_hash
  ON negocio (token_agente_hash)
  WHERE token_agente_hash IS NOT NULL;
