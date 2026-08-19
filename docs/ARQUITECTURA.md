# Arquitectura

## La idea central

Un **pedido**, una **reserva de mesa** y un **turno médico** son el mismo objeto.

| | Recurso que ocupa | Duración | Quién confirma |
|---|---|---|---|
| Pedido | capacidad de cocina | una franja | el local |
| Reserva | una mesa | un rato | según config |
| Turno | un profesional | un rato | el bot |

**Un cliente pidió un recurso, para un momento, y eso pasa por estados hasta
cerrarse.**

Todo lo demás del producto es periferia de eso.

Esa unificación no es una simplificación cómoda: es la razón por la que dos
verticales muy distintos comparten el 80% del código y por la que el panel y los
reportes salen una sola vez.

---

## Las capas

```
┌───────────────────────────────────────────────────────────┐
│  WhatsApp Cloud API (oficial)                             │
└────────────────────┬──────────────────────────────────────┘
                     │ webhook entrante / REST saliente
┌────────────────────▼──────────────────────────────────────┐
│  GATEWAY                                     Node          │
│  · resuelve el negocio por phone_number_id                 │
│  · sesión de agente por número de cliente (resume)         │
│  · outbox con reintentos                                   │
│  · historial propio de la conversación                     │
└────────────────────┬──────────────────────────────────────┘
                     │ Claude Agent SDK + MCP
┌────────────────────▼──────────────────────────────────────┐
│  AGENTE                                      Python/MCP    │
│  · prompt por vertical (gastronomía / salud)               │
│  · tools tipadas, acotadas, sin acceso a la base           │
└────────────────────┬──────────────────────────────────────┘
                     │ HTTP con token de negocio
┌────────────────────▼──────────────────────────────────────┐
│  CORE                                        Go            │
│  · motor de compromisos      · catálogo                    │
│  · disponibilidad y capacidad · clientes                   │
│  · cobro y cierre             · panel API                  │
└────────────────────┬──────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
┌───────▼────────┐      ┌─────────▼─────────┐
│  PostgreSQL    │      │  Sidecar ARCA     │  Python
└────────────────┘      └───────────────────┘
```

### La regla que sostiene todo

**El agente nunca toca la base de datos.** Habla con el core por HTTP, igual que
el MCP de Skill-Moodle habla con la API de Moodle.

Consecuencias, y son las que hacen que esto funcione:

- El core es determinístico y testeable sin un LLM en el medio
- **El 90% del producto no pasa por un modelo**, que es de donde sale el margen
- El panel y el agente usan la misma API, así que no se desincronizan
- Un bug del modelo no puede corromper datos: solo puede llamar mal a una tool
  que ya valida

---

## Modelo de datos

### El núcleo

```sql
-- ─── Tenant ────────────────────────────────────────────────
negocio
  id              uuid pk
  nombre          text
  vertical        enum('gastronomia','salud')
  timezone        text            -- America/Argentina/Mendoza
  wa_phone_id     text unique     -- el phone_number_id de Meta
  wa_waba_id      text
  config          jsonb           -- políticas, ver abajo
  creado_en       timestamptz

-- ─── Recursos: lo que se ocupa ─────────────────────────────
recurso
  id              uuid pk
  negocio_id      uuid fk
  tipo            enum('profesional','mesa','cocina')
  nombre          text            -- "Dra. Gómez", "Mesa 4", "Cocina"
  capacidad       int             -- mesa: cubiertos · cocina: unidades/hora
  activo          bool

-- ─── Catálogo: lo que se pide ──────────────────────────────
servicio
  id              uuid pk
  negocio_id      uuid fk
  categoria_id    uuid fk null
  nombre          text            -- "Doble cheddar" | "Arreglo"
  duracion_min    int null        -- null = no consume tiempo (un producto)
  precio_base     numeric(12,2)
  disponible      bool            -- EL interruptor. Ver PANEL.md
  activo          bool

-- qué recurso puede prestar qué servicio
servicio_recurso
  servicio_id     uuid fk
  recurso_id      uuid fk
  primary key (servicio_id, recurso_id)

-- ─── Disponibilidad ────────────────────────────────────────
horario
  id              uuid pk
  recurso_id      uuid fk
  dia_semana      int             -- 0..6
  desde           time
  hasta           time

excepcion
  id              uuid pk
  recurso_id      uuid fk
  desde           timestamptz
  hasta           timestamptz
  motivo          text            -- feriado, congreso, vacaciones

-- ─── EL MOTOR ──────────────────────────────────────────────
compromiso
  id              uuid pk
  negocio_id      uuid fk
  cliente_id      uuid fk
  recurso_id      uuid fk null    -- null mientras no se asignó
  tipo            enum('pedido','reserva','turno')
  estado          enum(...)       -- ver máquina de estados
  inicio          timestamptz null
  fin             timestamptz null
  demora_min      int null        -- lo que puso el local
  entrega         enum('retira','delivery','en_local') null
  direccion       text null
  total           numeric(12,2)
  origen          enum('whatsapp','panel','telefono')
  nota            text null
  creado_en       timestamptz
  confirmado_en   timestamptz null
  cerrado_en      timestamptz null

linea_compromiso
  id              uuid pk
  compromiso_id   uuid fk
  servicio_id     uuid fk
  cantidad        int
  precio_unit     numeric(12,2)   -- congelado al momento
  nota            text null       -- "sin cebolla"

-- ─── Bloqueo temporal ──────────────────────────────────────
-- Sin esto, dos personas sacan el mismo turno mientras completan sus datos.
hold
  id              uuid pk
  recurso_id      uuid fk
  inicio          timestamptz
  fin             timestamptz
  expira_en       timestamptz     -- típico: ahora + 10 min
  sesion          text            -- el número de WhatsApp

-- ─── Clientes ──────────────────────────────────────────────
cliente
  id              uuid pk
  negocio_id      uuid fk
  telefono        text            -- llega gratis por WhatsApp
  nombre          text
  documento       text null
  cobertura_id    uuid fk null    -- obra social / prepaga
  notas           text null
  unique (negocio_id, telefono)

-- ─── Precio por cobertura (viene de lista_precios de BlendPos) ──
cobertura
  id              uuid pk
  negocio_id      uuid fk
  nombre          text            -- OSEP, OSDE 210, particular

precio_cobertura
  servicio_id     uuid fk
  cobertura_id    uuid fk
  precio          numeric(12,2)
  coseguro        numeric(12,2) null
  primary key (servicio_id, cobertura_id)
```

