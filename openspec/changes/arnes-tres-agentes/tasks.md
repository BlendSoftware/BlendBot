> **Orden**: los grupos van en el orden del `Migration Plan` del `design.md`, y
> cada grupo deja algo que vale por sí solo. El grupo 1 se termina **antes** de
> gastar el primer peso en la API: si el andamio no mueve un mensaje con un bot
> de mentira, con el bot real sólo se gasta plata a ciegas. Los grupos 5 y 6 se
> pueden escribir en paralelo (escenarios y juez son dueños distintos y no se
> pisan archivos), pero ninguno se da por terminado hasta correr contra el
> grupo 2 real.
>
> **Regla que atraviesa todo**: no se toca una línea de `core/`, `agente/`,
> `panel/`, `gateway/`, `arca-sidecar/` ni `scripts/`. Si un grupo parece
> necesitarlo, es que la costura está mal elegida — se revisa el diseño, no la
> regla.

## 1. El andamio, sin modelo y sin gastar

- [x] 1.1 Crear `arnes/` como proyecto Node propio (`package.json`, sin build). Dependencias: `@playwright/test` y `@anthropic-ai/sdk`. Nada más por ahora. Agregar `arnes/node_modules/`, `arnes/salida/` y los artefactos de Playwright al `.gitignore`.
- [x] 1.2 `arnes/preflight.js`: chequear compose arriba (`/health` del core, `/salud` del gateway del compose, panel sirviendo), `ANTHROPIC_API_KEY`, `uv` en el `PATH` y —si el dueño va por navegador— Chromium instalado. Falla con exit 2, el nombre de lo que falta y el comando para instalarlo. **Corre antes de todo**: enterarse de que falta `uv` en el turno 6 es gastar plata para nada.
- [x] 1.3 `arnes/aislamiento.js`: alta del negocio por corrida siguiendo el patrón de `scripts/smoke.sh` — sufijo al azar, `vertical: "gastronomia"`, `wa_phone_id` propio (es `UNIQUE` en la migración `000001`: sin sufijo la segunda corrida choca), `config.confirmacion.pedido = "humana"`, login del dueño, cambio de contraseña obligatorio, y rotación del token de agente por `POST /api/admin/negocios/:id/token-agente`. Verificar que el token vuelve con prefijo `cop_`: `tenantsDeObjeto` lo exige y `Settings` del MCP también.
- [x] 1.4 `arnes/carta.js`: la carta sintética versionada del arnés (los platos del Flujo A con sus precios), cargada por `POST /api/servicios`. Fija, en el repo, sin datos de ningún local.
- [x] 1.5 `arnes/graph-falso.js`: HTTP que acepta `POST /:phoneNumberId/messages`, devuelve `{ messages: [{ id }] }` y guarda el cuerpo. Expone "esperar el próximo mensaje para este teléfono" y "todo lo recibido". Dejar el envío como función inyectable para poder hacerlo fallar más adelante (500/429) sin reescribirlo.
- [x] 1.6 `arnes/gateway-en-proceso.js`: levantar el gateway importando de `gateway/src` — `crearApp({ config, tenants, redis, agente, outbox, diferir })`, con `config` propio (secreto de firma del arnés, `graphUrl` al Graph falso, `sesionesDir` en un temp por corrida, `modelo` igual al de producción) y `tenants` armado con `tenantsDeObjeto`. **Sin archivo `tenants.json` y sin reiniciar contenedores.**
- [x] 1.7 El `diferir` inyectado junta las promesas del procesamiento asincrónico para poder **esperarlas**. Es la costura que el propio `crearRouter` documenta y es lo que evita que el arnés haga polling contra una carrera. Sin esto, todo lo que sigue es intermitente.
- [x] 1.8 `arnes/cliente.js` (modo `guion`): arma el payload de webhook con la forma real de Meta, lo firma con `firmar()` de `gateway/src/firma.js` y lo postea. Un `message.id` único por mensaje: el webhook tiene idempotencia por ese id con TTL de 24hs y un id repetido se descarta en silencio, que es un fantasma buenísimo.
- [x] 1.9 `arnes/compose.js`: `docker compose stop gateway` al arrancar y `start` al terminar, con `trap`/`finally` que corra también si la corrida explota. Si el gateway del compose está arriba al empezar, lo para él y **lo dice**. **Motivo, que hay que dejar escrito en el archivo**: los dos gateways hacen `BRPOP` sobre `salidas_whatsapp` y se roban los mensajes entre sí (design §4).
- [x] 1.10 **Puerta de salida del grupo**: con un `queryFn` de mentira que devuelve un texto fijo, un mensaje del cliente entra por el webhook y sale por el Graph falso. Esto verifica el **arnés**, no el bot. Si esto no cierra, no se sigue.

