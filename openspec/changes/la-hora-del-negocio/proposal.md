## Why

`lo-que-el-producto-promete` §3 reportó que las consultas se muestran en UTC: una pregunta hecha 22:48 en Mendoza se ve **01:48**. El diagnóstico de allá es correcto pero **se quedó corto**: no es un endpoint olvidado, es que localizar la hora es *opcional* y casi nadie lo hace.

`EnTimezone` existe una sola vez, como método de `CompromisoResponse` (`dto/compromiso_dto.go:144`), y se llama desde dos lugares, los dos en `motor_gastro.go` (`:135` y `:308`). **Ningún otro response de la API pasa por ahí.** Medido contra el sistema corriendo, con el negocio en `America/Argentina/Buenos_Aires` y el reloj de pared en 20:33:

```
compromiso.creado_en     2026-08-31T20:01:38-03:00     ← el único bien
consulta.creado_en       2026-08-31T23:22:38Z
jornada.abierta_en       2026-08-31T23:01:38Z
cliente.creado_en        2026-08-31T23:01:37Z
cliente.ultimo_pedido    2026-08-31T23:16:38Z
movimiento.creado_en     2026-08-31T23:16:38Z
cobro.cobrado_en         2026-08-31T23:01:38Z
```

Seis de siete mal. Y la lista de DTOs de respuesta con timestamps es más larga que lo medido: `HoldResponse` (`inicio`, `fin`, `expira_en`), `ExcepcionResponse` (`desde`, `hasta`), `ComprobanteResponse` (`emitido_en`), `ListaEsperaResponse` (`creado_en`, `notificado_en`). Todos salen en la TZ del proceso, que en el contenedor es UTC.

El panel no está roto y no hay que tocarlo. `formato.ts` documenta el contrato en su primera línea —*"el core ya las mandó en la hora del negocio"*— y `horaDe` (`:28`) corta el string con una regex justamente para no hacer aritmética de husos en el navegador. El contrato está bien; el core lo cumple en un solo lugar de siete.

Lo que hace que esto **no** se arregle con seis llamadas a `EnTimezone` es la forma del defecto: localizar es opt-in. Un response nuevo nace en UTC y nadie se entera hasta que un dueño mira la pantalla a la hora equivocada. Arreglar los seis de hoy deja intacta la razón por la que hubo seis.

## What Changes

- **Un tipo que no se puede serializar mal.** Los timestamps de los DTOs de respuesta pasan de `time.Time` a `dto.Hora`, que lleva su `*time.Location` adentro y cuyo `MarshalJSON` **falla** si no lo tiene. Olvidarse de localizar deja de producir una hora corrida en silencio y pasa a producir un error ruidoso, en el primer test que toque ese endpoint.
- **La timezone se resuelve una vez por request, en un middleware**, y viaja en el contexto. Hoy `locNegocio` (`motor_gastro.go:313`) lee el negocio de la base **en cada respuesta**: listar compromisos cuesta una consulta extra por listado. Resolverlo en el middleware lo baja a una por request y saca del camino a los services, que no tienen por qué conocer la config del negocio para poder contestar.
- **Los requests no se tocan.** Un `inicio` que llega con `-03:00` o con `Z` se sigue parseando como instante. Este cambio es sobre cómo sale la hora, no sobre cómo entra.
- **El almacenamiento no cambia.** Postgres sigue guardando `timestamptz` en UTC, que es lo correcto. Sin migración.
- **No BREAKING para el panel.** Los compromisos ya viajaban localizados y van a seguir igual; los otros seis empiezan a llegar bien, que es lo que `formato.ts` ya asumía. Un consumidor que estuviera compensando el UTC a mano sí se rompe — no hay ninguno: el panel no compensa y el agente lee horas para repetirlas, no para hacer cuentas.

## Capabilities

### New Capabilities
- `hora-local`: toda hora que sale de la API está expresada en la timezone del negocio, y un endpoint nuevo no puede omitirlo por descuido.

### Modified Capabilities
<!-- Ninguna. `stock-en-catalogo` no expone timestamps. El contrato de compromisos no cambia: ya cumplía. -->

## Impact

**Core (Go)**
- `core/internal/dto/hora.go` — **nuevo**. El tipo `Hora`, su `MarshalJSON` y el constructor que exige location.
- `core/internal/dto/` — `cliente_dto.go`, `cobro_dto.go`, `consulta_dto.go`, `hold_dto.go`, `horario_dto.go` (sólo `ExcepcionResponse`), `insumo_dto.go`, `jornada_dto.go`, `lista_espera_dto.go`, `compromiso_dto.go`: los campos de respuesta pasan a `Hora`. Los DTOs de **request** quedan como están.
- `core/internal/middleware/` — **nuevo**. Resuelve `negocio.Timezone` una vez por request y lo deja en el contexto. Cuelga después del middleware de auth, que es el que ya sabe el `negocio_id`.
- `core/internal/service/motor_gastro.go` — `localizado()` y `locNegocio()` se van: su trabajo lo hace el middleware. Es la única eliminación de código del cambio.
- Sin migración. Sin cambios de esquema.

**Panel (TypeScript)**
- Nada. `formato.ts` ya asume este contrato; el cambio es que ahora se cumple en todos lados. Vale un test que fije el contrato desde el lado del panel para que no se erosione.

**Agente (Python)**
- A verificar, no a cambiar a ciegas: el agente lee holds y consultas, y repite horas en el chat. Si hoy dice una hora corrida, este cambio lo arregla sin tocarlo. Hay que confirmarlo con un test, no asumirlo.

**Tests**
- Go: unitarios del tipo `Hora` (que `MarshalJSON` falle sin location es *el* test del cambio).
- Go: integración sobre los siete endpoints medidos arriba, con un negocio en una TZ que no sea UTC ni la del CI.
- Go: un test que recorra los DTOs de respuesta por reflexión y falle si alguno expone `time.Time` desnudo. Es lo que evita la regresión número ocho.
- `scripts/smoke.sh`: un assert de que ninguna hora de la API sale con `Z`.

**Riesgo conocido**
- El middleware necesita el `negocio_id`, que sale del JWT. Las rutas de `/api/admin/*` operan sobre la plataforma y no tienen negocio: ahí no hay TZ que resolver y los responses de admin no exponen horas. Hay que decidir explícitamente qué hace el middleware en ese caso en vez de dejarlo pasar de casualidad — está en `design.md` §4.
- `time.LoadLocation` necesita la tzdata. El `Dockerfile` del core tiene que tenerla o `LoadLocation` falla en runtime; hoy funciona, así que está, pero el cambio la vuelve crítica para **toda** la API y no sólo para compromisos. Verificarlo es una tarea, no un supuesto.
