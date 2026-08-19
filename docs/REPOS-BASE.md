# Los tres repos base

Este proyecto **no se escribe de cero**. Se arma sobre tres bases que ya
existen, ya corren y ya sufrieron sus gotchas.

| Repo | Qué es hoy | Qué aporta |
|---|---|---|
| `BlendSoftware/BlendPos` | POS de retail en producción, 1 cliente | El backend Go, el catálogo, el cobro y **el sidecar de ARCA** |
| `Group-Active-IA/Skill-Moodle` | Skill de Claude Code + MCP para tutores | **El patrón del agente**: MCP con tools, panel, multi-tenant |
| `JuaniSarmiento/wa-claude` | Bot de WhatsApp de Jarvis y Hugo | El puente con el Agent SDK, sesiones, outbox, streaming |

---

## 1. BlendPos

`git@github.com:BlendSoftware/BlendPos.git`
Último commit: **2026-05-18**. 68 commits. Parado hace tres meses.

### Qué hay

```
backend/                    Go 1.24 · Gin · JWT · Redis · zerolog · viper
  cmd/server                entrypoint
  internal/
    handler/                15 handlers HTTP
    service/                13 servicios de dominio
    repository/             acceso a datos
    model/                  16 modelos
    dto/  apierror/  middleware/  config/  infra/  worker/
  migrations/               15+ pares up/down (golang-migrate)
  tests/e2e/
afip-sidecar/               Python · FastAPI · pysimplesoap parcheado
frontend/                   TS + TSX
```

### Qué se rescata, archivo por archivo

**Se queda tal cual:**

| Pieza | Por qué |
|---|---|
| `afip-sidecar/` completo | Oro. Certificados, WSAA, WSFEv1 y los ~18 parches a `pysimplesoap` que costaron meses. Ver [`ARCA.md`](ARCA.md). |
| `internal/service/auth_service.go` + `handler/auth.go` | Login, JWT, sesiones. Ya con `must_change_password` (migration 13). |
| `internal/service/audit_service.go` + `model/audit_log.go` | Auditoría. En salud no es opcional, es requisito. |
| `internal/middleware/`, `config/`, `apierror/`, `dto/` | El andamiaje. No tiene nada de retail. |
| `migrations/` como práctica | golang-migrate con up/down. Se sigue igual. |
| `internal/service/facturacion_service.go` | El puente Go → sidecar. Se adapta el tipo de comprobante, no la mecánica. |

**Se adapta:**

| Pieza | Cómo queda |
|---|---|
| `model/producto.go` + `producto_service.go` | Pasa a ser **ítem de catálogo**. Una hamburguesa y una práctica odontológica son lo mismo: nombre, precio, activo/inactivo, categoría. |
| `model/categoria.go` | Igual: secciones de la carta o tipos de práctica. |
| `model/lista_precios.go` + `historial_precio.go` | En consultorios es **precio por obra social**. Mismo modelo: varias listas sobre el mismo ítem. Esto ya está resuelto y es exactamente lo que hace falta. |
| `model/venta.go` + `venta_service.go` | Pasa a ser el **cierre** de un compromiso. Un turno cobrado y un pedido entregado terminan los dos en una venta. |
| `model/sesion_caja.go` + `caja_service.go` | Sirve igual para el cierre de caja del día. |
| `model/comprobante.go` | Igual. Ya tiene retry (migration 3) y unicidad por venta (migration 10). |
| `model/configuracion_fiscal.go` | Igual. Punto de venta, CUIT, condición frente a IVA. |

**Se descarta:**

| Pieza | Por qué |
|---|---|
| `inventario_service.go`, `movimiento_stock.go` | Stock por SKU. Ni la hamburguesería ni el consultorio lo usan así. |
| `compra_service.go`, `proveedor.go`, `contacto_proveedor.go` | Compras a proveedores es retail puro. |
| `promocion_service.go`, `producto_hijo.go` | Combos y variantes. Puede volver más adelante, no en el v1. |
| `chromedp` (dependencia) | Estaba para scrapear o generar PDF. Revisar si sigue haciendo falta. |

**Lo que hay que construir nuevo y no está:** el motor de compromisos. Ver
[`ARQUITECTURA.md`](ARQUITECTURA.md). Es lo único que no se recicla.

### Advertencia

BlendPos **no es el punto de partida, es la cantera**. La tentación de "abrir el
repo y agregarle turnos" lleva a un producto de retail con turnos pegados.
El modelo nuevo se diseña primero y se le trae lo que sirve.

---

## 2. Skill-Moodle

`git@github.com:Group-Active-IA/Skill-Moodle.git`
Último commit: **2026-08-18**. Vivo. **Licencia MIT, copyright Juan Ignacio
Sarmiento**, o sea que se puede usar, modificar y vender sin pedir permiso.

### Qué hay

```
SKILL.md                    530 líneas: el prompt del agente
mcp/server.py               1745 líneas: FastMCP con ~40 tools
mcp/moodle/                 el cliente del sistema externo
panel/backend/              FastAPI (app.py, agente.py, datos.py, dia.py)
panel/web/                  Vite + React + TS
install.sh · VERSION        distribución de la skill
```