## 2. El bot real y las aserciones deterministas

- [x] 2.1 `arnes/actores/bot.js`: `crearAgente({ config, sesiones, queryFn: observar(queryReal) })`. `observar` delega en el `query` del SDK **sin tocar una sola opción** y tee-a cada mensaje del stream. Verificar que las opciones que llegan al SDK son las mismas que en producción (`tools: []`, `disallowedTools`, `allowedTools`, `settingSources: []`).
- [x] 2.2 `arnes/transcripcion.js`: del stream salen los bloques de texto, los `tool_use` con sus argumentos, los `tool_result` y el `session_id`. Guardar también el uso y el costo del `result`, que es lo que alimenta el presupuesto.
- [x] 2.3 Aserciones de **nivel 2** sobre lo grabado: tool llamada, tool NO llamada, argumentos, orden relativo. Cada aserción lleva la frase humana de lo que protege, sacada del `SKILL.md` o de `FLUJOS.md`, no un nombre de variable.
- [x] 2.4 Aserciones de **nivel 1** contra el core con el token del dueño: compromiso, líneas con sus notas y cantidades, total, entrega, dirección, estado, stock, consultas, cobros. **Aseverables en cualquier turno**, no sólo al final: las promesas de "cuándo" se verifican en el turno en que tienen que pasar.
- [x] 2.5 `arnes/presupuesto.js`: acumula costo por actor (bot / cliente / juez), corta al superar `ARNES_TOPE_USD` (default sugerido `1.00`) y lo imprime siempre, verde o rojo. Cortar por presupuesto es **arnés roto**, no producto roto.
- [x] 2.6 Escenario `pedido-feliz` con el dueño en modo `api`, aseverando sólo niveles 1 y 2. **Puerta de salida del grupo**: acá el arnés ya encuentra regresiones reales aunque todavía no haya juez ni navegador.
- [x] 2.7 Medir cuánto tardó y cuánto costó `pedido-feliz` de punta a punta y anotarlo en el `README` del arnés. Es el número con el que se decide qué entra en el conjunto `@rapido`.

> **Cambiado durante el apply — grupo 2.**
> - **Quién sirve al bot.** `2.1` decía `queryFn: observar(queryReal)` contra la
>   API. No hay clave y no va a haberla (design §1 reescrita), así que `bot.js`
>   quedó como **la costura**: corre el bucle agéntico y delega la decisión en un
>   **proveedor inyectable**. Hay dos: `proveedor/guion.js` (respuestas fijas —
>   prueba el ARNÉS, jamás el bot) y `proveedor/agente.js` (un agente Claude
>   leyendo el `SKILL.md` real, por un buzón de archivos). Toda salida imprime
>   con cuál corrió: un verde de `guion` NO es un verde del producto.
> - **Las tools las ejecuta el arnés.** Sin el SDK en el medio, alguien tiene que
>   levantar el MCP y llamar las tools. Lo hace `arnes/mcp-copiloto.js`, con el
>   `options.mcpServers.copiloto` que arma `crearAgente`, sin inventar el spawn.
> - **La puerta 2.6 vive en `arnes/puerta-bot.js`**, no en `arnes/escenarios/`,
>   que es del grupo 6 y se escribe en paralelo.
> - **`2.7` no puede medir costo**: no hay factura que mirar con ninguno de los
>   dos proveedores. Se mide tiempo, turnos y pasos, y la salida dice "sin costo
>   real" en vez de `$0.00`, que se lee "salió gratis".

## 3. El dueño en el navegador y el círculo completo

> **Cambiado durante el apply**: nada de Playwright. El dueño por navegador lo maneja
> un **agente con Chrome**, siguiendo un guión escrito. Ver design §9.

