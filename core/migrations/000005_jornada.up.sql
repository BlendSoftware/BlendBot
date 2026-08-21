-- 000005_jornada: la caja del día (E11 / W7-A).
-- El cierre dejaba de servir porque sólo miraba los comprobantes de ARCA. El
-- dueño quiere una CAJA de verdad: abrir el día, ver lo vendido y lo cobrado
-- mientras trabaja, y cerrarlo. La jornada es ese ciclo abrir → cerrar.

-- Una jornada por negocio: se abre y se cierra. cerrada_en NULL es "la caja
-- está abierta ahora mismo". abierta_por/cerrada_por quedan como rastro de quién
-- movió la caja (puede ser NULL: el agente no abre jornadas, sólo el panel).
CREATE TABLE jornada (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id   UUID         NOT NULL REFERENCES negocio(id),
  abierta_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  cerrada_en   TIMESTAMPTZ,
  abierta_por  UUID         REFERENCES usuario(id),
  cerrada_por  UUID         REFERENCES usuario(id),
  creado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Una sola jornada abierta por negocio a la vez: el índice parcial es el
-- árbitro, no una condición de carrera en el service. Dos clicks en "Abrir día"
-- chocan contra el índice y el segundo se vuelve un 409, no dos cajas abiertas.
CREATE UNIQUE INDEX idx_jornada_abierta ON jornada (negocio_id)
  WHERE cerrada_en IS NULL;

-- El histórico y "la del día": jornadas de un negocio por fecha de apertura.
CREATE INDEX idx_jornada_negocio ON jornada (negocio_id, abierta_en);
