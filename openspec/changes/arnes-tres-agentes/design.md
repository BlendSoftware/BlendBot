## Context

El repo tiene cuatro suites y ninguna se toca con la otra:

| Suite | Qué prueba | Qué NO ve |
|---|---|---|
| `core/tests/**` (`go test`) | El motor por HTTP, con base real | Modelo, panel, WhatsApp |
| `agente/tests/**` (`pytest` + `respx`) | Las tools del MCP con el core mockeado | El modelo, el core real |
| `gateway/tests/**` (`vitest`) | Webhook, firma, outbox, sesiones, con `queryFn` inyectado | El bot (justamente) |
| `panel/src/**.test.tsx` (`vitest` + jsdom) | Componentes sueltos | El core |
| `scripts/smoke.sh` | El producto entero **por la API del core** | Modelo, panel, WhatsApp |

El smoke es lo más parecido a un arnés que hay, y es explícito sobre su alcance: entra con el token del dueño, `POST /api/compromisos`, `PATCH .../estado`, y verifica el estado. Nunca hay una conversación. La frase que abre el archivo —*"¿puede un consultorio operar ahora mismo?"*— es exactamente la pregunta correcta para lo que prueba, y no es la pregunta de este cambio.

Lo que queda afuera de las cinco, y es el producto:

1. **Qué dice el bot.** El `SKILL.md` tiene seis reglas duras que "no se negocian" y ninguna tiene verificación. La regla 2 —*nunca prometas una demora*— es la corrección número uno del prototipado del 18/08. Nada la protege.
2. **El círculo completo.** `docs/FLUJOS.md`: *"El aviso de vuelta es la mitad del valor."* Ese aviso recorre panel → core → `LPUSH salidas_whatsapp` → worker de salidas → outbox → Graph. Ninguna suite cruza ese camino.
3. **El panel como lo toca un dueño.** El `SelectorDemora` tiene su test de componente, pero que exista el campo libre *en la pantalla real, sobre datos reales, después de un login real* no lo verifica nada. Y D8 dice que sin campo libre "el producto miente".

Restricción dura: **no se toca ningún componente**. Y no hace falta, porque `gateway/src` ya está escrito con las costuras puestas y comentadas como tales: `crearApp({config, tenants, redis, agente, outbox, diferir})`, `crearAgente({queryFn})` (*"inyectable — los tests no hablan con la API"*), `tenantsDeObjeto()`, `firmar()` exportada *"para los tests y el README"*, y `graphUrl` por entorno. Ese es el andamio del arnés, y ya está pago.

## Goals / Non-Goals

**Goals:**
- Que una conversación completa de `docs/FLUJOS.md` se recorra de punta a punta con el bot real, el panel real en un browser y el core real, y falle si el resultado no es el que dice el documento.
- Que el escenario *"El bot sabe decir que se terminó"*, declarado y no cubierto en `stock-visible-al-agente`, quede cubierto acá.
- Que una falla diga **qué actor, en qué turno y qué regla**, con la frase citada, sin que nadie tenga que leer un log de docker.
- Que una regla blanda no pueda meter un falso positivo sin que el arnés lo note y lo ponga en cuarentena.
- Que el techo de gasto sea un número que se configura, no una sorpresa en la factura.
- Cero código de prueba dentro de `core/`, `agente/`, `panel/` y `gateway/`.

**Non-Goals:**
- **Reemplazar el smoke.** El smoke seguirá siendo la respuesta a "¿levanta y opera?", gratis y offline. El arnés no corre sin API key; si fuera el único chequeo, un día sin saldo sería un día sin chequeo.
- **Cobertura del panel.** Playwright entra por tres gestos del dueño, no a probar la vista Cierre ni el Admin. Eso es de `vitest`, es más rápido y ya existe.
- **Probar la imagen del gateway.** El arnés levanta el gateway **en proceso** desde `gateway/src`. Prueba el código, no el `Dockerfile`. El contenedor lo cubre el smoke (`/salud`).
- **Medir calidad conversacional.** El arnés no puntúa si el bot fue simpático. Verifica reglas de prohibición y estado. "Sonó bien" no es un assert.
- **Montar CI.** Hoy no hay `.github/` en el repo. El arnés se escribe para poder correr sin TTY y con exit code, para que el día que haya CI se enchufe; crear el CI es otro cambio.
- **WhatsApp real.** El Graph es falso, siempre. El día que haya número productivo, mandarle mensajes de prueba a Meta desde un arnés es una forma cara de que te bajen la app.

