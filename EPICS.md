# EPICS — plan de construcción del MVP consultorios (Fase 1 + 2 del roadmap)

Documento de coordinación entre agentes. Cada epic define alcance, dueños de
archivos y contratos. **Un agente sólo toca los archivos de su workstream.**

## Convenciones globales (no negociables)

- Módulo Go: `copiloto/core` en `core/`. Español en nombres de dominio.
- `decimal.Decimal` para plata, jamás float.
- **Multi-tenant**: todo método de repositorio tenant-scoped recibe `negocioID`
  explícito y filtra en la query. Jamás confiar en un `negocio_id` del request:
  sale del JWT (`middleware.NegocioID(c)`).
- Migraciones: golang-migrate puro, `core/migrations/`. CERO GORM AutoMigrate.
- Modelos con `TableName()` (tablas en singular).
- Errores explícitos, sin panic. Patrón handler/service/repository de BlendPos
  (referencia en `~/Proyectos/BlendPos/backend`).
- Transiciones de estado se validan en el core (`model.EstadoCompromiso`),
  nunca en el agente.
- Reglas del negocio clave: AUSENTE sólo aplica a tipo `turno` (vertical salud);
  precios se congelan en `linea_compromiso.precio_unit` al crear; `disponible=false`
  excluye el servicio de todo listado no-admin.
- Formato: gofmt. Comentarios escasos, sólo restricciones no evidentes.
- Verificación mínima antes de terminar: `cd core && go build ./... && go vet ./... && go test ./...`.

## Estado de epics

| Epic | Qué | Estado |
|---|---|---|
| E1 | Core motor: repos + services + handlers + tests | **✔ hecho** (commit ab3ec61, 23 tests verdes) |
| E2 | Disponibilidad + agenda + token de agente | **en curso** |
| E3 | Panel API: auth endpoints, admin alta negocios, tablero, interruptor | ✔ dentro de E1/E2 |
| E4 | Agente MCP (Python FastMCP, 7 tools, SKILL.md salud) | **en curso** |
| E5 | Gateway WhatsApp (Node, webhook, sesiones, outbox) | pendiente |
| E6 | Panel web (React: agenda, catálogo, profesionales, ficha) | pendiente |
| E7 | Anti-ausentismo (recordatorio 24h, liberación, lista de espera) | pendiente |
| E8 | Cobro + sidecar ARCA (Factura C) | pendiente |
| E9 | Compose integrado + smoke e2e | pendiente |

---

## E1 — Core motor

### Workstream A: catálogo, clientes, auth, admin (archivos propios)

`internal/repository/`: `negocio_repo.go`, `usuario_repo.go`, `recurso_repo.go`,
`categoria_repo.go`, `servicio_repo.go`, `cliente_repo.go`, `cobertura_repo.go`,
`audit_repo.go`.
`internal/service/`: `auth_service.go`, `negocio_service.go`,
`catalogo_service.go`, `cliente_service.go`, `audit_service.go`.
`internal/handler/`: `auth.go`, `admin_negocios.go`, `catalogo.go`, `clientes.go`.
`internal/dto/`: `auth_dto.go`, `catalogo_dto.go`, `cliente_dto.go`, `negocio_dto.go`.

Contratos (constructores estilo BlendPos `NewXRepository(db *gorm.DB)`):

- NegocioRepo: `Create(ctx, *model.Negocio)`, `GetByID(ctx, id)`,
  `GetByWaPhoneID(ctx, waPhoneID)`, `List(ctx)`, `Update(ctx, *model.Negocio)`
- UsuarioRepo: `Create(ctx, *model.Usuario)`, `GetByUsername(ctx, username)`, `GetByID(ctx, id)`
- RecursoRepo / CategoriaRepo / ServicioRepo / CoberturaRepo / ClienteRepo:
  CRUD tenant-scoped — todo método recibe `negocioID string` primero y filtra.
  ServicioRepo suma `SetDisponible(ctx, negocioID, id, disponible bool)` (el interruptor)
  y `ListDisponibles(ctx, negocioID)` (sólo activo+disponible, para el agente).
  ClienteRepo suma `GetByTelefono(ctx, negocioID, telefono)`.
  CoberturaRepo maneja también `precio_cobertura` (`PrecioDe(ctx, servicioID, coberturaID)`, `Upsert…`).