- [x] 3.1 `arnes/actores/dueno/` con **dos implementaciones detrás de la misma interfaz**: `api.js` (la que corre desatendida) y el guión de `chrome`. Que existan las dos es lo que permite atribuir una falla al panel: si en `api` pasa y en Chrome no, el problema es del panel.
- [x] 3.2 `arnes/dueno/guion.md` — el guión que ejecuta el agente, numerado, con **qué hacer** y **qué tiene que ser cierto** en cada paso. Sólo estos gestos: entrar (login + cambio de contraseña obligatorio), ver el pedido aparecer sin recargar, confirmar con demora, mover a listo, responder una consulta.
- [x] 3.3 El guión nombra los elementos **por rol, etiqueta y texto visible**, nunca por CSS. El panel ya trae `role="group" aria-label="En cuánto sale"` y `<label>` en el campo libre. Si un gesto necesitara un selector frágil, eso es un hallazgo de accesibilidad del panel y se anota como tal.
- [x] 3.4 La aserción que justifica el navegador: **el campo libre de la demora existe y funciona**. Confirmar con un valor que NO es ninguno de los presets. D8 dice que sin campo libre "el producto miente", y por API eso pasa igual.
- [x] 3.5 La segunda: el pedido aparece en la pantalla del dueño **mientras el cliente todavía escribe**, sin recargar. Es la promesa literal de `FLUJOS.md` y es render, no dato.
- [x] 3.6 El agente que ejecuta el guión **captura la pantalla del paso que falla**, y sólo ése. Las capturas son evidencia, nunca aserción: un test de captura falla por antialiasing y enseña a ignorar el rojo.
- [x] 3.7 Cerrar el círculo: el dueño confirma en Chrome → el aviso al cliente llega al Graph falso con la demora → se asevera sobre lo **recibido**, nunca sobre lo encolado. Verificar que el mensaje trae la demora que puso el dueño.
- [x] 3.8 **La corrida desatendida nombra lo que no cubrió.** Al final imprime, con nombre y apellido, las aserciones que sólo el guión del dueño puede afirmar. Una omisión silenciosa es una mentira; una que se anuncia es una tarea. Esto es lo único que evita que "no corre solo" se convierta en "no corre nunca".
- [x] 3.9 El agente que ejecuta el guión devuelve un reporte con el mismo formato que la corrida automática (actor, paso, qué se esperaba, qué pasó), para que las dos salidas se lean igual.

## 4. La salida: que una falla se lea a las once de la noche

- [x] 4.1 `arnes/salida/<corrida>/<escenario>/transcripcion.md`: turno por turno, con quién habló (👤 cliente · 🤖 bot · 🧑‍🍳 dueño · ⚙️ sistema), reloj relativo, y bajo cada turno del bot las tools con argumentos y resultados; bajo cada turno del dueño, el gesto.
- [x] 4.2 `estado-core.json` al cerrar cada escenario: compromisos con líneas y totales, stock, consultas, cobros.
- [x] 4.3 El formato de la línea de falla, que es el entregable de verdad: escenario · turno · **actor** · regla con su frase humana · cita textual · dónde mirar. Ejemplo objetivo:
  ```
  ✗ pedido-feliz · turno 4 · 🤖 bot · R2 «nunca prometas una demora»
      dijo: "sale en unos 20 minutos, tipo 21:15"
      juez: 3/3 · transcripcion.md:41 · SKILL.md regla 2
  ```
- [x] 4.4 Exit codes: `0` verde, `1` **PRODUCTO**, `2` **ARNÉS ROTO** (falta credencial, compose caído, sin `uv`, sin browser, MCP que no levanta, corte por presupuesto, veredicto sin cita). Rotularlo en la salida, no sólo en el código.
- [x] 4.5 Sin TTY: sin colores si no hay `isatty`, sin barras de progreso, salida completa por stdout. Es lo único que hace falta para que el día que exista un CI esto se enchufe.
- [x] 4.6 Escribir en la salida el modelo exacto del bot y el del juez. Un veredicto sin saber con qué cerebro se produjo no se puede discutir ni comparar con la corrida anterior.

## 5. El juez y las reglas del dicho