## Decisions

### 1. El bot NUNCA se simula. Lo que se scriptea es el cliente

El actor "bot" del arnés no es código nuevo: es `gateway/src` con el `SKILL.md` de gastronomía como system prompt, el MCP de `agente/` con las tools reales y la API de Anthropic con el mismo `MODELO` que corre en producción.

*Por qué:* un bot simulado no prueba el bot, prueba la simulación — y la simulación la escribe la misma cabeza que escribió el prompt, así que comparte sus puntos ciegos por construcción. Todo el valor de este cambio está en la única pieza que hoy no se verifica: la decisión del modelo. Simularla es tirar el cambio a la basura y quedarse con el envoltorio.

Lo que sí se puede hacer determinista es **el otro lado**: en modo `guion`, el cliente manda texto fijo, sacado literal de `docs/FLUJOS.md`, incluida la tipeada `"te piedo una hhhamburguesa doble cheddar yunas paps"` — que no es color, es el caso de prueba: entender eso *es* la gracia del LLM, y está escrito así en los principios del asistente.

Con la entrada fija, el no-determinismo que queda es el de la salida del modelo. Y ahí entra la decisión 6: la mayoría de los asserts no miran la salida en prosa, miran **estado y tools**, que sí son deterministas aun con un modelo que redacta distinto cada vez.

*Alternativa descartada — bot simulado por defecto y bot real "en modo caro":* deja el camino barato como el que se corre siempre, y ese camino no prueba nada de lo que este cambio existe para probar. Se terminaría corriendo el simulado en cada push, viéndolo verde, y la primera regresión real del prompt llegaría igual al cliente. Un chequeo verde que no chequea nada es peor que no tener chequeo: **ocupa el lugar del que sí serviría**.

*Alternativa descartada — grabar y reproducir (VCR) las respuestas del modelo:* determinista y gratis después de la primera corrida, y es la trampa clásica. Una cinta grabada valida el bot de hace tres semanas; el día que cambia el `SKILL.md` —que es justo cuando querés correr esto— la cinta hay que regrabarla entera, y regrabarla es aceptar como correcto lo que salga. La cinta se vuelve el oráculo y nadie la revisa.

*Costo aceptado:* la corrida cuesta plata y tarda. Se acota con presupuesto (decisión 10) y con dónde corre (decisión 11).

### 2. Modo `guion` por defecto; modo `libre` existe pero no bloquea nada

- **`guion`** (el que se corre siempre): cliente scripteado, bot real, aserciones de los tres niveles, rompe el build.
- **`libre`** (opt-in, `make arnes-libre`): el cliente es un segundo modelo con persona y objetivo (*"tenés hambre, querés dos hamburguesas y sos parco"*), improvisando. Máximo 15 turnos, después se corta. **Nunca rompe el build**: deja informe.

*Por qué los dos:* el guion sólo encuentra lo que alguien ya imaginó. El modo libre encuentra la frase que a nadie se le ocurrió escribir — que es exactamente de dónde salieron las correcciones del 18/08, con Juani haciendo de cliente a mano. Este modo es esa sesión, automatizada, y ese es su único trabajo: **generar candidatos a escenario del modo `guion`**. Cuando el modo libre encuentra algo, no se arregla el modo libre: se escribe el escenario scripteado que lo captura para siempre.

*Por qué no bloquea:* dos modelos improvisando no repiten una corrida. Un chequeo que no repite y rompe el build se apaga en una semana, y con él se apaga el modo `guion` que sí sirve.

*Alternativa descartada — un solo modo, siempre libre:* es la sesión de prototipado, que es valiosa y es **exploración**, no verificación. Sin un guion determinista al lado no hay nada que defienda una regresión.

### 3. El gateway del arnés corre **en proceso**, no en el contenedor

El arnés hace `crearApp({config, tenants, redis, agente, outbox})` importando de `gateway/src`, con:
- `config` inventado por el arnés: su `META_APP_SECRET` (así puede firmar con `firmar()`), su `graphUrl` apuntando al Graph falso, su `sesionesDir` en un temp por corrida, y `modelo` leído del mismo default que producción.
- `tenants` armado con `tenantsDeObjeto({ "<phoneId de la corrida>": { negocio, agente_token, vertical } })` — sin archivo, sin restart.
- `agente` = `crearAgente({ config, sesiones, queryFn: observar(queryReal) })`, donde `observar` delega en el `query` real del SDK y **tee**-a cada mensaje del stream a la transcripción.

