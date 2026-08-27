## ADDED Requirements

### Requirement: Las aserciones se ordenan en tres niveles con distinta autoridad

El arnés SHALL clasificar toda aserción en uno de tres niveles:

1. **Estado** — lo que quedó en el core, leído por su API. Determinista.
2. **Tools** — qué tools llamó el bot, con qué argumentos y en qué orden. Determinista.
3. **Dicho** — lo que el bot escribió, evaluado por un modelo juez. No determinista.

Un escenario SHALL preferir el nivel más bajo que pueda expresar lo que quiere proteger. Una afirmación que se pueda verificar sobre el estado NO SHALL verificarse sobre el texto.

#### Scenario: Lo verificable por estado se verifica por estado
- **WHEN** el escenario quiere proteger que el pedido entró al panel antes de pedir el nombre
- **THEN** lo asevera consultando el core al cerrar el turno correspondiente
- **AND** NO lo asevera leyendo lo que el bot dijo

#### Scenario: Lo verificable por tools se verifica por tools
- **WHEN** el escenario quiere proteger que el bot no confirmó el pedido por su cuenta
- **THEN** lo asevera sobre las tools llamadas y sobre el estado resultante
- **AND** NO lo asevera pidiéndole a un juez que interprete el texto

#### Scenario: Cada aserción declara su nivel
- **WHEN** una aserción falla
- **THEN** la falla indica de qué nivel era
- **AND** el lector sabe si el resultado es determinista o es un juicio

### Requirement: Las tools que el bot llamó son observables y aseverables

El arnés SHALL registrar, por cada turno del bot, la secuencia de tools invocadas con sus argumentos y sus resultados, obtenida del stream de la conversación sin alterar cómo corre el bot.

Un escenario SHALL poder aseverar que una tool fue llamada, que NO fue llamada, con qué argumentos y en qué orden relativo a otras.

#### Scenario: Se asevera una tool que tiene que haberse llamado
- **WHEN** el cliente pide la carta
- **THEN** el arnés puede aseverar que el bot consultó el catálogo antes de responder

#### Scenario: Se asevera una tool que NO tiene que haberse llamado
- **WHEN** el cliente pide comida para retirar
- **THEN** el arnés puede aseverar que el bot no consultó disponibilidad de agenda

#### Scenario: Se aseveran los argumentos
- **WHEN** el cliente pide dos unidades de un plato y pide que una vaya sin un ingrediente
- **THEN** el arnés puede aseverar las líneas y las notas con las que se armó el compromiso

### Requirement: El nivel del dicho sólo asevera prohibiciones

Las reglas del nivel 3 SHALL estar redactadas como **prohibiciones**: qué NO puede decir el asistente. NO SHALL haber reglas de nivel 3 que exijan un contenido, un tono o una fórmula.

Las reglas que rompen la corrida SHALL limitarse a las reglas que el `SKILL.md` del vertical declara innegociables. El resto SHALL reportarse sin romper.

#### Scenario: Una regla de prohibición
- **WHEN** se escribe una regla de nivel 3
- **THEN** su enunciado describe algo que el asistente no puede decir
- **AND** se puede responder con sí o no señalando un mensaje

#### Scenario: No se aseveran obligaciones de estilo
- **WHEN** el bot responde correctamente pero con otras palabras que las del documento
- **THEN** el escenario NO falla por eso

#### Scenario: Sólo las reglas duras rompen
- **WHEN** falla una regla de nivel 3 que no es de las innegociables del `SKILL.md`
- **THEN** se reporta con su cita
- **AND** la corrida NO se rotula como falla del producto por esa regla sola

### Requirement: El juez es un modelo distinto del bot, pinneado y ciego a lo que se espera

El juez SHALL correr sobre un modelo distinto del que corre el bot y pinneado a una versión exacta, registrada en la salida de la corrida.

El juez SHALL recibir **una regla por llamada**, la transcripción como contexto, y una rúbrica binaria. NO SHALL recibir el resultado esperado, ni el nombre del escenario, ni si otras reglas pasaron.

#### Scenario: El juez no comparte cerebro con el acusado
- **WHEN** se evalúa una regla del nivel 3
- **THEN** el modelo que juzga no es el mismo que generó el texto juzgado

#### Scenario: El juez no sabe qué se espera
- **WHEN** se arma el pedido al juez
- **THEN** el pedido contiene la regla y la transcripción
- **AND** NO contiene ninguna pista de cuál es el veredicto deseado

