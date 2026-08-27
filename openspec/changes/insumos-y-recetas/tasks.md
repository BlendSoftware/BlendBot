> **Depende de `stock-visible-al-agente`.** Ese cambio deja montado el contrato
> (`restante` / `agotado` en el catálogo, el asistente respetándolo, la resolución
> del stock en una consulta agrupada). Acá se agrega una fuente más de la que puede
> salir ese número. No arrancar el grupo 3 hasta que el cambio anterior esté
> verificado, o se va a construir sobre un contrato que todavía se mueve.
>
> **Reparto**: grupos 1→2→3 son secuenciales (esquema, después dominio, después
> catálogo) y los hace el backend. El grupo 4 (panel) puede ir en paralelo desde
> que el grupo 2 fija los DTOs. El grupo 5 verifica. El grupo 6 audita.

## 1. Esquema (Go — migración 000008)

- [x] 1.1 Tabla `insumo`: id, negocio_id (FK), nombre, unidad (`g`|`ml`|`unidad`), stock, stock_minimo nullable, activo, creado_en, actualizado_en. `CHECK (stock >= 0)` — el árbitro es Postgres, mismo criterio que `cupo_no_sobrevendido` (design §5).
- [x] 1.2 Tabla `receta_item`: id, servicio_id (FK), insumo_id (FK), cantidad. `CHECK (cantidad > 0)`. Índice único `(servicio_id, insumo_id)`.
- [x] 1.3 Tabla `movimiento_insumo`: id, insumo_id (FK), tipo (`compra`|`consumo`|`devolucion`|`ajuste`), cantidad, saldo_resultante, compromiso_id nullable (FK), motivo nullable, creado_en. Índice por `(insumo_id, creado_en DESC)` para la vista de historia.
- [x] 1.4 Índices para el catálogo: lo que haga falta para traer en una consulta las recetas de toda la carta con el stock de sus insumos (design §8).
- [x] 1.5 Migración `down` que borre las tres tablas, con el comentario de que perder `movimiento_insumo` es perder la historia y sólo se corre si se abandona la feature.
- [x] 1.6 Comentarios en la migración al nivel de la 000007: cada decisión dice por qué está y qué se rompe si alguien la saca.

## 2. Dominio: insumos, recetas y movimientos (Go)

- [x] 2.1 `model/`: `Insumo`, `RecetaItem`, `MovimientoInsumo`. En `Insumo`, el método que decide si está bajo mínimo — sin mínimo cargado NUNCA marca (spec `insumos`).
- [x] 2.2 `repository/insumo_repo.go`: CRUD tenant-scoped + registrar movimiento. **Stock y movimiento siempre en la misma transacción**; que no exista un camino que escriba uno sin el otro (design §4).
- [x] 2.3 `repository/receta_repo.go`: CRUD de líneas, y la lectura en lote de las recetas de toda la carta con el stock de sus insumos (una consulta).
- [x] 2.4 `service/insumo_service.go`: altas, compra, ajuste. Rechazar cambio de unidad si el insumo ya está en alguna receta, explicando por qué (spec `insumos`).
- [x] 2.5 `service/receta_service.go`: alta y edición de líneas. Validar que el insumo sea del mismo negocio. Validar la exclusión receta ⊕ cupo manual en **los dos sentidos**, con un error que diga cuál sacar (design §2).
- [x] 2.6 El cálculo de porciones posibles: `min(floor(stock/cantidad))`, devolviendo también **cuál** insumo fue el limitante — es el `argmin` del mismo cálculo, sale gratis y lo necesita el panel (design §6).
- [x] 2.7 Receta vacía = sin receta (ilimitado), NO agotado. Apagar un plato porque alguien le vació la receta es el peor default posible.
- [x] 2.8 `dto/` y `handler/` para insumos, recetas y movimientos. Permisos: dueño escribe; dueño y operador leen.
- [x] 2.9 Cablear en el router y en la composition root.

## 3. Descuento al confirmar (Go)

- [x] 3.1 Generalizar la interfaz `cupoDescontador` de `core/internal/service/motor_gastro.go:41` para que el decorador descuente insumos o cupo según lo que tenga cada plato del pedido. **El motor de compromisos no se toca** (design, Context).
- [x] 3.2 Descuento transaccional: todo el pedido o nada. Copiar la disciplina de `cupoRepo.mover` — `UPDATE ... WHERE stock >= cantidad` con guarda propia y el `CHECK` como árbitro final (design §5).
- [x] 3.3 Multiplicar por las unidades pedidas de cada línea, no descontar una sola porción.
- [x] 3.4 Error de stock insuficiente que **nombra el insumo** que faltó, y traducirlo en el handler como ya se hace con `ErrSinCupo`.
- [x] 3.5 Devolución al cancelar, con movimientos `devolucion`. Anotar en el código la limitación conocida: si la cocina ya hizo el plato, devolver el stock miente en favor (design, Risks).
- [x] 3.6 Un pedido que mezcla plato con receta y plato con cupo aplica los dos controles en la misma confirmación.

