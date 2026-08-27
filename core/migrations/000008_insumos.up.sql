-- 000008_insumos: la materia prima del negocio y de qué está hecho cada plato.
-- Capa 2 del control de stock.
--
-- La 000007 dice que no se descuentan ingredientes al gramo porque "eso exige
-- recetas y rendimientos perfectos y se abandona en un mes". El dueño del
-- producto revisó ese argumento y decidió avanzar igual, así que el riesgo que
-- esa frase anticipaba —una receta mal cargada apaga un plato que sí se puede
-- vender— es lo que ordena las decisiones de acá abajo: la unidad no se
-- convierte (no hay error de factor mil), toda variación queda registrada (el
-- dueño puede auditar el saldo) y el limitante se puede nombrar (el plato que
-- se apaga dice por qué).
--
-- La diferencia estructural con la Capa 1: el cupo es una FOTO del día y vive
-- colgado de la jornada; el insumo es un SALDO CORRIENTE y vive colgado del
-- negocio. La carne que sobra hoy sigue estando mañana, así que acá no hay
-- jornada_id en ningún lado. Si alguien se la agrega, el stock se reinicia
-- todas las noches y la feature entera deja de tener sentido.

-- ─── Insumo: la materia prima ───────────────────────────────────────
CREATE TABLE insumo (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  UUID        NOT NULL REFERENCES negocio(id),
  nombre      TEXT        NOT NULL,   -- "carne picada", "pan de papa"

  -- La unidad es DEL INSUMO y no se convierte nunca. Es el riesgo con peor
  -- relación daño/probabilidad de todo el cambio: cargar la carne en kilos y
  -- la receta en gramos apaga la cocina entera por un factor de mil, y el
  -- dueño no tiene cómo darse cuenta de que ése es el problema. Una sola
  -- unidad por insumo elimina la conversión, y sin conversión no hay error de
  -- conversión. El CHECK está para que nadie invente 'kg' y rompa la premisa
  -- desde una consola de psql.
  unidad      TEXT        NOT NULL CHECK (unidad IN ('g', 'ml', 'unidad')),

  -- El saldo. Entero en la unidad del insumo: gramos, no kilos con coma. Los
  -- flotantes acá terminan en 0.30000000000000004 porciones.
  stock       INT         NOT NULL DEFAULT 0,

  -- NULL es "no me avises", NO "avisame siempre". Un insumo sin mínimo jamás
  -- se marca: si el default fuera avisar, el panel arrancaría con todo en rojo
  -- el primer día y el dueño aprendería a ignorar la marca — que es la única
  -- forma en que un aviso muere.
  stock_minimo INT        CHECK (stock_minimo >= 0),

  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- La sobreventa la impide la BASE, no el service. El UPDATE del descuento ya
  -- trae su propia guarda (stock - n >= 0), pero si algún día alguien escribe
  -- otro camino que se olvide de ponerla, acá rebota. Mismo criterio que
  -- cupo_no_sobrevendido en la 000007: el árbitro es Postgres, no una
  -- condición de carrera en Go. Sacar este CHECK es habilitar stock negativo,
  -- que en la práctica es vender comida que no existe.
  CONSTRAINT insumo_stock_no_negativo CHECK (stock >= 0)
);

-- El listado del panel: los insumos de un negocio por nombre. Es también el
-- índice que acota por tenant todas las lecturas de esta tabla.
CREATE INDEX idx_insumo_negocio ON insumo (negocio_id, nombre);

-- ─── Receta: de qué está hecho un plato ─────────────────────────────
CREATE TABLE receta_item (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE: la receta es del plato. Si el plato se borra, no queda
  -- una receta huérfana apuntando a algo que ya no está en la carta.
  servicio_id UUID  NOT NULL REFERENCES servicio(id) ON DELETE CASCADE,

  -- Sin CASCADE a propósito: borrar un insumo que está en una receta tiene que
  -- REBOTAR, no vaciar recetas por abajo. Un plato al que le desaparecieron
  -- líneas se vuelve ilimitado en silencio (ver más abajo por qué), o sea que
  -- el CASCADE acá sería "borré la carne y ahora las hamburguesas son
  -- infinitas". La baja de un insumo en uso es activo = FALSE, no DELETE.
  insumo_id   UUID  NOT NULL REFERENCES insumo(id),

  -- En la unidad del insumo, siempre. La receta NO elige unidad (ver el
  -- comentario de insumo.unidad). CHECK (cantidad > 0): una línea en cero no
  -- significa nada —ni "no lleva" ni "lleva algo"— y además haría explotar el
  -- floor(stock / cantidad) con una división por cero.
  cantidad    INT   NOT NULL CHECK (cantidad > 0)
);

