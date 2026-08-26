-- 000007_cupos: el cupo del día por plato. Capa 1 del control de stock.
--
-- No se descuentan ingredientes al gramo: eso exige recetas y rendimientos
-- perfectos y se abandona en un mes. Lo que se lleva es cuántas porciones de
-- CADA plato quedan en esta jornada, que es lo que el cocinero sabe de memoria
-- y lo que el cliente necesita que sea verdad.
--
-- El cupo es OPT-IN: un servicio sin fila acá es ilimitado. Así los negocios
-- que ya venían andando no cambian de comportamiento el día del deploy, y el
-- que quiere control lo carga plato por plato.
CREATE TABLE cupo_jornada (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  UUID        NOT NULL REFERENCES negocio(id),
  -- ON DELETE CASCADE: el cupo es del día. Si la jornada se borra, no queda
  -- un cupo huérfano apuntando a un día que no existe.
  jornada_id  UUID        NOT NULL REFERENCES jornada(id) ON DELETE CASCADE,
  servicio_id UUID        NOT NULL REFERENCES servicio(id),
  asignado    INT         NOT NULL CHECK (asignado >= 0),
  consumido   INT         NOT NULL DEFAULT 0 CHECK (consumido >= 0),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- La sobreventa la impide la BASE, no el service. El UPDATE de consumo ya
  -- trae su propia guarda, pero si algún día alguien escribe otro camino que
  -- se olvide de ponerla, acá rebota. Mismo criterio que el índice único de
  -- jornada: el árbitro es Postgres, no una condición de carrera en Go.
  CONSTRAINT cupo_no_sobrevendido CHECK (consumido <= asignado)
);

-- Un solo cupo por plato y por jornada. Es lo que convierte "setear el cupo"
-- en un upsert y no en una carrera entre dos mozos tocando el mismo plato.
CREATE UNIQUE INDEX idx_cupo_jornada_servicio ON cupo_jornada (jornada_id, servicio_id);

-- El listado del panel: los cupos de la jornada abierta de un negocio.
CREATE INDEX idx_cupo_negocio ON cupo_jornada (negocio_id, jornada_id);
