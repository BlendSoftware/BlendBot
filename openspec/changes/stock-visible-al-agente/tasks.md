> **Reparto**: los grupos 1 y 2 se implementan en paralelo contra el contrato de
> `specs/stock-en-catalogo/spec.md` (backend Go y agente Python son dueños distintos
> y no se pisan archivos). El grupo 3 verifica lo de los dos. El grupo 4 audita.
> El grupo 2 puede escribirse contra el contrato antes de que el 1 esté mergeado,
> pero no se da por terminado hasta correr contra el core real.

## 1. Core — el catálogo expone el cupo (Go)

- [x] 1.1 ~~Auditar los llamadores de `solo_disponibles=true`.~~ HECHO: el agente es el único que lo pasa; el panel nunca lo manda; `ListDisponibles` no tiene llamadores de producción. Esa auditoría fue la que destapó que el estrechamiento del design §4 estaba mal.
- [x] 1.2 Sumar `Restante *int` y `Agotado bool` a la respuesta del servicio. **Corrección: `dto.ServicioCatalogo` no existe** — `catalogo_dto.go` tiene sólo DTOs de request y la respuesta es `[]model.Servicio` serializado directo. Van en `model.Servicio` con `gorm:"-"`, siguiendo el precedente de `PrecioEfectivo`. `Restante` sin `omitempty`, o `null` no llega.
- [x] 1.3 Verificar si `repository.CupoRepository.DeJornada` alcanza para la lectura en lote; si no, agregar el método de lectura agrupada por jornada. Una consulta por listado, nunca una por servicio (design §1).
- [x] 1.4 En el service que arma el catálogo: resolver la jornada abierta, leer los cupos en lote y mergear en memoria. Sin jornada abierta, todo `restante: null` / `agotado: false` y sin error (design §2).
- [x] 1.5 **REVERTIDO por auditoría.** `solo_disponibles=true` NO se estrecha: sigue filtrando sólo el interruptor manual, en el WHERE del repo. La respuesta filtrada igual trae `restante` y `agotado`, que es lo que deja al agente partir la lista en una lectura. Estrecharlo obligaba al agente a resignar el filtrado server-side de `disponible` — precio que no vale la pena. Ver el requirement corregido en el spec.
- [x] 1.6 `go build ./... && go vet ./...` verdes.

## 2. Agente — no ofrecer lo que no hay (Python)

- [x] 2.1 Eliminar el cache de catálogo de `_catalogo` (`agente/server.py:77`): `ver_catalogo` lee fresco siempre. Conservar el paso de `cobertura_id` en cada lectura (design §5).
- [x] 2.2 Partir la respuesta de `ver_catalogo` en `servicios` (vendibles) y `agotados_hoy` (sólo nombres, sin precio).
- [x] 2.3 En `_servicio_visible`: incluir `restante` únicamente cuando el plato lleva cuenta y `restante <= 3`. Umbral en una constante con nombre, no un literal suelto (design §6).
- [x] 2.4 Actualizar el docstring de `ver_catalogo`: `agotados_hoy` NO es una lista de la que se ofrece ni se toma pedido; sirve para decir "hoy se nos terminó" en vez de "no tenemos".
- [x] 2.5 `agente/skills/gastronomia/SKILL.md`: regla dura sobre agotados (no ofrecer, no prometer reposición, no ofrecer avisar cuando haya) + bump de versión.
- [x] 2.6 `_sin_encontrar()` dice "decile que eso no lo tienen" también para un plato agotado, si el cliente va derecho a `armar_compromiso` sin pasar por `ver_catalogo`. Es exactamente la frase falsa que el spec prohíbe. Darle un código propio (`"agotado"`) con el mensaje correcto, distinto del de un plato apagado o inexistente. **Hallazgo de la auditoría, no estaba en el plan original.**

## 3. Tests — verificación (dueño: agente de test)

- [x] 3.0 **BLOQUEANTE, hacer primero.** El harness de e2e (`core/tests/e2e/main_test.go`) nunca cableó los cupos: no tiene `cupoRepo`, ni `ConCupoEnCatalogo`, ni `ConControlDeCupos`, ni `CupoSvc` en `Deps`. Producción sí los tiene (`main.go:191` y `:200`). Consecuencia: **toda la feature de stock que ya está en main no tiene una sola línea de cobertura e2e sobre HTTP**, incluida la traducción de `ErrSinCupo` en `handler/compromisos.go:168`. Cablearlo antes de escribir cualquier test e2e, o 3.4 no puede pasar. **Hallazgo de la auditoría, es deuda anterior a este cambio.**

- [x] 3.1 Integración Go: los cinco escenarios de "El catálogo expone el cupo" (sin cupo, con stock, agotado, sin jornada abierta, tenant-scoped).
- [x] 3.2 Integración Go: los tres escenarios de "`solo_disponibles` filtra el interruptor manual, no el stock" — que el filtrado SÍ trae los agotados marcados, que el apagado a mano se filtra en el servidor, y que sin filtro se ve todo.
- [x] 3.3 Integración Go: que el listado resuelva el cupo en **una** consulta. Si no se puede aseverar el conteo, dejar un test con carta grande que falle si aparece el N+1.
- [x] 3.4 e2e Go: dos clientes contra el último plato — el primero confirma, el segundo recibe `ErrSinCupo`, y `consumido` nunca supera a `asignado`.
- [x] 3.5 pytest: `ver_catalogo` no lista agotados, los devuelve en `agotados_hoy` sin precio, y la carta entera agotada devuelve `servicios` vacío con aviso.
- [x] 3.6 pytest: `restante` aparece con `<= 3`, no aparece con stock holgado ni con ilimitado.
- [x] 3.7 pytest: segunda lectura ve el stock fresco (el escenario del cache). Revisar que ningún test existente dependa de que el catálogo venga cacheado; si alguno depende, se ajusta el test (design §5).
- [x] 3.8 `scripts/smoke.sh`: cargar cupo 1 → consumirlo confirmando → el catálogo filtrado lo trae marcado `agotado: true` / `restante: 0`. **El `null` del plato ilimitado se asevera sobre el cuerpo crudo, no con `val`**: un campo AUSENTE también se lee como null, y ese assert pasaba contra un core sin la feature.
- [x] 3.9 Suites completas verdes: `go test ./...`, `uv run pytest`, y el smoke contra el compose.

## 4. Auditoría (dueño: Claude)

- [x] 4.1 Revisar que el motor no se haya tocado: sin cambios en la máquina de estados, en el descuento transaccional ni en el `CHECK` de `cupo_jornada`.
- [x] 4.2 Confirmar que `restante: null` ≠ `restante: 0` sobrevive de punta a punta — base, DTO, JSON, agente — y que nadie comparó con `<= 0` en el camino.
- [x] 4.3 Verificar el escenario que el diseño admite que NO cierra: la ventana de carrera sigue existiendo y `ErrSinCupo` la cubre. Que ningún copy del panel ni del SKILL prometa lo contrario.
- [x] 4.4 Medir el costo del listado con carta grande. **Cubierto mejor que con un número**: el test `TestElCupoDelCatalogoSaleEnUnaSolaConsulta` graba el SQL real con un `logger.Interface` de GORM, carta de 50 platos todos con cupo, y exige exactamente 1 sentencia contra `cupo_jornada`. Un tiempo se degrada en silencio; un conteo de queries falla fuerte. El contador se validó sensible (7 llamadas → cuenta 7).
- [x] 4.5 Correr el recorrido del dueño en el navegador: cargar cupo 1, confirmar un pedido, ver el plato caer a agotado en la vista Stock.