- AuthService: `Login(ctx, username, password) (TokensDTO, error)` — bcrypt,
  access+refresh JWT con claims de `middleware.JWTClaims` (incluye NegocioID, jti),
  `Refresh(ctx, refreshToken)`, `Logout(ctx, jti)` → set en redis `jwt:revoked:<jti>` con TTL.
- NegocioService (sólo rol admin): `Alta(ctx, dto)` crea negocio + usuario dueño
  inicial con `must_change_password=true`; `List`, `Update`, `Baja` (soft: activo=false).
- Cada handler expone `func Register(rg *gin.RouterGroup, deps …)`. **NO tocar
  `internal/router/router.go`** — lo integra el orquestador.

Endpoints:
```
POST /api/auth/login · POST /api/auth/refresh · POST /api/auth/logout
GET/POST/PATCH /api/admin/negocios            (RequireRole admin)
GET  /api/servicios?categoria=&solo_disponibles=
POST /api/servicios · PATCH /api/servicios/:id
PATCH /api/servicios/:id/disponible           {"disponible": bool}
GET/POST/PATCH /api/categorias · /api/recursos · /api/coberturas
GET  /api/clientes/por-telefono/:tel · POST/PATCH /api/clientes
```

### Workstream B: el motor (archivos propios)

`internal/repository/`: `compromiso_repo.go`, `hold_repo.go`, `horario_repo.go`
(horario + excepcion).
`internal/service/`: `motor_service.go`, `hold_service.go`.
`internal/handler/`: `compromisos.go`, `holds.go`, `horarios.go`.
`internal/dto/`: `compromiso_dto.go`, `hold_dto.go`, `horario_dto.go`.

Contratos:

- CompromisoRepo: `Create(ctx, *model.Compromiso)` (con líneas, en tx),
  `GetByID(ctx, negocioID, id)` (preload Lineas),
  `ListTablero(ctx, negocioID, estados []model.EstadoCompromiso, desde, hasta *time.Time)`,
  `UpdateEstado(ctx, negocioID, id, …)` — update condicional `WHERE estado = <actual>`
  para no pisar transiciones concurrentes,
  `ListPorRecurso(ctx, negocioID, recursoID, desde, hasta)` (estados no terminales).
- HoldRepo: `Create`, `Delete(ctx, id, sesion)`, `ListVigentes(ctx, recursoID, desde, hasta, ahora)`,
  `DeleteExpirados(ctx, ahora)`.
- MotorService:
  - `Crear(ctx, negocioID, dto)`: valida servicios existentes+disponibles del
    tenant, congela `precio_unit` (precio por cobertura del cliente si existe,
    si no `precio_base`), calcula total, estado inicial `pendiente`. D7: entra
    incompleto al panel apenas hay líneas.
  - `Transicionar(ctx, negocioID, id, nuevo model.EstadoCompromiso, opts)`:
    valida con `PuedeTransicionarA`; `ausente` sólo si tipo==turno; setea
    `confirmado_en`/`cerrado_en`/`demora_min`/`recurso_id` según transición.
    Devuelve `ErrTransicionInvalida` si no.
  - Al crear con `inicio/fin/recurso`: valida no-solape contra compromisos
    activos y holds vigentes de ese recurso (excepto el hold de la misma sesión).
- HoldService: `Crear(ctx, negocioID, recursoID, inicio, fin, sesion)` — valida
  solape (holds vigentes + compromisos), expira a `ahora + config hold_minutos`
  (leer de `negocio.config`, default 10); `Liberar`; limpieza lazy de expirados.
- Errores sentinel en `internal/service/motor_errors.go`:
  `ErrTransicionInvalida`, `ErrNoDisponible`, `ErrSolapado`, `ErrNoEncontrado`.
  Handlers los mapean: 409, 422, 409, 404.

