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

## Resultado

`medicion.sh` contra el stack corriendo, antes y después del cambio:

| campo | antes | después |
|---|---|---|
| `compromiso.creado_en` | `20:01:38-03:00` | `20:01:38-03:00` (ya estaba bien) |
| `consulta.creado_en` | **`23:22:38Z`** | `20:22:38-03:00` |
| `jornada.abierta_en` | **`23:01:38Z`** | `20:01:38-03:00` |
| `cliente.creado_en` | **`23:01:37Z`** | `20:01:37-03:00` |
| `cliente.ultimo_pedido` | **`23:16:38Z`** | `20:16:38-03:00` |
| `movimiento.creado_en` | **`23:16:38Z`** | `20:16:38-03:00` |
| `cobro.cobrado_en` | **`23:01:38Z`** | `20:01:38-03:00` |
| `negocio(admin).creado_en` | `Z` | `Z` — UTC **elegido** (design §4) |

De **6 mal / 3 bien** a **0 mal / 9 bien**. El script sale 0.

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
- `core/internal/dto/hora.go` — **nuevo**. El tipo `Hora`, su `MarshalJSON`, el constructor que exige location y `HoraUTC` para las rutas de plataforma.
- `core/internal/dto/negocio_dto.go` — `NegocioResponse` **nuevo**, para que `/api/admin/negocios` deje de serializar `model.Negocio` directo.
- `core/cmd/server/main.go` — `import _ "time/tzdata"`, para que la hora no dependa de la base de la imagen.
- `core/internal/dto/` — `cliente_dto.go`, `cobro_dto.go`, `consulta_dto.go`, `hold_dto.go`, `horario_dto.go` (sólo `ExcepcionResponse`), `insumo_dto.go`, `jornada_dto.go`, `lista_espera_dto.go`, `compromiso_dto.go`: los campos de respuesta pasan a `Hora`. Los DTOs de **request** quedan como están.
- `core/internal/middleware/` — **nuevo**. Resuelve `negocio.Timezone` una vez por request y lo deja en el contexto. Cuelga después del middleware de auth, que es el que ya sabe el `negocio_id`.
- `core/internal/service/motor_gastro.go` — `localizado()` y `locNegocio()` se van: su trabajo lo hace el middleware. Es la única eliminación de código del cambio.
- Sin migración. Sin cambios de esquema.

**Panel (TypeScript)**
- Nada. `formato.ts` ya asume este contrato; el cambio es que ahora se cumple en todos lados. Vale un test que fije el contrato desde el lado del panel para que no se erosione.

**Agente (Python)**
- A verificar, no a cambiar a ciegas: el agente lee holds y consultas, y repite horas en el chat. Si hoy dice una hora corrida, este cambio lo arregla sin tocarlo. Hay que confirmarlo con un test, no asumirlo.

**Evidencia**
- `openspec/changes/la-hora-del-negocio/medicion.sh` — **nuevo**. Recorre la API y reporta qué campo viaja en qué huso, distinguiendo rutas de negocio (deben ir en local) de rutas de plataforma (deben ir en UTC). Sale 1 mientras quede alguna de negocio en UTC. Línea de base al abrir el cambio: **6 mal, 3 bien**.

**Tests**
- Go: unitarios del tipo `Hora` (que `MarshalJSON` falle sin location es *el* test del cambio).
- Go: integración sobre los siete endpoints medidos arriba, con un negocio en una TZ que no sea UTC ni la del CI.
- Go: un test que recorra los DTOs de respuesta por reflexión y falle si alguno expone `time.Time` desnudo. Es lo que evita la regresión número ocho.
- `scripts/smoke.sh`: un assert de que ninguna hora de la API sale con `Z`.

**Riesgo conocido** *(los dos primeros ya se verificaron — ver `tasks.md` grupo 1)*
- ~~Los responses de admin no exponen horas.~~ **Falso, verificado.** `GET /api/admin/negocios` devuelve `creado_en` (medido en UTC) y `ConfigFiscalResponse` devuelve `actualizado_en`. La decisión §4 del design se rehízo: las rutas de plataforma van en UTC **elegido explícitamente** (`dto.HoraUTC`), porque son cross-tenant y rendir cada fila en su propio huso rompe el orden de lectura de la lista. Sale alcance nuevo: un `dto.NegocioResponse` para que admin deje de serializar `model.Negocio` directo.
- ~~Hay que verificar que la imagen tenga tzdata.~~ **Verificado: la tiene**, vía `apk add tzdata` en `core/Dockerfile:33`. Pero el binario **no** la embebe: `import _ "time/tzdata"` sólo está en 4 archivos de test. Eso significa que **ninguna suite puede detectar que la imagen se quedó sin tzdata**, porque los tests traen la suya. Se agrega el import al binario de producción (~450 KB sobre 34,7 MB).
- Queda vivo: `model.Servicio` se serializa directo al panel, sin DTO. Hoy no lleva horas, pero el test guardián del grupo 7 tiene que recorrer también los modelos que viajan crudos, o deja un agujero de la forma exacta del que encontró la verificación 1.2.
