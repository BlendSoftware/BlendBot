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

- [ ] 1.1 **BLOQUEANTE.** Confirmar que la imagen del core tiene tzdata: `docker compose exec core ls /usr/share/zoneinfo` o, si la base es `scratch`, que el binario se compile con `import _ "time/tzdata"`. Hoy compromisos localiza bien, así que la tzdata está por algún lado; hay que saber **por cuál**, porque el cambio la vuelve crítica para toda la API. Si depende de la base de la imagen, agregar el import embebido: una API entera que devuelve horas mal por un cambio de base es un precio desproporcionado frente a ~800 KB de binario.
- [ ] 1.2 Confirmar que `/api/admin/*` no expone ningún campo de hora hoy. Es el supuesto sobre el que se apoya la decisión §4 del design. Si alguno la expone, la decisión hay que rediscutirla antes de escribir código, no después.
- [ ] 1.3 Dejar registrada la medición de partida —los siete endpoints del `proposal.md`— como script reproducible, para poder correr el mismo comando al final y comparar. Sirve de evidencia del antes y del después.

## 2. El tipo `dto.Hora` (Go)

- [ ] 2.1 `core/internal/dto/hora.go`: el tipo con `t time.Time` y `loc *time.Location` privados, el constructor que exige location, y un `Zero`/`nil`-safe para los campos opcionales (`*Hora` donde hoy hay `*time.Time`).
- [ ] 2.2 `MarshalJSON`: falla con error nombrando el tipo si `loc == nil`; si no, `t.In(loc)` formateado RFC3339Nano. **Sin fallback a UTC** — es el corazón del cambio.
- [ ] 2.3 `UnmarshalJSON`: decidir y documentar. Un response no se deserializa en producción, pero los tests sí lo hacen. Que exista y parsee como instante, o que no exista y los tests comparen strings; lo que no puede es existir y perder el offset en silencio.
- [ ] 2.4 Tests unitarios del tipo. **El test que importa es el de 2.2**: serializar sin location devuelve error. Si ese test no existe, el cambio no tiene sentido.
- [ ] 2.5 Test: misma `Hora` con `TZ=UTC` y con `TZ=Europe/Madrid` en el proceso produce el mismo JSON.

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

## 5. Borrar lo que sobra (Go)

- [ ] 5.1 Eliminar `CompromisoResponse.EnTimezone` (`compromiso_dto.go:144`).
- [ ] 5.2 Eliminar `localizado()` (`motor_gastro.go:303`) y `locNegocio()` (`:312`), sus tres llamadas (`:114`, `:122`, `:175`) y el `EnTimezone` suelto del listado (`:135`), que es el único que no pasa por `localizado`.
- [ ] 5.3 Si `motor_gastro` ya no usa `m.negocios` para nada más, sacar la dependencia. Si la usa, dejarla y anotar para qué.
- [ ] 5.4 `go build ./... && go vet ./...` verdes.

## 6. Tests de verificación (dueño: agente de test)

- [ ] 6.1 Integración: los cuatro escenarios de "Toda hora que sale de la API está en la timezone del negocio", con un negocio en una TZ que **no** sea UTC ni la del CI. Una TZ con offset no entero (`Asia/Kolkata`, +05:30) es mejor test que una redonda: atrapa el bug de asumir horas enteras.
- [ ] 6.2 Integración: recorrer los siete endpoints medidos en el `proposal.md` y afirmar que ninguno devuelve `Z`. Es el antes/después del cambio, ejecutable.
- [ ] 6.3 Integración: dos negocios en husos distintos no se mezclan.
- [ ] 6.4 Integración: `negocio.timezone` inválida falla nombrando el negocio, no cae a UTC.
- [ ] 6.5 `scripts/smoke.sh`: un assert de que ninguna hora del flujo sale con `Z`. El smoke ya recorre el producto entero; es el lugar barato para que esto no se erosione.
- [ ] 6.6 Panel: un test sobre `horaDe` que fije el contrato desde el otro lado —dado un RFC3339 con offset, devuelve la hora de pared sin convertir—. Hoy el contrato está en un comentario; que esté en un test.
- [ ] 6.7 **Open question del design**: verificar si el agente (Python) mostraba horas corridas al leer `expira_en` de un hold o `creado_en` de una consulta. Un test que lo demuestre. Si estaba mal y ahora está bien, anotarlo; si hay que tocar el agente, es alcance nuevo y se propone aparte.

## 7. El guardián contra la regresión número ocho

- [ ] 7.1 Test que recorra por reflexión los structs de `internal/dto` y falle si un struct de **respuesta** expone `time.Time`/`*time.Time` en un campo con tag `json`. Debe nombrar campo y archivo, y decir qué usar en su lugar.
- [ ] 7.2 Distinguir request de response por la convención del repo (`...Input`/`...Request` entra, `...Response`/`...Resumen` sale). Lista de excepciones **vacía** al empezar; si hace falta una, va con su motivo escrito al lado.
- [ ] 7.3 Verificar que el test falla de verdad: agregar un `time.Time` a un response, ver el rojo, sacarlo. Un guardián que nunca se vio fallar no es un guardián.

## 8. Cierre

- [ ] 8.1 Correr la medición de 1.3 y pegar el antes/después en el `proposal.md`.
- [ ] 8.2 Anotar en `openspec/changes/lo-que-el-producto-promete/proposal.md` §3 que queda resuelto acá, y que el alcance real era seis endpoints, no uno.
- [ ] 8.3 `docs/ARQUITECTURA.md`: una línea sobre dónde vive la regla de timezone ahora, para que el próximo no la busque en `motor_gastro`.
