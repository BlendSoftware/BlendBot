> **Reparto**: los tres grupos son independientes y se pueden hacer en cualquier
> orden. Dentro del 2, el aviso va antes que el documento: no se promete en
> `FLUJOS.md` algo que todavía no existe.
>
> El grupo 0 ya está: lo cerró el cambio `la-hora-del-negocio`.

## 0. §3 — Las consultas en UTC

- [x] 0.1 ~~Localizar las consultas.~~ **RESUELTO en `la-hora-del-negocio`.** El hallazgo de este documento era correcto pero el alcance estaba corto: medidos los siete endpoints, **seis** salían en UTC. La causa no era el olvido sino su forma —localizar era opt-in— así que se invirtió el default con un tipo que no se puede serializar sin huso. De 6 mal / 3 bien a 0 mal / 9 bien.
- [x] 0.2 Confirmado lo que este documento decía del panel: `horaDe` estaba bien y no se tocó una línea. El bug estaba en el core.

## 1. §1 — Que el prompt diga la verdad sobre cuándo entra el pedido

- [x] 1.1 `SKILL.md` regla 3: dice que el pedido entra al panel **con `confirmar`**, no al armarlo. Se le agregó la contracara explícita: *"Nunca le digas al cliente que el local ya lo está viendo antes de llamar a `confirmar`"*, porque borrar la frase falsa no alcanza — el modelo necesita saber en qué momento la cocina lo ve para saber qué prometer.
- [x] 1.2 El diagrama de flujo corregido: `armar_compromiso` "arma el pedido y calcula el total (NO lo escribe todavía) · vive en esta conversación: la cocina no lo ve aún", y `confirmar(confirmado=true) → ENTRA AL PANEL`.
- [x] 1.3 `docs/FLUJOS.md`: corregido el diagrama y **sacada la frase que vendía el diferencial** (*"la cocina lo ve venir mientras el tipo todavía escribe"*). Era la promesa falsa, no un adorno. También la fila de la tabla de correcciones que decía "Entra apenas hay ítems".
- [x] 1.4 Queda escrito en `FLUJOS.md` por qué se corrigió el documento y no el código: persistir el borrador necesita expirar solo, distinguirse del pedido real en la cocina, y no contar en cierre / stock / reportes. Sin esas cinco cosas no cumple la promesa, muda el problema a la pantalla del cocinero.
- [x] 1.5 `SKILL.md` 1.4.0 → **1.5.0**.
- [x] 1.6 Prompt y tool ahora dicen lo mismo: el `"persistido": false` de `armar_compromiso` está citado en la regla 3 como respaldo, en vez de contradecirla.

## 2. §4 — El aviso de `listo`

- [x] 2.1 `AvisoPedidoListo` y `PedidoListo` en la interfaz `AvisadorPedido`.
- [x] 2.2 `worker`: texto según entrega — retira → *"Ya podés pasar a buscarlo por el local"*; delivery → *"Ya salió para tu dirección"*; cualquier otra cosa (incluido `en_local`) devuelve nil sin publicar, sin inventar una frase.
- [x] 2.3 `avisarListo` con las mismas tres reglas que `avisarConfirmacion` (sólo WhatsApp, sólo con teléfono, best-effort) y **sin exigir `DemoraMin`**, que es la diferencia deliberada: el texto no la usa, y copiar la condición dejaría mudo el aviso justo en los pedidos sin demora cargada.
- [x] 2.4 Cableado en `Transicionar`, al lado de `avisarConfirmacion`.
- [x] 2.5 12 casos verdes: avisa en retira y delivery, **no** avisa en `en_local`, ni sin entrega, ni por panel, ni sin teléfono; avisa sin demora; y un aviso roto no voltea la transición.
- [x] 2.6 `docs/FLUJOS.md`: promete **dos** avisos con el porqué al lado — `en_curso` y `entregado` no le cambian la conducta a nadie y cada mensaje se paga en la API de Meta.
- [x] 2.7 `SKILL.md` **regla 7**, agregada al final.

  **Hallazgo:** la primera versión la insertó como regla 2, corriendo la numeración. Eso habría roto en silencio al arnés, que referencia las reglas por número en sus informes de falla (`SKILL.md regla 2` en `arnes/README.md:266` y en el design de `arnes-tres-agentes`). La regla nueva va **al final** y 1–6 quedan intactas.

## 3. §2 — `ver_catalogo` con el nombre de la categoría

- [x] 3.1 `_servicio_visible` suma `categoria_nombre`; `categoria_id` se queda.
- [x] 3.2 `_categorias()` cachea el mapa **en la sesión**, y no contradice al catálogo que se lee fresco: lo que se mueve a mitad de conversación es el stock, no cómo se llaman los rubros. Verificado con un test que tres `ver_catalogo` producen **una** lectura de `/api/categorias`.
- [x] 3.3 Un plato sin categoría no trae el campo. En la carta de prueba las papas van sin categoría a propósito: el caso "no la cargaron" tiene que existir en el fixture base, no sólo en un test aparte.
- [x] 3.4 5 tests nuevos, 66 en total verdes. Incluye el degradado: si `/api/categorias` falla, la carta sale igual sin los nombres — quedarse sin agrupar es donde estábamos antes; tumbar la conversación sería peor.
- [x] 3.5 No se agrupa ni ordena del lado del agente: la agrupación es del modelo, la tool le da el dato que le faltaba.

## 4. Cierre

- [x] 4.1 `go build ./...`, `go vet ./...` y `go test ./...` verdes, incluidos e2e (54s) e integración (27s).
- [x] 4.2 `pytest` del agente: **66 verdes**.
- [x] 4.3 `proposal.md` con los cuatro puntos marcados y la decisión tomada escrita al lado.
