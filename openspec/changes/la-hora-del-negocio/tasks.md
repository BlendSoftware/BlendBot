> **Reparto**: los grupos van casi en serie y eso es a propósito — cada uno
> depende del anterior. El único paralelizable es el 4: una vez que existen el
> tipo (grupo 2) y el middleware (grupo 3), los nueve DTOs se migran
> independientes entre sí, cada uno con su test de integración.
>
> El grupo 1 es **bloqueante y va primero**: si la imagen no tiene tzdata, todo
> lo demás construye sobre arena.
>
> El grupo 6 (el test de reflexión) va **último**. Escrito antes, es un muro
> rojo que no distingue avance de estancamiento.

## 1. Verificación previa — bloqueante

- [x] 1.1 **BLOQUEANTE.** ~~Confirmar de dónde sale la tzdata.~~ HECHO. Sale del **paquete del sistema**, no del binario: `core/Dockerfile:33` hace `apk add --no-cache ca-certificates tzdata` sobre `alpine:3.21`, y el contenedor tiene `/usr/share/zoneinfo/America/Argentina/`. El Dockerfile ya documenta que no es cosmético. **El binario NO la embebe**: `import _ "time/tzdata"` aparece sólo en 4 archivos de test (`e2e/main_test.go:28`, `integration/cobro_test.go:24`, `integration/anti_ausentismo_test.go:11`, `repository/cobro_repo_test.go:15`). Consecuencia incómoda: **los tests embeben su propia tzdata, así que ninguna suite puede detectar que la imagen se quedó sin ella.** Se cumple la condición para agregar el import embebido → tarea 1.4.
- [x] 1.2 **El supuesto era falso.** `/api/admin/*` **sí** expone horas, dos: `model.Negocio.CreadoEn` (medido: `GET /api/admin/negocios` devuelve `creado_en: 2026-08-31T22:51:05.938268Z`) y `ConfigFiscalResponse.ActualizadoEn` (`cobro_dto.go:185`, lo devuelven el `GET` y el `PUT` de `/api/admin/negocios/:id/fiscal`). La decisión §4 del design se rehízo entera: las rutas de plataforma van en **UTC elegido con `dto.HoraUTC`**, no en UTC por omisión. Sale alcance nuevo → tareas 4.10 y 4.11.
- [x] 1.3 Medición de partida como script reproducible: `openspec/changes/la-hora-del-negocio/medicion.sh`. Distingue rutas de negocio (deben ir en local) de rutas de plataforma (deben ir en UTC) y sale 1 si alguna de negocio todavía manda `Z`. **Línea de base: 6 mal, 3 bien.**
- [x] 1.4 **Sale de 1.1.** `import _ "time/tzdata"` agregado a `cmd/server/main.go`, con el porqué al lado. Comentario del `core/Dockerfile` actualizado: el `apk add tzdata` queda (sirve para `date` adentro del contenedor) pero deja de ser lo que sostiene la hora. **Costo real medido: 34,7 MB → 35,1 MB (+400 KB, 1,2%).**

  **Verificado, no supuesto.** Se levantó el core con `--tmpfs /usr/share/zoneinfo` (el sistema operativo sin una sola zona, `ls -A | wc -l` = 0) contra la base real:

  ```
  /health                → {"status":"ok"}
  compromiso.creado_en   → 2026-08-31T20:01:38.090494-03:00
  ```

  Localiza igual. Antes de este import, ese mismo contenedor habría devuelto `Z`.

## 2. El tipo `dto.Hora` (Go)

