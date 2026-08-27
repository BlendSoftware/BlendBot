## Why

La vista Stock del panel promete, textual: *"Cuántas porciones quedan de cada plato. Lo que llega a cero deja de ofrecerse en WhatsApp solo."* **Hoy eso es falso.** El cupo de la Capa 1 (`cupo_jornada`, migración 000007) se descuenta bien al confirmar y Postgres impide la sobreventa, pero el agente nunca se entera: pide el catálogo con `solo_disponibles=true`, que filtra únicamente por el interruptor manual `servicio.disponible`, y ni `dto.ServicioCatalogo` ni `_servicio_visible` (`agente/server.py:243`) exponen el estado del cupo.

El resultado es el peor orden posible de los eventos: el bot ofrece un plato agotado, el cliente lo pide, arma el pedido, y recién ahí el local intenta confirmarlo y el core devuelve `ErrSinCupo`. El cliente ya se ilusionó y alguien tiene que salir a explicarle. El dueño cargó el cupo justamente para que eso no pasara.

Va ahora porque es el prerrequisito de todo lo que viene: cualquier control de stock más fino (insumos, recetas) es inútil mientras el bot siga ofreciendo lo que no hay.

## What Changes

- `GET /api/servicios` suma dos campos por servicio: `restante` (porciones que quedan hoy) y `agotado` (booleano). Ambos derivan de la jornada **abierta**; un servicio sin fila de cupo es ilimitado y viaja con `restante: null, agotado: false`. Sin jornada abierta, todo es ilimitado — no se inventa un día.
- El parámetro `solo_disponibles=true` pasa a significar **disponible Y no agotado**. Es el único cambio de comportamiento de un contrato existente, y es exactamente lo que el nombre del parámetro ya prometía.
- `_servicio_visible` en el agente propaga `restante` cuando el plato está por terminarse, para que el bot pueda decir "quedan 2" en vez de callarse.
- El `SKILL.md` de gastronomía suma la regla dura: lo que no está en `ver_catalogo` no existe; nunca ofrecer un plato agotado ni prometer reponerlo.
- **No BREAKING**: agregar campos a la respuesta es aditivo, y el estrechamiento de `solo_disponibles` alinea el comportamiento con lo que el panel ya promete al dueño. El motor de compromisos no se toca: `ErrSinCupo` sigue siendo la última línea de defensa contra la carrera entre dos clientes pidiendo el último plato a la vez.

## Capabilities

### New Capabilities
- `stock-en-catalogo`: el cupo del día visible en el catálogo y respetado por el asistente, de modo que un plato agotado deje de ofrecerse antes de que el cliente lo pida.

### Modified Capabilities
<!-- Ninguna: no hay specs previas en openspec/specs/. El contrato de catálogo y el del agente se capturan enteros dentro de la capability nueva. -->

## Impact

**Core (Go)**
- `core/internal/dto/catalogo_dto.go` — `restante *int` y `agotado bool` en la respuesta del servicio.
- `core/internal/service/` — el armado del catálogo consulta `CupoRepository` por la jornada abierta y aplica el filtro de agotados. Una sola consulta por listado, no una por plato.
- `core/internal/repository/cupo_repo.go` — método de lectura en lote por jornada (ya existe `DeJornada`; verificar que alcance).
- Sin migración. Sin cambios de esquema.

**Agente (Python)**
- `agente/server.py` — `_servicio_visible` y el docstring de `ver_catalogo`.
- `agente/skills/gastronomia/SKILL.md` — regla y bump de versión.

**Tests**
- Go: integración (catálogo con cupo en cero no lista el plato; sin jornada abierta todo ilimitado; tenant-scoped) y e2e.
- Python: pytest sobre `ver_catalogo` con agotados.
- `scripts/smoke.sh`: un assert que recorra cargar cupo 1 → consumirlo → el catálogo ya no lo ofrece.

**Riesgo conocido**
- Costo por listado: el catálogo pasa a tocar `cupo_jornada`. Se mitiga con una sola consulta agrupada por jornada y el índice `idx_cupo_negocio` que ya existe.
- El agente cachea el catálogo en la sesión (`s.catalogo`). Si el cupo cambia a mitad de conversación, el bot puede estar leyendo datos viejos. Hay que decidir en `design.md` si el cache se invalida o si se acepta y `ErrSinCupo` cubre el hueco.
