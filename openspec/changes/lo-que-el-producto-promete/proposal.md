## Why

El arnés de tres actores encontró cuatro lugares donde **el producto no hace lo que sus propios documentos dicen que hace**. No son bugs de código: cada lado funciona bien por separado. Son desacuerdos entre el prompt, las tools y los documentos que los tres dan por ciertos.

Ninguna de las cinco suites los ve, y no es un descuido: `pytest` asevera lo que la tool hace, `go test` lo que el motor hace, y el `SKILL.md` es texto que nadie contrasta contra el código. Cada lado es coherente **consigo mismo**. La juntura no la miraba nadie hasta ahora.

Los cuatro son de la misma familia y por eso van juntos: **el sistema le dice al cliente algo que no es cierto**, y en tres de los cuatro se lo dice con total confianza.

## What Changes

Este documento **no decide**: propone y pone las opciones sobre la mesa. Dos de los cuatro son decisiones de producto con consecuencias operativas reales para un local, y no se toman a las once de la noche leyendo un diff.

### 1. El pedido dice que entra al panel y no entra — **decisión de producto**

`SKILL.md` lo promete tres veces (líneas 44, 99, 111) y `FLUJOS.md` una cuarta (línea 115): *"el pedido entra al panel apenas hay ítems"*. `armar_compromiso` (`agente/server.py:580`) guarda un borrador en la sesión del proceso y devuelve `"persistido": False` **más un aviso que dice lo contrario del prompt**: *"Esto TODAVÍA NO está confirmado"*. El compromiso lo escribe `confirmar`. Hay un test que lo fija a propósito (`test_arma_pedido_de_dos_items_con_total_y_no_persiste`).

El modelo recibe las dos versiones en el mismo turno. Cuál gana es una moneda al aire, y si gana el prompt el bot le dice al cliente *"ya le pasé el pedido al local"* con la pantalla de la cocina vacía.

Y hay algo más grande en juego: `FLUJOS.md` vende como diferencial que *"la cocina lo ve venir mientras el tipo todavía escribe"*. Hoy eso es falso.

**Las dos salidas, con su costo:**
- **Que persista de verdad.** Se cumple la promesa y el diferencial es real. El precio: pedidos a medio armar en la pantalla de la cocina, y basura de conversaciones abandonadas que hay que expirar.
- **Que el prompt diga la verdad.** Honesto y barato. El precio: se cae la promesa que el documento usa para diferenciar el producto.

No hay una tercera que sea gratis. **Elegir es del dueño del producto.**

### 2. `ver_catalogo` no puede dar lo que el prompt pide — gap, no decisión

`_servicio_visible` (`agente/server.py:308`) devuelve `categoria_id`, un UUID. El `SKILL.md` (líneas 282-292) le muestra al modelo la carta agrupada bajo **Hamburguesas / Para compartir / Bebidas**.

El modelo no puede agrupar sin inventarse los títulos, que es exactamente lo que la regla 5 prohíbe. Se le pide un formato que las tools no pueden alimentar. Acá no hay decisión: falta el dato.

### 3. Las consultas se muestran en UTC — bug — ✅ RESUELTO en `la-hora-del-negocio`

> **El hallazgo era correcto y el alcance estaba corto.** No era un endpoint
> olvidado: medidos los siete, **seis** salían en UTC (consultas, jornada,
> clientes, `ultimo_pedido`, movimientos de insumo y cobros). El único bien era
> compromisos, porque `EnTimezone` existía sólo ahí.
>
> La causa no era el olvido sino su forma: localizar era *opt-in*. El cambio
> `la-hora-del-negocio` invierte el default con un tipo `dto.Hora` que no se
> puede serializar sin huso, más un middleware que lo resuelve una vez por
> request. Medición: de 6 mal / 3 bien a **0 mal / 9 bien**.
>
> Y confirmó lo que este documento decía del panel: `horaDe` está bien y no se
> tocó. El bug estaba en el core.


Una pregunta hecha 22:48 en Mendoza se ve **01:48** en la pantalla «Preguntas».

`horaDe` (`panel/src/dominio/formato.ts:28`) lee la hora del string tal cual, y **está bien**: su contrato dice que el core manda la hora ya localizada. Los compromisos pasan por `localizado()` (`motor_gastro.go`); las consultas no. El bug está en el core, no en el panel.

### 4. Sólo `confirmado` le avisa al cliente — alcance

`FLUJOS.md:120` dice *"cada cambio dispara aviso por WhatsApp"* para EN_COCINA → LISTO → ENTREGADO. `core/internal/worker/aviso_pedido.go` sólo tiene `PedidoConfirmado`.

Puede ser que sólo se haya implementado uno, o que el documento prometa de más a propósito (tres avisos por pedido es mucho WhatsApp, y cada uno cuesta plata en la API de Meta). **Hay que decidir cuál de las dos es**, y que el documento y el código digan lo mismo.

## Capabilities

### New Capabilities
- `promesas-cumplidas`: que lo que el prompt le dice al modelo, lo que las tools devuelven y lo que los documentos prometen digan lo mismo — y que exista algo que lo verifique, porque hoy no lo verifica nadie.

### Modified Capabilities
<!-- Se decide al escribir los specs, cuando estén tomadas las decisiones 1 y 4. -->

## Impact

Depende de cómo se resuelvan 1 y 4. En el peor caso: `agente/server.py`, el `SKILL.md`, `core/internal/service/consulta_service.go`, `core/internal/worker/aviso_pedido.go`, `docs/FLUJOS.md` y el catálogo del core.

**Lo que NO cambia:** el arnés. Sus aserciones ya aseveran el **contrato documentado**, no la implementación, y por eso están en rojo. Cuando esto se arregle se ponen verdes solas. Si en cambio se decide cambiar el documento, hay que actualizarlas — y eso es correcto: cambiar lo que el producto promete tiene que costar un cambio explícito en lo que lo verifica.

## Lo que hay que llevarse de esto, más allá de los cuatro

Los cuatro salieron del mismo lugar: **nadie contrastaba el prompt contra el código**. El `SKILL.md` son 400 líneas que el modelo obedece como si fueran documentación de la API, y hasta hoy podían decir cualquier cosa sin que nada se quejara.

Mientras el prompt siga siendo texto que ninguna suite lee, esta clase de bug se vuelve a fabricar sola cada vez que alguien edita el `SKILL.md` — y se descubre en la conversación de un cliente, no en CI.