*Por qué:* tres cosas que el contenedor hace imposibles y que acá salen gratis.
1. **El token del agente se rota por corrida** (`POST /api/admin/negocios/:id/token-agente` no deja elegirlo). Con el contenedor habría que escribir `tenants.json` y hacer `up -d --force-recreate gateway` en cada corrida: lento, racy y con una ventana en que el gateway viejo sigue leyendo la cola.
2. **`queryFn` observado.** Sin él, el nivel 2 de aserciones (qué tools llamó el bot) no existe, y ese nivel es la mitad del valor. El único otro camino sería agregarle al gateway un `TRANSCRIPT_DIR` — o sea, código de prueba en producción, justo lo que el proposal promete no hacer.
3. **`diferir` inyectable.** `crearRouter` lo acepta y su comentario dice para qué: *"los tests inyectan un `diferir` que la junta y la espera"*. Con eso el arnés **espera** a que el mensaje se procesó entero en vez de hacer polling con timeout. El componente más flaky de un arnés así —la carrera contra el procesamiento asincrónico— desaparece por diseño.

*Qué se pierde, y se acepta:* el arnés no prueba `gateway/Dockerfile` ni las env del compose. Es el mismo JavaScript. El contenedor sigue cubierto por `esperar_http .../salud` en el smoke, y una diferencia entre imagen y fuente se manifestaría ahí.

*Alternativa descartada — gateway del compose y `GRAPH_URL` apuntando al falso:* prueba la imagen, pero pierde 1, 2 y 3, obliga a tocar `docker-compose.yml` para pasar `GRAPH_URL` (hoy `config.js` la lee y el compose no la manda), y deja el token del tenant como un baile de reinicios. El precio es toda la observabilidad; la ganancia es probar un `COPY`.

### 4. El gateway del compose se **para** durante la corrida

Antes de empezar: `docker compose stop gateway`. Al terminar (incluso si falló): `docker compose start gateway`.

*Por qué:* el worker de salidas hace `BRPOP salidas_whatsapp`. Si el gateway del compose y el del arnés están vivos a la vez, **los dos compiten por la misma cola** y el aviso de confirmación se lo lleva el que llegó primero. El arnés fallaría una de cada dos veces con un síntoma que no dice nada ("el cliente nunca recibió la confirmación"), y se perdería una tarde entera buscándolo en el bot. No es un detalle de implementación: es el bug que este arnés generaría si no se decide ahora.

*Alternativa descartada — usar otra DB de redis para el arnés:* no sirve, porque el **productor** de la cola es el core del compose, que escribe en la suya. Habría que recrear el core también, y ahí ya estamos levantando un segundo stack entero.

*Alternativa descartada — cola por tenant:* es la solución correcta a futuro (`salidas_whatsapp:<phoneId>`) y es un cambio en `core/internal/worker/cola.go`. Este cambio no toca el core. Queda anotado como mejora, no como requisito.

*Riesgo asumido:* si el proceso del arnés muere de un `kill -9`, el gateway del compose queda parado. El arnés lo dice fuerte al arrancar y `make arnes` lo restaura en un `trap`, igual que hace `smoke.sh` con su tempfile.

### 5. El Graph falso es el teléfono del cliente

Un HTTP mínimo que acepta `POST /:phoneNumberId/messages`, responde `{ messages: [{ id }] }` y **guarda el cuerpo**. Es el único lugar por donde sale un mensaje hacia el cliente, y por ahí salen las dos clases que existen:
- la **respuesta del bot** al mensaje del cliente (webhook → agente → outbox → Graph), y
- el **aviso proactivo** que dispara el dueño desde el panel (core → `LPUSH salidas_whatsapp` → worker de salidas → outbox → Graph).

*Por qué importa que sea uno solo:* porque el círculo de `FLUJOS.md` se cierra ahí y sólo ahí. Que el aviso del local llegue por el mismo agujero que la respuesta del bot es la prueba de que el producto está entero. Si el arnés leyera el aviso de la tabla del core, estaría verificando que el core lo escribió, no que el cliente lo recibió — que es la mitad del valor según el documento.

El Graph falso además puede **fallar a pedido** (500, 429) para que un escenario verifique que el outbox reintenta y que nada se pierde. No entra en el alcance inicial, pero el diseño lo deja posible: es una función, no una constante.

### 6. Tres niveles de aserción, con distinta autoridad. Y el nivel 3 es de prohibición

