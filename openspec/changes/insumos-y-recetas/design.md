## Context

Después de `stock-visible-al-agente`, el sistema tiene un contrato limpio: el catálogo dice `restante` (entero o `null`) y `agotado`, y el asistente ya no ofrece lo que no hay. Ese contrato tiene hoy una sola fuente — el cupo manual por plato y por jornada.

Esta capability agrega una segunda fuente: la receta. El plato deja de tener un número que alguien escribió y pasa a tener un número que se deriva de la materia prima que hay en el local.

La diferencia estructural con el cupo no es menor y define casi todo el diseño:

|  | Cupo (Capa 1) | Insumo (Capa 2) |
|---|---|---|
| Vive en | la jornada | el negocio |
| Se reinicia | todos los días | nunca |
| Lo carga el dueño | cada día | cuando compra |
| Unidad | porciones | gramos, ml, unidades |
| Relación con el plato | 1 a 1 | N a N |

El cupo es una foto del día. El insumo es un saldo corriente. Un `cupo_jornada` sin fila significa "hoy no llevo la cuenta"; un `insumo` en cero significa "no hay carne", y eso sigue siendo verdad mañana a la mañana.

Y la restricción heredada del proyecto: **el motor de compromisos no se toca**. Lo que se toca es `motor_gastro.go`, que es el decorador del vertical y fue diseñado explícitamente para engancharse por opciones (`ConControlDeCupos`). Esta capability suma una opción más ahí, no cambia la máquina de estados.

## Goals / Non-Goals

**Goals:**
- Que el dueño cargue materia prima una vez y los platos se apaguen solos cuando no alcanza.
- Que los dos modos convivan sin que el dueño tenga que entender la diferencia: carga receta o carga cupo, y el sistema hace lo suyo.
- Que cuando el stock miente, el dueño pueda darse cuenta y arreglarlo en segundos, no descubrirlo por una venta perdida.
- Que toda variación de stock tenga una explicación recuperable.

**Non-Goals:**
- **Rendimientos, mermas y desperdicio.** Una receta declara lo que lleva el plato, no lo que se tira pelando la papa. Modelar merma exige medirla, y medirla exige una disciplina que un local chico no tiene. Es exactamente el pantano que la decisión original del proyecto quería evitar.
- **Costeo y márgenes.** Con insumos y precios se puede calcular el costo de un plato. Es tentador y no entra acá: cambia el alcance de "que no me falte" a "cuánto gano", que es otro producto.
- **Recetas anidadas** (una salsa que es insumo de tres platos). Un nivel de profundidad. El día que haga falta, se agrega; hoy duplicar la salsa en tres recetas es peor en teoría y mejor en la práctica.
- **Órdenes de compra y proveedores.**
- **Inventario físico / conteo cíclico.** El ajuste manual alcanza para v1.

## Decisions

### 1. La receta deriva porciones; no las guarda

`restante` de un plato con receta se calcula al vuelo: `min(floor(insumo.stock / receta_item.cantidad))` sobre todos sus insumos. No hay columna `porciones_posibles` en ningún lado.

*Por qué:* si se guardara, habría que recalcularla ante cada movimiento de cada insumo de cada receta que lo usa — y el día que un recálculo falle, el sistema miente con total confianza. Derivar es más caro por lectura y no puede desincronizarse.

*Alternativa descartada:* materializar en `cupo_jornada` al abrir la caja. Tiene el atractivo de reusar toda la Capa 1 sin tocar nada, pero rompe apenas entra mercadería a mitad de servicio: el cupo del día quedó calculado con el stock de las 20:00 y la carne llegó a las 21:30.

### 2. Un plato tiene receta **o** cupo manual, nunca los dos

Se valida al cargar: si el plato tiene receta, no acepta cupo manual, y al revés. El error es explícito y dice cuál sacar.

*Por qué:* dos fuentes para el mismo número obligan a inventar una regla de precedencia, y toda regla de precedencia es una pregunta que el dueño se va a hacer en el peor momento ("¿por qué dice 3 si cargué 10?"). Prohibirlo en la escritura es una línea de validación; permitirlo es una clase de bug permanente.