#### Scenario: El juez queda registrado
- **WHEN** termina una corrida que evaluó reglas de nivel 3
- **THEN** la salida indica la versión exacta del modelo juez usada

### Requirement: Un veredicto condenatorio sin cita textual es un fallo del arnés

Todo veredicto que condene SHALL incluir la cita textual del mensaje que viola la regla y el turno en que se dijo. Un veredicto condenatorio sin cita, o con una cita que no aparece en la transcripción, NO SHALL contarse como falla del producto: SHALL rotularse como arnés roto para esa regla.

#### Scenario: Condena con prueba
- **WHEN** el juez condena y cita una frase que está en la transcripción
- **THEN** el veredicto vale y la regla se evalúa como violada

#### Scenario: Condena sin prueba
- **WHEN** el juez condena y no cita, o cita algo que no está en la transcripción
- **THEN** el veredicto se descarta
- **AND** la regla se rotula como no evaluable y el resultado NO se atribuye al producto

### Requirement: Cada regla del dicho se evalúa tres veces sobre la misma transcripción

Una regla de nivel 3 SHALL evaluarse tres veces sobre la transcripción ya fijada, y SHALL resolverse por mayoría. La conversación NO SHALL volver a correrse para desempatar.

La salida SHALL registrar los tres veredictos, no sólo el resultado.

#### Scenario: Mayoría condenatoria
- **WHEN** dos o tres veredictos condenan con cita
- **THEN** la regla se evalúa como violada
- **AND** la salida muestra la proporción

#### Scenario: Mayoría absolutoria con disidencia
- **WHEN** un solo veredicto condena y dos absuelven
- **THEN** la regla NO se evalúa como violada
- **AND** la disidencia queda registrada, porque una regla que empieza a discrepar seguido es una regla mal escrita

#### Scenario: No se reejecuta la conversación
- **WHEN** hay que desempatar un veredicto
- **THEN** se reevalúa la misma transcripción
- **AND** NO se vuelve a hablar con el bot

### Requirement: Cada regla del dicho tiene su caso negativo

Toda regla de nivel 3 SHALL venir acompañada de una transcripción de ejemplo que **sí** la viola, y el juez SHALL condenarla. Una regla cuyo caso negativo el juez no condena SHALL marcarse como no confiable y NO SHALL contarse como aprobada cuando pase.

#### Scenario: El juez condena el caso negativo
- **WHEN** se evalúa la regla contra su transcripción de ejemplo con la violación adentro
- **THEN** el juez condena
- **AND** la regla se considera confiable

#### Scenario: El juez perdona el caso negativo
- **WHEN** el juez NO condena la violación de ejemplo
- **THEN** la regla se marca como no confiable
- **AND** un escenario que la tenía en verde NO cuenta esa regla como verificada

### Requirement: Una regla ruidosa entra en cuarentena, no se borra

Una regla de nivel 3 SHALL poder marcarse en cuarentena con su motivo y su fecha. Una regla en cuarentena SHALL seguir evaluándose y reportándose, pero NO SHALL romper la corrida.

La entrada y la salida de cuarentena SHALL ser una acción explícita de una persona, registrada con su motivo. NO SHALL ser automática.

#### Scenario: Regla en cuarentena
- **WHEN** una regla en cuarentena condena
- **THEN** el resultado se reporta con su cita y con la nota de cuarentena
- **AND** la corrida no falla por ella

#### Scenario: Nada se auto-silencia
- **WHEN** una regla falla varias corridas seguidas
- **THEN** el arnés NO la silencia por su cuenta
- **AND** la sigue reportando hasta que alguien decida qué hacer con ella

#### Scenario: Salir de cuarentena deja rastro
- **WHEN** una regla vuelve a estar activa
- **THEN** queda registrado el motivo por el que se la considera arreglada

### Requirement: El estado del core se asevera al cerrar cada turno, no sólo al final

El arnés SHALL poder aseverar el estado del core en cualquier punto de la conversación, no únicamente al terminar. Las promesas del producto sobre **cuándo** pasa algo SHALL verificarse en el turno en que tienen que pasar.

#### Scenario: Algo que tiene que haber pasado ya
- **WHEN** el cliente terminó de dictar los ítems
- **THEN** el arnés asevera, en ese turno, que el compromiso existe y está pendiente

#### Scenario: Algo que todavía no tiene que haber pasado
- **WHEN** el cliente todavía no confirmó el resumen
- **THEN** el arnés asevera que el compromiso no está confirmado
- **AND** una confirmación anticipada falla en el turno en que ocurrió, no al final
