# Hardening — hallazgos de la revisión adversarial (19/08/2026)

> **Vertical activo: gastronomía** (ver D21 en `docs/DECISIONES.md`, 21/08/2026).
> Esta revisión se hizo cuando el piloto de referencia era salud, así que
> varios hallazgos usan "paciente"/"consultorio" como ejemplo concreto (p.ej.
> H4, H9, H14). El bug de fondo en cada caso es genérico (aplica igual a un
> cliente de gastronomía); no se reescriben los hallazgos para no alterar el
> registro técnico de la revisión.

Revisión de todo el repo buscando bugs en las costuras entre servicios. Ordenado
por severidad. El estado se actualiza a medida que se corrigen.

## CRÍTICO

- [x] **H1 · `gateway/src/agente.js` — `allowedTools` no restringe; `bypassPermissions` + `process.env` completo = un WhatsApp podía leer los tokens de todos los tenants.** El SDK dice que `allowedTools` sólo auto-aprueba; para restringir hay que usar `tools`. **CORREGIDO**: `tools: []` + `disallowedTools` explícito, y el env del MCP pasó a ser mínimo (PATH/HOME + los 4 de sesión), sin spread de `process.env`. Tests verdes.

## ALTO

- [x] **H2 · Orden de variables de plantilla WhatsApp.** El core publica `Variables` como `map[string]string`; Go serializa maps en orden alfabético, y el gateway hace `Object.values()` posicional → `{{1}},{{2}},{{3}}` permutados en todo recordatorio y oferta de hueco. **CORREGIDO**: `MensajeSalida.Variables` pasó a `[]string` posicional (contrato documentado por plantilla en `cola.go`: `recordatorio_turno`→{{1}}nombre,{{2}}fecha_hora_local,{{3}}negocio; `hueco_liberado`→{{1}}nombre,{{2}}servicio,{{3}}fecha_hora_local,{{4}}negocio); el gateway ya consume el array posicional. Tests Go (integración) y vitest (outbox/salidas) fijan el orden. Verde.
- [x] **H3 · Carrera del hold sin constraint.** `hold_service.Crear` y `motor_service.Crear` verifican y crean sin lock ni constraint; dos turnos simultáneos sobre el mismo recurso/hora pasan los dos. **CORREGIDO** con el lock pesimista (no con `EXCLUDE`): `CompromisoRepository.ReservarConLock` corre verificación + inserción dentro de una tx que primero toma `SELECT ... FOR UPDATE` sobre la fila del recurso, y ambos services (hold y motor) pasan por ahí con repos ligados a esa tx. Se descartó el `EXCLUDE USING gist` porque rompía dos semánticas vigentes: los holds expirados-sin-barrer bloquearían, y la renovación del hold de la propia sesión (que inserta una segunda fila solapada a propósito) daría 23P01. El lock serializa sin tocar ninguna de esas reglas. `core/internal/repository/compromiso_repo.go`, `core/internal/service/{hold,motor}_service.go`. Test: `TestHoldConcurrenteSoloUnoGana` (8 goroutines → 1 gana, 7 `ErrSolapado`, 1 hold en base), verde bajo `-race`.
- [ ] **H4 · El agente cotiza `precio_base`, el core congela precio por cobertura.** `agente/server.py` (`armar_compromiso`, `ver_catalogo`) usa `precio_base`; el core usa `precio_cobertura` del cliente. El paciente confirma un número y se cobra otro. Fix: resolver cobertura del cliente antes del borrador y pedir el precio efectivo, o exponer precio por cobertura en `GET /api/servicios`.
- [x] **H5 · `CompromisoResponse.Inicio/Fin/CerradoEn` es `time.Time` crudo (TZ del proceso), `AgendaResponse` es string en TZ del negocio.** En contenedor (UTC) la ficha del cliente muestra horas y hasta días equivocados. **CORREGIDO**: la TZ se resuelve en el vertical, no en el motor. `CompromisoResponse.EnTimezone(loc)` reescribe `Inicio/Fin/ConfirmadoEn/CerradoEn/CreadoEn` a la TZ del negocio (`t.In(loc)`), así el JSON sale con el offset del negocio (p.ej. `-03:00`) en lugar de `Z`, igual que la agenda. `motorGastro` (el decorador que ya lee la config del negocio) resuelve `LoadLocation(neg.Timezone)` y llama `EnTimezone` sobre el response de Crear/Obtener/Listar/Transicionar, después de que el motor arma el DTO. El motor (`motor_service`, `model/estado`) no se tocó; el contrato JSON mantiene los mismos campos. El panel no necesitó cambios: ya tipa esos campos como `string` y `horaDe`/`minutosDe` cortan la hora de pared del string (esperaban el offset del negocio, no `Z`). `core/internal/dto/compromiso_dto.go`, `core/internal/service/motor_gastro.go`. Test: `TestMotorGastroLocalizaTimestampsALaTZDelNegocio` + `...EnListar` (18:00Z → 15:00-03:00, nunca `Z`), verde; e2e/integración siguen verdes.
- [x] **H6 · Sidecar: un `WSFEv1` por tenant compartido entre threads sin lock.** `/facturar` es sync (threadpool), `tenant_pool` devuelve la misma instancia; dos facturas del mismo negocio en paralelo se pisan el dict de factura → CAE con importe/DNI cruzados. **CORREGIDO** con `threading.Lock` por `AFIPClient` (la opción de menos cirugía): `facturar()` toma `self._facturar_lock` alrededor de todo el armado + `CAESolicitar` (`_facturar_serializado`). Serializa por tenant —también el correlativo `ultimo+1`—; distintos tenants tienen distinto `AFIPClient` y distinto lock, así que siguen facturando en paralelo. `arca-sidecar/afip_client.py`. Test: `tests/test_concurrencia.py` (8 hilos concurrentes del mismo tenant sobre un WSFEv1 doblado con ventana de cruce: `max_activos==1` y cada `CAESolicitar` ve su propio DNI). Verificado que sin el lock el test falla (8 hilos en paralelo). Suite del sidecar verde.

