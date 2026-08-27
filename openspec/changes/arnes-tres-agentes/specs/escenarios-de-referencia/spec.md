## ADDED Requirements

### Requirement: El pedido validado se recorre entero, de "Hola" al aviso de confirmación

El arnés SHALL recorrer el Flujo A de `docs/FLUJOS.md` completo, con los mensajes del cliente textuales —incluida la frase con faltas de ortografía— y SHALL verificar el orden que el documento fija: armar ítems → el compromiso entra al panel como pendiente → pedir el nombre → avisar que espera confirmación → el local confirma con su demora → el cliente recibe el aviso.

Este escenario SHALL correr en el conjunto rápido, porque es la conversación que define el producto.

#### Scenario: El bot entiende el pedido mal escrito
- **WHEN** el cliente escribe "te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar"
- **THEN** el compromiso queda con las dos líneas correctas de la carta
- **AND** la entrega queda como retira
- **AND** el bot NO vuelve a preguntar si es delivery

#### Scenario: El compromiso entra al panel antes de que el cliente dé su nombre
- **WHEN** el cliente terminó de dictar los ítems y todavía no dijo su nombre
- **THEN** ya existe un compromiso pendiente en el core con esas líneas
- **AND** el dueño lo ve en el panel

#### Scenario: El total del resumen es el total del core
- **WHEN** el bot le lee al cliente el resumen con el total
- **THEN** ese total coincide con el total del compromiso en el core

#### Scenario: El bot no confirma el pedido por su cuenta
- **WHEN** el cliente da su nombre y acepta el resumen
- **THEN** el compromiso queda pendiente, no confirmado
- **AND** el bot le avisa al cliente que el local confirma

#### Scenario: El dueño confirma y el cliente recibe la demora
- **WHEN** el dueño confirma el pedido desde el panel con una demora
- **THEN** el compromiso queda confirmado con esa demora
- **AND** el cliente recibe un mensaje que trae la demora o la hora resultante
- **AND** ese mensaje llegó por el mismo camino que las respuestas del bot

#### Scenario: El cambio de estado le llega al cliente
- **WHEN** el dueño mueve el pedido a listo desde el panel
- **THEN** el cliente recibe un aviso

### Requirement: El asistente nunca promete una demora antes de que el local la ponga

El arnés SHALL verificar, en todos los escenarios de pedido, que ningún mensaje del bot anterior a la confirmación del local afirme un tiempo de preparación, una hora de entrega o una inminencia.

Es la corrección número uno del prototipado del 18/08 y la segunda regla innegociable del `SKILL.md`. Su violación SHALL romper la corrida.

#### Scenario: El cliente pregunta cuánto tarda
- **WHEN** el cliente pregunta cuánto tarda antes de que el local confirme
- **THEN** el bot responde que el local le pasa el tiempo
- **AND** NO afirma una cantidad de minutos, ni una hora, ni que "ya sale"

#### Scenario: El bot no adelanta la hora en el resumen
- **WHEN** el bot lee el resumen del pedido
- **THEN** el resumen no contiene una hora de entrega ni una demora

#### Scenario: Después de la confirmación sí puede decirla
- **WHEN** el local ya confirmó con su demora
- **THEN** el bot puede decirle al cliente esa demora o la hora resultante
- **AND** el número que dice es el que puso el local

### Requirement: El asistente sabe decir que un plato se terminó hoy

El arnés SHALL cubrir el escenario que `stock-visible-al-agente` declaró y dejó sin verificar: un plato que se agotó durante el día, pedido por su nombre.

El arnés SHALL aseverar contra el contrato del catálogo —lo que el core devuelve como restante y agotado— y NO contra la tabla de la que salga ese número, para que la misma verificación sirva cuando el número venga de otra fuente.

#### Scenario: El plato agotado no se ofrece
- **WHEN** un plato quedó sin stock y el cliente pide una recomendación
- **THEN** el bot no lo ofrece
- **AND** no arma ninguna línea con ese plato

#### Scenario: Se lo piden por su nombre
- **WHEN** el cliente pide por su nombre el plato agotado
- **THEN** el bot responde que hoy se terminó
- **AND** NO responde que el local no lo tiene
- **AND** NO promete reponerlo ni ofrece avisarle cuando haya
- **AND** ofrece una alternativa que está en la carta

#### Scenario: Un plato apagado a mano no es lo mismo
- **WHEN** el dueño apaga un plato desde el panel y el cliente lo pide
- **THEN** el bot responde que eso no lo tienen
- **AND** NO responde que se terminó hoy

#### Scenario: El último plato se lo lleva el primero que confirma
- **WHEN** dos clientes distintos piden a la vez el último plato y el dueño confirma los dos
- **THEN** el primero queda confirmado
- **AND** el segundo no se confirma
- **AND** el segundo cliente recibe una respuesta que no le promete el plato

### Requirement: Un delivery no se cierra sin dirección

El arnés SHALL verificar que el asistente pide la dirección antes de cerrar un pedido con entrega a domicilio, y que un local que no hace delivery lo dice y ofrece las alternativas que sí hace.

#### Scenario: Pide delivery sin dar dirección
- **WHEN** el cliente pide delivery y no da la dirección
- **THEN** el bot se la pide
- **AND** el compromiso no queda confirmado sin dirección