Endpoints:
```
POST  /api/compromisos
GET   /api/compromisos?estado=&desde=&hasta=
GET   /api/compromisos/:id
PATCH /api/compromisos/:id/estado    {"estado": "...", "demora_min": n, "recurso_id": "..."}
POST  /api/holds · DELETE /api/holds/:id
GET/POST/DELETE /api/recursos/:id/horarios · /api/recursos/:id/excepciones
```

### Workstream C: tests (archivos propios)

`core/tests/` completo + `*_test.go` nuevos (sin tocar código de producción).

- Harness testcontainers (patrón BlendPos, deps ya en ecosistema): postgres:16-alpine
  + migraciones vía golang-migrate (`file://../../migrations`) + `*gorm.DB`.
  Helper en `tests/testutil/db.go`.
- Tests de integración contra los contratos de A y B (escribirlos contra las
  firmas de ESTE documento):
  - **Aislamiento de tenant**: negocio A no puede leer/tocar compromisos,
    servicios ni clientes de negocio B por ningún método de repo. Es EL test
    del producto.
  - Máquina de estados vía MotorService: pendiente→confirmado→en_curso→completado
    ok; pendiente→completado rechazado; ausente en pedido rechazado, en turno ok.
  - Holds: dos holds solapados sobre el mismo recurso → el segundo falla;
    hold expirado no bloquea; el hold de la propia sesión no bloquea confirmar.
  - Precio congelado: cambiar `precio_base` después de crear no altera la línea.
  - Interruptor: `disponible=false` → `Crear` compromiso con ese servicio falla
    y `ListDisponibles` no lo lista.
  - Unicidad `(negocio_id, telefono)` de cliente.
- Si una firma de A/B no existe aún al compilar, dejarla igual según contrato:
  la integración la reconcilia el orquestador.

### Integración (orquestador)

Cablear `router.go` con todos los `Register`, resolver drift de firmas,
`go build && go vet && go test`, commit convencional.

---

## E2 — Disponibilidad, agenda y token de agente (Go)

### Workstream W2-A: código (archivos propios)

- `core/migrations/000002_token_agente.up.sql` / `.down.sql`:
  `ALTER TABLE negocio ADD COLUMN token_agente_hash TEXT;` + índice único parcial.
- `internal/middleware/agent_auth.go`: **AutenticacionDual(cfg, rdb, buscarPorTokenHash)**.
  Un solo middleware que reemplaza a JWTAuth en el grupo protegido: si el Bearer
  empieza con `cop_` → sha256(token) contra `negocio.token_agente_hash`, setea
  claims `{Rol: "agente", NegocioID: <id>}`; si no → validación JWT idéntica a la
  actual (reusar la lógica, no duplicarla: extraé lo común). Rol nuevo
  `RolAgente = "agente"` en auth.go (solo la const, no toques el resto).
- `internal/repository/disponibilidad_repo.go`: lecturas para el cálculo
  (horarios por recurso y día, excepciones en rango, compromisos no terminales
  en rango, holds vigentes en rango, recursos vinculados a servicio vía
  `servicio_recurso` — si el servicio no tiene vínculos, todos los recursos
  activos tipo profesional del tenant).
- `internal/service/disponibilidad_service.go`:
  `Consultar(ctx, negocioID, dto) (*dto.HuecosResponse, error)` — algoritmo:
  para cada día en `[desde, desde+dias)` (default hoy, 7 días, máx 30) en la
  **timezone del negocio**; por recurso: intersecar horarios del día − excepciones
  − compromisos − holds vigentes; slots de `servicio.duracion_min` (requerido: si
  es NULL → ErrSinDuracion 422) con paso = duración; máx 50 huecos en total, en
  orden cronológico. Servicio inexistente/no disponible → ErrNoDisponible.
  `AgendaDelDia(ctx, negocioID, fecha) (*dto.AgendaResponse, error)`: por recurso
  activo: horarios de ese día de semana, compromisos del día (no cancelados/rechazados)
  con cliente (nombre, telefono) preloadeado, ordenados por inicio.
- `internal/service/negocio_token_service.go`: `RotarTokenAgente(ctx, negocioID)`
  genera `cop_` + 32 bytes urlsafe, guarda sha256 hex, devuelve el token UNA vez.
