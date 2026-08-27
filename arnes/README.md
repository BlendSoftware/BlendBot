# El arnés

Son las once de la noche, corriste esto antes de shippear y algo se puso rojo.
Este archivo está escrito para ese momento.

## Qué prueba esto que las otras cinco suites no prueban

Las cinco que ya hay prueban las **piezas**: `go test` el motor, `pytest` las
tools con el core mockeado, los `vitest` el gateway con el bot mockeado y el
panel con componentes sueltos, y `scripts/smoke.sh` el producto entero **por la
API del core**, con 101 asserts.

Ninguna de las cinco mira dos cosas, y las dos son el producto:

1. **Qué decide decir el bot.** El `SKILL.md` tiene seis reglas que dicen "no se
   negocian" y ninguna tiene verificación. La regla 2 —*nunca prometas una
   demora*— fue la corrección número uno del prototipado del 18/08 y hoy no la
   protege nada.
2. **La juntura panel → core → redis → gateway → WhatsApp.** El aviso de vuelta
   al cliente recorre ese camino entero y ninguna suite lo cruza. `FLUJOS.md`
   dice que ese aviso *"es la mitad del valor"*.

El smoke nunca tiene una conversación, y no es un defecto suyo: su pregunta
—*"¿puede un local operar ahora mismo?"*— es la correcta para lo que prueba.
Esta es otra pregunta.

## Cómo se corre

```sh
make up            # una vez: el compose tiene que estar arriba
make arnes         # los escenarios @rapido, en modo guion
```

| comando | qué hace |
|---|---|
| `make arnes` | los escenarios `@rapido`. Es lo que se corre antes de un release. |
| `make arnes-todo` | todos los escenarios. Tarda más y encuentra más. |
| `make arnes-listar` | qué escenarios hay y con qué etiquetas. Gratis, no levanta nada. |
| `make arnes-libre` | el cliente improvisa. **Nunca rompe el build**; deja candidatos. |
| `make arnes-dueno` | monta el escenario y lo sostiene vivo mientras **un agente** hace el guión en Chrome. |
| `make arnes-ejemplo` | cómo se lee una falla, sin levantar nada y sin gastar un peso. |

Y las puertas de cada grupo, que corren solas y sirven para saber si lo que se
rompió es el arnés o el producto:

```sh
node arnes/puerta-andamio.js   # el andamio: un mensaje cruza el sistema entero, sin modelo
node arnes/puerta-bot.js       # el bot y las aserciones deterministas
node arnes/preflight.js        # ¿esta máquina puede correr el arnés?
```

### Qué necesita arriba

- **El compose andando** (`make up`): core, redis, panel. El gateway del compose
  se para solo durante la corrida y se levanta al terminar (ver gotcha 1).
- **`uv` en el `PATH`**, y sólo si el bot va a llamar tools de verdad: de ahí
  sale el MCP de `agente/`.
- **Node ≥ 20.** Sin `npm install` propio: la única dependencia que el arnés
  importa directo es `redis`, y la toma de `gateway/node_modules` para que sea
  exactamente la versión que el gateway espera.

### Qué NO necesita

- **No necesita `ANTHROPIC_API_KEY`.** No hay una en esta máquina y el dueño del
  producto decidió no poner una. El bot lo sirve **un agente Claude leyendo el
  `SKILL.md` real** por un buzón de archivos (design §1). El principio que se
  protege es el mismo de siempre —el bot no lo puede escribir la misma cabeza
  que escribió el prompt—; lo que cambió es quién lo cumple.
- **No necesita Playwright ni Chromium.** El dueño en el navegador lo maneja un
  agente con el Chrome que ya tiene, siguiendo `arnes/dueno/guion.md`
  (design §9). Cero dependencias de browser, cero tests de browser flaky.
- **No necesita red hacia ninguna API.** Y por lo tanto **no cuesta plata**: ver
  *Cuánto tarda y qué cuesta*.

## Con quién corrió: la pregunta que va antes que el resultado

Los tres actores son proveedores inyectables, y **cuál corrió viaja en toda
salida, verde o roja**. Un verde que no dice con qué proveedor corrió es peor
que no tener arnés: se lee como "el bot está bien" cuando puede querer decir
"mis respuestas fijas siguen siendo fijas".