#### Scenario: El local no hace delivery
- **WHEN** el negocio tiene el delivery apagado y el cliente lo pide
- **THEN** el bot lo dice y ofrece retirar o comer en el local
- **AND** no arma un compromiso con entrega a domicilio

### Requirement: Las modificaciones del plato llegan a la cocina en la línea correcta

El arnés SHALL verificar la regla de partición de líneas del `SKILL.md`: una modificación que aplica a una sola unidad separa la línea; una que aplica a todas va en la misma línea con su cantidad.

Es una aserción de estado pura y protege una regla que una regresión del prompt rompe sin que se note en la conversación.

#### Scenario: Dos unidades, una modificada
- **WHEN** el cliente pide dos unidades del mismo plato y aclara que una va sin un ingrediente
- **THEN** el compromiso tiene dos líneas de ese plato
- **AND** una lleva la nota con la modificación y la otra no

#### Scenario: La modificación aplica a todas
- **WHEN** el cliente pide dos porciones del mismo plato con la misma modificación para las dos
- **THEN** el compromiso tiene una línea con cantidad dos y la nota

#### Scenario: La modificación se le repite al cliente
- **WHEN** el bot lee el resumen
- **THEN** el resumen menciona la modificación

#### Scenario: Las instrucciones de entrega no van en la línea
- **WHEN** el cliente aclara algo sobre la entrega
- **THEN** eso va en la nota del pedido y no en la nota de un plato

### Requirement: Lo que el asistente no sabe termina en una consulta que el dueño responde

El arnés SHALL recorrer el círculo completo de una pregunta que no está en el catálogo ni en los datos del local: el bot la registra en vez de inventar, el dueño la ve y la responde desde el panel, y el cliente recibe la respuesta por WhatsApp.

#### Scenario: El bot no inventa
- **WHEN** el cliente pregunta algo que no está cargado en los datos del local ni en la carta
- **THEN** el bot no afirma una respuesta
- **AND** queda registrada una consulta en el core
- **AND** el bot le avisa al cliente que el local le responde

#### Scenario: Lo que sí está cargado se responde sin consulta
- **WHEN** el cliente pregunta la dirección o el horario y esos datos están cargados
- **THEN** el bot los responde con lo cargado
- **AND** NO registra una consulta

#### Scenario: El dueño responde y el cliente recibe
- **WHEN** el dueño responde la consulta desde el panel
- **THEN** el cliente recibe la respuesta por el Graph falso

### Requirement: La reserva de mesa recorre el camino de la agenda

El arnés SHALL cubrir el Flujo D: una reserva de mesa usa disponibilidad y bloqueo, a diferencia de un pedido de comida, que no ocupa agenda.

#### Scenario: La reserva usa la agenda
- **WHEN** el cliente pide reservar una mesa para una cantidad de personas y una noche
- **THEN** el bot consulta disponibilidad y bloquea el hueco elegido
- **AND** el compromiso queda con ese horario

#### Scenario: Un pedido de comida no usa la agenda
- **WHEN** el cliente hace un pedido para retirar
- **THEN** el bot NO consulta disponibilidad ni bloquea nada

#### Scenario: El hueco bloqueado no se ofrece dos veces
- **WHEN** el hueco ya está bloqueado por otra sesión
- **THEN** el bot no se lo ofrece al cliente
- **AND** no promete una mesa que no está

### Requirement: Un escenario que todavía no se puede correr se saltea ruidosamente

Un escenario cuyo requisito no aterrizó SHALL declararse pendiente con el motivo, y la corrida SHALL informarlo como pendiente en su resumen. NO SHALL desaparecer del listado ni contarse como aprobado.

El escenario del insumo compartido —vender un plato baja las porciones posibles de otro que comparte materia prima, y el asistente no puede mentir sobre ninguno de los dos— SHALL existir declarado como pendiente hasta que la capacidad de insumos y recetas aterrice.

#### Scenario: Escenario pendiente
- **WHEN** un escenario depende de una capacidad que todavía no existe
- **THEN** la corrida lo lista como pendiente con su motivo
- **AND** NO lo cuenta como aprobado

#### Scenario: El pendiente deja de serlo solo
- **WHEN** la capacidad de la que dependía ya está en el sistema
- **THEN** el escenario corre
- **AND** su verificación se apoya en el contrato del catálogo, no en la fuente del número

### Requirement: El asistente no cancela lo que el local ya está cocinando

El arnés SHALL verificar que el asistente no cancela por su cuenta un pedido que el local ya confirmó, y que le pasa el pedido de cancelación al local.

#### Scenario: El cliente quiere cancelar un pedido ya confirmado
- **WHEN** el cliente pide cancelar un pedido que el local ya confirmó
- **THEN** el compromiso NO queda cancelado por el bot
- **AND** el bot le dice al cliente que el local lo resuelve

#### Scenario: El cliente cambia el pedido mientras todavía está pendiente
- **WHEN** el cliente agrega un ítem antes de que el local confirme
- **THEN** el compromiso se recalcula con la línea nueva
- **AND** el total que el bot le dice al cliente coincide con el nuevo total del core
