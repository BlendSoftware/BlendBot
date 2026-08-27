## Why

El producto se prueba hoy en dos mitades que nunca se tocan. `scripts/smoke.sh` recorre el core entero por la API real (77 asserts) pero **nunca habla con el modelo, nunca abre el panel y nunca manda un WhatsApp**: entra por `/api/compromisos` con un token de dueño y hace de cuenta que del otro lado hubo una conversación. `agente/tests/` prueba las tools con el core mockeado (`respx`), o sea prueba la plomería del MCP sin el modelo arriba. `panel/src/**/*.test.tsx` prueba componentes con jsdom, sin core. `gateway/tests/` prueba el webhook con `queryFn` inyectado, o sea sin bot.

El resultado es que **la pieza que el cliente efectivamente usa —el bot decidiendo qué decir— no tiene una sola línea de verificación en todo el repo**. Y no es un hueco teórico: el cambio `stock-visible-al-agente` dejó escrito, en su propio spec, el escenario *"El bot sabe decir que se terminó"* y lo dejó **sin cubrir**, porque es comportamiento del modelo y ninguna suite del repo sabe aseverar eso. Ese escenario es justo el que protege la regla que más plata cuesta romper: decirle "no lo tenemos" a un cliente por un plato que sí existe y volvió ayer.

Peor: las cuatro suites juntas no prueban **la juntura**. El valor del producto, textual en `docs/FLUJOS.md`, es *"el aviso de vuelta es la mitad del valor"*: el cliente pide, el pedido entra al panel, **el dueño toca un botón**, y el cliente recibe la demora por WhatsApp. Ese círculo cruza los cinco componentes (gateway → agente → core → panel → core → redis → gateway → Graph) y hoy **no lo recorre nada**. Si mañana el `SelectorDemora` pierde el campo libre, o el worker de salidas deja de leer la cola, o el SKILL empieza a prometer demoras, las cuatro suites siguen verdes y el smoke también.

Va ahora porque el pedido del dueño del producto fue literal —*"un agente que testee como dueño con playwright, un agente que haga de bot con el prompt y uno que haga de cliente"*— y porque `insumos-y-recetas` está por sumar una segunda fuente de la que puede salir "no hay". Sin un arnés que pruebe qué **dice** el bot cuando no hay, esa feature se despliega a ciegas.

## What Changes

- **Un arnés de tres actores en `arnes/`**, proyecto propio en la raíz, que corre una conversación completa contra el sistema real y asevera sobre el resultado. Los tres actores:
  - **🧑‍🍳 El dueño**, con **Playwright** sobre Chromium, en el panel real: entra, ve el pedido entrar, confirma con demora, marca listo, responde una consulta. Sólo los gestos que el dueño hace de verdad.
  - **🤖 El bot**, que **es el producto, no una imitación**: el `SKILL.md` de gastronomía como system prompt, el MCP de `agente/` con las tools reales, el modelo real de la API de Anthropic, el mismo `MODELO` que corre en producción. El arnés no reimplementa el bot; lo observa.
  - **👤 El cliente**, que escribe por el webhook de WhatsApp con firma HMAC válida y recibe las respuestas en un **Graph falso** que hace de teléfono. En modo `guion` sus mensajes son el texto literal de `docs/FLUJOS.md` (con la tipeada y todo); en modo `libre` es un segundo modelo actuando un personaje.
- **Tres niveles de aserción, con distinta autoridad.** Nivel 1: el estado del core por la API (determinista, es donde vive casi todo el valor). Nivel 2: las tools que el bot llamó y con qué argumentos (determinista, se lee del stream del SDK). Nivel 3: lo que el bot **dijo**, evaluado por un modelo juez sobre **prohibiciones** —nunca sobre obligaciones de estilo— con cita textual obligatoria y mayoría de 3 veredictos. Un veredicto sin cita es un bug del arnés, no una falla del bot.
- **Dos modos y un tope de plata.** `guion` (el que se corre siempre: cliente scripteado, bot real) y `libre` (cliente-modelo improvisando, no bloquea nada, produce informe). `ARNES_TOPE_USD` corta la corrida antes de gastar de más, y toda corrida imprime lo que gastó.
- **La salida es una línea de tiempo, no un booleano.** Cada escenario deja `transcripcion.md` con quién habló en cada turno, qué tools llamó, qué clickeó el dueño y qué vio el cliente; más el estado del core al final y el trace de Playwright. Una falla nombra **qué actor, en qué turno, qué regla** y cita la frase.
- **Se distingue "falló el producto" de "se rompió el arnés".** Exit 1 es el producto; exit 2 es que faltó la API key, no levantó el compose, no estaba `uv` o no había browser. A las once de la noche eso es la diferencia entre arreglar un bug y perseguir un fantasma.
- **NO se toca ningún componente.** El arnés usa las costuras de inyección que `gateway/src` ya expone por diseño (`crearApp`, `crearAgente({queryFn})`, `tenantsDeObjeto`, `diferir`, `GRAPH_URL`) y la API pública del core. **NO BREAKING**: no cambia un contrato, no agrega una migración, no toca `core/`, `agente/`, `panel/` ni `gateway/`. La única dependencia nueva vive en `arnes/package.json`.
- **`scripts/smoke.sh` no se toca y no se reemplaza.** Son preguntas distintas: el smoke pregunta *"¿el sistema responde?"*; el arnés pregunta *"¿la conversación termina donde tiene que terminar?"*. El smoke es gratis, offline y de segundos; el arnés cuesta centavos, minutos y una API key.

