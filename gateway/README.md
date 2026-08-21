# Gateway de WhatsApp

El puente entre la **Cloud API oficial de Meta** y el **agente MCP**. Recibe el
webhook, resuelve de qué comercio es el número, corre una query del Agent SDK
con el MCP del agente atado a ese negocio, y manda la respuesta por el outbox.

Nada de Baileys. De `wa-claude` se rescató el patrón (sesiones con `resume`,
outbox con reintentos, timeout con `AbortController`), no el código.

```
Meta ──POST──▶ /webhook/whatsapp
                 ├─ firma X-Hub-Signature-256 sobre el RAW body → si no cierra, 401
                 ├─ 200 a Meta YA (si tardás, reintenta y duplica)
                 └─ async:
                     ├─ phone_number_id → tenant (negocio, token, vertical)
                     ├─ SETNX wa:msg:<id> TTL 24h → si ya estaba, corta
                     ├─ Agent SDK (systemPrompt = SKILL.md del vertical)
                     │    └─ MCP: uv --directory ../agente run python server.py
                     └─ outbox:<phone_number_id> → Graph API
```

## Correr

```bash
npm install
cp env.example .env          # completar los secretos
cp tenants.example.json tenants.json
node --env-file=.env src/index.js
npm test
```

No hay `dotenv`: el gateway lee `process.env` y listo. En desarrollo se le pasa
el archivo con la bandera nativa de Node (`--env-file`); en el deploy las
variables las inyecta el orquestador. `npm start` corre sin el archivo, para
cuando el entorno ya viene puesto.

Necesita **redis** arriba (`make infra` en la raíz del repo) y el **core**
respondiendo en `CORE_URL`.

## Variables

| Variable | Default | Para qué |
|---|---|---|
| `PORT` | 8090 | |
| `REDIS_URL` | `redis://localhost:6379` | idempotencia, outbox y cola de salidas |
| `META_APP_SECRET` | — | verificar la firma del webhook. **Sin esto no arranca** |
| `META_VERIFY_TOKEN` | — | el `hub.verify_token` del alta del webhook |
| `META_GRAPH_TOKEN` | — | bearer para mandar mensajes |
| `GRAPH_URL` | `https://graph.facebook.com/v21.0` | sólo para apuntar a un mock |
| `CORE_URL` | `http://localhost:8080` | se le pasa al MCP |
| `TENANTS_PATH` | `./tenants.json` | |
| `SESIONES_DIR` | `./data/sesiones` | |
| `ANTHROPIC_API_KEY` | — | |
| `MODELO` | `claude-haiku-4-5-20251001` | el chat va en el barato (ver docs/WHATSAPP.md) |

## Dar de alta un comercio

1. En el core, como admin, **rotar el token de agente** del negocio. El core lo
   muestra **una sola vez**: si se pierde, se rota de nuevo.
2. Agregarlo a `tenants.json` con el `phone_number_id` que da Meta (no el
   número de teléfono: el id):

```json
{
  "106540352242922": {
    "negocio": "Pizzería Sarmiento",
    "agente_token": "cop_...",
    "vertical": "gastronomia",
    "wa_numero": "+5492611234567"
  }
}
```

3. Reiniciar el gateway (los tenants se leen al arrancar).

`vertical` elige el prompt: tiene que existir `agente/skills/<vertical>/SKILL.md`.

**`tenants.json` está en el `.gitignore` y tiene que seguir estándolo**: cada
`agente_token` es acceso completo a la agenda de un comercio.

Un `phone_number_id` que no está en el archivo se loguea y se descarta en
silencio. Contestarle a un número que no administramos es peor que ignorarlo.

## Los módulos