| Nivel | Sobre qué | Determinista | ¿Rompe? |
|---|---|---|---|
| **1 — Estado** | El core por su API: existe el compromiso, sus líneas, su total, su `entrega`, su `nota`, su estado, el stock que quedó | Sí | Sí |
| **2 — Tools** | Qué tools llamó el bot, con qué argumentos, en qué orden (del stream del SDK) | Sí | Sí |
| **3 — Dicho** | Reglas de **no-decir**, evaluadas por un modelo juez sobre la transcripción | No | Sólo las seis reglas duras del SKILL |

*Por qué en ese orden:* casi todo lo que importa es nivel 1 o 2. *"El pedido entra al panel apenas hay ítems"* es nivel 1 con un reloj: al terminar el turno 3, ya hay un compromiso `pendiente` y todavía no se dio el nombre. *"Una modificación de una sola unidad separa la línea"* es nivel 1 puro: dos líneas, una con `nota: "sin panceta"`. *"El bot no confirma solo"* es nivel 1: el compromiso quedó `pendiente`, no `confirmado`. Ninguna necesita interpretar prosa.

*Por qué el nivel 3 es de prohibición y no de obligación:* "el bot debe saludar cálidamente" no tiene un umbral honesto y va a fallar con una respuesta perfectamente buena. "El bot **no** debe afirmar una demora antes de que el local confirme" tiene un criterio binario que un juez responde citando la frase o admitiendo que no la hay. Se aseveran las seis reglas duras del `SKILL.md`, que son prohibiciones todas, porque el producto ya las escribió como prohibiciones — no hubo que inventar el criterio, estaba.

*Regla de oro del nivel 3:* **veredicto sin cita textual = bug del arnés, no falla del bot.** Si el juez dice "sí prometió una demora" pero no puede citar dónde, la corrida marca `ARNÉS ROTO` para esa regla y no falla al producto. Un juez que puede condenar sin pruebas es un generador de falsos positivos con permiso.

### 7. El juez: modelo distinto del bot, pinneado, tres veredictos, mayoría

- **Modelo distinto** del que corre el bot (`ARNES_MODELO_JUEZ`, más capaz que `MODELO`). Un juez que comparte modelo con el acusado comparte sus puntos ciegos: si el modelo cree que "ya sale" no es prometer una demora, lo cree las dos veces y la regla nunca dispara.
- **Pinneado a una versión exacta** y **escrito en la salida de la corrida**. Un juez cuyo modelo flota vuelve los veredictos irreproducibles, y un veredicto irreproducible no se puede discutir.
- **Una regla por llamada**, con la transcripción entera de contexto y un rúbrica binaria. No se le pide "evaluá esta conversación": se le pide "¿este mensaje afirma un tiempo de demora? sí/no + cita".
- **Tres veredictos, mayoría 2 de 3.** La transcripción ya está fija: reevaluar es barato (no se vuelve a correr la conversación) y mata casi todo el ruido del juez. Es la mitigación más rentable del arnés entero.
- El juez **nunca ve** qué se espera. Recibe la regla y el texto. Si le decís "esperamos que no haya prometido demora", te va a dar la razón.

*Alternativa descartada — regex/keywords en vez de juez:* barato y determinista, y no funciona. "Sale en 20 minutos", "en un ratito lo tenés", "para las nueve y cuarto está" y "ya te lo mando" son todas la misma violación con cero palabras en común. Un regex sobre `\d+ min` deja pasar tres de cuatro y encima falsea sobre `"$8.900"` cuando el bot lee el total.

*Alternativa descartada — un solo veredicto:* la mitad del costo y el doble de ruido. Con transcripción fija, el veredicto extra cuesta centavos; un falso positivo cuesta la confianza en el arnés.

### 8. Cuarentena: una regla ruidosa se aísla, no se borra

Cada regla blanda lleva estado en `arnes/juez/cuarentena.json`. Si una regla falla y la revisión concluye que el bot estaba bien, se marca `cuarentena` con el motivo y la fecha: sigue evaluándose y se sigue reportando, **pero no rompe**. Sale de cuarentena a mano, con el motivo por el cual se considera arreglada.

*Por qué:* la muerte típica de un arnés conversacional es una regla que grita en falso, alguien la borra para poder mergear, y con ella se va la única protección de una regla real del producto. La cuarentena deja el ruido visible sin bloquear, que es el único punto medio que sobrevive a un viernes a las siete.