| variable | valores | qué quiere decir el verde |
|---|---|---|
| `ARNES_BOT` | `guion` (default) | **verifica el ARNÉS, jamás el bot.** Las respuestas son fijas y comparten los puntos ciegos del prompt por construcción. |
| | `agente` | un agente Claude leyendo el `SKILL.md` real y llamando las tools reales. **El único que emite veredicto sobre el bot.** |
| `ARNES_CLIENTE` | `agente` (default en modo libre) | un agente improvisando en personaje. **El único que encuentra algo.** |
| | `de-prueba` | líneas fijas: ejercita el bucle del modo libre, no el producto. |
| `ARNES_DUENO` | `navegador` (default) | lo hace un agente con Chrome siguiendo `arnes/dueno/guion.md`. No corre desatendido. |
| | `api` | el dueño manejado por la API del core. Corre solo, y **nombra al final lo que no pudo afirmar**. |

Con `ARNES_BOT=agente` la corrida **se queda esperando** a que alguien conteste
el buzón: imprime la ruta, y adentro hay un `SIGUIENTE.md` que dice qué leer y
dónde contestar. Es lento a propósito: del otro lado hay un agente leyendo un
`SKILL.md` de 400 líneas.

## Los tres gotchas

Los tres se disfrazan de bug del producto. Los tres cuestan una tarde si no
están escritos.

### 1. El gateway del compose se roba la cola

El worker de salidas hace `BRPOP salidas_whatsapp`. Si el gateway del compose y
el del arnés están vivos a la vez, **los dos compiten por la misma cola** y el
aviso de confirmación se lo lleva el que llegó primero. El síntoma es *"el
cliente nunca recibió la confirmación"*, y la tarde se va buscándolo en el bot.

Por eso el arnés hace `docker compose stop gateway` al empezar y `start` al
terminar, incluso si explota. **Si matás el arnés con `kill -9`, el gateway del
compose queda parado.** Se restaura con:

```sh
docker compose start gateway
```

El arnés imprime ese comando al arrancar, justamente para ese caso.

### 2. Un `message.id` repetido se descarta en silencio

El webhook tiene idempotencia por `message.id` con TTL de 24 horas (`SETNX` en
redis). Un id repetido devuelve **200, cero respuesta, cero error**. Si el arnés
reusara un id, el síntoma sería *"el bot no contestó el turno 3"* y se buscaría
en el bot, en el modelo o en la cola — nunca ahí.

Por eso cada mensaje lleva un `wamid` único y `payloadDeTexto()` obliga a
pasarlo. Repetir un id es una decisión que se toma a propósito, para probar la
idempotencia; nunca un descuido.

### 3. El redis no está necesariamente en el 6379

La URL que vive en el compose (`redis://redis:6379/0`) es el hostname de la red
de docker y **desde el host no resuelve**. Y el puerto publicado no es
necesariamente el de siempre: en esta máquina un `docker-compose.override.yml`
gitignoreado lo mueve al 6380 porque otro proyecto ocupa el 6379.

El modo de falla es feo: el cliente de redis reintenta en silencio, el proceso
queda colgado con un `err.message` vacío, y lo que ve el que corre el arnés es
*"el bot no contestó"*.

Por eso la URL **se le pregunta al compose** (`docker compose port redis 6379`)
en vez de asumirse. Se pisa con `ARNES_REDIS_URL` si hace falta.

## Los exit codes

| código | rótulo | qué quiere decir |
|---|---|---|
| **0** | VERDE | pasó todo lo que se corrió. Mirá con qué proveedor corrió antes de festejar. |
| **1** | **PRODUCTO** | falló una aserción de nivel 1 o 2, o una de las seis reglas duras del `SKILL.md` con cita verificada. **Hay algo que arreglar en el sistema.** |
| **2** | **ARNÉS ROTO** | **no hay veredicto sobre el producto.** |

### Por qué el exit 2 no dice nada sobre el producto

Un exit 2 quiere decir que el arnés **no llegó a terminar de preguntar**: falta
una credencial, el compose no está arriba, no hay `uv`, el MCP no levantó, se
cortó por presupuesto, o el juez condenó sin poder citar la frase. En ninguno de
esos casos el producto hizo nada mal — simplemente nadie lo interrogó.

