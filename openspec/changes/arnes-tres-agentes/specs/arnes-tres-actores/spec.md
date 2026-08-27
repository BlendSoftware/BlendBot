## ADDED Requirements

### Requirement: El arnés corre tres actores contra el sistema real

El arnés SHALL recorrer cada escenario con tres actores simultáneos contra el sistema real levantado con `docker compose`: el **dueño** operando el panel, el **bot** atendiendo, y el **cliente** escribiendo por WhatsApp.

Ninguno de los tres actores SHALL sustituir a un componente del producto. El único componente falso permitido es la **API de Graph de Meta**, porque es el único que no le pertenece al proyecto.

#### Scenario: Los tres actores en una corrida
- **WHEN** se corre un escenario del arnés
- **THEN** el cliente entra por `POST /webhook/whatsapp` con firma HMAC válida
- **AND** el bot corre con el `SKILL.md` del vertical, el MCP de `agente/` y la API de Anthropic
- **AND** el dueño opera el panel servido por el compose
- **AND** el core, la base y redis son los del compose, sin mocks

#### Scenario: Ningún componente del producto se sustituye
- **WHEN** el arnés necesita observar lo que hace el bot
- **THEN** lo observa envolviendo el stream del SDK, sin cambiar el modelo, el prompt, las tools ni las opciones con las que corre en producción
- **AND** NO reemplaza al bot por una simulación

### Requirement: El bot del arnés es el producto, no una imitación

El actor bot SHALL ser `gateway/src` corriendo con el `SKILL.md` del vertical como system prompt, el servidor MCP de `agente/` con sus tools reales y el modelo de la API de Anthropic. El arnés NO SHALL implementar una versión propia del bot, ni por defecto ni como modo alternativo.

El modelo del bot SHALL ser el mismo que usa el gateway en producción. Si ese modelo cambia, el veredicto de una corrida anterior deja de ser válido.

#### Scenario: El bot corre con el prompt de producción
- **WHEN** el arnés levanta el actor bot
- **THEN** el system prompt es el contenido de `agente/skills/<vertical>/SKILL.md` sin modificar
- **AND** las tools disponibles son exactamente las del MCP `copiloto`
- **AND** el modelo es el que el gateway usa en producción

#### Scenario: No existe un modo con el bot simulado
- **WHEN** alguien busca correr el arnés sin gastar en la API
- **THEN** el arnés NO ofrece un modo con el bot simulado
- **AND** falla con exit 2 si falta `ANTHROPIC_API_KEY`, en vez de correr algo que no prueba el bot

#### Scenario: La corrida deja escrito con qué cerebro corrió
- **WHEN** una corrida termina, verde o roja
- **THEN** la salida indica el modelo exacto del bot y el modelo exacto del juez
- **AND** ese dato viaja en los artefactos de la corrida

### Requirement: El cliente tiene un modo scripteado y un modo libre

El arnés SHALL ofrecer dos modos para el actor cliente:

- **`guion`** (default): los mensajes del cliente son texto fijo, tomado de `docs/FLUJOS.md` cuando el escenario provenga de ahí, incluidas sus faltas de ortografía. Rompe el build.
- **`libre`** (opt-in): el cliente es un modelo actuando una persona con un objetivo declarado. NO SHALL romper el build; produce informe.

El modo `libre` SHALL tener un techo de turnos. Un hallazgo del modo `libre` se resuelve escribiendo un escenario nuevo en modo `guion`, no ajustando el modo `libre`.

#### Scenario: El guion respeta el texto del documento
- **WHEN** un escenario proviene de un flujo de `docs/FLUJOS.md`
- **THEN** los mensajes del cliente son los del documento, textuales
- **AND** las faltas de ortografía del documento se conservan, porque entenderlas es parte de lo que se prueba

#### Scenario: El modo libre no bloquea
- **WHEN** el modo `libre` encuentra una violación
- **THEN** la corrida la reporta con su transcripción
- **AND** el exit code NO indica falla del producto
- **AND** el hallazgo se convierte en un escenario del modo `guion` para que quede protegido

#### Scenario: El cliente libre no puede correr para siempre
- **WHEN** el cliente-modelo no cierra la conversación
- **THEN** el escenario se corta al llegar al techo de turnos
- **AND** la corrida lo reporta como conversación no cerrada, no como éxito

### Requirement: El Graph falso es el teléfono del cliente

Todo mensaje que el producto mande hacia el cliente SHALL llegar al arnés por un servidor HTTP que imita `POST /<phone_number_id>/messages` de la Cloud API, y por ningún otro camino.

El arnés NO SHALL leer los mensajes salientes de la base ni de la cola de redis para darlos por entregados. Un mensaje encolado no es un mensaje recibido, y la diferencia entre esas dos cosas es la mitad del valor del producto.

