## Context

El `proposal.md` de este cambio puso cuatro desacuerdos sobre la mesa y dijo, textual, que **no decidía**: dos son decisiones de producto con consecuencias operativas para un local y no se toman leyendo un diff.

Estado al empezar este design:

| # | Qué | Estado |
|---|---|---|
| 3 | Las consultas se muestran en UTC | ✅ **Resuelto** en `la-hora-del-negocio`. El alcance real era seis endpoints, no uno. |
| 2 | `ver_catalogo` devuelve `categoria_id` y el prompt pide nombres | Gap: falta un dato, no hay nada que decidir |
| 1 | El pedido dice que entra al panel y no entra | Decisión de producto |
| 4 | Sólo `confirmado` le avisa al cliente | Decisión de alcance |

Este documento decide 1 y 4, y resuelve 2.

**Las dos decisiones se tomaron con una recomendación puesta y aceptada por el dueño del producto**, no por default de implementación. Quedan escritas acá con su costo para que se puedan revertir sabiendo qué se resigna.

## Goals / Non-Goals

**Goals:**
- Que el sistema no le diga al cliente algo que no es cierto. Es el hilo común de los cuatro.
- Que el prompt, las tools y los documentos digan lo mismo. Hoy cada lado es coherente consigo mismo y la juntura no la mira nadie.
- Que cada decisión quede escrita con lo que se resigna, no sólo con lo que se gana.

**Non-Goals:**
- Persistir borradores de pedido. Se decide **no** hacerlo ahora; el porqué está en §1 y el camino queda abierto.
- Avisar en cada transición de estado. Se decide un subconjunto; ver §2.
- Tocar la máquina de estados del core. Ninguno de los tres lo necesita.

## Decisions

### 1. El pedido NO se persiste al armarlo, y el prompt pasa a decir la verdad

`SKILL.md` promete tres veces que el pedido entra al panel apenas hay ítems (líneas 44, 99, 111) y `FLUJOS.md` una cuarta (línea 115). `armar_compromiso` guarda un borrador en la sesión del proceso y devuelve `"persistido": False` **más un aviso que dice lo contrario del prompt**: *"Esto TODAVÍA NO está confirmado"*.

El modelo recibe las dos versiones en el mismo turno. Cuál gana es una moneda al aire, y si gana el prompt el bot le dice al cliente *"ya le pasé el pedido al local"* con la pantalla de la cocina vacía.

**Decisión: que el prompt diga la verdad.** El pedido se escribe con `confirmar`, y eso es lo que el prompt va a decir.

*Por qué no la otra:* persistir de verdad cumple la promesa y hace real el diferencial que `FLUJOS.md` vende —*"la cocina lo ve venir mientras el tipo todavía escribe"*—, pero el precio no es escribir antes: es **el ciclo de vida del borrador**. Pedidos a medio armar en la pantalla de una cocina necesitan expirar solos, distinguirse visualmente de los pedidos reales, no contar en el cierre de caja, no descontar stock, y no ensuciar los reportes. Nada de eso existe hoy. Sin esas cinco cosas, "persistir el borrador" no es cumplir la promesa: es mudar el problema del chat a la pantalla del cocinero, que es peor porque ahí sí hay alguien mirando.

*Lo que se resigna, dicho sin adorno:* se cae la promesa que `FLUJOS.md` usa para diferenciar el producto. El sistema pasa a ser honesto y menos vendible. Es una pérdida real.

*El camino queda abierto:* la promesa vuelve el día que exista el ciclo de vida del borrador, y ese día es un cambio propio con su propio diseño, no un flag.

### 2. Los avisos por WhatsApp son `confirmado` y `listo`, y el documento se corrige

`FLUJOS.md:120` promete aviso en `EN_COCINA → LISTO → ENTREGADO`. `worker/aviso_pedido.go` tiene sólo `PedidoConfirmado`.

**Decisión: se agrega `listo` y el documento pasa a prometer dos, no tres.**

