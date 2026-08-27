## ADDED Requirements

### Requirement: El catálogo expone el cupo del día

`GET /api/servicios` SHALL devolver, por cada servicio, el estado del cupo de la jornada **abierta** del negocio: `restante` (entero o `null`) y `agotado` (booleano).

`restante: null` SHALL significar "este plato no lleva cuenta" (ilimitado). `restante: 0` SHALL significar "lleva cuenta y no queda". Un centinela numérico (`-1`) para ilimitado NO está permitido: la diferencia entre "no sé" y "no hay" tiene que sobrevivir al viaje.

La lectura del cupo SHALL resolverse con una sola consulta agrupada por jornada, no una por servicio.

#### Scenario: Plato sin cupo cargado
- **WHEN** el negocio tiene una jornada abierta y el servicio no tiene fila en `cupo_jornada`
- **THEN** el servicio viaja con `restante: null` y `agotado: false`

#### Scenario: Plato con cupo y stock
- **WHEN** el servicio tiene cupo `asignado: 10`, `consumido: 4`
- **THEN** el servicio viaja con `restante: 6` y `agotado: false`

#### Scenario: Plato agotado
- **WHEN** el servicio tiene cupo `asignado: 3`, `consumido: 3`
- **THEN** el servicio viaja con `restante: 0` y `agotado: true`

#### Scenario: Sin jornada abierta todo es ilimitado
- **WHEN** el negocio no tiene ninguna jornada abierta
- **THEN** todos los servicios viajan con `restante: null` y `agotado: false`
- **AND** la respuesta NO devuelve error

#### Scenario: El cupo no se filtra entre negocios
- **WHEN** dos negocios tienen cupo cargado sobre servicios distintos en jornadas abiertas simultáneas
- **THEN** el catálogo de cada negocio SHALL reflejar únicamente sus propios cupos

### Requirement: `solo_disponibles` filtra el interruptor manual, no el stock

El parámetro `solo_disponibles=true` de `GET /api/servicios` SHALL seguir significando exactamente lo que significaba: filtrar por `servicio.disponible`. NO SHALL filtrar por `agotado`.

Son dos estados distintos y el cliente merece oír una frase distinta en cada uno: `disponible=false` es "el dueño lo apagó" y se responde "eso no lo tenemos"; `agotado` es "se terminó hoy" y se responde "hoy se nos terminó". Colapsarlos en un solo filtro obliga a quien consume a resignar el filtrado del servidor para poder distinguirlos, que es exactamente lo que no queremos.

La respuesta filtrada SHALL incluir igual `restante` y `agotado`, de modo que el consumidor pueda partir la lista sin una segunda llamada.

#### Scenario: El filtrado sigue trayendo los agotados, marcados
- **WHEN** se pide `GET /api/servicios?solo_disponibles=true` y un servicio tiene `agotado: true`
- **THEN** ese servicio SÍ aparece, con `agotado: true`
- **AND** el consumidor tiene todo lo que necesita para separarlo en una sola lectura

#### Scenario: El interruptor manual sigue filtrando en el servidor
- **WHEN** un servicio tiene `disponible: false` y `restante: 20`
- **THEN** con `solo_disponibles=true` NO aparece
- **AND** el filtro se aplica en la consulta, no en el consumidor

#### Scenario: Sin filtro se ve todo
- **WHEN** se pide `GET /api/servicios` sin `solo_disponibles`
- **THEN** aparecen también los apagados a mano, marcados
- **AND** el panel puede así mostrarle al dueño la carta entera con su estado

### Requirement: El asistente no ofrece lo que no hay

La tool `ver_catalogo` del agente SHALL listar en `servicios` únicamente lo que se puede vender ahora mismo. Los platos agotados del día SHALL viajar en una lista separada `agotados_hoy`, con el nombre solamente y sin precio.

La regla del SKILL "lo que no está en la lista, no existe" SHALL permanecer intacta y sin excepciones: `agotados_hoy` NO es una lista de la que se pueda ofrecer ni tomar pedido. Existe para que el asistente pueda decir "hoy se nos terminó" en vez de "no tenemos", que sería falso.

#### Scenario: El bot no ofrece un plato agotado
- **WHEN** el cliente pide una recomendación y el bife está agotado
- **THEN** el bife NO aparece entre los servicios ofrecidos

#### Scenario: El bot sabe decir que se terminó
- **WHEN** el cliente pregunta puntualmente por un plato que está en `agotados_hoy`
- **THEN** el asistente responde que hoy se terminó
- **AND** NO responde que el negocio no lo tiene
- **AND** NO promete reponerlo ni ofrece avisarle cuando haya

#### Scenario: Carta entera agotada
- **WHEN** todos los servicios del negocio están agotados
- **THEN** `servicios` viaja vacío con el aviso de que no hay nada disponible ahora
- **AND** el asistente NO inventa productos

### Requirement: El asistente avisa cuando queda poco

`ver_catalogo` SHALL incluir `restante` en un servicio únicamente cuando el plato lleva cuenta y queda poco. El umbral SHALL vivir en una constante con nombre (valor inicial `<= 3`), no en un literal suelto. NO SHALL ser configurable por negocio ni por entorno en este alcance: hacerlo ajustable es otro cambio. Un plato ilimitado o con stock holgado NO SHALL traer el campo.

Mismo criterio que `descripcion`: lo que no está cargado, ni aparece.

#### Scenario: Queda poco
- **WHEN** un servicio tiene `restante: 2`
- **THEN** el ítem viaja con `restante: 2` y el asistente puede decir cuántos quedan

#### Scenario: Stock holgado
- **WHEN** un servicio tiene `restante: 40`
- **THEN** el ítem NO trae el campo `restante`

#### Scenario: Ilimitado
- **WHEN** un servicio tiene `restante: null`
- **THEN** el ítem NO trae el campo `restante`
- **AND** el asistente NO afirma ni niega que haya cantidad limitada

### Requirement: El asistente lee stock fresco

`ver_catalogo` SHALL consultar el core en cada invocación. El catálogo NO SHALL servirse de un cache de sesión.

El stock es el dato volátil del catálogo; un cache por sesión rompe esta capacidad justo en el servicio lleno, que es donde importa. La garantía de cotizar con la cobertura correcta (H4) se mantiene porque la lectura fresca ya viaja con `cobertura_id`.

#### Scenario: El stock cambia a mitad de conversación
- **WHEN** el asistente listó el catálogo, el último bife se vendió, y el cliente vuelve a preguntar por la carta
- **THEN** la segunda lectura NO ofrece el bife

#### Scenario: El precio sigue saliendo de la cobertura del cliente
- **WHEN** el cliente tiene una cobertura con precio propio
- **THEN** cada lectura fresca cotiza con esa cobertura
- **AND** el precio que se le dice al cliente coincide con el que el core congela al crear el compromiso

### Requirement: La sobreventa la sigue impidiendo la base

Este cambio SHALL ser de lectura. El descuento transaccional del cupo al confirmar, la devolución al cancelar y el `CHECK (consumido <= asignado)` de `cupo_jornada` NO SHALL modificarse.

`ErrSinCupo` SHALL seguir siendo la última línea de defensa. Esta capacidad achica la ventana en que dos clientes ven el mismo último plato; no la cierra, y no debe presentarse como si lo hiciera.

#### Scenario: Dos clientes, un plato
- **WHEN** dos clientes ven el último plato al mismo tiempo y ambos confirman
- **THEN** el primero confirma
- **AND** el segundo recibe `ErrSinCupo` del core
- **AND** el cupo nunca queda con `consumido > asignado`