#### Scenario: La respuesta del bot llega por el Graph falso
- **WHEN** el cliente manda un mensaje y el bot responde
- **THEN** la respuesta llega al Graph falso con el `phone_number_id` y el teléfono del destinatario
- **AND** el arnés la trata como el mensaje que el cliente ve

#### Scenario: El aviso que dispara el dueño llega por el mismo lugar
- **WHEN** el dueño confirma un pedido desde el panel con una demora
- **THEN** el aviso al cliente recorre core → cola de salidas → worker → outbox → Graph falso
- **AND** llega al mismo Graph falso que las respuestas del bot
- **AND** el arnés lo asevera sobre lo recibido, no sobre lo encolado

#### Scenario: Un mensaje que no sale se ve como no salido
- **WHEN** el worker de salidas o el outbox no entregan un mensaje
- **THEN** el escenario falla por mensaje no recibido
- **AND** la falla indica hasta qué eslabón llegó

### Requirement: Cada corrida se aísla creando su propio negocio

El arnés SHALL crear, por corrida, su propio negocio con un sufijo al azar, su propio `wa_phone_id`, su propio dueño y su propio teléfono de cliente. NO SHALL depender de datos sembrados previamente ni SHALL borrar datos al terminar.

Dos corridas simultáneas sobre la misma base NO SHALL interferir entre sí.

#### Scenario: Corridas repetidas no se pisan
- **WHEN** el arnés se corre diez veces seguidas contra la misma base
- **THEN** las diez pasan
- **AND** quedan diez negocios de prueba, sin error

#### Scenario: Sin limpieza al terminar
- **WHEN** una corrida termina, verde o roja
- **THEN** el arnés NO borra el negocio que creó
- **AND** los datos quedan disponibles para inspeccionar la falla

#### Scenario: El teléfono del cliente es propio de la corrida
- **WHEN** dos corridas se solapan en el tiempo
- **THEN** cada una usa un teléfono de cliente distinto
- **AND** las sesiones de conversación de una NO alcanzan a la otra

### Requirement: El arnés no deja dos consumidores sobre la misma cola de salidas

El arnés SHALL garantizar que, mientras corre, exista **un solo** consumidor de la cola de salidas del core. SHALL detener el gateway del compose antes de empezar y SHALL volver a levantarlo al terminar, incluso si la corrida falló.

Si al arrancar detecta el gateway del compose activo, SHALL detenerlo él y decirlo, en vez de asumir el estado de la máquina.

#### Scenario: El gateway del compose se para durante la corrida
- **WHEN** arranca una corrida del arnés con el gateway del compose activo
- **THEN** el arnés lo detiene y lo informa
- **AND** al terminar lo vuelve a levantar

#### Scenario: La corrida falla y el gateway vuelve igual
- **WHEN** un escenario falla a mitad de camino
- **THEN** el gateway del compose queda levantado como estaba
- **AND** la máquina queda en el estado en que se la encontró

### Requirement: El dueño se maneja por el navegador, con una alternativa por API

El actor dueño SHALL manejar el panel real en un navegador para los gestos que el dueño hace de verdad: entrar, ver entrar un pedido, confirmarlo con demora, moverlo de estado y responder una consulta.

El arnés SHALL ofrecer una implementación alternativa del mismo actor que opere por la API del core, seleccionable por entorno, corriendo **los mismos escenarios y las mismas aserciones**. Que las dos existan es lo que permite separar una falla del panel de una falla del producto.

Los localizadores del navegador SHALL apoyarse en roles, etiquetas y texto visible. Una captura de pantalla NO SHALL usarse como aserción; se guarda como evidencia.

#### Scenario: El dueño confirma con una demora que no es un preset
- **WHEN** el dueño confirma un pedido escribiendo una demora en el campo libre
- **THEN** el pedido queda confirmado con esa demora
- **AND** el escenario falla si el campo libre no existe en la pantalla

#### Scenario: El pedido aparece solo mientras el cliente todavía escribe
- **WHEN** el cliente terminó de dictar los ítems y todavía no dio su nombre
- **THEN** el dueño ve el pedido en la pantalla sin recargarla a mano

#### Scenario: La misma prueba sin navegador
- **WHEN** se corre con el actor dueño por API
- **THEN** se recorren los mismos escenarios y se evalúan las mismas aserciones, salvo las que sólo el navegador puede afirmar
- **AND** las que sólo el navegador puede afirmar se reportan como omitidas, nombrándolas

#### Scenario: Falla en el navegador y pasa por API
- **WHEN** un escenario falla con el dueño en navegador y pasa con el dueño por API
- **THEN** la salida permite atribuir la falla al panel

### Requirement: Toda corrida tiene techo de gasto y declara lo que gastó

El arnés SHALL acumular el costo de las llamadas al modelo, separado por actor (bot, cliente, juez), y SHALL cortar la corrida al superar un techo configurable.

Toda corrida SHALL imprimir el gasto al terminar, verde o roja.

