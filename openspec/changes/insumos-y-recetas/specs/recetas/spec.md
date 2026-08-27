## ADDED Requirements

### Requirement: Un plato declara de qué está hecho

Un servicio SHALL poder declarar qué insumos consume y cuánto de cada uno. La cantidad SHALL expresarse en la unidad del insumo.

La receta SHALL ser opt-in plato por plato: un plato sin receta se comporta exactamente como hoy. Un insumo SHALL aparecer una sola vez por receta (índice único `(servicio_id, insumo_id)`).

El insumo SHALL pertenecer al mismo negocio que el servicio.

#### Scenario: Carga de una receta
- **WHEN** el dueño declara que la hamburguesa lleva 1 medallón y 1 pan de papa
- **THEN** la receta queda cargada con esas dos líneas

#### Scenario: Un insumo no se repite en la misma receta
- **WHEN** el dueño intenta agregar un insumo que ya está en esa receta
- **THEN** la operación se rechaza
- **AND** se ofrece cambiar la cantidad de la línea existente

#### Scenario: No se puede usar el insumo de otro negocio
- **WHEN** se intenta armar una receta con el id de un insumo de otro negocio
- **THEN** la operación se rechaza

### Requirement: Un plato tiene receta o cupo manual, nunca los dos

Un servicio con receta NO SHALL aceptar cupo manual, y un servicio con cupo manual NO SHALL aceptar receta. El rechazo SHALL decir explícitamente cuál de los dos hay que sacar.

Dos fuentes para el mismo número obligan a una regla de precedencia, y toda regla de precedencia es una pregunta que el dueño se hace en el peor momento.

#### Scenario: Cupo sobre un plato con receta
- **WHEN** el dueño intenta ponerle cupo a un plato que ya tiene receta
- **THEN** la operación se rechaza indicando que ese plato se controla por receta

#### Scenario: Receta sobre un plato con cupo
- **WHEN** el dueño intenta cargar una receta en un plato que ya tiene cupo del día
- **THEN** la operación se rechaza indicando que primero hay que quitar el cupo

### Requirement: Las porciones posibles se derivan, no se guardan

Para un servicio con receta, las porciones posibles SHALL calcularse como `min(floor(insumo.stock / receta_item.cantidad))` sobre todas sus líneas.

Ese número NO SHALL persistirse en ninguna tabla. Un valor guardado puede desincronizarse del stock que lo originó, y un stock que miente con confianza es peor que no tener stock.

El cálculo SHALL alimentar los mismos campos `restante` y `agotado` que ya expone el catálogo, sin cambiar sus tipos ni el significado de `null` frente a `0`.

#### Scenario: El insumo más escaso manda
- **WHEN** la hamburguesa lleva 1 medallón y 1 pan, hay 40 medallones y 12 panes
- **THEN** `restante` es 12

#### Scenario: Cantidades que no dividen exacto
- **WHEN** un plato lleva 300 g de carne y hay 1000 g
- **THEN** `restante` es 3, no 3.33

#### Scenario: Un insumo en cero apaga el plato
- **WHEN** la hamburguesa lleva pan y el pan está en 0
- **THEN** `restante` es 0 y `agotado` es true
- **AND** el asistente deja de ofrecer la hamburguesa

#### Scenario: Entra mercadería a mitad del servicio
- **WHEN** un plato está agotado y el dueño registra una compra del insumo que faltaba
- **THEN** la lectura siguiente del catálogo ya lo ofrece
- **AND** no hace falta cerrar ni reabrir la jornada

#### Scenario: Receta vacía es ilimitado, no agotado
- **WHEN** un servicio tiene receta pero se le borraron todas las líneas
- **THEN** se trata como un plato sin receta: `restante` es `null` y `agotado` es false

#### Scenario: Insumos compartidos no son independientes
- **WHEN** el bife y las empanadas comparten la carne, y se vende un bife
- **THEN** las porciones posibles de las empanadas bajan también
- **AND** el panel muestra esa dependencia en vez de dos números que parezcan sumables

### Requirement: Confirmar un pedido descuenta los insumos

Confirmar un compromiso SHALL descontar, por cada línea de plato con receta, la cantidad de cada insumo multiplicada por las unidades pedidas. El descuento SHALL ocurrir en una sola transacción para todo el pedido: o se descuenta todo, o no se descuenta nada.

Si algún insumo no alcanza, la confirmación SHALL fallar con un error que diga **qué insumo** faltó.

Cancelar un compromiso confirmado SHALL devolver los insumos, registrando movimientos de tipo `devolucion`.