*Por qué no automática:* que una regla se auto-silencie porque falló dos veces es exactamente cómo se apagan solas las que sí encontraban algo. Entra a cuarentena una persona, y queda escrito quién y por qué.

### 9. Playwright sí, para tres gestos, con salida de emergencia

**Se agrega `@playwright/test` a `arnes/`, sólo Chromium.** El dueño se maneja por el browser en: **entrar** (login + cambio de contraseña obligatorio), **confirmar un pedido con demora**, **mover a listo**, y **responder una consulta**. Nada más.

*Qué aporta que la API no:*
- **El campo libre de la demora.** D8: *"Presets sí, pero con campo libre siempre"* — sin él "el producto miente". Por la API, `PATCH /estado {"demora_min": 30}` pasa con o sin campo libre en la pantalla. Es una decisión de producto que sólo el DOM puede defender.
- **Que el pedido aparezca solo.** `FLUJOS.md` promete que *"la cocina lo ve venir mientras el tipo todavía escribe"*. Eso es render + refresco. Por API se verifica que el registro existe; en el browser, que el dueño lo ve. Son afirmaciones distintas y el producto vende la segunda.
- **Que se pueda con el pulgar.** El panel promete botones de 48px sobre una tarjeta. Un `PATCH` no tiene tamaño.
- **Que el panel esté en el circuito.** Es una de las cinco piezas. Un arnés de punta a punta que saltea el panel prueba cuatro quintos y se llama entero.

*Qué cuesta, sin maquillaje:* una devDependency, un Chromium (~150 MB) que bajar una vez, y tests de browser que son la clase más flaky que existe. Se mitiga con **locators por rol y texto** —el panel ya trae `role="group" aria-label="En cuánto sale"`, `aria-label`s y `<label>`s, así que no hace falta un solo selector de CSS frágil— y con las aserciones web-first de Playwright, que esperan solas. **No se usan screenshots como assert**: se guardan como evidencia. Un test de captura de pantalla falla por un antialiasing y enseña a ignorar rojo.

*La salida de emergencia:* `ARNES_DUENO=api` corre **los mismos escenarios** con el dueño manejado por la API del core. Sirve en una máquina sin browser, en un CI futuro sin Chromium, y para separar culpas cuando algo falla: si en modo `api` pasa y en modo browser no, el problema es del panel. Que el actor dueño tenga dos implementaciones detrás de la misma interfaz es lo que hace posible ese diagnóstico, y es la razón principal por la que el arnés se organiza por actores y no por pasos.

*Alternativa descartada — sólo API para el dueño:* más rápido, más estable, sin dependencia nueva. Y ciega para las cuatro cosas de arriba, incluida la que el dueño del producto pidió por su nombre. Si el panel no está en el circuito, "de punta a punta" es una exageración.

*Alternativa descartada — Playwright para todo el panel:* convierte el arnés en la suite de UI del proyecto, tarda diez minutos y compite con los `vitest` que ya cubren eso mejor y más rápido.

### 10. Presupuesto explícito: `ARNES_TOPE_USD`, y toda corrida dice qué gastó

El `result` del stream del SDK trae uso y costo. El arnés los suma —bot, cliente en modo libre y juez, por separado— y:
- **corta la corrida** apenas se supera `ARNES_TOPE_USD` (default sugerido: `1.00`), con `ARNÉS CORTADO POR PRESUPUESTO` y lo gastado hasta ahí;
- **imprime el desglose** al final de toda corrida, verde o roja.

*Por qué:* "cuesta plata" sin número es una objeción que no se puede responder ni administrar. Con techo, el peor caso es conocido y chico. Y el desglose expone la regresión de costo: si un cambio en el `SKILL.md` duplica los tokens por conversación, se ve acá antes que en la factura.

### 11. Vive en `arnes/`, corre a mano, nunca en cada push

- **`arnes/`**, en la raíz, proyecto Node propio. No dentro de `gateway/` (no es gateway) ni de `panel/` (no es panel): es un quinto consumidor del sistema, como `scripts/`.
- **Node** porque los tres actores ya lo son: Playwright es Node, el gateway que se levanta en proceso es Node, y el SDK de Anthropic ya es dependencia del gateway. En Python habría que reimplementar el arranque del gateway, que es justo lo que no queremos.
- **`make arnes`** (modo guion, escenarios `@rapido`), **`make arnes-todo`**, **`make arnes-libre`**.
- **Fuera de `go test` y de `make smoke`.** Necesita compose arriba, `ANTHROPIC_API_KEY`, `uv` en la máquina y Chromium. `go test ./...` tiene que seguir siendo gratis y offline; colgarle esto lo convierte en un comando que falla por falta de saldo.
- **Cuándo se corre:** antes de un release, y después de tocar `agente/skills/**/SKILL.md`, las tools del MCP, la vista Pedidos o el worker de salidas. **Nunca en cada push.**
- **CI:** hoy no existe `.github/` en el repo, así que este cambio no configura ninguno. Lo que sí garantiza es que se pueda: sin TTY, sin colores si no hay `isatty`, exit code claro y artefactos en un directorio. El día que haya CI, esto va detrás de un trigger manual y un secreto, nunca en el push.