-- Un insumo aparece UNA sola vez por receta. Sin esto, "la hamburguesa lleva
-- 100 g de carne" y "la hamburguesa lleva 200 g de carne" conviven, y el
-- min(floor()) que deriva las porciones pasa a depender de en qué orden se
-- cargaron las filas. Es lo que convierte "editar la receta" en cambiarle la
-- cantidad a una línea y no en una carrera entre dos filas iguales.
CREATE UNIQUE INDEX idx_receta_servicio_insumo ON receta_item (servicio_id, insumo_id);

-- La pregunta inversa: "¿en qué platos se me va la carne?". La necesitan el
-- panel (mostrar los insumos compartidos como dependencia, no como dos números
-- sumables) y el rechazo del cambio de unidad de un insumo con recetas vivas.
CREATE INDEX idx_receta_insumo ON receta_item (insumo_id);

-- Nota sobre el índice que el catálogo necesita (design §8): la resolución de
-- TODA la carta en una sola consulta arranca por idx_servicio_negocio, entra a
-- receta_item por idx_receta_servicio_insumo y a insumo por su PK. No hace
-- falta un índice más; hace falta que nadie escriba la consulta plato por
-- plato, que sería un N+1 sobre dos tablas en cada mensaje de cada
-- conversación.

-- ─── Movimiento: por qué el saldo es el que es ──────────────────────
--
-- "Compré 20 kg, ¿por qué me quedan 3?" es la primera pregunta que el dueño
-- hace cuando el sistema y la heladera no coinciden, y aparece el día dos. Sin
-- esta tabla no tiene respuesta, y sin respuesta deja de confiar en el número
-- —que es la única forma en que esta feature muere de verdad—.
--
-- Se crea AHORA y no en un v2 porque el historial no se puede backfillear: lo
-- que no se registró el martes no existe el jueves.
CREATE TABLE movimiento_insumo (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id   UUID  NOT NULL REFERENCES insumo(id),

  -- compra/devolucion suman, consumo resta, ajuste deja el saldo donde el
  -- dueño dice que está (contó la heladera). El CHECK evita que aparezca un
  -- quinto tipo que nadie sepa interpretar al leer la historia.
  tipo        TEXT  NOT NULL CHECK (tipo IN ('compra', 'consumo', 'devolucion', 'ajuste')),

  -- SIEMPRE positivo: es la MAGNITUD del movimiento y el tipo dice el signo.
  -- Guardar negativos haría que "sumá la columna" dé el saldo por accidente y
  -- que el día que alguien cargue un consumo en positivo la suma mienta.
  cantidad    INT   NOT NULL CHECK (cantidad > 0),

  -- El saldo DESPUÉS del movimiento. Es redundante con la suma de la historia
  -- y por eso mismo sirve: permite leer una fila sola y saber en qué quedó, y
  -- permite detectar que la historia y el saldo se desincronizaron.
  saldo_resultante INT NOT NULL CHECK (saldo_resultante >= 0),

  -- Qué pedido se lo llevó. NULL para las compras y los ajustes, que no
  -- vienen de un compromiso. Sin CASCADE: si el compromiso se borrara, el
  -- movimiento tiene que seguir explicando el saldo.
  compromiso_id UUID REFERENCES compromiso(id),

  -- El texto que el dueño escribe en un ajuste ("se cayó una bandeja").
  motivo      TEXT,

  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La vista de historia de un insumo: lo último primero. Es la consulta que
-- responde "¿por qué me quedan 3?".
CREATE INDEX idx_movimiento_insumo ON movimiento_insumo (insumo_id, creado_en DESC);