- [ ] 2.1 `core/internal/dto/hora.go`: el tipo con `t time.Time` y `loc *time.Location` privados, el constructor que exige location, y un `Zero`/`nil`-safe para los campos opcionales (`*Hora` donde hoy hay `*time.Time`).
- [ ] 2.2 `MarshalJSON`: falla con error nombrando el tipo si `loc == nil`; si no, `t.In(loc)` formateado RFC3339Nano. **Sin fallback a UTC** — es el corazón del cambio.
- [ ] 2.3 `UnmarshalJSON`: decidir y documentar. Un response no se deserializa en producción, pero los tests sí lo hacen. Que exista y parsee como instante, o que no exista y los tests comparen strings; lo que no puede es existir y perder el offset en silencio.
- [ ] 2.4 Tests unitarios del tipo. **El test que importa es el de 2.2**: serializar sin location devuelve error. Si ese test no existe, el cambio no tiene sentido.
- [ ] 2.5 Test: misma `Hora` con `TZ=UTC` y con `TZ=Europe/Madrid` en el proceso produce el mismo JSON.
- [ ] 2.6 **Sale de 1.2.** Constructor `HoraUTC(t)` para las rutas de plataforma. Que se llame así y no `NuevaHora(t, time.UTC)` es el punto: en el sitio de construcción tiene que leerse la decisión, no una location cualquiera que resulta ser UTC. Documentar en el godoc que es **sólo** para responses cross-tenant, con el porqué del design §4.

## 3. El middleware de timezone (Go)

- [ ] 3.1 Middleware nuevo que corre **después** del de auth: toma el `negocio_id` de los claims, lee el negocio, `time.LoadLocation`, deja el `*time.Location` en el contexto de gin.
- [ ] 3.2 `negocio_id` vacío (admin de plataforma) → no pone nada en el contexto y sigue. Sin error, sin default. Decisión §4.
- [ ] 3.3 `time.LoadLocation` falla → el request falla con un error que nombra el negocio y el valor de la columna. Nunca caer a UTC.
- [ ] 3.4 Cablearlo en `router.go` en el grupo correcto: todas las rutas de negocio, ninguna de `/api/admin/*`.
- [ ] 3.5 Test: una consulta a `negocio` por request, no una por response. Verificable contando queries o con un repo espía.

## 4. Migrar los DTOs de respuesta (Go) — paralelizable

> Uno por ítem, cada uno con su test de integración. El orden sugerido va del
> que tiene el bug confirmado al que sólo lo tiene por inspección.

- [ ] 4.1 `consulta_dto.go` — `creado_en`, `respondida_en`. Es el bug reportado en `lo-que-el-producto-promete` §3; cerrarlo primero y anotarlo allá.
- [ ] 4.2 `jornada_dto.go` — `abierta_en`, `cerrada_en`.
- [ ] 4.3 `cliente_dto.go` — `creado_en`, `ultimo_pedido`.
- [ ] 4.4 `cobro_dto.go` — `cobrado_en`, `emitido_en`, `actualizado_en`. **Ojo con `CAEVence`**: es `*string` `YYYY-MM-DD` y es una fecha fiscal de ARCA en su propio huso. Queda fuera del alcance y hay que documentarlo en el campo (design, Open Questions).
- [ ] 4.5 `insumo_dto.go` — `MovimientoResponse.creado_en`.
- [ ] 4.6 `hold_dto.go` — `inicio`, `fin`, `expira_en` del **response**. `CrearHoldInput` no se toca.
- [ ] 4.7 `horario_dto.go` — `ExcepcionResponse.desde/hasta`. `CrearExcepcionInput` no se toca. `HorarioResponse` usa `string` `"HH:MM"` y queda fuera: no es un instante.
- [ ] 4.8 `lista_espera_dto.go` — `creado_en`, `notificado_en`.
- [ ] 4.9 `compromiso_dto.go` — migrar al tipo nuevo. **No cambia el comportamiento**: ya salía localizado. Es lo que permite borrar `EnTimezone`.
- [ ] 4.10 **Sale de 1.2.** `dto.NegocioResponse` nuevo, con `creado_en` construido con `HoraUTC`. `admin_negocios.go:38` y `:84` dejan de serializar `model.Negocio` directo. No se toca `model.Negocio`: meterle `dto.Hora` invertiría la dependencia y haría ciclo (design §4).
- [ ] 4.11 **Sale de 1.2.** `ConfigFiscalResponse.ActualizadoEn` (`cobro_dto.go:185`) → `HoraUTC`. Es una ruta de plataforma aunque el DTO viva en `cobro_dto.go`.

## 5. Borrar lo que sobra (Go)

