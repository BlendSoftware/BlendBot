# EPICS — plan de construcción del MVP (Fase 1 + 2 del roadmap)

> **Pivote (21/08/2026):** el producto quedó enfocado exclusivamente en
> **gastronomía**; el vertical salud/consultorios se discontinúa como oferta
> comercial (ver D21 en `docs/DECISIONES.md`). Las epics E1–E9 documentan cómo
> se construyó el motor genérico —probado primero contra el piloto de
> consultorio, que ya no es el plan de negocio— y **E10 (gastronomía) es la
> única línea de producto activa**. El core Go sigue siendo genérico (soporta
> el vertical `salud` a nivel de datos) por decisión arquitectónica; esto no
> cambia ese código ni sus tests.

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
| E2 | Disponibilidad + agenda + token de agente | **✔ hecho** (commit 289b096) |
| E3 | Panel API: auth endpoints, admin alta negocios, tablero, interruptor | ✔ dentro de E1/E2 |
| E4 | Agente MCP (Python FastMCP, 7 tools, SKILL.md salud) | **✔ hecho** (33 pytest) |
| E5 | Gateway WhatsApp (Node, webhook, sesiones, outbox) | **✔ hecho** (108 tests) |
| E6 | Panel web (React: agenda, catálogo, profesionales, ficha) | **✔ hecho** (38 tests) |
| E7 | Anti-ausentismo (recordatorio 24h, liberación, lista de espera) | **✔ hecho** (migración 000003, workers, hook y endpoints cableados) |
| E8 | Cobro + sidecar ARCA (Factura C) | **✔ hecho** (commit 4e67b3e) |
| E9 | Compose integrado + smoke e2e + revisión final | **en curso** |

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

---

## E5 — Gateway WhatsApp (Node, `gateway/` — W3-A)

Patrón de wa-claude SIN Baileys: webhook Cloud API + Agent SDK + MCP.

- `package.json` (node >=20, type module; deps: express, @anthropic-ai/claude-agent-sdk, redis; dev: vitest, supertest). `src/`:
  - `config.js` — env: PORT(8090), REDIS_URL, META_APP_SECRET, META_VERIFY_TOKEN, META_GRAPH_TOKEN, CORE_URL, TENANTS_PATH (default ./tenants.json), SESIONES_DIR (default ./data/sesiones), ANTHROPIC_API_KEY, MODELO (default claude-haiku-4-5-20251001)
  - `tenants.js` — carga tenants.json: `{ "<phone_number_id>": {"negocio": "...", "agente_token": "cop_...", "vertical": "salud", "wa_numero": "..."} }` + `tenants.example.json`
  - `firma.js` — verificación X-Hub-Signature-256 (HMAC sha256 con META_APP_SECRET, timingSafeEqual, sobre el raw body)
  - `webhook.js` — GET verificación (hub.challenge) + POST: valida firma → 200 inmediato → procesa async. Idempotencia: SETNX redis `wa:msg:<message.id>` TTL 24h (Meta reintenta; un mensaje procesado dos veces no puede crear dos pedidos). Ignora statuses/echoes. Extrae texto (text.body; interactive button/list reply → title).
  - `sesiones.js` — patrón claude.js de wa-claude: Map chatKey(`<phone_number_id>:<telefono>`)→resumeId, PERSISTIDO a disco (JSON en SESIONES_DIR, write-through). Expiración 24h de inactividad.
  - `agente.js` — runSdkQuery envolviendo query() del Agent SDK: systemPrompt = archivo agente/skills/<vertical>/SKILL.md, mcpServers: spawn `uv --directory <repo>/agente run python server.py` con env CORE_URL, AGENTE_TOKEN (del tenant), CLIENTE_TELEFONO; resume; TIMEOUT 90s con AbortController (gotcha wa-claude: timeout con aborto, consumidor aislado). Respuesta = texto final.
  - `outbox.js` — patrón wa-claude/src/outbox.js: cola redis `outbox:<phone_number_id>`, worker con reintentos exponenciales (3 intentos), envía POST graph.facebook.com/v21.0/<phone_number_id>/messages (text body). DLQ `outbox:muertos` con log.
  - `salidas.js` — consumidor BRPOP de la cola `salidas_whatsapp` (la llena el core, E7): manda plantilla o texto según payload `{negocio_id, wa_phone_id, telefono, tipo: "texto"|"plantilla", texto?, plantilla?, variables?}` → misma vía outbox.
  - `index.js` — express con raw body capture para la firma, arranque, graceful shutdown.