### Qué aporta, que es lo más valioso de los tres

**No aporta código: aporta el patrón, ya probado en producción.**

1. **Tools con `@mcp.tool()` sobre FastMCP.** Cada capacidad del sistema es una
   función tipada que el modelo puede llamar. Acá va a ser igual:
   `consultar_disponibilidad`, `reservar`, `cancelar`, `ver_catalogo`.

2. **Confirmación humana en dos pasos.** Mirar la firma de `responder_mensaje`:

   ```python
   async def responder_mensaje(alumno: str, texto: str, confirmado: bool = False)
   ```

   Toda escritura pide `confirmado`. **Ese es el principio de oro** y es
   exactamente lo que se aplica al confirmar un pedido en gastronomía.

3. **Descubrimiento de identidad por datos, no por argumento.** El agente
   arranca llamando `mis_datos` y descubre a quién sirve. El prompt es agnóstico.
   Acá: el agente descubre de qué negocio es por el número de WhatsApp, nunca
   porque se lo pasen como parámetro.

4. **Separación panel / agente.** `panel/backend` es FastAPI plano y
   determinístico; el agente es otra cosa. **El 90% del producto no pasa por un
   LLM**, y de ahí sale la unit economics.

5. **El prompt como archivo versionado** (`SKILL.md`, `VERSION`). Acá se
   convierte en el prompt por vertical: uno para gastronomía, uno para salud.

---

## 3. wa-claude

`git@github.com:JuaniSarmiento/wa-claude.git`
Último commit: **2026-08-14**. Vivo. Es de Juani.

### Qué hay

```
src/bot.js          2129 líneas · Baileys, reconexión, media, replies
src/claude.js       1907 líneas · el puente con @anthropic-ai/claude-agent-sdk
src/outbox.js       cola de salida
src/msg-store.js    historial local (Baileys no da el completo)
src/anti-ban.js     mitigaciones de baneo
src/reply-tracker.js · voice.js · wa-send.js · memory.js · long-memory.js
```

### Lo que se rescata

**El patrón de sesión por conversación.** En `claude.js`:

```js
const sonnetSessions = new Map();   // chatId -> resumeId
```

y los resume-ids **persistidos a disco**, porque vivir solo en RAM ya rompió
una vez. Acá es idéntico: **una sesión de agente por número de cliente**, con
resume, para que el tipo pueda escribir "che, agregame una gaseosa" diez minutos
después y el agente sepa de qué habla.

También sirve directo:

| Pieza | Para qué |
|---|---|
| `runSdkQuery` con `mcpServers`, `systemPrompt`, `resume`, timeout y abort | El envoltorio del agente, ya endurecido |
| Streaming por `onChunk` con consumidor aislado | Que el consumidor no pueda tumbar la query |
| `outbox.js` | Reintentos de envío. En un producto pago esto no es opcional |
| `msg-store.js` | Historial propio, porque el canal no te lo da completo |
| El timeout con aborto por cuelgue | Ya documentado en el código |

### Lo que NO se rescata

**Baileys. Todo lo que sea Baileys se tira.**

`bot.js` entero, `anti-ban.js`, el manejo de QR, la reconexión, el parche de
versión caduca. Nada de eso existe en la API oficial.

Motivo, y es la decisión más importante del proyecto: Baileys es WhatsApp por
ingeniería inversa. Para Jarvis está perfecto, si banean es el número propio.
**Para un cliente que paga, un baneo le corta el canal por donde vende.** Y no
hay razón económica para el riesgo: las conversaciones de servicio en la API
oficial hoy **no se cobran**. Ver [`WHATSAPP.md`](WHATSAPP.md).

Lo que reemplaza a `bot.js` es un receptor de **webhooks** y un cliente REST.
Bastante menos código y sin sorpresas.

---

## Cómo se juntan

```
   WhatsApp Cloud API  (oficial)
            │  webhook
            ▼
   ┌─────────────────────┐
   │  Gateway            │  ← el patrón de wa-claude, sin Baileys
   │  sesión por número  │
   └─────────┬───────────┘
             │ Agent SDK + MCP
   ┌─────────▼───────────┐
   │  Agente del negocio │  ← el patrón de Skill-Moodle
   │  tools tipadas      │
   └─────────┬───────────┘
             │ HTTP
   ┌─────────▼───────────┐
   │  Core (Go)          │  ← la base de BlendPos
   │  motor + catálogo   │
   │  + cobro            │
   └─────────┬───────────┘
             │
   ┌─────────▼───────────┐
   │  Sidecar ARCA       │  ← tal cual de BlendPos
   └─────────────────────┘
```

**El agente no toca la base de datos nunca.** Habla con el core por HTTP, igual
que el MCP de Moodle habla con la API de Moodle. Eso mantiene el core
determinístico y testeable, y deja al LLM en la capa donde puede equivocarse
sin romper nada.