*Por qué esos dos y no los tres:* son los dos momentos en que el cliente **hace algo** con la información. `confirmado` le dice cuánto esperar; `listo` le dice que vaya a buscarlo o que salió el delivery. `en_curso` ("entró a la plancha") no le cambia la conducta a nadie: es ruido con costo, porque cada mensaje se paga en la API de Meta. `entregado` llega cuando el cliente ya tiene la comida en la mano — avisarle es redundante y un poco absurdo.

*Por qué no dejar sólo `confirmado` y bajar el documento a uno:* `listo` es el aviso que evita que el cliente llegue temprano y espere parado en el mostrador, o que llegue tarde y coma frío. Es el que más valor operativo tiene después del primero.

*Lo que se resigna:* nada material. El costo es un mensaje más por pedido en la factura de Meta.

*Simetría con lo que ya existe:* `avisarConfirmacion` sólo avisa si el pedido entró por WhatsApp, si hay teléfono, y es *best-effort* —un aviso que falla no voltea la transición, que ya está persistida—. `listo` sigue exactamente las mismas tres reglas. No se inventa un mecanismo nuevo: se agrega un caso al que ya está probado.

*Diferencia deliberada con `confirmado`:* el aviso de confirmación exige `DemoraMin != nil`, porque su texto la usa. El de `listo` no lleva demora y por lo tanto **no** exige ese campo. Copiar la condición sin pensarla dejaría el aviso mudo justo en los pedidos que no tuvieron demora cargada.

### 3. `ver_catalogo` manda el nombre de la categoría, no sólo el id

`_servicio_visible` (`agente/server.py:301`) devuelve `categoria_id`, un UUID. El `SKILL.md` le muestra al modelo la carta agrupada bajo títulos legibles. El modelo no puede agrupar sin inventarse los nombres, que es exactamente lo que la regla 5 prohíbe.

Acá no hay decisión: falta el dato. Se agrega `categoria_nombre`.

*Dónde sale:* el core ya tiene `GET /api/categorias`. El agente lo lee una vez por armado de catálogo y mapea; no se agrega un campo al response de `/api/servicios` porque el catálogo es lo que el agente pide **en cada mensaje de cada conversación** y engordarlo tiene un costo que este dato no justifica — el mapa de categorías cambia con muchísima menos frecuencia que la carta.

*Qué NO se hace:* no se ordena ni se agrupa del lado del agente. La agrupación es del modelo; la tool le da el dato que le falta y nada más.

*El id se queda:* `categoria_id` sigue viajando. Sacarlo sería un cambio incompatible sin ninguna ganancia.

## Risks / Trade-offs

- **§1 es la decisión más discutible del documento** y hay que decirlo. Se elige honestidad sobre diferenciación, y alguien razonable podría elegir al revés. Lo que la sostiene no es que persistir esté mal, sino que persistir *bien* es más trabajo del que parece, y persistir *mal* es peor que no persistir.
- **§2 agrega un mensaje por pedido a la factura de Meta.** Es un costo por conversación, no fijo: escala con el volumen. Un local con mucho delivery lo va a notar.
- **§3 agrega una lectura de `/api/categorias` por armado de catálogo.** Se mitiga con el mismo criterio que el resto del agente y hay que confirmar que no reintroduzca el N+1 que `stock-visible-al-agente` sacó.

## Migration Plan

Sin migración de datos. Ninguno de los tres toca el esquema ni la máquina de estados.

El orden importa en uno solo: §2 necesita que el aviso de `listo` exista antes de tocar `FLUJOS.md`, para que el documento no prometa algo que todavía no está.

## Open Questions

- ¿El texto del aviso de `listo` cambia según `entrega`? "Ya podés pasar a buscarlo" (retira) y "Salió para tu casa" (delivery) no son la misma frase, y `en_local` no debería recibir nada — el mozo se lo lleva a la mesa. Se resuelve en la implementación, con los tres casos escritos.