Confundirlo con un rojo es la forma más rápida de perder una hora arreglando un
bug que no existe. Y es peor que eso: **un arnés que dice "rojo" cuando en
realidad se quedó sin una dependencia entrena a la gente a desconfiar del rojo**,
y a partir de ahí el rojo no sirve para nada.

Dos reglas que se derivan de eso y están implementadas:

- **Cuando pasan las dos cosas a la vez, gana el 2** — pero las fallas del
  producto se imprimen igual, rotuladas. Nunca se acusa al producto desde una
  corrida que no terminó, y nunca se esconde lo determinista que ya se rompió.
  Lo que quedó verde en una corrida cortada se rotula **no aprobado**.
- **Una corrida que no corrió ni un escenario es exit 2.** Un filtro de
  etiquetas que no matchea devuelve cero fallas, y cero fallas se lee como
  "pasó". Es el modo de falla más silencioso que existe en un arnés.

## Cuánto tarda y qué cuesta

**Qué cuesta: nada.** No hay `ANTHROPIC_API_KEY` en esta máquina, así que no hay
factura que mirar. El desglose de gasto que imprime cada corrida va a decir
`sin costo real` con esas palabras, y **eso no es lo mismo que "salió gratis"**:
cuando el bot lo sirve un agente, el costo existe y está en la sesión de ese
agente, no en un `result` que el arnés pueda sumar. El día que haya una key, el
tope es `ARNES_TOPE_USD` (default `1.00`) y corta solo.

**Cuánto tarda**, medido en esta máquina contra el compose local:

| corrida | reloj |
|---|---|
| `node arnes/puerta-andamio.js` | ~3 s |
| `node arnes/puerta-bot.js` — `pedido-feliz` entero con `ARNES_BOT=guion` (alta del negocio + carta + 4 turnos + aserciones de nivel 1 y 2) | **7,6 s** medidos |
| `make arnes` (`@rapido`: 2 escenarios, `ARNES_BOT=guion`) | ~20 s, más el `stop`/`start` del gateway del compose |
| lo mismo con `ARNES_BOT=agente` | **lo que tarde el agente en contestar el buzón**: minutos, y no se puede acotar desde acá |

El criterio del conjunto `@rapido` sale de ahí: entra lo que cabe en una corrida
antes de un release, no todo lo que se puede probar.

## El modo libre, y la única forma de usarlo bien

`make arnes-libre` pone un cliente que improvisa —una persona, un objetivo, un
techo de 15 turnos— y lo deja hablar. **Nunca rompe el build**, y eso no es
tibieza: dos modelos improvisando no repiten una corrida, y un chequeo que no
repite y rompe el build se apaga en una semana. Con él se apagaría el modo
`guion`, que sí sirve.

Lo que produce son **candidatos a escenario**, en `hallazgos.md`. Y acá está la
regla que hace que el modo valga algo:

> **Un hallazgo del modo libre se resuelve escribiendo un escenario nuevo en
> modo `guion`, no ajustando el modo libre.**
>
> El modo libre genera candidatos; el guion es el que defiende. Si aparece una
> frase que a nadie se le había ocurrido, se escribe `arnes/escenarios/<lo que
> sea>.js` con sus aserciones de nivel 1 y 2 y ahí queda protegida para siempre.
> Tocar el modo libre para que "pase" es tirar el hallazgo a la basura.

Un cliente con respuestas fijas es el modo `guion` con otro nombre. Por eso
`ARNES_CLIENTE=de-prueba` existe sólo para ejercitar el bucle y la salida lo
dice con todas las letras: **no puede encontrar nada**.

## Cuándo se corre

- **Antes de un release.**
- **Después de tocar** `agente/skills/**/SKILL.md`, las tools del MCP
  (`agente/server.py`), la vista Pedidos del panel o el worker de salidas del
  core.
- **Nunca en cada push.** Tarda minutos, con `ARNES_BOT=agente` necesita a
  alguien contestando el buzón, y necesita el compose arriba. Colgarlo de un
  push lo convierte en un comando que la gente aprende a ignorar — y el día que
  encuentre algo de verdad, nadie va a mirar.