- [ ] 5.1 Eliminar `CompromisoResponse.EnTimezone` (`compromiso_dto.go:144`).
- [ ] 5.2 Eliminar `localizado()` (`motor_gastro.go:303`) y `locNegocio()` (`:312`), sus tres llamadas (`:114`, `:122`, `:175`) y el `EnTimezone` suelto del listado (`:135`), que es el único que no pasa por `localizado`.
- [ ] 5.3 Si `motor_gastro` ya no usa `m.negocios` para nada más, sacar la dependencia. Si la usa, dejarla y anotar para qué.
- [ ] 5.4 `go build ./... && go vet ./...` verdes.

## 6. Tests de verificación (dueño: agente de test)

- [ ] 6.1 Integración: los cuatro escenarios de "Toda hora que sale de la API está en la timezone del negocio", con un negocio en una TZ que **no** sea UTC ni la del CI. Una TZ con offset no entero (`Asia/Kolkata`, +05:30) es mejor test que una redonda: atrapa el bug de asumir horas enteras.
- [ ] 6.2 Integración: recorrer los endpoints de negocio medidos en el `proposal.md` y afirmar que ninguno devuelve `Z`. Es el antes/después del cambio, ejecutable.
- [ ] 6.2b **Sale de 1.2.** Integración sobre `/api/admin/*`: los cuatro escenarios del requirement de plataforma. Incluido el que importa —dos negocios en husos distintos dados de alta con diez minutos de diferencia se leen en el orden real— porque es el argumento que sostiene la decisión de usar UTC ahí.
- [ ] 6.3 Integración: dos negocios en husos distintos no se mezclan.
- [ ] 6.4 Integración: `negocio.timezone` inválida falla nombrando el negocio, no cae a UTC.
- [ ] 6.5 `scripts/smoke.sh`: un assert de que ninguna hora del flujo sale con `Z`. El smoke ya recorre el producto entero; es el lugar barato para que esto no se erosione.
- [ ] 6.6 Panel: un test sobre `horaDe` que fije el contrato desde el otro lado —dado un RFC3339 con offset, devuelve la hora de pared sin convertir—. Hoy el contrato está en un comentario; que esté en un test.
- [ ] 6.7 **Open question del design**: verificar si el agente (Python) mostraba horas corridas al leer `expira_en` de un hold o `creado_en` de una consulta. Un test que lo demuestre. Si estaba mal y ahora está bien, anotarlo; si hay que tocar el agente, es alcance nuevo y se propone aparte.

## 7. El guardián contra la regresión número ocho

- [ ] 7.1 Test que recorra por reflexión los structs de `internal/dto` y falle si un struct de **respuesta** expone `time.Time`/`*time.Time` en un campo con tag `json`. Debe nombrar campo y archivo, y decir qué usar en su lugar.
- [ ] 7.2 Distinguir request de response por la convención del repo (`...Input`/`...Request` entra, `...Response`/`...Resumen` sale). Lista de excepciones **vacía** al empezar; si hace falta una, va con su motivo escrito al lado.
- [ ] 7.2b **Sale de 1.2.** El test tiene que cubrir también los `model.*` que se serializan directo, no sólo `internal/dto`: `model.Servicio` ya viaja crudo al panel y `model.Negocio` viajaba así hasta 4.10. Recorrer sólo `dto` deja un agujero del tamaño exacto del bug que 1.2 encontró. Si cubrir `model` resulta inviable, la alternativa es prohibir serializar modelos directo — pero eso es alcance nuevo y se propone aparte, no se decide acá.
- [ ] 7.3 Verificar que el test falla de verdad: agregar un `time.Time` a un response, ver el rojo, sacarlo. Un guardián que nunca se vio fallar no es un guardián.

## 8. Cierre

- [ ] 8.1 Correr la medición de 1.3 y pegar el antes/después en el `proposal.md`.
- [ ] 8.2 Anotar en `openspec/changes/lo-que-el-producto-promete/proposal.md` §3 que queda resuelto acá, y que el alcance real era seis endpoints, no uno.
- [ ] 8.3 `docs/ARQUITECTURA.md`: una línea sobre dónde vive la regla de timezone ahora, para que el próximo no la busque en `motor_gastro`.