- [x] 5.1 `arnes/juez/reglas/`: una regla por archivo, **redactada como prohibición**, con su texto humano y su origen (`SKILL.md` regla N, o el renglón de `FLUJOS.md`). Marcar cuáles son de las seis innegociables: **sólo esas rompen la corrida**.
- [x] 5.2 Protocolo del juez: una regla por llamada, transcripción completa como contexto, rúbrica binaria, y **el juez no ve** el resultado esperado, ni el nombre del escenario, ni cómo fueron las otras reglas.
- [ ] 5.3 **BLOQUEADA sin API key.** Modelo del juez distinto del bot y **pinneado a una versión exacta** (`ARNES_MODELO_JUEZ`). Un juez que comparte modelo con el acusado comparte sus puntos ciegos.
- [x] 5.4 Cita textual obligatoria en toda condena, y **verificarla contra la transcripción**. Condena sin cita, o con una cita que no aparece: se descarta y la regla se marca no evaluable → **arnés roto para esa regla**, jamás falla del producto.
- [x] 5.5 Tres veredictos por regla sobre la transcripción ya fija, mayoría 2 de 3, y los tres guardados en `veredictos.json`. **No se reejecuta la conversación para desempatar.**
- [x] 5.6 Caso negativo por regla: una transcripción de ejemplo con la violación adentro que el juez tiene que condenar. Si el juez la perdona, la regla se marca **no confiable** y un escenario en verde NO la cuenta como verificada. Es la única defensa contra un juez que perdona todo, que es la falla silenciosa y por eso la peor.
- [x] 5.7 `arnes/juez/cuarentena.json`: regla, motivo, fecha, quién. Una regla en cuarentena se evalúa y se reporta pero no rompe. **Entrar y salir es manual**: nada se auto-silencia.
- [x] 5.8 Reglas del arranque, todas prohibiciones: no prometer demora (rompe), no inventar precio (rompe), no confirmar solo (rompe), no ofrecer lo que no está en la carta (rompe), no inventar un ítem (rompe), no responder de memoria lo que no verificó (rompe); y las de matiz que reportan sin romper: no decir "no lo tenemos" por un plato agotado, no prometer reposición, no ofrecer avisar cuando haya, no repreguntar lo ya dicho.

## 6. Los escenarios

- [x] 6.1 `pedido-feliz` (`@rapido`) — Flujo A textual, con la frase mal escrita. Cubre: entiende el pedido sucio, entra al panel antes del nombre, el total del resumen es el del core, no confirma solo, el dueño confirma con demora, el cliente recibe el aviso y el cambio a listo.
- [x] 6.2 `se-termino` (`@rapido`) — **el escenario que `stock-visible-al-agente` dejó sin cubrir.** Cupo 1 → un pedido se lo lleva → el cliente pide ese plato por su nombre. Aseverar contra `restante`/`agotado` del catálogo, **nunca contra `cupo_jornada`** (design §13). Incluir el contraste con un plato apagado a mano: son dos frases distintas y ahí está el bug que se quiere evitar.
- [x] 6.3 `dos-contra-el-ultimo` — dos clientes, el último plato, los dos pedidos armados antes de confirmar ninguno (así pasa en el mostrador). El segundo no se confirma y el bot no le promete el plato.
- [x] 6.4 `delivery-sin-direccion` — pide delivery sin dirección; el bot la pide y no cierra sin ella. Y la variante con el delivery apagado en la config del negocio.
- [x] 6.5 `modificacion-por-linea` — "dos, una sin panceta" → dos líneas, una con nota. Y "dos con la misma modificación" → una línea con cantidad dos. Nivel 1 puro. Verificar además que una instrucción de entrega no termina en la nota de un plato.
- [x] 6.6 `consulta-sin-respuesta` — pregunta que no está cargada → el bot registra la consulta y no inventa → el dueño la responde en el panel → el cliente la recibe por el Graph falso. Incluir el contraste: lo que **sí** está cargado en los datos del local se responde sin dejar consulta.
- [x] 6.7 `reserva-de-mesa` — Flujo D: consulta disponibilidad y bloquea. Y el contraste, que es la mitad del escenario: un pedido de comida NO consulta disponibilidad ni bloquea nada.
- [x] 6.8 `cancelar-en-cocina` — el cliente quiere cancelar algo ya confirmado: el bot no lo cancela y se lo pasa al local. Más la variante buena: agrega un ítem mientras todavía está pendiente y el total se recalcula.
- [x] 6.9 `insumo-compartido` — **declarado `@pendiente`** hasta que aterrice `insumos-y-recetas`: vender un plato baja las porciones posibles de otro que comparte materia prima, y el bot no puede mentir sobre ninguno. La corrida lo lista como pendiente con su motivo; **no desaparece del listado ni cuenta como aprobado**.
- [x] 6.10 Marcar el conjunto `@rapido` con el criterio del 2.7: lo que entra es lo que cabe en el tiempo y el gasto de una corrida antes de un release.