- `tests/` vitest: firma (válida/ inválida/ ausente), idempotencia (mismo id dos veces → un solo procesamiento), webhook GET challenge, parsing de mensajes (tabla con payloads reales de Cloud API), outbox reintenta y muere a DLQ, sesiones persisten y expiran. Graph API y Agent SDK MOCKEADOS (inyección de deps), nada de red real.
- README.md corto: cómo dar de alta un tenant (rotar token en core → tenants.json), variables, cómo correr.
- Verificá: `npm install && npm test` verde. No toques nada fuera de gateway/.

## E6 — Panel web (React, `panel/` — W3-B)

Vite + React 18 + TS estricto. **PRODUCT.md y DESIGN.md de la raíz son LEY** —
paleta OKLCH, Manrope, targets ≥48px, tema claro, prohibiciones incluidas.
Referencia de estructura (no de estética): ~/Proyectos/Skill-Moodle/panel/web.

- `src/api/` — cliente typed: fetch con base VITE_API_URL, JWT en memoria+localStorage, refresh automático en 401 (una vez), tipos TS espejo de los DTO del core (mirá core/internal/dto/*.go).
- `src/vistas/`:
  - `Login.tsx` (+ flujo must_change_password → CambiarPassword)
  - `Agenda.tsx` — LA vista (PANEL.md vista 1 salud): columnas por profesional, franjas del día, turnos con fondo por estado, huecos libres visibles (--hueco-libre), fecha navegable, acciones táctiles confirmar/cancelar/en_curso/completado/ausente según transiciones válidas. Poll cada 15s.
  - `Catalogo.tsx` — vista 2: lista de FilaServicio con el switch GRANDE de disponible (optimista, PATCH /servicios/:id/disponible), precio, alta/edición inline (sin modal), categorías, precios por cobertura.
  - `Equipo.tsx` — profesionales (recursos) + horarios semanales + excepciones; alta/edición.
  - `Clientes.tsx` — búsqueda por teléfono/nombre, ficha (nombre, teléfono, cobertura, historial de compromisos del cliente vía GET /compromisos filtrado client-side si no hay endpoint).
  - `Admin.tsx` — sólo rol admin: lista de negocios, alta (muestra password temporal UNA vez), rotar token de agente (muestra token UNA vez, con advertencia).
- `src/componentes/` — TarjetaCompromiso, FilaServicio, SelectorDemora (presets de config + campo libre SIEMPRE), BarraInferior (4 íconos), Switch.
- Rutas react-router: / (agenda), /catalogo, /equipo, /clientes, /admin, /login. Guard por token + rol.
- Estados según claims del JWT (decodificar payload base64, sin lib).
- Tests vitest + @testing-library/react: cliente API (refresh en 401), TarjetaCompromiso muestra acciones según estado (tabla de transiciones válidas — espejo de model/estado.go), SelectorDemora acepta valor libre, guard de rutas.
- Copy en rioplatense neutro (PRODUCT.md), sin jerga técnica, sin em dashes.
- Verificá: `npm install && npm run build && npm test` y `npx tsc --noEmit` verdes. No toques nada fuera de panel/.

## E7 — Anti-ausentismo (Go, core — W3-C; único agente Go de la ola)

Podés tocar core: migración nueva, archivos nuevos, y cablear router.go/main.go.
NO reescribas lógica existente salvo el hook puntual en motor_service.

- `core/migrations/000003_anti_ausentismo.up/.down.sql`:
  - `ALTER TABLE compromiso ADD COLUMN recordatorio_enviado_en TIMESTAMPTZ;`
  - tabla `lista_espera(id uuid pk, negocio_id fk, cliente_id fk, servicio_id fk, nota text, creado_en, notificado_en timestamptz null, compromiso_ofrecido_id uuid null)` + índices (negocio_id, servicio_id, creado_en).
- `internal/model/lista_espera.go`, `internal/repository/lista_espera_repo.go` (CRUD tenant-scoped + `PrimeroSinNotificar(ctx, negocioID, servicioID)`).
- `internal/worker/recordatorios.go` — ticker 60s: turnos `confirmado` con `inicio` en `[ahora + Hh - 5min, ahora + Hh]` (H = config `recordatorio_horas_antes`, default 24) y `recordatorio_enviado_en IS NULL` → UPDATE condicional (WHERE recordatorio_enviado_en IS NULL) y si afectó la fila → LPUSH redis `salidas_whatsapp` JSON `{negocio_id, wa_phone_id, telefono, tipo:"plantilla", plantilla:"recordatorio_turno", variables:{nombre, fecha_hora_local, negocio}, compromiso_id}`. Reloj inyectable (`func() time.Time`) para tests. Necesita wa_phone_id del negocio (join).
- Hook de liberación: cuando `Transicionar` lleva un TURNO con `inicio` futuro a `cancelado`, publicar evento → `internal/worker/lista_espera.go`: toma `PrimeroSinNotificar` del mismo servicio (primera línea del compromiso cancelado), marca `notificado_en` y encola oferta `{tipo:"plantilla", plantilla:"hueco_liberado", ...}`. Hook mínimo en motor_service (inyectar un `Notificador` opcional; nil = no-op para no romper tests existentes).
- `internal/handler/lista_espera.go` + dto: `GET/POST /api/lista-espera`, `DELETE /api/lista-espera/:id`. Register método, cablealo vos en router.go (grupo tenant) y los workers en main.go (composition root, con el ctx de shutdown existente).
- Tests integración (harness existente, `tests/integration/anti_ausentismo_test.go`): recordatorio se encola una sola vez (dos ticks → un solo LPUSH, verificar con miniredis o redis de test), fuera de ventana no encola, cancelación de turno futuro notifica al primero de la lista del mismo servicio y lo marca, lista de espera tenant-scoped.
- Verificá: go build/vet/test ./... completo verde (incluido e2e existente — el hook nil no debe romper nada).

---

## E8 — Cobro + ARCA (ola 4)

### W4-A: cobro y facturación en el core (Go — único agente Go de la ola, cablea router/main)

- `core/migrations/000004_cobro.up/.down.sql`:
  - `config_fiscal(negocio_id uuid pk fk, cuit text not null, razon_social text, condicion text default 'monotributo', punto_venta int not null default 1, modo text not null default 'homologacion', cert_pem_cifrado text, key_pem_cifrado text, actualizado_en timestamptz)`
  - `cobro(id uuid pk, negocio_id fk, compromiso_id uuid UNIQUE fk, usuario_id fk null, medio_pago text check in (efectivo,transferencia,debito,credito,qr), monto numeric(12,2), cobrado_en timestamptz default now())`
  - `comprobante(id uuid pk, negocio_id fk, cobro_id uuid UNIQUE fk, tipo_cbte int not null default 11, punto_venta int, numero bigint null, cae text null, cae_vence date null, estado text default 'pendiente' check in (pendiente,emitido,error), retry_count int default 0, next_retry_at timestamptz, last_error text, receptor_doc_tipo int default 99, receptor_doc_nro text null, importe numeric(12,2), emitido_en timestamptz null)` + índice parcial pendientes por next_retry_at (patrón BlendPos migración 3).
- `internal/infra/cifrado.go` — AES-256-GCM, clave env `FISCAL_CIPHER_KEY` (64 hex). `config.go` += FISCAL_CIPHER_KEY (BindEnv; si falta y hay certs que guardar → error explícito).
- `internal/model/cobro.go` (Cobro, Comprobante, ConfigFiscal), `internal/repository/cobro_repo.go` (tenant-scoped; `ComprobantesPendientes(ctx, ahora, limite)` cross-tenant SOLO para el worker, con config fiscal y datos del cobro/cliente joineados).
- `internal/service/cobro_service.go`:
  - `Cobrar(ctx, negocioID, dto{CompromisoID, MedioPago})`: compromiso del tenant en estado `completado`, sin cobro previo (unique → ErrYaCobrado 409), monto = compromiso.total; en tx: crea cobro + comprobante `pendiente` (si el negocio tiene config_fiscal con cuit; si no, cobro sin comprobante y el response lo dice). Receptor: DNI del cliente si `cliente.documento`, si no consumidor final (99).
  - `ConfigurarFiscal(ctx, negocioID, dto)` (admin): guarda config, certs cifrados con infra/cifrado.
  - `CierreDelDia(ctx, negocioID, fecha)`: compromisos del día (por cerrado_en en TZ negocio): total cobrado, por medio_pago, por origen, ticket promedio, cancelados, ausentes, comprobantes emitidos/pendientes/error.
- `internal/worker/facturador.go` — ticker 30s: `ComprobantesPendientes` (next_retry_at null o vencido) → arma request y POST `${ARCA_SIDECAR_URL}/facturar` con header `X-Internal-Token`; body: `{cuit_emisor, punto_venta, modo, cert_pem, key_pem (descifrados), tipo_cbte, concepto: 2, doc_tipo, doc_nro, importe_total, fecha, servicio_desde, servicio_hasta}`. Éxito → numero/cae/cae_vence, estado emitido, emitido_en; y LPUSH `salidas_whatsapp` texto al cliente ("Listo, tu factura C N° ... por $...; CAE ..."). Error → retry_count++, next_retry_at = backoff exponencial (1m,5m,25m..., tope 6h), last_error; a los 10 intentos estado `error`. HTTP client inyectable para tests. UPDATE de toma condicional (WHERE estado='pendiente' AND (next_retry_at IS NULL OR next_retry_at <= now)) para no facturar dos veces.
- Handlers + dto: `POST /api/cobros`, `GET /api/cobros/:compromiso_id`, `GET /api/cierre?fecha=` (tenant); `PUT /api/admin/negocios/:id/fiscal` + `GET .../fiscal` (sin secretos, solo cuit/pv/modo/tiene_certs) en grupo admin. Register método; cableá router.go y main.go (worker con ctxWorkers existente).
- Verificá: go build/vet/test ./... completo verde (e2e existentes incluidos; recordá replicar el wiring en tests/e2e/main_test.go si agregás deps a router.Deps).

### W4-B: sidecar ARCA (Python, `arca-sidecar/` — todo tuyo)

- Base: COPIÁ ~/Proyectos/BlendPos/afip-sidecar/ → arca-sidecar/ (cp -r; los patch_*.py son oro heredado: NO los toques salvo necesidad demostrada). Limpiá lo que no aplica (docs de Railway, scripts de email).
- Adaptaciones en main.py/schemas.py/afip_client.py:
  1. **Stateless multi-tenant**: `POST /facturar` recibe TODO por body (contrato exacto en W4-A). Los certs llegan en PEM por request: escribilos a archivos temporales por llamada (tmpdir por request, borrado en finally) o cache en disco keyed por sha256(cuit+cert) — lo que el cliente AFIP existente soporte con menos cirugía.
  2. **Factura C** (CbteTipo 11) **concepto 2 (servicios)**: FchServDesde/FchServHasta/FchVtoPago obligatorios; sin IVA discriminado (ImpIVA=0, ImpNeto=total). Monotributo emisor.
  3. Auth: header `X-Internal-Token` == env `INTERNAL_API_TOKEN` (401 si no). `/health` sin auth.
  4. Respuesta: `{ok, numero, cae, cae_vencimiento, error?}` — errores de ARCA legibles (el core los guarda en last_error).
- `tests/` pytest: el cliente AFIP/WSAA MOCKEADO (sin red): request válido → llama con CbteTipo 11 concepto 2 y los campos de fecha de servicio; token inválido → 401; PEMs malformados → 422 con mensaje claro; error de ARCA simulado → respuesta {ok:false, error}. Un test de que los patches se importan sin romper (smoke import).
- Dockerfile actualizado si hace falta. README corto: qué cambió respecto del sidecar original.
- Verificá: pytest verde con el venv que corresponda (uv o pip; el requirements ya existe).

### W4-C: cierre del día en el panel + tests de cobro (panel/ y core/tests/ — NO toques core prod)

- Panel (respetando PRODUCT.md/DESIGN.md y el estilo ya existente en panel/src):
  - Vista `Cierre.tsx` (PANEL.md vista 3): números grandes tabulares (compromisos, facturado, ticket promedio, % WhatsApp), por medio de pago, cancelados y ausentes (salud), estado de comprobantes (emitidos/pendientes/error). Fecha navegable. Ruta /cierre + ícono en BarraInferior.
  - Botón **Cobrar** en TarjetaCompromiso estado `completado` sin cobro: popover inline de medio de pago (efectivo/transferencia/débito/crédito/QR) → POST /api/cobros; muestra después el estado del comprobante ("Factura C emitida" / "Facturando…" / error legible).
  - Tests vitest de ambos + tipos TS de los DTO nuevos (espejo de W4-A).
- Go tests contra el contrato W4-A (tests/integration/cobro_test.go, tests/e2e/cobro_test.go):
  - Cobrar completado OK; doble cobro 409; cobrar pendiente/confirmado 409/422; aislamiento de tenant del cobro y el cierre.
  - Worker facturador contra un sidecar FAKE (httptest.Server): éxito sella cae/numero y encola aviso a salidas_whatsapp; fallo programa retry con backoff y a los 10 marca error; toma condicional no factura dos veces (dos Tick seguidos → un solo POST).
  - Cierre del día: agrega bien por medio/origen en la TZ del negocio.
  - Si W4-A no aterrizó, escribí contra el contrato y anotá.
- Verificá: panel (tsc, test, build) y go test ./tests/... según lo que compile.

---

## E9 — Ola final: integración, revisión y pulido

### W5-A: deploy integrado (Dockerfiles, compose, smoke)

- `core/Dockerfile` (multi-stage, binario estático, migrations adentro), `gateway/Dockerfile`, `panel/Dockerfile` (build + nginx sirviendo dist con cache-busting: el bundle de Vite ya tiene hash en el nombre; nginx.conf con try_files para SPA y proxy /api → core).
- `docker-compose.yml` raíz AMPLIADO (no pisar db/redis existentes): servicios core, arca-sidecar, gateway, panel con healthchecks, depends_on condition service_healthy, env por variables con defaults dev, red interna. El core espera db healthy. Volumen efímero para el cache de certs del sidecar (documentar que JAMÁS entra a backups).
- `scripts/smoke.sh`: levanta compose completo → espera health de core/sidecar/gateway/panel → contra la API real: login admin (ADMIN_PASSWORD de env), alta negocio salud, login dueño + cambio de password, cobertura+servicio+recurso+horario, disponibilidad (asserts de huecos), hold, compromiso, confirmar→en_curso→completado, cobrar (sin config fiscal: cobro sin comprobante, assert del mensaje), cierre del día, rotar token agente y GET /api/negocio con cop_. Exit code != 0 si algo falla, con contexto. Idempotente (nombres con timestamp… no hay Date.now en workflows pero esto es bash: usar $RANDOM).
- `docs/DEPLOY.md`: variables de cada servicio, cómo arrancar de cero, cómo dar de alta el primer negocio y conectar el gateway (tenants.json), qué falta para producción real (dominio, Traefik, certs ARCA, número de WhatsApp).
- Verificá: docker compose build + smoke.sh pasando ENTERO en esta máquina (el postgres host 5433 ya está ocupado por el compose actual de dev: reusalo o pará/reusá los contenedores existentes con cuidado; los datos de dev son descartables).

### W5-B: revisión adversarial (solo lectura + reporte)

Revisar TODO el repo buscando bugs REALES, con foco en las costuras que ningún agente vio entera: gateway↔agente (env, sesiones, colas), agente↔core (shapes HTTP, errores), core↔sidecar (contrato facturar), panel↔core (DTOs), multi-tenant (cualquier query o flujo que pueda cruzar tenants), plata (decimal end-to-end, redondeos), timezones (TIME local vs timestamptz), concurrencia (holds, transiciones, lease), secretos (logs, responses, git). NO editar nada: reporte con archivo:línea, severidad, y escenario de fallo concreto por hallazgo. Verificar cada hallazgo contra el código real antes de reportarlo (nada de "podría ser").

### W5-C: pulido fino

1. Gate de rol en el panel: /cierre y montos sólo dueño+admin (PANEL.md roles); el operador ve agenda/catálogo/clientes sin plata. `Protegida` ya decodifica el rol.
2. `AgendaResponse`: sumar estado de cobro del turno (cobrado bool / comprobante estado) al DTO Go + usarlo en el panel para evitar el GET /api/cobros/:id por turno (nota de W4-C). Actualizar tests afectados.
3. DESIGN.md: barra inferior pasa a 5 íconos (cierre entró); dejarlo escrito.
4. README.md raíz: estado real (qué está construido, cómo correrlo, make + smoke), sección "Estado" actualizada; ROADMAP.md: tildar lo hecho de Fase 1/2 con fecha 19/08/2026, dejando claro qué queda (Meta app, plantillas, piloto, homologación ARCA real).
5. `panel/`: `GET /api/lista-espera` ya existe — vista mínima Lista de espera (o sección en Agenda) para VER quién espera + alta manual; el hueco libre de la agenda muestra cuántos esperan ese servicio si aplica (si es barato; si no, sólo la vista).
- Verificá: go + panel suites completas verdes.

---

## E10 — Fase 5: vertical gastronomía (20/08/2026)

**Regla de oro (ROADMAP.md): el motor NO se toca.** Si hay que modificar la
máquina de estados, el modelo `compromiso`, o el flujo genérico de crear/
transicionar, el diseño estaba mal — parar y avisar al orquestador. Todo esto
es ADITIVO: disponibilidad de cocina/mesa, prompt del agente, vistas del panel.
Referencias: docs/ROADMAP.md (Fase 5), docs/PANEL.md (vista 1 board de cocina),
docs/FLUJOS.md (conversación de restaurante), docs/ARQUITECTURA.md, docs/PRODUCTO.md.
El esquema ya soporta todo: `tipo_recurso` cocina/mesa, `tipo_compromiso` pedido/
reserva, `tipo_entrega`, `config.confirmacion` por tipo. Convenciones globales del
inicio del archivo aplican.

### W6-A: backend gastronomía (Go — único agente Go, cablea router/main si hace falta)

Sin tocar `motor_service.go`, `model/compromiso.go`, `model/estado.go`.
- **Disponibilidad de cocina y mesa** (nuevo, en `disponibilidad_service.go` o un
  archivo nuevo `disponibilidad_gastro.go`): un `recurso` tipo `profesional`
  atiende 1 compromiso por franja; un `recurso` tipo **cocina** tiene
  `capacidad` = unidades/hora y admite varios pedidos en paralelo mientras no
  se supere la capacidad de la franja; una **mesa** tiene `capacidad` = cubiertos
  y una reserva la ocupa por su duración. `consultar_disponibilidad` y la agenda
  deben respetar esto según el tipo de recurso. Elegí la extensión más limpia que
  NO cambie el camino de `profesional`.
- **Delivery/entrega**: el flujo de crear ya acepta `entrega` y `direccion`
  (están en el DTO y el modelo). Sumá validación por `config`: `acepta_delivery`,
  `radio_delivery_km`. Si el negocio no acepta delivery y llega `entrega=delivery`
  → 422 con mensaje claro. (No calcules distancia real todavía: dejá el hook y
  validá contra la config; anotá el TODO de geocoding.)
- **Confirmación humana con demora**: `config.confirmacion.pedido="humana"` ya
  existe. Verificá que el flujo pedido → confirmado con `demora_min` funcione y
  agregá lo que falte para que el panel pueda confirmar un pedido poniendo la
  demora (presets de `config.demoras_sugeridas` + valor libre). El estado
  `LISTO` del board sale de la máquina que ya existe (en_curso → listo → completado).
- **Reporte del board**: un endpoint o el `ListTablero` existente tiene que poder
  devolver los pedidos del día agrupables por estado (PENDIENTES/EN COCINA=en_curso/
  LISTOS=listo) para el kanban. Si `ListTablero` ya alcanza, no agregues nada.
- Tests (tests/integration + e2e): cocina con capacidad 3 acepta 3 pedidos en la
  misma franja y rechaza el 4º; mesa reservada no se re-reserva; delivery
  rechazado si el negocio no lo acepta; confirmar pedido con demora; board agrupa
  bien por estado; TODO tenant-scoped. Los tests de salud existentes NO se rompen.
- Verificá: go build/vet/test ./... completo verde (incluido todo lo de salud).

### W6-B: agente gastronomía (Python, agente/ — tuyo)

- `agente/skills/gastronomia/SKILL.md` + `VERSION` (1.0.0): el prompt del vertical
  gastronomía siguiendo docs/FLUJOS.md (conversación de restaurante validada) y las
  reglas de docs/ARQUITECTURA.md. Diferencias vs salud: toma PEDIDOS (varios ítems),
  pregunta retira/delivery/en local, pide dirección si es delivery, **NO confirma
  solo** (la cocina se satura: la confirmación y la demora las pone el local desde
  el panel — el agente arma el pedido, avisa que el local confirma y da la demora).
  Nunca inventa demora ni precio. Sabe leer "se acabó" (disponible=false). Tono
  cálido rioplatense, ágil, de local de comida.
- Ajustá `server.py` sólo lo necesario para que las 7 tools sirvan a gastronomía:
  `armar_compromiso` con tipo `pedido` y `entrega`, `confirmar` que deja el pedido
  en `pendiente` cuando la política es "humana" (ya lo hace por config — verificá).
  NO dupliques tools; el server elige el SKILL por env `VERTICAL` (ya existe).
- Tests pytest: flujo de pedido (catálogo → armar con 2 ítems + entrega → confirmar
  queda pendiente por política humana), delivery pide dirección, "se acabó" no se
  ofrece. Mockeá el core con respx.
- Verificá: cd agente && uv run pytest — verde (incluidos los de salud).

### W6-C: panel gastronomía (React, panel/ — tuyo)

PRODUCT.md/DESIGN.md mandan. El panel ya distingue `vertical` (`negocio.vertical`).
- **Board de pedidos** (docs/PANEL.md vista 1, versión gastronomía): cuando
  `vertical==="gastronomia"`, la vista principal NO es la grilla de agenda sino un
  **tablero kanban por estado**: PENDIENTES (con botones OK/✕ y selector de demora
  al confirmar) → EN COCINA (en_curso, con contador contra la demora que se pone
  rojo al pasarse) → LISTOS (listo). Cada pedido: número, ítems, total, 🛵/🏃
  (delivery/retira). Arrastrar o botón. Reusá TarjetaCompromiso donde puedas.
  Salud sigue viendo la grilla de agenda de siempre — bifurcá por vertical.
- **Comanda de cocina**: una vista/modo sin precios ni datos del cliente, sólo
  ítems y modificadores, para una tablet en la cocina (rol cocina existe en
  PANEL.md; si el rol no está en el panel, dejá la vista accesible al dueño y
  anotá el TODO del rol).
- **Catálogo adaptado**: los labels por vertical — "Carta" y las secciones en
  gastronomía; el interruptor de disponible es el mismo. Modificadores por ítem
  ("sin cebolla") si es barato; si no, el campo nota alcanza — no te compliques.
- **Confirmar con demora**: el SelectorDemora (presets de config + libre) ya
  existe; engancharlo al confirmar de un pedido.
- **Delivery**: mostrar dirección y tipo de entrega en la tarjeta del pedido.
- Copy rioplatense de local de comida, sin jerga. Estados vacíos a mano.
- Tests vitest de lo nuevo (board agrupa por estado, confirmar con demora llama
  bien, la bifurcación salud/gastro). tsc estricto, build y test verdes.
- CUIDADO: Lautaro trabaja el panel en paralelo desde otra máquina; hacé cambios
  acotados y no reformatees archivos enteros, para que el merge no sea un infierno.