## Capabilities

### New Capabilities
- `arnes-tres-actores`: la orquestación de los tres actores contra el sistema real — cuáles son las costuras, cómo se aísla cada corrida, qué modos hay, cuánto puede costar, y qué deja escrito para que una falla se pueda leer a las once de la noche.
- `aserciones-de-conversacion`: qué significa que un agente conversacional "falle" — los tres niveles de aserción, el protocolo del juez con cita obligatoria, y la cuarentena que impide que una regla ruidosa se lleve puesta la credibilidad del arnés.
- `escenarios-de-referencia`: el catálogo de conversaciones que el arnés recorre, sacadas de `docs/FLUJOS.md` y de las reglas duras del `SKILL.md`, incluido el escenario que `stock-visible-al-agente` dejó explícitamente sin cubrir.

### Modified Capabilities
<!-- Ninguna. `openspec/specs/` está vacío: no hay specs archivadas todavía, así que
     no hay requirements existentes que cambiar. El escenario "El bot sabe decir que se
     terminó" de `stock-visible-al-agente` NO cambia de texto: gana un verificador,
     que es exactamente lo que le faltaba. -->

## Impact

**Nuevo: `arnes/`** (Node, sibling de `scripts/`)
- `arnes/package.json` — proyecto propio. Dependencias nuevas: `@playwright/test` y `@anthropic-ai/sdk`. Node porque los tres actores ya son Node: Playwright es Node, el gateway es Node y el SDK del agente es una dependencia que el gateway ya tiene.
- `arnes/actores/` — dueño (Playwright), cliente (guion y libre), y el arranque observado del bot.
- `arnes/graph-falso.js` — el teléfono del cliente: recibe los `POST /:phoneId/messages` que el outbox manda y los expone como mensajes recibidos.
- `arnes/escenarios/` — un archivo por conversación.
- `arnes/juez/` — las reglas de no-decir y el protocolo de veredicto.
- `arnes/salida/` — artefactos por corrida. **Va al `.gitignore`.**

**Makefile**
- `make arnes` (guion, escenarios rápidos), `make arnes-todo`, `make arnes-libre`. Nada se cuelga de `make smoke` ni de `go test`: el arnés necesita compose arriba, `ANTHROPIC_API_KEY`, `uv` en la máquina y un Chromium bajado.

**`.gitignore`**
- `arnes/salida/`, `arnes/node_modules/`, y los artefactos de Playwright.

**`docs/`**
- Una sección en `README.md` (o `docs/PRUEBAS.md`, a decidir en tasks) que diga cuándo se corre: antes de un release, después de tocar `SKILL.md`, las tools del MCP o la vista Pedidos. **Nunca en cada push.**

**Lo que NO se toca**
- `core/`, `agente/`, `panel/`, `gateway/`, `arca-sidecar/`, `scripts/smoke.sh` y las migraciones. Cero código de prueba dentro de producción: el arnés no necesita un solo `if (test)` en el gateway porque las costuras ya existen y están documentadas como inyectables.

**Riesgos que el diseño tiene que resolver**
- **Contra qué corre el bot.** La API real es plata y no-determinismo; un bot simulado es determinista y no prueba nada. La respuesta no es elegir uno: es no simular nunca al bot y mover el determinismo al lado del cliente.
- **Qué es "que falle".** Un juez mal calibrado convierte el arnés en un generador de falsos positivos, y un arnés que grita en falso se apaga a la semana. Necesita reglas de prohibición, cita obligatoria y cuarentena.
- **Playwright es una dependencia nueva y un browser que bajar.** Hay que decir qué aporta que la API del panel no, y dejar una salida por si la máquina no tiene browser.
- **Colisión de consumidores en redis.** El gateway del compose y el gateway del arnés hacen `BRPOP` sobre la **misma** cola `salidas_whatsapp`: si los dos corren, se roban los mensajes y el arnés falla al azar. Hay que resolverlo explícito.
- **El costo real no es la plata, es el tiempo.** Cada turno del bot es una query con tools: segundos. Una corrida completa son minutos, y eso define dónde puede correr y dónde no.