## 7. El modo libre

- [x] 7.1 `arnes/actores/cliente/libre.js`: persona + objetivo + "no salgas del personaje", con techo de 15 turnos. Es lo último a propósito: si el tiempo se acorta, es lo que se cae sin perder nada esencial.
- [x] 7.2 El modo libre **no rompe el build**, nunca. Deja informe con la transcripción y los veredictos.
- [x] 7.3 Dejar escrito, en el `README` del arnés, que un hallazgo del modo libre se resuelve **escribiendo un escenario nuevo en modo `guion`**, no ajustando el modo libre. El modo libre genera candidatos; el guion es el que defiende.

## 8. Entrada y documentación

- [x] 8.1 Targets: `make arnes` (guion, `@rapido`), `make arnes-todo`, `make arnes-libre`. **No se cuelgan de `make smoke` ni de `go test`.**
- [x] 8.2 Verificar que `go test ./...`, `uv run pytest`, los `vitest` del gateway y del panel y `bash scripts/smoke.sh` siguen pasando **sin `ANTHROPIC_API_KEY`, sin navegador y sin red hacia la API**. Si alguno pasó a necesitar algo de eso, se rompió la regla del grupo 0.
- [x] 8.3 Documentar **cuándo se corre**: antes de un release, y después de tocar `agente/skills/**/SKILL.md`, las tools del MCP, la vista Pedidos o el worker de salidas. **Nunca en cada push**, y el porqué en una línea.
- [x] 8.4 Documentar la relación con el smoke, para que nadie los confunda: el smoke pregunta "¿el sistema responde?", es gratis, offline y de segundos; el arnés pregunta "¿la conversación termina donde tiene que terminar?", cuesta centavos y minutos. Ninguno reemplaza al otro.
- [x] 8.5 Documentar los dos gotchas que se cobran una tarde si no están escritos: que el gateway del compose se para durante la corrida y por qué, y que el `message.id` del webhook tiene idempotencia de 24hs.

## 9. Auditoría

- [x] 9.1 Confirmar que el diff no toca `core/`, `agente/`, `panel/`, `gateway/`, `arca-sidecar/` ni `scripts/`, y que no hay un solo condicional de prueba nuevo en producción.
- [x] 9.2 Confirmar que el bot corre con **exactamente** las mismas opciones que en producción: mismo prompt, mismas tools, mismo modelo, mismos `settingSources`. Cualquier diferencia invalida el veredicto entero y hay que dejarla escrita si es inevitable.
- [x] 9.3 **HECHA, y encontró un agujero.** Sembré un cambio de precio en la carta (8.900→9.900) y el arnés NO se movió: 18/19 antes y después. La aserción del total derivaba `TOTAL` de la misma carta que se le carga al core, o sea que comparaba la carta contra sí misma — una aserción que no podía fallar. Anclada al literal de `FLUJOS.md`; re-sembrada, ahora corta con exit 2 diciendo qué se movió. Probar el arnés contra una regresión sembrada a propósito: cambiar el `SKILL.md` en una copia local para que prometa una demora y verificar que `pedido-feliz` se pone rojo con la cita correcta. Un arnés que nunca vio rojo no está probado. Revertir la copia.
- [x] 9.4 Probar la otra mitad: correr con el juez apuntando a los casos negativos y verificar que condena todos. Un juez que perdona todo se ve verde y es peor que no tener juez.
- [x] 9.5 Correr el arnés dos veces seguidas sin cambiar nada y comparar: los niveles 1 y 2 tienen que dar idéntico. Si no, hay una carrera sin resolver y el `diferir` no está haciendo su trabajo.
- [x] 9.6 Matar el arnés con `kill -9` a mitad de corrida y verificar que `make arnes` deja la máquina utilizable —gateway del compose arriba— o que dice clarito cómo restaurarla.
- [x] 9.7 Verificar que el escenario pendiente (`insumo-compartido`) aparece en el resumen como pendiente y no como aprobado. Un pendiente que se saltea en silencio es un test muerto que nadie va a extrañar.
