## ADDED Requirements

### Requirement: Toda hora que sale de la API está en la timezone del negocio

Cualquier campo de fecha u hora de un response de `/api/*` SHALL viajar en formato RFC3339 con el offset de la timezone del negocio dueño del dato, tomada de `negocio.timezone`.

La TZ del proceso, del contenedor o del sistema operativo NO SHALL influir en la hora que se serializa. Un core corriendo en UTC y uno corriendo en `America/Argentina/Buenos_Aires` SHALL producir byte por byte la misma respuesta para el mismo dato.

Esto aplica a todos los responses, sin lista de excepciones: compromisos, consultas, clientes, cobros, comprobantes, jornadas, holds, excepciones de horario, movimientos de insumo y lista de espera.

#### Scenario: Una consulta creada de noche no salta de día
- **WHEN** el negocio está en `America/Argentina/Buenos_Aires` y se crea una consulta a las 22:48 hora local (01:48 UTC del día siguiente)
- **THEN** `GET /api/consultas` devuelve `creado_en` con la parte de hora en `22:48` y offset `-03:00`
- **AND** la fecha es la del día en que el cliente preguntó, no la del día siguiente

#### Scenario: La hora no depende de dónde corre el core
- **WHEN** el mismo dato se sirve desde un proceso con `TZ=UTC` y desde uno con `TZ=Europe/Madrid`
- **THEN** las dos respuestas son idénticas

#### Scenario: Dos negocios en husos distintos
- **WHEN** dos negocios en `America/Argentina/Buenos_Aires` y `America/Argentina/Jujuy` tienen datos creados en el mismo instante
- **THEN** cada uno los ve con el offset de su propia timezone
- **AND** ninguno ve el offset del otro

#### Scenario: Ningún endpoint devuelve `Z`
- **WHEN** se recorren los endpoints de lectura de la API con un negocio cuya timezone no es UTC
- **THEN** ningún campo de hora del cuerpo termina en `Z`

### Requirement: Un response nuevo no puede omitir la timezone por descuido

Los campos de hora de los DTOs de **respuesta** SHALL usar el tipo `dto.Hora`, que lleva su `*time.Location` adentro. `time.Time` desnudo NO SHALL aparecer en un campo con tag `json` de un struct de respuesta.

`Hora.MarshalJSON` SHALL devolver error cuando no tiene location. NO SHALL caer a UTC, ni a la TZ del proceso, ni a un default de ninguna clase: un fallback silencioso es el bug que este requisito existe para hacer imposible.

Un test automatizado SHALL recorrer los structs de respuesta de `internal/dto` y fallar si alguno expone `time.Time` o `*time.Time` en un campo serializado, nombrando el campo y el archivo.

#### Scenario: Serializar sin location falla
- **WHEN** se serializa una `Hora` construida sin `*time.Location`
- **THEN** `MarshalJSON` devuelve error
- **AND** el error nombra el tipo, para que quien lo lea sepa qué le falta

#### Scenario: El test de reflexión atrapa un campo nuevo
- **WHEN** alguien agrega un campo `time.Time` con tag `json` a un struct de respuesta
- **THEN** el test falla nombrando ese campo y su archivo
- **AND** el mensaje dice qué usar en su lugar

#### Scenario: Los DTOs de request no se ven afectados
- **WHEN** el test de reflexión recorre `CrearCompromisoInput`, `CrearHorarioInput`, `CrearExcepcionInput` y demás structs de entrada
- **THEN** no los reclama: `time.Time` en un request es correcto

### Requirement: La timezone se resuelve una vez por request

La resolución de `negocio.timezone` a `*time.Location` SHALL ocurrir una sola vez por request, en un middleware que corre después de la autenticación, y SHALL viajar en el contexto.

Los services NO SHALL leer el negocio para resolver la timezone. Armar un response NO SHALL costar una consulta adicional a `negocio`.

#### Scenario: Un listado no paga consultas de timezone
- **WHEN** se piden 50 compromisos en un listado
- **THEN** la timezone se resuelve una vez, no una por compromiso ni una por listado además de la del middleware

#### Scenario: Timezone inválida en el negocio
- **WHEN** `negocio.timezone` tiene un valor que `time.LoadLocation` no reconoce
- **THEN** el request falla con un error que nombra el negocio y el valor
- **AND** NO se cae a UTC en silencio

### Requirement: Sin negocio en el contexto no se serializan horas

Cuando el request no tiene negocio asociado —las rutas de plataforma bajo `/api/admin/*`, donde el JWT del admin trae `negocio_id` vacío— el middleware NO SHALL poner location en el contexto.

Un response de esas rutas que intente serializar una `Hora` SHALL fallar. NO SHALL existir un fallback a UTC.

#### Scenario: El admin opera sin timezone y sin romperse
- **WHEN** el admin de plataforma llama a `GET /api/admin/negocios`
- **THEN** el request funciona normalmente
- **AND** no se resuelve ninguna timezone, porque la respuesta no expone horas

#### Scenario: Un response de admin con hora falla ruidosamente
- **WHEN** alguien agrega un campo `Hora` a un response de `/api/admin/*`
- **THEN** el endpoint falla en el primer test que lo serialice
- **AND** el error empuja a decidir a propósito en qué huso mostrar una hora que cruza negocios

### Requirement: Cómo entra la hora y cómo se guarda no cambian

Los DTOs de **request** SHALL seguir aceptando `time.Time` y SHALL seguir parseando cualquier offset RFC3339 válido, incluido `Z`, como un instante.

El almacenamiento SHALL seguir siendo `timestamptz` en UTC. Este cambio NO SHALL introducir migraciones ni cambios de esquema.

#### Scenario: Un hold pedido con offset y otro con Z son el mismo instante
- **WHEN** se piden dos holds para `2026-09-01T20:00:00-03:00` y `2026-09-01T23:00:00Z`
- **THEN** los dos representan el mismo instante y el segundo solapa con el primero

#### Scenario: El almacenamiento no cambia
- **WHEN** se aplica el cambio completo
- **THEN** no hay archivos nuevos en `core/migrations/`
- **AND** las filas existentes se siguen leyendo sin conversión
