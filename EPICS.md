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
| E1 | Core motor: repos + services + handlers + tests | **en curso** |
| E2 | Disponibilidad: huecos reales + agenda | pendiente |
| E3 | Panel API: auth endpoints, admin alta negocios, tablero, interruptor | dentro de E1/E2 |
| E4 | Agente MCP (Python FastMCP, 7 tools, SKILL.md salud) | pendiente |
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