*Alternativa descartada — meterlo en `scripts/smoke.sh`:* el smoke es un bash de 551 líneas, sin dependencias más que `curl` y `jq`, que corre en frío en cualquier máquina. Meterle un browser, Node y una API key le saca lo único que lo hace valioso: que siempre se puede correr.

### 12. Cada corrida se aísla creando su propio negocio, como el smoke

Sufijo al azar → `POST /api/admin/negocios` con `vertical: "gastronomia"`, `wa_phone_id` propio de la corrida, `config.confirmacion.pedido = "humana"` → login del dueño y cambio de contraseña → carga de la carta del escenario → rotación del token de agente → tenant en memoria. El teléfono del cliente también lleva el sufijo.

*Por qué:* es exactamente el patrón que `smoke.sh` ya justificó (*"correrlo diez veces deja diez consultorios de prueba y ningún error"*), funciona contra una base con datos y evita el paso más frágil de todos, que es limpiar. `wa_phone_id` es `UNIQUE` en la migración: sin sufijo, la segunda corrida choca.

*Alternativa descartada — un negocio fijo sembrado una vez:* corridas más rápidas y un estado compartido que se ensucia; dos corridas simultáneas se pisan el stock y el arnés falla por una razón que no es el producto.

### 13. Las aserciones de stock miran el **contrato**, no la fuente del número

Los escenarios de "se terminó" se aseveran contra lo observable: `restante`/`agotado` en `GET /api/servicios`, que el bot no lo ofrezca, y qué dice cuando se lo piden. **Nunca** contra `cupo_jornada`, ni contra recetas, ni contra insumos.

*Por qué:* `insumos-y-recetas` está por sumar una segunda fuente del mismo número, y su propio proposal dice que el contrato hacia afuera no cambia — *"cambia de dónde sale el número"*. Un arnés que se asevera contra la tabla habría que reescribirlo entero; uno que se asevera contra el contrato **prueba las dos fuentes sin tocar una línea**, y encima verifica esa promesa. El escenario del insumo compartido (vender un bife baja las empanadas posibles) entra igual, marcado `@pendiente` hasta que ese cambio aterrice.

*Corolario para `insumos-y-recetas`:* cuando aterrice, el arnés es donde se verifica el riesgo que su diseño nombra —*"una receta mal cargada apaga un plato vendible"*—, porque el síntoma de ese bug es una **frase del bot**, y esta es la única suite del repo que puede leerla.

### 14. La salida es una línea de tiempo, y una falla nombra actor, turno y regla

Por corrida, `arnes/salida/<corrida>/<escenario>/`:
- **`transcripcion.md`** — turno por turno, con quién habló (👤 cliente · 🤖 bot · 🧑‍🍳 dueño · ⚙️ sistema), el reloj relativo, y debajo de cada turno del bot **las tools que llamó con sus argumentos y lo que devolvieron**; debajo de cada turno del dueño, qué clickeó y la captura.
- **`estado-core.json`** — el estado al cerrar: compromisos con líneas y totales, stock, consultas, cobros.
- **`veredictos.json`** — cada regla blanda, sus tres veredictos, la cita.
- **`trace.zip`** de Playwright y capturas, sólo en el turno que falló.

Y la línea de falla, que es el entregable de verdad:

```
✗ pedido-feliz · turno 4 · 🤖 bot · R2 «nunca prometas una demora»
    dijo: "sale en unos 20 minutos, tipo 21:15"
    juez: 3/3 · transcripcion.md:41 · SKILL.md regla 2
```

*Por qué esto y no un stack trace:* el arnés se corre a las once de la noche antes de un release. La pregunta es "¿me lo llevo o no?", y para contestarla hace falta saber cuál de los tres actores se salió del libreto y en qué momento. Un `AssertionError: expected false to be true` obliga a reconstruir eso leyendo el código del test. **Cada aserción lleva la frase humana de lo que protege**, sacada de `FLUJOS.md` o del `SKILL.md`, no un nombre de variable.

