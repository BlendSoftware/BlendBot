## Why

El dueño quiere cargar la materia prima una vez y que los platos se descuenten solos: si entran 40 medallones y cada hamburguesa lleva uno, después de 40 hamburguesas la hamburguesa se apaga sin que nadie toque nada. Hoy el sistema sabe contar porciones por plato (`cupo_jornada`, Capa 1) pero no sabe de qué está hecho un plato, así que el dueño tiene que recalcular a mano el cupo de cada ítem cada vez que entra o sale mercadería — y en el medio del servicio eso no pasa.

**Esta capability contradice una decisión escrita del proyecto.** Dos lugares dicen que no va:
- `core/migrations/000007_cupos.up.sql`: *"No se descuentan ingredientes al gramo: eso exige recetas y rendimientos perfectos y se abandona en un mes."*
- `docs/PANEL.md` → "Lo que NO va en el v1: **Stock de insumos**".

El dueño del producto revisó ese argumento y decidió avanzar igual. Queda registrado acá, y el diseño se hace cargo del riesgo concreto que esa decisión anticipaba: **una receta mal cargada apaga un plato que sí se puede vender.** Un sistema de stock que miente en contra es peor que no tener stock, porque el local pierde ventas sin enterarse. Las decisiones de `design.md` giran alrededor de eso.

Va después de `stock-visible-al-agente` y no antes, porque el contrato que ese cambio establece (`restante` / `agotado` en el catálogo, y el asistente respetándolo) es exactamente el que esta capability va a alimentar desde otra fuente. Sin él, descontar insumos no cambiaría nada de lo que ve el cliente.

## What Changes

- **Insumos**: el negocio carga su materia prima con nombre, unidad y stock (`carne picada`, gramos, 40000). El stock de un insumo es un saldo corriente que **no** se reinicia con la jornada: la carne que sobra hoy sigue estando mañana.
- **Recetas**: cada plato puede declarar qué insumos consume y cuánto de cada uno. Es opt-in plato por plato, igual que el cupo.
- **Porciones derivadas**: para un plato con receta, las porciones posibles se calculan `min(floor(stock_insumo / cantidad_receta))` sobre todos sus insumos. No se guardan: se derivan. Guardarlas sería un segundo lugar donde vive la misma verdad.
- **Descuento automático**: confirmar un pedido descuenta los insumos de cada plato con receta, en la misma transacción y con la misma disciplina que ya usa el cupo. Cancelar los devuelve.
- **Los dos modos conviven**: un plato con receta se controla por insumos; uno con cupo manual se controla por cupo; uno sin ninguno de los dos es ilimitado; y el interruptor `disponible` sigue apagando cualquiera a mano. Un plato SHALL tener receta o cupo manual, nunca los dos — dos fuentes para el mismo número es una fábrica de bugs.
- **Movimientos**: toda variación de stock de un insumo (compra, consumo, ajuste, devolución) queda registrada. Sin esto, la pregunta "compré 20 kg, ¿por qué me quedan 3?" no tiene respuesta posible, y esa pregunta aparece el día dos.
- **Avisos**: un insumo por debajo de su mínimo aparece marcado en el panel. Sin notificaciones push en este alcance.
- **NO BREAKING**: el contrato del catálogo no cambia — `restante` y `agotado` ya existen desde `stock-visible-al-agente`; esta capability sólo agrega una fuente más de la que pueden salir.

## Capabilities

### New Capabilities
- `insumos`: la materia prima del negocio como saldo corriente, con unidad, mínimo de aviso y un registro de movimientos que explique cada variación.
- `recetas`: qué insumos consume cada plato y cuánto, y cómo eso deriva en porciones posibles y en el descuento al confirmar.

### Modified Capabilities
- `stock-en-catalogo`: `restante` y `agotado` pasan a poder originarse en una receta además del cupo manual. El contrato hacia afuera (los campos, sus tipos, el significado de `null` vs `0`) NO cambia; cambia de dónde sale el número.

## Impact

**Base de datos**
- Migración nueva: `insumo`, `receta_item`, `movimiento_insumo`.
- `CHECK (stock >= 0)` en `insumo`: el árbitro de la sobreventa sigue siendo Postgres, mismo criterio que `cupo_no_sobrevendido`.
- Índice único `(servicio_id, insumo_id)` en `receta_item`: un insumo aparece una sola vez por receta.

**Core (Go)**
- `model/`, `repository/`, `service/`, `handler/`, `dto/` para insumos y recetas.
- El armado del catálogo suma la fuente "receta" al cálculo de `restante`/`agotado` que `stock-visible-al-agente` dejó montado.
- `motor_gastro.go`: el descontador actual (`cupoDescontador`) se generaliza para que confirmar descuente insumos o cupo según lo que tenga el plato. **El motor de compromisos sigue sin tocarse**: se toca el decorador de gastronomía, que es aditivo por diseño.

**Panel (React)**
- Vista Insumos (alta, stock, mínimo, registrar compra) — pestaña dentro de Stock.
- Editor de receta por plato en Carta.
- El aviso de insumo bajo mínimo.

**Agente (Python)**
- Sin cambios de contrato: ya no ofrece agotados desde `stock-visible-al-agente`. A confirmar en verify que efectivamente no hace falta tocar nada.

**Riesgos que el diseño tiene que resolver**
- **Receta mal cargada apaga un plato vendible.** Es el riesgo que la decisión original del proyecto anticipaba. Necesita una salida visible y rápida para el dueño.
- **Unidades.** Cargar la carne en kilos y la receta en gramos apaga la cocina entera por un factor de mil. La unidad tiene que ser del insumo y la receta tiene que heredarla, no elegirla.
- **Insumos compartidos.** Si el bife y las empanadas comparten la carne, las porciones posibles de cada plato dejan de ser independientes: vender un bife baja las empanadas posibles. Es inherente al modelo, no una decisión. El panel tiene que mostrarlo así o el número va a parecer roto.
- **Costo del catálogo.** Cada listado pasa a resolver un `min()` sobre las recetas de toda la carta. Sin cuidado es un N+1 sobre dos tablas.