Por lo mismo **no se cuelga de `make smoke` ni de `go test ./...`**. Esos dos
tienen que seguir siendo gratis y offline: son la respuesta a "¿levanta y
opera?" y esa respuesta tiene que existir también un día sin saldo.

## El arnés y el smoke no se reemplazan

| | `scripts/smoke.sh` | el arnés |
|---|---|---|
| pregunta | ¿el sistema responde? | ¿la conversación termina donde tiene que terminar? |
| cómo | la API del core, con `curl` y `jq` | una conversación entera, con el bot y el panel |
| tarda | segundos | minutos |
| cuesta | nada, y nunca va a costar | nada hoy; centavos el día que haya API key |
| corre en frío | sí, en cualquier máquina | no: necesita el compose arriba |
| cuándo | después de cada deploy | antes de un release |

Si tuvieras que quedarte con uno, quedate con el smoke. El arnés contesta la
otra mitad de la pregunta, no la misma mejor.

## Dónde queda la salida

`arnes/salida/<corrida>/<escenario>/`:

- **`transcripcion.md`** — turno por turno, con quién habló (👤 cliente ·
  🤖 bot · 🧑‍🍳 dueño · ⚙️ sistema), el reloj relativo, y debajo de cada turno
  del bot las tools con sus argumentos y lo que devolvieron.
- **`estado-core.json`** — el estado al cerrar. Si no se capturó, el archivo
  dice por qué: un archivo que explica su vacío es una tarea, uno ausente es un
  agujero.
- **`veredictos.json`** — cada regla del dicho, sus tres veredictos y la cita.
- **`trace-turno-N.json`** — sólo del turno que falló, con el anterior y el
  siguiente. Un trace de todos los turnos es un log, y un log es lo que este
  arnés existe para no tener que leer.

Y la línea de falla, que es el entregable de verdad:

```
✗ pedido-feliz · turno 4 · 🤖 bot · R2 «nunca prometas una demora»
    dijo: "sale en unos 20 minutos, tipo 21:15"
    juez: 3/3 · transcripcion.md:41 · SKILL.md regla 2
```

Escenario, turno, **actor**, la regla con su frase humana, la cita textual y
dónde mirar. `make arnes-ejemplo` la muestra sin levantar nada.

## Variables de entorno

Todas salen del `.env` de la raíz primero y de la shell después, igual que el
smoke: el `.env` es lo que el compose levantó de verdad.

| variable | default | para qué |
|---|---|---|
| `ARNES_BOT` | `guion` | quién sirve los turnos del bot |
| `ARNES_CLIENTE` | `agente` | quién improvisa en modo libre |
| `ARNES_DUENO` | `navegador` | qué implementación del actor dueño |
| `ARNES_BUZON` | un temp | dónde vive el buzón del proveedor `agente` |
| `ARNES_BUZON_TIMEOUT_MS` | `900000` | cuánto se espera una respuesta del buzón |
| `ARNES_ESPERA_DUENO_MS` | `1800000` | cuánto espera `make arnes-dueno` a cada apretón de manos |
| `ARNES_MAX_TURNOS` | `15` | el techo del modo libre |
| `ARNES_TOPE_USD` | `1.00` | techo de gasto; corta la corrida al superarlo |
| `ARNES_REDIS_URL` | (se le pregunta al compose) | pisa la resolución del gotcha 3 |
| `ARNES_MODELO_JUEZ` | — | el modelo del juez, pinneado a una versión exacta |

## Un detalle que no es un detalle: el arnés no toca el producto

Ni una línea de `core/`, `agente/`, `panel/`, `gateway/`, `arca-sidecar/` o
`scripts/`. Todo lo que el arnés necesita ya estaba escrito como costura y
comentado como tal: `crearApp({config, tenants, redis, agente, outbox,
diferir})`, `crearAgente({queryFn})`, `tenantsDeObjeto()`, `firmar()` exportada
*"para los tests y el README"*, y `graphUrl` por entorno.

Si algún día un escenario parece necesitar un condicional de prueba en
producción, la costura está mal elegida: se revisa el diseño, no la regla.
Borrar `arnes/` no rompe nada.