### 15. Exit 1 es el producto; exit 2 es el arnés

- **0** — todo verde. Imprime lo gastado.
- **1 — `PRODUCTO`**: una aserción de nivel 1, 2 o una regla dura del nivel 3 falló. Hay algo que arreglar en el sistema.
- **2 — `ARNÉS ROTO`**: falta `ANTHROPIC_API_KEY`, el compose no está arriba, no hay `uv`, no hay Chromium, no se pudo parar el gateway, el MCP no levantó, el juez no devolvió cita, o se cortó por presupuesto. **No hay veredicto sobre el producto.**

*Por qué separarlos:* confundirlos es la forma más rápida de perder una hora arreglando un bug que no existe. Un arnés que dice "rojo" cuando en realidad se quedó sin API key entrena a la gente a desconfiar del rojo, y a partir de ahí el rojo no sirve para nada.

### 16. El redis del arnés se le pregunta al compose, no se asume

`urlDeRedisDelHost()` resuelve la URL con esta precedencia: `ARNES_REDIS_URL` explícito → `docker compose port redis 6379` → el 6379 de siempre, avisando.

*Por qué:* la URL que vive en el compose (`redis://redis:6379/0`) es el hostname de la red de docker y desde el host no resuelve. Y el puerto publicado **no es necesariamente el 6379**: en la máquina donde se construyó esto, un `docker-compose.override.yml` gitignoreado lo mueve al 6380 porque otro proyecto ocupa el de siempre.

*Por qué importa más de lo que parece:* el modo de falla es horrible. El cliente de redis reintenta en silencio, el proceso queda colgado con un `err.message` vacío, y el síntoma que ve el que corre el arnés es **"el bot no contestó"** — o sea, va a buscar el problema en el producto. Es el tercer gotcha del arnés, al mismo nivel que el `stop` del gateway (§4) y el `message.id` repetido, y por el mismo motivo: los tres se disfrazan de bug del producto.

*Alternativa descartada:* hardcodear `redis://localhost:6379` en la lectura del entorno. Se probó y mintió el mismo día. Una constante que sólo es cierta en algunas máquinas es una segunda fuente de verdad, y la que miente siempre es la que alguien lee primero.

### 17. La única dependencia que el arnés importa directo es `redis`, y sale de `gateway/`

Se resuelve con `createRequire` apuntado a `gateway/package.json`, en vez de instalar una copia propia en `arnes/`.

*Por qué:* el cliente de redis que se le pasa a `crearApp` tiene que ser **el que el gateway espera**. Con una copia propia en `arnes/node_modules`, una diferencia de versión convierte al arnés en una prueba de otra cosa — y esa clase de falla aparece meses después, disfrazada.

## Risks / Trade-offs

- **El juez condena de más y el arnés se vuelve ruido** → tres veredictos con mayoría sobre transcripción fija, cita textual obligatoria (sin cita el veredicto se descarta y marca arnés roto), sólo prohibiciones, sólo las seis reglas duras rompen, y cuarentena manual para lo que grite en falso. Es el riesgo número uno del cambio y se lo ataca por cuatro lados a la vez.
- **El juez perdona de más y un escenario queda verde con el bot diciendo cualquier cosa** → es el riesgo espejo y es peor, porque es silencioso. Mitigación: cada regla blanda lleva su **caso negativo**, una transcripción con la violación adentro que el juez tiene que condenar. Si el juez perdona el caso negativo, la regla queda marcada como no confiable. Un juez que nunca condena hay que poder detectarlo, y sólo se detecta probándolo contra una violación conocida.
- **Los dos gateways compitiendo por `salidas_whatsapp`** → `docker compose stop gateway` con `trap` de restauración (decisión 4). Si al arrancar el arnés detecta el contenedor arriba, lo para él y lo dice; no asume.
- **Tests de browser flaky** → locators por rol/texto sobre los `aria-label` que el panel ya trae, aserciones web-first, cero screenshot-as-assert, y `ARNES_DUENO=api` para poder decidir en un minuto si la culpa es del panel o del producto.
- **El arnés tarda minutos y alguien lo va a querer meter en el push** → no se cuelga de `go test` ni de `make smoke`, y la documentación dice explícitamente cuándo corre. El tope de presupuesto es la última red: si alguien lo automatiza mal, corta solo.
- **El modelo cambia (versión nueva, `MODELO` distinto) y el arnés cambia de veredicto sin que se toque una línea de código** → la corrida escribe qué modelo usó el bot y cuál el juez. Cambiar `MODELO` obliga a correr el arnés antes de shippear, y esa es una regla de proceso, no de código: ningún test puede protegerte de haber cambiado el cerebro del producto.
- **`uv` y el MCP en la máquina del que corre** → el arnés chequea `uv`, `docker`, la API key y Chromium **antes de gastar un peso**, y falla con exit 2 y el comando que falta. Nada peor que enterarse de que falta `uv` en el turno 6, con la plata ya gastada.
- **El modo libre puede gastar mucho si el cliente-modelo no cierra nunca** → techo de 15 turnos y el tope de presupuesto compartido.
- **El arnés prueba el código del gateway, no su imagen** → aceptado y escrito (decisión 3). El contenedor lo cubre el smoke.