#### Scenario: Se supera el techo
- **WHEN** el gasto acumulado supera el techo configurado
- **THEN** la corrida se corta
- **AND** informa cuánto gastó y en qué escenario se cortó
- **AND** NO emite veredicto sobre el producto

#### Scenario: Corrida verde
- **WHEN** todos los escenarios pasan
- **THEN** la salida incluye el gasto total desglosado por actor

### Requirement: El arnés verifica sus requisitos antes de gastar

El arnés SHALL verificar, antes de la primera llamada al modelo, que estén: el compose respondiendo, la clave de la API, el runtime que levanta el MCP y —si el dueño va por navegador— el navegador instalado.

Un requisito faltante SHALL cortar con el nombre de lo que falta y el comando para resolverlo.

#### Scenario: Falta un requisito
- **WHEN** falta el runtime que levanta el MCP
- **THEN** el arnés corta antes de gastar
- **AND** dice qué falta y cómo instalarlo
- **AND** el resultado es "arnés roto", no "producto roto"

#### Scenario: El compose no está arriba
- **WHEN** el core no responde
- **THEN** el arnés corta con "arnés roto" y nombra el servicio que no responde

### Requirement: El arnés no vive dentro de ningún componente ni de las suites existentes

El arnés SHALL vivir en su propio directorio en la raíz del repositorio, con sus propias dependencias. NO SHALL agregar dependencias, archivos ni condicionales de prueba a `core/`, `agente/`, `panel/`, `gateway/` ni `arca-sidecar/`.

NO SHALL colgarse de `go test`, de las suites de `vitest`, de `pytest` ni de `scripts/smoke.sh`. Esas suites SHALL seguir corriendo sin clave de API, sin navegador y sin conexión.

#### Scenario: Las suites existentes siguen siendo gratis y offline
- **WHEN** se corren las suites del repositorio sin clave de API y sin red
- **THEN** siguen pasando
- **AND** el arnés no participa de esa corrida

#### Scenario: Cero código de prueba en producción
- **WHEN** se revisa el diff del cambio
- **THEN** no hay ninguna rama condicional nueva en el código de producción destinada al arnés
- **AND** el arnés se apoya únicamente en puntos de inyección que ya existían

### Requirement: La salida de una corrida es una línea de tiempo legible

Cada escenario SHALL dejar una transcripción turno por turno que identifique quién habló, en qué momento, con qué texto; y bajo cada turno del bot, qué tools llamó, con qué argumentos y qué le devolvieron; y bajo cada turno del dueño, qué gesto hizo.

Cada escenario SHALL dejar además el estado del core al cerrar, y las capturas y el trace del navegador del turno que falló.

Los artefactos SHALL quedar fuera del control de versiones.

#### Scenario: Una falla se puede reconstruir sin leer logs de contenedores
- **WHEN** un escenario falla
- **THEN** la transcripción alcanza para ver la conversación completa y las tools que se llamaron
- **AND** el estado del core al cerrar está guardado

#### Scenario: Evidencia del navegador sólo donde importa
- **WHEN** el actor dueño falla en un gesto del navegador
- **THEN** quedan la captura y el trace de ese momento

### Requirement: Una falla nombra actor, turno y regla, y cita la frase

Toda falla SHALL identificar el escenario, el número de turno, **cuál de los tres actores** se salió del libreto, y **qué regla** se violó expresada en la frase humana que la origina en `docs/FLUJOS.md` o en el `SKILL.md`.

Si la regla es sobre lo que el bot dijo, la falla SHALL incluir la frase textual.

#### Scenario: Falla de una regla del asistente
- **WHEN** el bot afirma una demora antes de que el local confirme
- **THEN** la falla nombra el escenario y el turno
- **AND** identifica al bot como el actor
- **AND** cita la frase dicha
- **AND** nombra la regla con su texto del `SKILL.md`

#### Scenario: Falla de estado
- **WHEN** el compromiso quedó con un total distinto del cotizado
- **THEN** la falla dice qué se esperaba, qué llegó, y en qué turno se cotizó

### Requirement: El resultado distingue producto roto de arnés roto

El arnés SHALL usar códigos de salida distintos para "el producto falló" y "el arnés no pudo emitir veredicto", y SHALL rotularlo en la salida.

Falta de credenciales, compose caído, runtime o navegador ausentes, MCP que no levanta, corte por presupuesto y veredicto de juez sin cita SHALL contar como arnés roto.

#### Scenario: El producto falló
- **WHEN** una aserción sobre el estado, sobre las tools o sobre una regla dura del asistente falla
- **THEN** el resultado se rotula como falla del producto

#### Scenario: El arnés no pudo emitir veredicto
- **WHEN** el arnés se corta por falta de un requisito o por presupuesto
- **THEN** el resultado se rotula como arnés roto
- **AND** NO afirma nada sobre el producto