### La máquina de estados

```
                 ┌──────────────┐
   (bot crea)───▶│  PENDIENTE   │  esperando confirmación
                 └──┬────────┬──┘
          confirmar │        │ rechazar
                    ▼        ▼
            ┌───────────┐  ┌───────────┐
            │CONFIRMADO │  │ RECHAZADO │ ── fin
            └─────┬─────┘  └───────────┘
                  │ arranca
                  ▼
            ┌───────────┐
            │ EN_CURSO  │   en cocina · paciente adentro
            └─────┬─────┘
                  ▼
            ┌───────────┐
            │  LISTO    │   para retirar · en camino
            └─────┬─────┘
                  ▼
            ┌───────────┐
            │ COMPLETADO│ ──▶ cobro ──▶ comprobante ARCA
            └───────────┘

    Desde PENDIENTE o CONFIRMADO:
      → CANCELADO   (el cliente avisó)
      → AUSENTE     (no vino y no avisó · solo salud)
```

**`AUSENTE` es una transición de primera clase, no un caso raro.** Es la métrica
que se le vende al consultorio, así que se modela desde el día uno.

### La política de confirmación, por config

Es la diferencia real entre los dos verticales, y **es configuración, no código**:

```jsonc
// negocio.config
{
  "confirmacion": {
    "pedido":  "humana",     // la cocina se satura, decide el local
    "reserva": "humana",
    "turno":   "automatica"  // la agenda ya sabe si el hueco está libre
  },
  "hold_minutos": 10,
  "recordatorio_horas_antes": 24,
  "demoras_sugeridas": [15, 25, 40],   // presets, pero SIEMPRE con campo libre
  "acepta_delivery": true,
  "radio_delivery_km": 3
}
```

**Por qué en gastronomía confirma un humano:** la agenda de un consultorio sabe
con certeza si un hueco está libre. La cocina no: un sábado a las 21 el sistema
no tiene forma de saber que el parrillero está desbordado. Si el bot acepta solo,
el cliente espera algo que no llega y la culpa es del producto.

Es el mismo principio de oro del Copiloto Moodle: **la IA prepara, el humano
confirma.**

---

## El core: qué expone

```
POST   /api/compromisos                  crear (bot o panel)
PATCH  /api/compromisos/:id/estado       transición con validación
GET    /api/compromisos?estado=&fecha=   el tablero
POST   /api/disponibilidad/consultar     huecos reales de un servicio
POST   /api/holds                        bloquear mientras se completa
DELETE /api/holds/:id                    liberar
GET    /api/servicios                    catálogo con `disponible`
PATCH  /api/servicios/:id/disponible     EL interruptor
GET    /api/clientes/por-telefono/:tel   reconocer al que escribe
POST   /api/cobros                       cerrar y facturar
GET    /api/reportes/*                   la analítica
```

**Las transiciones de estado se validan en el core, nunca en el agente.** Si el
modelo intenta pasar de `PENDIENTE` a `COMPLETADO`, el core lo rechaza.

---

## El agente: las tools

Siguiendo el patrón de `Skill-Moodle/mcp/server.py`, con FastMCP:

```python
@mcp.tool()
async def ver_catalogo(categoria: str | None = None) -> dict:
    """Lo que el negocio ofrece HOY. Nunca lista lo que tiene disponible=false."""

@mcp.tool()
async def consultar_disponibilidad(
    servicio: str,
    desde: str | None = None,
    recurso: str | None = None,
) -> dict:
    """Huecos reales. Ya descuenta holds y excepciones."""

@mcp.tool()
async def armar_compromiso(lineas: list[dict], entrega: str | None = None) -> dict:
    """Arma el borrador y devuelve el total. NO lo confirma."""

@mcp.tool()
async def bloquear(recurso: str, inicio: str, fin: str) -> dict:
    """Hold de 10 minutos mientras se completan los datos."""

@mcp.tool()
async def confirmar(compromiso_id: str, confirmado: bool = False) -> dict:
    """Escritura. Requiere confirmado=True, igual que responder_mensaje en Moodle."""

@mcp.tool()
async def cancelar(compromiso_id: str, motivo: str, confirmado: bool = False) -> dict: ...

@mcp.tool()
async def datos_del_negocio() -> dict:
    """Horarios, dirección, medios de pago, coberturas. El agente arranca por acá."""
```

### Reglas del agente, no negociables

1. **Nunca inventa un precio.** Sale del catálogo o no se dice.
2. **Nunca promete una demora** que no vino del panel o de la configuración.
3. **Nunca da consejo clínico.** En salud: agenda, no opina. Si preguntan por un
   síntoma, deriva a la consulta.
4. **Toda escritura pasa por `confirmado=True`.**
5. **Identidad por transporte, jamás por argumento.** El negocio sale del
   `phone_number_id` del webhook y el cliente del número que escribe. Que el
   modelo no pueda pasar un `negocio_id` es lo que impide que un tenant lea a otro.

### Modelos

Igual que en el análisis del Copiloto Moodle:

| Uso | Modelo | Por qué |
|---|---|---|
| Chat con el cliente | el barato (Haiku / Flash) | Es el 95% del volumen y es lo que dispara el costo |
| Interpretar un pedido enredado | el barato | Alcanza de sobra |
| Casos raros o ambiguos | el fuerte, puntual | Quirúrgico, no por defecto |

Con caché de prompts, porque el system prompt y las tools se repiten en cada
turno. Ver la cuenta en [`WHATSAPP.md`](WHATSAPP.md).

---

## Multi-tenant

Copiado del multi-tenant de Skill-Moodle, que ya está resuelto:

- **Un token por negocio.** Nunca un token global que el agente pueda apuntar a
  cualquier lado.
- **La identidad viaja por transporte**, no como parámetro de tool.
- **Toda query del core filtra por `negocio_id`** a nivel repositorio, no de
  handler. Se testea que sea imposible saltearlo.
- **Rol de solo lectura** para reportes.

---

## Datos sensibles (Ley 25.326)

Aplica al vertical salud desde el primer día.

| Regla | Cómo |
|---|---|
| Mínimo dato necesario | Nombre, teléfono, cobertura. **Nada de motivo de consulta libre.** El tipo de práctica alcanza. |
| Cifrado en reposo | Documento y notas del cliente, cifrados a nivel campo |
| Auditoría | `audit_log` de BlendPos, tal cual. Quién leyó qué ficha y cuándo |
| Retención | Política explícita de borrado de conversaciones |
| Nada de historia clínica | **No se guarda.** Es otro producto, con otro marco legal. Tentación a evitar. |
| Secretos | Ni tokens ni credenciales en la base ni en logs. Gestor de claves o variables de entorno |

---

## Stack

| Capa | Qué | De dónde |
|---|---|---|
| Core | Go 1.24 · Gin · JWT · zerolog · viper · decimal | BlendPos |
| Migraciones | golang-migrate, up/down | BlendPos |
| Base | PostgreSQL | BlendPos |
| Caché / colas | Redis | BlendPos |
| Fiscal | Python · FastAPI · pysimplesoap parcheado | BlendPos `afip-sidecar` |
| Agente | Python · FastMCP · Claude Agent SDK | Skill-Moodle |
| Gateway | Node | wa-claude, sin Baileys |
| Panel | Vite · React · TS | Skill-Moodle `panel/web` |
| Deploy | Docker Compose detrás de Traefik | Copiloto Moodle |

**Nada de esto es una elección nueva.** Son las cinco decisiones de stack que ya
están tomadas y probadas en producción en los tres repos.

---

## Gotchas heredados, para no repetirlos

Cada uno costó debug real en su repo de origen:

- **`decimal`, nunca `float`, para plata.** Ya está en `go.mod` de BlendPos.
- **El bundle del panel con nombre fijo necesita cache-busting `?v=N`**, si no el
  navegador sirve el viejo. Pasó en el Copiloto Moodle.
- **Un `docker compose restart` no relee `env_file`.** Hace falta
  `up -d --force-recreate` para que un cambio de modelo tome efecto.
- **Idempotencia en el webhook.** Meta reintenta. Un mensaje procesado dos veces
  no puede crear dos pedidos.
- **Timeout con aborto en las queries del agente**, ya resuelto en `claude.js`.
- **Los resume-id de sesión se persisten a disco**, no viven solo en RAM.
- **Usar el OAuth personal para servir a clientes viola el ToS de Anthropic.** El
  camino es API key. Ya documentado en el Copiloto Moodle.