## Migration Plan

No hay migración: nada de esto existe todavía y nada de lo que existe cambia. Se agrega un directorio, tres targets de `make` y dos líneas de `.gitignore`.

Orden de construcción, y cada paso deja algo que sirve solo:
1. **El andamio sin modelo**: crear el negocio, levantar el gateway en proceso, el Graph falso, mandar un mensaje firmado y ver que el pipeline entero mueve un mensaje — con un `queryFn` de mentira que devuelve `"ok"`. Verifica el arnés, no el bot. Si esto no cierra, nada de lo que sigue tiene sentido.
2. **El bot real y el nivel 1 y 2** sobre `pedido-feliz`, con el dueño en modo `api`. Acá ya vale la pena aunque no haya juez ni browser.
3. **El dueño en Playwright** y el círculo completo hasta el aviso al cliente.
4. **El juez, las reglas duras y la cuarentena**, con sus casos negativos.
5. **El resto de los escenarios**, y el modo `libre`.

Rollback: borrar `arnes/`. No hay nada acoplado.

## Open Questions

- **¿Una regla blanda del nivel 3 debe romper el build, o sólo reportar?** El diseño propone que rompan **sólo las seis reglas duras del `SKILL.md`** (las que el propio documento declara innegociables) y que el resto reporte. Es la respuesta que mejor equilibra, pero es una decisión de producto: quien banque el ruido puede querer que rompan todas, y quien priorice shippear puede querer que no rompa ninguna. **Mi inclinación: como está propuesto** — esas seis las escribió el dueño del producto como innegociables, así que romper el build es coherente con lo que él mismo dijo que valen.
- **¿El arnés corre contra la carta sintética del repo o contra la carta del piloto cuando exista?** El diseño usa una carta sintética, fija, versionada, porque un escenario que depende de datos de un local ajeno no es reproducible. Pero la carta real de un local es donde van a aparecer los nombres ambiguos de verdad ("La Birra" / "La Birra doble" / "birra"), que es la clase de bug que este arnés existe para encontrar. **Mi inclinación: sintética para el modo `guion`, y una carta del piloto importada como fixture para el modo `libre`** cuando haya piloto — pero eso depende de que exista el piloto, que hoy es el único bloqueante real del proyecto.
- **¿Qué modelo pinnea el juez, y quién decide cambiarlo?** El diseño pide un modelo más capaz que el del bot, pinneado a una versión exacta y escrito en la salida. No fijo cuál acá porque el que corresponda depende de qué esté disponible y a qué precio el día que se implemente, y porque cambiarlo invalida la comparabilidad con las corridas anteriores. **Mi inclinación: el escalón de arriba del que corra el bot, pinneado con fecha, y un cambio de juez se anota igual que un cambio de `SKILL.md`.**
- **¿La cola `salidas_whatsapp` debería particionarse por `phone_number_id`, como ya lo está la del outbox?** Sería la solución limpia a la colisión de la decisión 4 y elimina un `stop`/`start` de contenedor de la corrida. Toca `core/internal/worker/cola.go` y `gateway/src/salidas.js`, o sea queda fuera del alcance de este cambio. **Mi inclinación: sí, pero como cambio propio y después**, porque además es una mejora productiva y no sólo de testing — hoy dos negocios comparten esa cola.
- **¿El modo `libre` entra en la primera versión o se difiere?** El plan lo pone último a propósito. Si el presupuesto de tiempo se acorta, es lo primero que se cae sin perder nada esencial. **Mi inclinación: dejarlo escrito en el spec y construirlo último**, para que la decisión de recortar sea explícita y no un olvido.