*Alternativa descartada:* "la receta gana". Funciona, pero deja cupos manuales huérfanos en la base que no hacen nada y que alguien va a leer en un dashboard.

### 3. La unidad es del insumo; la receta la hereda

`insumo.unidad` (`g`, `ml`, `unidad`) se define al crear el insumo. `receta_item.cantidad` es un número **en la unidad del insumo**, y la UI la muestra siempre al lado del campo. La receta nunca elige unidad.

*Por qué:* es el riesgo con peor relación daño/probabilidad de todo el cambio. Cargar la carne en kilos y la receta en gramos apaga la cocina entera por un factor de mil, y el dueño no tiene forma de darse cuenta de que ese es el problema. Una sola unidad por insumo elimina la conversión, y sin conversión no hay error de conversión.

*Alternativa descartada:* unidades convertibles (kg↔g, l↔ml). Más cómodo de cargar, y agrega una tabla de factores que hay que testear y que puede estar mal. La comodidad no paga ese precio acá.

### 4. Se registra cada movimiento de stock

`movimiento_insumo` (insumo_id, tipo, cantidad, saldo_resultante, compromiso_id opcional, motivo, creado_en). Tipos: `compra`, `consumo`, `devolucion`, `ajuste`. El insert va en la **misma transacción** que el cambio de `insumo.stock`.

*Por qué:* "compré 20 kg, ¿por qué me quedan 3?" es la primera pregunta que el dueño hace cuando el sistema y la heladera no coinciden, y aparece el día dos. Sin registro no tiene respuesta, y sin respuesta el dueño deja de confiar en el número — que es la única forma en que esta feature muere. Es una tabla y un insert; backfillearlo después es imposible.

*Alternativa descartada:* dejarlo para v2. El costo de agregarlo ahora es una tabla; el costo de agregarlo después es una tabla más un agujero permanente en la historia.

### 5. El descuento reusa la disciplina del cupo, no la reimplementa

El descuento de insumos al confirmar copia la forma de `cupoRepo.mover`: una transacción, `UPDATE ... WHERE stock >= cantidad` con guarda propia, y `CHECK (stock >= 0)` en la tabla como árbitro final. La interfaz `cupoDescontador` de `motor_gastro.go:41` se generaliza para que el decorador descuente lo que corresponda según el plato.

*Por qué:* la Capa 1 ya resolvió bien el problema difícil (carrera entre dos pedidos por lo último). Repetir el patrón es más barato y más seguro que inventar otro, y deja las dos capas rompiéndose igual, que es lo que uno quiere cuando debuguea a las once de la noche.

### 6. Una salida visible para la receta mal cargada

Cuando un plato queda en `agotado` **por receta**, el panel dice cuál insumo lo apagó y con qué número: *"Hamburguesa: 0 porciones — falta pan de papa (quedan 2 unidades, la receta pide 3 unidades)"*, y lo lleva a corregir ese saldo.

> **Corregido durante el apply.** La versión original decía que el interruptor `disponible` quedaba como salida de emergencia para forzar la venta. **Es falso y era una promesa peligrosa.** Un plato agotado por receta ya tiene `disponible: true` —por eso se ve como agotado—, así que apagarlo lo esconde y prenderlo lo devuelve a agotado. Y aunque se pudiera forzar dentro de la lista vendible, confirmar el pedido fallaría con `ErrSinStock`: la salida habría dejado al cliente pidiendo algo que no se le puede cobrar. Una salida que falla más tarde es peor que no tener salida.
>
> La salida real es **corregir el saldo del insumo**, y es mejor: arregla el número equivocado en vez de taparlo, y deja un movimiento de `ajuste` explicando qué pasó. El panel ya lleva del plato apagado al insumo — *"Si ese número está mal, corregilo en Stock → Insumos"*.

*Por qué:* es el riesgo que la decisión original del proyecto anticipó y la razón por la que estos sistemas se abandonan. Un plato que se apaga solo y no dice por qué es indistinguible de un bug, y el dueño lo resuelve apagando la feature entera. El insumo culpable ya está calculado — es el `argmin` del mismo `min()` que derivó las porciones — así que mostrarlo no cuesta nada y es la diferencia entre "esto anda mal" y "ah, cargué mal el pan".

