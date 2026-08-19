# Hardening — hallazgos de la revisión adversarial (19/08/2026)

Revisión de todo el repo buscando bugs en las costuras entre servicios. Ordenado
por severidad. El estado se actualiza a medida que se corrigen.

## CRÍTICO

- [x] **H1 · `gateway/src/agente.js` — `allowedTools` no restringe; `bypassPermissions` + `process.env` completo = un WhatsApp podía leer los tokens de todos los tenants.** El SDK dice que `allowedTools` sólo auto-aprueba; para restringir hay que usar `tools`. **CORREGIDO**: `tools: []` + `disallowedTools` explícito, y el env del MCP pasó a ser mínimo (PATH/HOME + los 4 de sesión), sin spread de `process.env`. Tests verdes.

## ALTO

- [ ] **H2 · Orden de variables de plantilla WhatsApp.** El core publica `Variables` como `map[string]string`; Go serializa maps en orden alfabético, y el gateway hace `Object.values()` posicional → `{{1}},{{2}},{{3}}` permutados en todo recordatorio y oferta de hueco. Fix: el core publica `[]string` ordenado (o contrato de orden por plantilla). `core/internal/worker/cola.go` + `recordatorios.go` + `lista_espera.go` + `gateway/src/outbox.js`/`salidas.js`.
- [ ] **H3 · Carrera del hold sin constraint.** `hold_service.Crear` y `motor_service.Crear` verifican y crean sin lock ni constraint; dos turnos simultáneos sobre el mismo recurso/hora pasan los dos. Fix: `EXCLUDE USING gist (recurso_id WITH =, tstzrange(inicio,fin) WITH &&)` en `hold` y en compromisos no terminales (migración nueva), o `SELECT ... FOR UPDATE` del recurso en una tx que abarque verificación+inserción.
- [ ] **H4 · El agente cotiza `precio_base`, el core congela precio por cobertura.** `agente/server.py` (`armar_compromiso`, `ver_catalogo`) usa `precio_base`; el core usa `precio_cobertura` del cliente. El paciente confirma un número y se cobra otro. Fix: resolver cobertura del cliente antes del borrador y pedir el precio efectivo, o exponer precio por cobertura en `GET /api/servicios`.
- [ ] **H5 · `CompromisoResponse.Inicio/Fin/CerradoEn` es `time.Time` crudo (TZ del proceso), `AgendaResponse` es string en TZ del negocio.** En contenedor (UTC) la ficha del cliente muestra horas y hasta días equivocados. Fix: `CompromisoDesdeModel` serializa como RFC3339 en la TZ del negocio, igual que la agenda. `core/internal/dto/compromiso_dto.go`.
- [ ] **H6 · Sidecar: un `WSFEv1` por tenant compartido entre threads sin lock.** `/facturar` es sync (threadpool), `tenant_pool` devuelve la misma instancia; dos facturas del mismo negocio en paralelo se pisan el dict de factura → CAE con importe/DNI cruzados. Fix: `threading.Lock` por `AFIPClient` alrededor de `facturar()`, o `WSFEv1` por request cacheando sólo el token WSAA. `arca-sidecar/afip_client.py` + `tenant_pool.py`.

## MEDIO

- [ ] **H7 · Recordatorios: SELECT de 200 en ventana de 72h.** Con ~15 consultorios el lote no alcanza a los turnos de las 24h y el recordatorio no sale nunca, sin error. Fix: filtrar la ventana en SQL (`inicio ∈ [ahora+Hmin, ahora+Hmax]`). `core/internal/repository/aviso_repo.go`.
- [ ] **H8 · El grupo `tenant` del router no tiene `RequireRole`.** El token `cop_` del agente y el rol `operador` alcanzan `/api/cierre`, `/api/cobros`, `PATCH /servicios`. Fix: `RequireRole(dueno,admin)` sobre cobros/cierre/fiscal; scope/allowlist aparte para `RolAgente`. `core/internal/router/router.go`. (El gate del panel que hace W5-C es sólo cosmético sin esto.)
- [ ] **H9 · `agente cancelar` no valida dueño del compromiso.** Un paciente con un UUID ajeno cancela el turno de otro (mismo negocio) y dispara la oferta a lista de espera. Fix: resolver cliente por `CLIENTE_TELEFONO` y rechazar si `cliente_id` no coincide. `agente/server.py`.
- [ ] **H10 · Auth del sidecar acoplada a `ARCA_MODO_DEFAULT`.** Con el `.env.example` (modo homologacion, token vacío) y negocios en `modo=produccion`, factura real sin auth. Fix: exigir `INTERNAL_API_TOKEN` siempre. `arca-sidecar/main.py`.
- [ ] **H11 · "Hoy" por defecto en hora del proceso.** `GET /api/cierre` y `/api/agenda` sin `?fecha=` usan `time.Now()` del proceso, no la TZ del negocio → cierre del día equivocado cerca de medianoche. Fix: `time.Now().In(loc)` con la TZ del negocio. `core/internal/handler/cobros.go`, `disponibilidad.go`.

## BAJO

- [ ] **H12 · `Equipo.tsx` excepción con TZ del navegador**, cierra 23:59 (deja el último minuto). Fix: construir con TZ del negocio, cerrar a 00:00 del día siguiente.
- [ ] **H13 · `outbox.js` reintento sólo en `setTimeout`** (no en Redis): un SIGTERM en la ventana pierde el mensaje sin DLQ. Fix: `ZADD` con score de reintento o `BRPOPLPUSH` a lista en-vuelo.
- [ ] **H14 · Sidecar loguea el DNI del paciente en claro** (dato de salud, Ley 25.326). Fix: enmascarar. `arca-sidecar/main.py`, `afip_client.py`.
- [ ] **H15 · Mensaje "sin config fiscal" también sale con total 0.** `cobro_dto.go` — distinguir el motivo.
- [ ] **H16 · Timezone del negocio no se valida en alta/update.** Un valor inválido rompe agenda/disponibilidad/cierre de ese tenant para siempre con 400. Fix: `time.LoadLocation` en `negocio_service`.
- [ ] **H17 · `sesion` viaja en el body y decide si un hold ajeno bloquea.** Con un token del tenant se puede pasar el teléfono de otro y crear encima de su hold. Fix: derivar la sesión del claim o firmar el hold-id.

## Veredicto de la revisión

Aislamiento por tenant: sólido y consistente en el core (ninguna query cruza
negocios). Plata decimal de punta a punta. Secretos cifrados y fuera de logs/git.
Los problemas están en las costuras que ningún agente vio enteras. H1 era el único
bloqueante de un piloto y ya está corregido. Orden sugerido del resto:
H2 → H3 → H6 → H4/H5 → H8/H9/H10 → medios/bajos.