- `internal/handler/disponibilidad.go` (`POST /disponibilidad/consultar`,
  `GET /agenda?fecha=`), `internal/handler/negocio_datos.go`
  (`GET /negocio` → nombre, vertical, timezone, config, coberturas — la tool
  `datos_del_negocio` del agente lee esto). Handler admin: agregar en archivo
  propio `internal/handler/admin_token.go` → `POST /:id/token-agente` (se monta
  en el grupo admin existente).
- `internal/dto/disponibilidad_dto.go`, `negocio_datos_dto.go`.
- Register como método (convención E1). **NO tocar router.go/main.go** (cablea
  el orquestador) ni archivos de E1 salvo la const RolAgente.

### Workstream W2-B: agente MCP (Python, `agente/` — todo tuyo)

`agente/` nuevo: `pyproject.toml` (uv, python 3.12, fastmcp, httpx, pydantic,
pydantic-settings), `server.py`, `core_client.py`, `settings.py`,
`skills/salud/SKILL.md`, `VERSION`, `tests/` (pytest + respx).
Patrón de referencia: ~/Proyectos/Skill-Moodle/mcp/server.py (FastMCP, tools
tipadas, confirmado=True).

Las 7 tools (contra la API del core por HTTP, `Authorization: Bearer $AGENTE_TOKEN`,
base `$CORE_URL`):
- `datos_del_negocio()` → GET /api/negocio
- `ver_catalogo(categoria=None)` → GET /api/servicios?solo_disponibles=true — jamás lista disponible=false
- `consultar_disponibilidad(servicio, desde=None, recurso=None)` → resuelve servicio por nombre (fuzzy sobre el catálogo) → POST /api/disponibilidad/consultar
- `armar_compromiso(lineas, entrega=None)` → arma borrador LOCAL (no persiste): resuelve servicios por nombre, calcula total desde el catálogo, devuelve resumen + advertencia de que falta confirmar
- `bloquear(recurso, inicio, fin)` → POST /api/holds (sesion = número del cliente, viene por env/contexto de sesión `CLIENTE_TELEFONO`)
- `confirmar(compromiso_borrador, confirmado=False)` → si confirmado=False devuelve el resumen y pide confirmación; si True: POST /api/clientes por-telefono (obtener o crear) + POST /api/compromisos + PATCH estado→confirmado si la política del negocio (config.confirmacion.turno=="automatica") lo permite; si es "humana" lo deja pendiente y avisa
- `cancelar(compromiso_id, motivo, confirmado=False)` → PATCH estado→cancelado
Errores del core → mensajes útiles para el modelo (409 solapado → "ese hueco se acaba de ocupar, ofrecé otro").
`SKILL.md` salud: prompt del agente conversacional — reglas no negociables de
ARQUITECTURA.md (nunca inventa precio/demora, nunca consejo clínico, deriva
síntomas a consulta, confirmación en dos pasos, tono cálido rioplatense neutro
profesional). Estructura: identidad → flujo de turno → herramientas → reglas → ejemplos.
Tests: unit de core_client (respx mockea el core), de resolución fuzzy de
servicios, y de la máquina confirmado=False/True.

### Workstream W2-C: tests e2e HTTP (Go, archivos propios)

`core/tests/e2e/*_test.go` (paquete nuevo; el harness testutil ya existe):
- Levantar el router REAL (router.New con deps sobre la DB de testcontainers +
  miniredis o redis real de testcontainers — elegí lo más simple que ande) y
  pegarle por httptest.
- Flujo completo consultorio: bootstrap admin (INSERT directo) → login admin →
  alta negocio → login dueño (password temporal) → cambiar password → crear
  cobertura/servicio (duracion 30)/recurso/horario → consultar disponibilidad
  (huecos correctos en TZ Mendoza) → hold → crear compromiso turno →
  confirmar → tablero lo muestra → completado.
- Token de agente: rotar token como admin → GET /api/negocio con cop_ token OK →
  con token trucho 401 → el token de negocio A no lee /api/servicios de B (crear
  dos negocios).
- Auth: sin token 401, dueño no accede a /api/admin 403, refresh y logout
  (token revocado → 401).
- Si W2-A aún no aterrizó cuando empieces, escribí contra este contrato y anotá
  lo que no compile.