## MEDIO

- [x] **H7 · Recordatorios: SELECT de 200 en ventana de 72h.** Con ~15 consultorios el lote no alcanza a los turnos de las 24h y el recordatorio no sale nunca, sin error. **CORREGIDO**: la ventana fina se movió a la query. `TurnosSinRecordatorio(ctx, ahora, margen, limite)` calcula por negocio el `recordatorio_horas_antes` efectivo (saneado igual que el worker: entero en (0,72], si no 24) con un `CROSS JOIN LATERAL` y filtra `inicio ∈ [ahora+H-margen, ahora+H]` en SQL, así el `LIMIT 200` sólo cuenta candidatos reales. El filtro en memoria del worker queda como red de seguridad. `core/internal/repository/aviso_repo.go`, `core/internal/worker/recordatorios.go`. Test: `TestRecordatorioNoSeAhogaConLoteLleno` (250 turnos cercanos fuera de ventana + 1 dentro → se encola sólo el de dentro).
- [x] **H8 · El grupo `tenant` del router no tiene `RequireRole`.** El token `cop_` del agente y el rol `operador` alcanzan `/api/cierre`, `/api/cobros`, `PATCH /servicios`. **CORREGIDO**: cobros/cierre/jornada/reportes pasaron a un subgrupo `RequireRole(RolDueno, RolAdmin)` (el operador queda afuera; el admin ya no llegaba por `RequireNegocio`), y `RolAgente` (cop_) quedó acotado por `middleware.RestringirAgente()` a una allowlist de rutas —leer negocio/catálogo/precios/disponibilidad, obtener-o-crear cliente y crear/consultar/cancelar compromisos y holds—, con 403 en todo lo demás (cobros, cierre, reportes, jornada, escritura de catálogo/horarios). `core/internal/router/router.go` + `core/internal/middleware/auth.go`. Tests e2e: `core/tests/e2e/roles_test.go`.
- [x] **H9 · `agente cancelar` no valida dueño del compromiso.** Un paciente con un UUID ajeno cancela el turno de otro (mismo negocio) y dispara la oferta a lista de espera. Fix: resolver cliente por `CLIENTE_TELEFONO` y rechazar si `cliente_id` no coincide. `agente/server.py`. **CORREGIDO**: `cancelar` resuelve la ficha por `CLIENTE_TELEFONO` (igual que `confirmar`) y rechaza con `codigo:"no_es_tuyo"` si `compromiso.cliente_id` no coincide, antes del preview y del `confirmado=true`. Test pytest cubre turno ajeno rechazado y propio OK. Verde.
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