### 7. Los insumos compartidos se muestran como lo que son

Si la carne la usan el bife y las empanadas, las porciones posibles de cada uno no son independientes. El panel NO muestra los dos números como si se pudieran sumar; muestra el insumo y qué platos dependen de él.

*Por qué:* no es una decisión de diseño, es aritmética: el `min()` de cada plato lee el mismo saldo. Mostrar "6 bifes / 20 empanadas" invita a leer "26 platos", y cuando vendan 6 bifes y las empanadas bajen a 8, el número va a parecer roto. Mostrar la dependencia hace que el comportamiento sea obvio en vez de sorprendente.

### 8. El catálogo resuelve todas las recetas en una consulta

El listado trae en una sola query los `receta_item` de todos los servicios de la carta con el stock de sus insumos, y hace el `min()` en memoria.

*Por qué:* el camino ingenuo (por cada plato, traer su receta; por cada ítem, traer su insumo) es un N+1 sobre dos tablas y el catálogo se pide en cada mensaje de cada conversación. `stock-visible-al-agente` ya sentó el precedente de resolver el stock en una consulta agrupada; esto lo sostiene.

## Risks / Trade-offs

- **Una receta mal cargada apaga un plato vendible** → decisión §6: el panel dice qué insumo lo apagó, y el interruptor manual sigue siendo la salida de emergencia. Es la mitigación, no la solución; el riesgo es real y es el precio de la feature.
- **Unidades mal cargadas** → decisión §3: una unidad por insumo, heredada por la receta, sin conversión posible.
- **El dueño carga la materia prima una vez y no la vuelve a tocar** → el stock deriva de la realidad y el sistema apaga platos que sí hay. No hay mitigación técnica: es disciplina operativa, y es exactamente lo que la decisión original del proyecto predijo que iba a fallar. El registro de movimientos al menos hace visible cuándo fue la última vez que alguien cargó algo.
- **Costo del catálogo** → decisión §8, y medir con carta grande + recetas de varios insumos. Si duele, la salida es cachear por jornada con invalidación en cada movimiento, no volver al N+1.
- **Insumos compartidos confunden** → decisión §7.
- **Devolver insumos al cancelar es una ficción parcial** → si el pedido se canceló después de que la cocina lo hizo, la carne ya no está. Devolver el stock miente en favor. Se devuelve igual (es lo mismo que hace el cupo hoy) y el movimiento queda registrado como `devolucion`, así el dueño puede ajustarlo. Anotarlo como limitación conocida, no fingir que está resuelto.

## Migration Plan

Migración aditiva: tres tablas nuevas, ninguna columna existente cambia. Un negocio sin insumos cargados se comporta exactamente igual que hoy — el catálogo cae al cupo manual o a ilimitado, que es lo que ya hacía.

Deploy: migración → core → panel. El agente no cambia.

Rollback: revertir el core deja las tablas huérfanas sin efecto (el catálogo vuelve a mirar sólo `cupo_jornada`). La migración `down` borra las tres tablas; sólo correrla si se abandona la feature, porque se pierde el historial de movimientos.

## Open Questions

- ¿La receta se carga en la vista Carta (junto al plato) o en la vista Insumos (junto a la materia prima)? Junto al plato es donde el dueño piensa "de qué está hecha la hamburguesa"; junto al insumo es donde piensa "en qué se me va la carne". Probablemente las dos, con una sola fuente de verdad. Resolver con el dueño en dogfooding.
- ¿Un plato con receta cuyos insumos alcanzan para 200 porciones debería mostrar `restante: 200`, o `null`? El número es verdadero pero no es una decisión de nadie. Inclinación: devolverlo igual y dejar que el umbral de `stock-visible-al-agente` (`<= 3`) decida si el asistente lo menciona.
- ¿Qué pasa con un plato cuya receta quedó vacía (se le borraron todos los insumos)? Inclinación: tratarlo como sin receta (ilimitado), no como agotado. Apagar un plato porque alguien vació su receta es el peor default posible.