El motor de compromisos NO SHALL modificarse: el enganche va en el decorador de gastronomía, que ya está diseñado para recibir opciones.

#### Scenario: Descuento de un pedido de varias unidades
- **WHEN** se confirma un pedido de 3 hamburguesas y cada una lleva 1 medallón y 1 pan
- **THEN** el stock de medallones baja 3 y el de pan baja 3
- **AND** quedan movimientos de `consumo` referenciando ese compromiso

#### Scenario: Un insumo insuficiente frena todo el pedido
- **WHEN** un pedido necesita 5 panes y hay 2
- **THEN** la confirmación falla nombrando al pan
- **AND** ningún otro insumo del pedido quedó descontado

#### Scenario: Cancelar devuelve
- **WHEN** se cancela un pedido confirmado que había consumido 3 medallones
- **THEN** el stock de medallones sube 3
- **AND** queda un movimiento `devolucion`

#### Scenario: Dos pedidos por lo último
- **WHEN** dos pedidos que necesitan el mismo último pan se confirman a la vez
- **THEN** uno confirma y el otro falla
- **AND** el stock del pan nunca queda negativo

#### Scenario: Los platos sin receta no se ven afectados
- **WHEN** un pedido mezcla un plato con receta y otro con cupo manual
- **THEN** el primero descuenta insumos y el segundo descuenta cupo
- **AND** ambos controles se aplican en la misma confirmación

### Requirement: El panel dice qué insumo apagó el plato

Cuando un servicio queda agotado por receta, el sistema SHALL poder informar **cuál** insumo lo limitó y con qué números.

Un plato que se apaga solo y no dice por qué es indistinguible de un bug, y el dueño lo resuelve apagando la feature entera. El insumo limitante ya se conoce: es el mínimo del mismo cálculo que derivó las porciones.

El interruptor manual `disponible` SHALL seguir funcionando como salida de emergencia para forzar la venta de un plato que el stock apagó.

#### Scenario: Se nombra al culpable
- **WHEN** la hamburguesa queda en 0 porciones porque no hay pan
- **THEN** el panel indica que el limitante es el pan, con su stock y lo que pide la receta

#### Scenario: Forzar la venta a mano
- **WHEN** el dueño sabe que el stock está mal cargado y enciende el plato a mano
- **THEN** el plato vuelve a ofrecerse
- **AND** el descuento de insumos sigue intentándose al confirmar

## MODIFIED Requirements

### Requirement: El catálogo expone el cupo del día

`GET /api/servicios` SHALL devolver, por cada servicio, `restante` (entero o `null`) y `agotado` (booleano).

`restante` SHALL derivarse de la primera fuente que aplique, en este orden:
1. **Receta**: si el servicio tiene líneas de receta, `min(floor(insumo.stock / cantidad))`.
2. **Cupo manual**: si tiene fila en `cupo_jornada` de la jornada abierta, `asignado - consumido`.
3. **Ilimitado**: `null`.

Como un servicio no puede tener receta y cupo a la vez, el orden nunca resuelve un empate real; es explícito para que el comportamiento no dependa de la implementación.

`restante: null` SHALL seguir significando "no lleva cuenta" y `restante: 0` "lleva cuenta y no queda". El contrato hacia afuera NO cambia: cambia de dónde sale el número. La resolución de recetas SHALL hacerse en una sola consulta agrupada para toda la carta, nunca una por plato.

#### Scenario: Plato sin cupo ni receta
- **WHEN** el servicio no tiene receta ni fila de cupo
- **THEN** viaja con `restante: null` y `agotado: false`

#### Scenario: Plato con cupo manual
- **WHEN** el servicio tiene cupo `asignado: 10`, `consumido: 4` y ninguna receta
- **THEN** viaja con `restante: 6`

#### Scenario: Plato con receta
- **WHEN** el servicio tiene receta y su insumo más escaso alcanza para 6 porciones
- **THEN** viaja con `restante: 6`

#### Scenario: Receta sin jornada abierta
- **WHEN** el negocio no tiene jornada abierta y el servicio tiene receta
- **THEN** `restante` se calcula igual desde el stock de insumos
- **AND** el insumo no depende de la jornada, a diferencia del cupo

#### Scenario: Sin jornada abierta y con cupo manual
- **WHEN** el negocio no tiene jornada abierta y el servicio se controla por cupo
- **THEN** viaja con `restante: null` y `agotado: false`
- **AND** la respuesta NO devuelve error

#### Scenario: El cupo no se filtra entre negocios
- **WHEN** dos negocios tienen control de stock sobre servicios distintos
- **THEN** el catálogo de cada negocio refleja únicamente lo suyo