## 4. Catálogo: la segunda fuente (Go)

- [x] 4.1 En el armado del catálogo, resolver `restante`/`agotado` con la precedencia del spec: receta → cupo manual → `null`.
- [x] 4.2 Una sola consulta agrupada para las recetas de toda la carta. Si aparece el N+1 sobre dos tablas, es un bug de este grupo (design §8).
- [x] 4.3 El insumo con receta NO depende de la jornada: un plato con receta calcula `restante` aunque la caja esté cerrada. El cupo manual sí sigue dependiendo (spec `recetas`, MODIFIED).
- [x] 4.4 Exponer el insumo limitante para que el panel pueda nombrarlo.
- [x] 4.5 `go build ./... && go vet ./...` verdes.

## 5. Panel (React)

- [x] 5.1 Pestaña Insumos dentro de Stock: listado con stock, unidad y marca de bajo mínimo.
- [x] 5.2 Alta de insumo y registro de compra. La unidad SIEMPRE visible al lado de cada campo de cantidad (design §3).
- [x] 5.3 Ajuste manual de stock con motivo.
- [x] 5.4 Historia de movimientos de un insumo, que deje responder "compré 20 kg, ¿por qué me quedan 3?".
- [x] 5.5 Editor de receta por plato en Carta, con la unidad del insumo al lado de la cantidad.
- [x] 5.6 En un plato agotado por receta, **nombrar el insumo limitante** con sus números. Es la mitigación del riesgo principal, no un adorno (design §6).
- [x] 5.7 Mostrar los insumos compartidos como dependencia, no como dos números que parezcan sumables (design §7).
- [x] 5.8 Copy rioplatense, al nivel del resto del panel. `tsc` y build verdes.

## 6. Tests (dueño: agente de test)

- [x] 6.1 Integración: los cuatro escenarios de `insumos` (alta, saldo cruzando el cierre del día, stock no negativo, tenant-scoped).
- [x] 6.2 Integración: unidad — rechazo de cambio de unidad con recetas vivas.
- [x] 6.3 Integración: movimientos — compra, consumo referenciando compromiso, y que un fallo no deje stock sin movimiento ni movimiento sin stock.
- [x] 6.4 Integración: exclusión receta ⊕ cupo en los dos sentidos.
- [x] 6.5 Integración: `min(floor())` — insumo más escaso manda, división no exacta da 3 y no 3.33, insumo en cero apaga, receta vacía es ilimitado.
- [x] 6.6 Integración: compra a mitad del servicio reactiva el plato sin cerrar la jornada.
- [x] 6.7 Integración: catálogo con receta y sin jornada abierta calcula igual; con cupo manual y sin jornada abierta es ilimitado.
- [x] 6.8 Integración: el listado resuelve las recetas de toda la carta sin N+1. Carta grande con recetas de varios insumos.
- [x] 6.9 e2e: pedido de 3 unidades descuenta 3; insumo insuficiente frena TODO el pedido sin descontar nada; cancelar devuelve; dos pedidos por lo último y el stock nunca queda negativo.
- [x] 6.10 e2e: pedido mezclando plato con receta y plato con cupo aplica los dos controles.
- [x] 6.11 vitest para las vistas nuevas del panel. 40 tests nuevos (213 en total), verificados con **mutation testing**: 25 mutaciones sembradas, 24 cazadas a la primera y 1 no — sacar el sufijo de unidad de cada línea de la receta pasaba TODO VERDE. Corregido. Se sumó además un test-guardián por suite que compara los imports reales de la vista contra lo que la suite mockea, para cerrar la trampa del mock con objeto literal.
- [x] 6.12 `scripts/smoke.sh`: insumo → receta → confirmar pedido → el insumo bajó y el plato se apagó solo.
- [x] 6.13 Suites completas verdes: `go test ./...`, `npm test` en panel, `uv run pytest`, y el smoke contra el compose.

## 7. Auditoría (dueño: Claude)

- [x] 7.1 Que el motor de compromisos no se haya tocado: sólo el decorador `motor_gastro.go`.
- [x] 7.2 Que no exista ningún camino que escriba stock sin movimiento. Rastrear todos los writes a `insumo.stock`.
- [x] 7.3 Que `restante: null` ≠ `restante: 0` sobreviva también por la fuente "receta", y que nadie haya comparado con `<= 0` en el camino nuevo.
- [x] 7.4 Que el negocio sin insumos cargados se comporte EXACTAMENTE como antes del cambio. Es la garantía de que el deploy no le cambia el comportamiento a nadie.
- [x] 7.5 Medir el catálogo con carta grande + recetas y dejar el número en el PR, comparado contra la medición de `stock-visible-al-agente`.
- [x] 7.6 Recorrido del dueño en el navegador: cargar insumo, cargar receta, confirmar un pedido, ver bajar el insumo, ver el plato apagarse, y ver que el panel nombra al insumo culpable.
- [x] 7.7 Verificar en el agente que no hizo falta tocar nada (la proposal lo asume; confirmarlo o corregir la proposal).
