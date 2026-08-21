-- 000006_consultas: el dogfooding 2. Lo que el bot no supo responder queda
-- registrado para que el dueño lo conteste, y cada plato puede describir qué
-- lleva.

-- Consulta: una pregunta del cliente que el agente no pudo verificar con sus
-- tools (no está en la carta ni en los datos del local). En vez de inventar, la
-- deja acá; el dueño responde y el cliente se entera por WhatsApp. cliente_id es
-- nullable porque el que pregunta puede no estar todavía en la ficha; telefono
-- se guarda igual para poder avisarle.
CREATE TABLE consulta (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id    UUID         NOT NULL REFERENCES negocio(id),
  cliente_id    UUID         REFERENCES cliente(id),
  telefono      TEXT         NOT NULL DEFAULT '',
  pregunta      TEXT         NOT NULL,
  respuesta     TEXT,
  estado        TEXT         NOT NULL DEFAULT 'pendiente',
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  respondida_en TIMESTAMPTZ
);

-- El inbox del panel lista pendientes por orden de llegada dentro del tenant.
CREATE INDEX idx_consulta_negocio ON consulta (negocio_id, estado, creado_en);

-- Descripción del plato: "qué lleva la Doble bacon". El agente la usa para
-- responder sin inventar; el panel la edita.
ALTER TABLE servicio ADD COLUMN descripcion TEXT;