| Archivo | Qué hace |
|---|---|
| `src/config.js` | entorno, con defaults y validación al arrancar |
| `src/tenants.js` | `phone_number_id` → negocio, token y vertical |
| `src/firma.js` | HMAC sha256 sobre el raw body, con `timingSafeEqual` |
| `src/webhook.js` | GET del challenge, POST con firma + 200 inmediato + idempotencia |
| `src/sesiones.js` | `<phone_number_id>:<telefono>` → `resumeId`, write-through a disco |
| `src/agente.js` | una query del Agent SDK por mensaje, con timeout de 90s |
| `src/outbox.js` | cola por comercio, 3 intentos con backoff, DLQ |
| `src/salidas.js` | consumidor de `salidas_whatsapp` (lo que encola el core) |
| `src/index.js` | express con captura del raw body, workers y apagado ordenado |

## Colas de redis

| Clave | Quién escribe | Quién lee |
|---|---|---|
| `wa:msg:<message.id>` | el webhook (SETNX, TTL 24h) | el webhook |
| `outbox:<phone_number_id>` | webhook y salidas | el worker del outbox |
| `outbox:muertos` | el outbox al agotar reintentos | **vos**, a mano |
| `salidas_whatsapp` | el core (E7) | el worker de salidas |

Payload que espera `salidas_whatsapp`:

```json
{
  "negocio_id": "uuid",
  "wa_phone_id": "106540352242922",
  "telefono": "5492619876543",
  "tipo": "plantilla",
  "plantilla": "recordatorio_turno",
  "variables": { "nombre": "Carla", "fecha_hora_local": "jueves 10:30", "negocio": "Pizzería" },
  "compromiso_id": "uuid"
}
```

`tipo` también puede ser `"texto"` con el campo `texto`.

## Cosas que muerden

- **La firma se calcula sobre el body crudo.** Si se parsea con
  `express.json()` y se reserializa, no cierra nunca: orden de claves, espacios
  y escapes unicode no vuelven iguales. Por eso `index.js` usa `express.raw` y
  parsea el JSON a mano después de guardarse el `Buffer`.
- **El 200 va antes de procesar.** Correr el modelo puede tardar 90s; Meta no
  espera y reintenta. Con la idempotencia el reintento no hace daño, pero el
  200 tardío igual te llena la cola.
- **Las sesiones van a disco.** El `Map` en memoria de `wa-claude` se perdía en
  cada restart y el cliente tenía que repetir todo. Acá cada `guardar` escribe
  el archivo (atómico, tmp + rename).
- **Las plantillas toman parámetros posicionales.** El `variables` que manda el
  core es un objeto: el orden que vale es el de las claves del JSON. Si
  necesitás control fino, mandá un array.
- **La ventana de 24hs es real.** Pasada esa ventana Meta sólo acepta
  plantillas aprobadas: un `tipo: "texto"` proactivo rebota y termina en
  `outbox:muertos`. Ahí se ve, no se pierde.
- **El agente sólo puede usar sus tools** (`allowedTools: ['mcp__copiloto']`,
  `settingSources: []`). Sin eso el SDK le deja Bash y Write, y un prompt
  injection en un mensaje de WhatsApp pasaría de chiste a acceso al disco.

## Tests

`npm test` (vitest). Todo con inyección de dependencias: **no hay red, no hay
API key, no hay redis de verdad**. El Agent SDK y la Graph API se inyectan como
funciones, y redis es un fake en memoria (`tests/ayudas/redis-falso.js`).

Cubre: firma (válida, ausente, con otro secreto, largo distinto), GET del
challenge, idempotencia (mismo id dos veces → un solo procesamiento y una sola
respuesta), parsing de payloads reales de la Cloud API (texto, botón
interactivo, opción de lista, botón de plantilla, audio, imagen, statuses,
lote de dos), tenant desconocido, disculpa ante timeout y ante error del
modelo, outbox (backoff, reintento al frente de la cola, DLQ a los 3 intentos,
cuerpo que se le manda a Graph), sesiones (persistencia entre restarts,
expiración a 24hs, archivo corrupto) y el consumidor de `salidas_whatsapp`.
