## ADDED Requirements

### Requirement: El negocio lleva su materia prima como saldo corriente

Un insumo SHALL tener nombre, unidad (`g`, `ml`, `unidad`), stock actual y stock mínimo de aviso, y SHALL pertenecer a un negocio.

El stock de un insumo NO SHALL reiniciarse con la jornada. A diferencia del cupo, que es una foto del día, el insumo es un saldo que persiste: la carne que sobra hoy sigue estando mañana.

El stock NO SHALL poder quedar negativo. La garantía SHALL estar en la base (`CHECK (stock >= 0)`), no solamente en el service, con el mismo criterio que `cupo_no_sobrevendido`.

#### Scenario: Alta de un insumo
- **WHEN** el dueño crea "carne picada" en gramos con stock 40000 y mínimo 5000
- **THEN** el insumo queda cargado con ese saldo
- **AND** pertenece únicamente a su negocio

#### Scenario: El saldo cruza el cierre del día
- **WHEN** un insumo queda con stock 12000 y se cierra la jornada
- **THEN** al abrir la jornada siguiente el stock sigue siendo 12000

#### Scenario: El stock no puede quedar negativo
- **WHEN** algún camino intenta descontar más cantidad de la que hay
- **THEN** la operación falla
- **AND** el stock queda intacto

#### Scenario: Los insumos no se filtran entre negocios
- **WHEN** dos negocios tienen insumos con el mismo nombre
- **THEN** cada uno lee y modifica únicamente los suyos

### Requirement: La unidad es del insumo y no se convierte

La unidad SHALL definirse en el insumo. El sistema NO SHALL ofrecer conversión entre unidades (kg↔g, l↔ml) en ningún punto.

Toda cantidad que se exprese contra un insumo — en una receta, en una compra, en un ajuste — SHALL estar en la unidad de ese insumo, y la interfaz SHALL mostrarla junto al campo.

#### Scenario: La unidad acompaña siempre a la cantidad
- **WHEN** el dueño carga una cantidad contra un insumo, en cualquier pantalla
- **THEN** la unidad del insumo se muestra junto al campo
- **AND** no se ofrece elegir otra unidad

#### Scenario: Cambiar la unidad de un insumo con receta
- **WHEN** el dueño intenta cambiar la unidad de un insumo que ya está en una receta
- **THEN** el sistema rechaza el cambio y explica que hay recetas expresadas en la unidad vieja
- **AND** el stock y las recetas quedan intactos

### Requirement: Toda variación de stock queda registrada

Cada cambio del stock de un insumo SHALL registrar un movimiento con tipo (`compra`, `consumo`, `devolucion`, `ajuste`), cantidad, saldo resultante, momento, y el compromiso que lo originó cuando lo haya.

El movimiento SHALL escribirse en la **misma transacción** que el cambio de stock. Un stock que cambió sin movimiento, o un movimiento sin cambio de stock, NO SHALL ser posible.

#### Scenario: Una compra queda registrada
- **WHEN** el dueño registra la entrada de 20000 g de carne
- **THEN** el stock sube 20000
- **AND** queda un movimiento `compra` con el saldo resultante

#### Scenario: El consumo apunta al pedido que lo causó
- **WHEN** se confirma un pedido que consume 400 g de carne
- **THEN** queda un movimiento `consumo` de 400
- **AND** el movimiento referencia al compromiso

#### Scenario: La historia explica el saldo
- **WHEN** el dueño mira los movimientos de un insumo
- **THEN** puede reconstruir cómo llegó del saldo anterior al actual
- **AND** cada consumo dice qué pedido se lo llevó

#### Scenario: Un fallo no deja el registro a medias
- **WHEN** el descuento de stock falla a mitad de una transacción
- **THEN** ni el stock ni el movimiento quedan escritos

### Requirement: El insumo bajo mínimo se ve

Un insumo cuyo stock esté por debajo de su mínimo SHALL aparecer marcado. El aviso SHALL ser visible en el panel; NO SHALL haber notificaciones push en este alcance.

Un insumo sin mínimo cargado NUNCA SHALL marcarse: no tener mínimo significa "no me avises", no "avisame siempre".

#### Scenario: Cae bajo el mínimo
- **WHEN** un insumo con mínimo 5000 queda en 4200
- **THEN** aparece marcado como bajo mínimo

#### Scenario: Sin mínimo no hay aviso
- **WHEN** un insumo no tiene mínimo cargado y queda en 1
- **THEN** NO aparece marcado
