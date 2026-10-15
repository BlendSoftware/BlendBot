# Plan: que cada comercio conecte su WhatsApp solo (Embedded Signup)

> Investigado el **15/10/2026** contra la documentación oficial de Meta (las
> páginas `.md` que Meta publica en su índice
> `https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt`)
> y contra el código de `main` en el commit `34e5411`. Es un plan: no se tocó
> código, ni Meta, ni nada desplegado.

---

## 1. Resumen

1. El mecanismo es **Embedded Signup v4**: el dueño aprieta un botón en el panel, hace el alta con Meta en un popup y el panel recibe `waba_id`, `phone_number_id` y un `code` que vence en **30 segundos** y que el core cambia por un token de negocio.
2. Antes de eso BlendSoftware tiene que ser **Tech Provider**: portfolio verificado, App Review con acceso avanzado a `whatsapp_business_messaging` y `whatsapp_business_management`, y Access Verification para pasar de 10 a 200 altas por semana.
3. Como Tech Provider **cada comercio carga su tarjeta en su WABA y Meta le factura a él**; desde el 1/10/2026 Meta cobra cada respuesta del bot (servicio) a **US$ 0,026 en Argentina**, más de tres veces lo que asume `docs/WHATSAPP.md`.
4. En el código, el cambio de fondo es sacar los tenants de `tenants.json` y el `META_GRAPH_TOKEN` global: el core guarda por negocio el token de Meta cifrado y el gateway se lo pide al core por una ruta interna.
5. Se puede hacer en 7 etapas chicas; las 3 primeras no dependen de Meta y se pueden empezar ya, mientras corre la verificación del negocio.

---

## 2. Lo que depende de Meta

### 2.1 Pasos, en orden

| # | Paso | Quién | Tiempo | Fuente |
|---|---|---|---|---|
| 1 | Verificar el portfolio **Blendsoftware** (nombre, dirección, teléfono, mail, web; documentos si Meta no encuentra el negocio) | Juani o Lauti, en Meta Business Suite | **No verificado.** La doc no da plazo | [Become a Tech Provider, Step 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) |
| 2 | Completar la app **BlendBot** (`1654068459715368`): ícono, política de privacidad (ya existe `landing/public/privacidad.html`), categoría | Nosotros | Una tarde | misma página, "Review your app settings" |
| 3 | **App Review**: pedir acceso avanzado a `whatsapp_business_messaging` y `whatsapp_business_management`, con un texto y **un video separado por permiso** | Nosotros | "about 24 hours" en promedio | [App Review](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review) |
| 4 | **Access Verification** (necesaria para el cupo de 200 altas por semana) | Nosotros | **No verificado** | [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview) |
| 5 | Configurar **Facebook Login for Business**: dominios permitidos (sólo HTTPS) y una configuración de Embedded Signup; guardar el `config_id` | Nosotros | Una hora | [Implementation, Steps 1 y 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation) |
| 6 | Suscribir la app al campo de webhook **`account_update`** (y, si hay coexistencia, a `history`, `smb_app_state_sync`, `smb_message_echoes`) | Nosotros | Minutos | Implementation, "Requirements"; [Coexistence, Step 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) |

Citas que sostienen la tabla:

- "To become a tech provider you need to verify your business with Meta" y "Your business must be verified before you can start the app review process." (Become a Tech Provider)
- `whatsapp_business_messaging` con acceso avanzado: "required to send messages on behalf of your clients". `whatsapp_business_management` con acceso avanzado: "required to access your clients' WABAs. Without it, API calls that use this permission on WABAs not owned by your business return error code `200`." (Become a Tech Provider)
- Videos: "The first video must show a message created and sent from your app and received in the WhatsApp client" y "The second video must show your app being used to create a message template." Vale grabar el cURL del panel **API Setup** y el **WhatsApp Manager** en lugar de la app propia. (Become a Tech Provider)
- "Do not submit a video that includes multiple permissions supporting different use cases." y "you cannot submit a screenshot". (App Review)
- "The average turnaround time for App Review is about 24 hours. [...] You don't need to wait for Embedded Signup to be fully implemented to start this process." (App Review)
- "By default, you can onboard up to 10 new business customers in a rolling 7-day window." / "If you complete Business Verification, App Review, and Access Verification, your limit is automatically increased to 200 new business customers in a rolling 7-day window." (Embedded Signup overview)

**¿Hace falta `business_management`?** No para el camino básico. Las páginas de Tech Provider y de App Review sólo piden los dos permisos de WhatsApp. `business_management` aparece en dos casos: compartir línea de crédito (sólo Solution Partners) y la API `/<CLIENT_BUSINESS_ID>/system_user_access_tokens` para generar o renovar tokens de negocio ([Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business), tabla de parámetros: "This access token requires the `business_management` permission"). Si se decide renovar tokens por API (ver 4.6), hay que sumarlo al App Review.

**Antes del App Review se puede probar igual.** "Business apps are automatically approved for Standard Access [...] Make sure your test users have a `developer` or `admin` role in the Meta app" (App Review). Para los pilotos previos a la aprobación, el dueño del comercio tiene que tener un rol en la app.

### 2.2 El flujo técnico (v4)

**Versión.** La vigente es v4. "Embedded signup v2 will be deprecated on October 15, 2026" (aviso en todas las páginas de Embedded Signup), y la tabla de [Versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions) marca v2 y v3 "Available until: October, 2026". **Hoy es 15/10/2026: sólo v4.** En v4 los productos se eligen en la configuración y `extras` va vacío o con `setup: {}`: "The extras object is purposely empty for v4" (Versions), y el ejemplo de Implementation usa `extras: { setup: {} }`.

**Frontend (panel).** Fuente: [Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation).

1. Cargar `https://connect.facebook.net/en_US/sdk.js` y `FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: 'v25.0' })`. La doc dice que la versión es irrelevante para Embedded Signup: "Set this to the latest API version: v25.0".
2. `FB.login(callback, { config_id, response_type: 'code', override_default_response_type: true, extras: { setup: {} } })`.
3. Un listener de `message` que descarta todo lo que no venga de Facebook (`if (!event.origin.endsWith('facebook.com')) return;`) y lee `data.type === 'WA_EMBEDDED_SIGNUP'`. Trae `data.waba_id`, `data.phone_number_id`, `data.business_id` y `event`:
   - `FINISH` (Cloud API), `FINISH_ONLY_WABA` (sin número), `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (coexistencia), `ERROR`;
   - `CANCEL` con `current_step` si abandonó;
   - "both clicking **Finish** and closing the popup [...] on the final screen are considered successful onboarding".
4. El callback de `FB.login` trae `response.authResponse.code`. "The exchangeable token code has a time-to-live of 30 seconds". El panel lo manda al core **en el acto**, junto con lo del listener.

**Backend (core), server a server.** Fuente: [Onboarding for Tech Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider). "Perform all of the requests described below using server-to-server requests. Do not use client-side requests."

| Paso | Llamada | Notas |
|---|---|---|
| 1. Code → token | `GET https://graph.facebook.com/v25.0/oauth/access_token?client_id=<APP_ID>&client_secret=<APP_SECRET>&code=<CODE>` | Devuelve el "business token" (Business Integration System User). El `APP_SECRET` es el mismo `META_APP_SECRET` del gateway |
| 2. Suscribir la app a la WABA | `POST /<WABA_ID>/subscribed_apps` con `Authorization: Bearer <BUSINESS_TOKEN>` | Responde `{ "success": true }` |
| 3. Registrar el número | `POST /<PHONE_NUMBER_ID>/register` con `{ "messaging_product": "whatsapp", "pin": "<6 dígitos>" }` | El PIN queda como PIN de verificación en dos pasos. **Se saltea en coexistencia** ("skip the phone number registration step, as the number is already registered") |
| 4. (Opcional) mensaje de prueba | `POST /<PHONE_NUMBER_ID>/messages` | Sólo con una ventana de servicio abierta |
| 5. Medio de pago | El comercio lo carga en WhatsApp Manager | Ver sección 3.1 |

Límites que muerden: el registro admite "10 requests per business number in a 72-hour moving window"; al pasarse, error `133016` y el número queda bloqueado 72 horas ([Register a phone number](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration)). Por eso el alta tiene que ser **idempotente por paso** y no reintentar `/register` a ciegas.

**Webhook por WABA.** No hace falta configurar nada por WABA: "Meta sends webhooks to the callback URL set on your app" y, si no hay override en el número ni en la WABA, "the webhook falls back to your app's callback URL" ([Override the callback URL](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override)). Existe el override (`override_callback_uri` + `verify_token` en `POST /<WABA_ID>/subscribed_apps`, o en el número), pero para nosotros alcanza con la URL de la app y rutear por `phone_number_id`, que es lo que ya hace el gateway. La firma `X-Hub-Signature-256` se calcula con el app secret ([Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)), así que es la misma para todas las WABAs.

**Desconexión del lado de Meta.**

- Nosotros: `DELETE /<WABA_ID>/subscribed_apps` ([Webhooks for partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks)).
- `POST /<PHONE_NUMBER_ID>/deregister` existe, pero "You cannot use this endpoint to deregister a business phone number that is in use with both Cloud API and the WhatsApp Business app" (Register a phone number).
- El comercio también puede cortarnos: "Your business clients can invalidate business integration system User access tokens by going to Business Manager > Settings > Business Settings > Integrations > Connected apps and removing your app" (Facebook Login for Business). Llega como `account_update` con `PARTNER_APP_UNINSTALLED` o `PARTNER_REMOVED` ([account_update](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update)).

**Vencimiento del token.** La doc tira para dos lados y hay que mirarlo en el dashboard (va a la sección 7):

- Facebook Login for Business: el token de negocio "Defaults to **never expire**".
- La plantilla que recomienda Implementation se llama "WhatsApp Embedded Signup Configuration **With 60 Expiration Token**".
- Al crear la configuración se elige "the type of access token [...] and token expiration" (Facebook Login for Business).

### 2.3 Límites para negocios nuevos

| Tema | Lo que dice Meta | Fuente |
|---|---|---|
| Mensajes iniciados por el negocio | "Newly created business portfolios have a messaging limit of 250" destinatarios únicos en 24 horas **fuera** de la ventana de servicio. Sube a 2.000 verificando el negocio o mandando 2.000 plantillas de buena calidad en 30 días; después escala solo | [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) |
| A quién afecta | El límite es por portfolio del **comercio** y lo comparten todos sus números | misma |
| Para BlendBot | Las respuestas dentro de la ventana de 24 horas no cuentan. Cuentan los recordatorios y los avisos por plantilla del core (`salidas_whatsapp`). Con 250 por día sobra para un local | Juicio, no cita |
| Display name | Se verifica sola "When you reach a higher messaging limit"; si la rechazan, `name_status = DECLINED`. Cambiarla: 10 veces cada 30 días, y después de aprobada hay 14 días para re-registrar el número (o sea, otro `/register` con el PIN guardado) | [Display names](https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names) |
| Número | Lo verifica el comercio dentro del flujo ("enter and verify their business phone number") | Embedded Signup overview |
| Coexistencia | Throughput fijo de 20 mensajes por segundo | Coexistence, "Limitations" |

### 2.4 La app "BlendBot" y el número de prueba

- **La app sirve de base.** Para ser Tech Provider hace falta "A Meta app with the WhatsApp use case and a connected business portfolio" (Become a Tech Provider). Si la app `1654068459715368` ya tiene el caso de uso WhatsApp y cuelga del portfolio Blendsoftware, es la misma app que pasa el App Review; no hay que crear otra. **No pude confirmar desde acá que sea de tipo Business ni que tenga el caso de uso**: hay que mirarlo en el dashboard.
- **El número de prueba sirve para el App Review**: la doc acepta grabar el cURL de **API Setup** mandando un mensaje a un destinatario de prueba. También sirve como número del comercio de demo mientras se desarrolla.
- **El número de prueba no sirve para probar Embedded Signup**: el flujo pide verificar un número real dentro del popup. **No verificado** en la doc. Para la prueba de punta a punta hace falta un número real, que puede ser un chip de BlendSoftware.

---

## 3. Lo que tienen que decidir Juani y Lauti

### 3.1 Quién le paga a Meta

Hechos:

- "Tech Providers do not have credit lines. Instead, clients onboarded by Tech Providers must provide their own payment method after onboarding is complete. Meta will then bill these clients for API usage, and the Tech Provider will bill for other services." ([Solution Partner overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview))
- "Note that becoming a Solution Partner is a lengthy process, so if you don't need a credit line and don't need to invoice your clients for API usage directly, consider becoming a Tech Provider instead." (misma)
- Hay una tercera vía: armar una *multi-partner solution* con un Solution Partner que comparta su línea de crédito (misma página, "Multi-Partner Solutions").

Precios vigentes (planilla USD y ARS del [rate card](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#rate-cards-and-volume-tiers), "effective October 1, 2026", bajada el 15/10/2026). Fila Argentina:

| Categoría | USD por mensaje | ARS por mensaje |
|---|---|---|
| Marketing | 0,0618 | 89,56 |
| Utility | 0,026 | 37,68 |
| Authentication | 0,026 | 37,68 |
| **Service** (respuestas del bot) | **0,026** | **37,68** |

- "Effective October 1, 2026, Meta will charge on a per-message basis for service messages" y "Any non-template message is charged as of October 1, 2026" ([Pricing for non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)).
- Siguen gratis los mensajes dentro de la ventana de 72 horas de un anuncio click-to-WhatsApp: "Messages sent within the 72-hour free entry point window [...] remain free for message delivery" (misma).

**Esto rompe dos números de `docs/WHATSAPP.md`:** utility figura a US$ 0,0075 (hoy es 0,026) y la conversación típica de 6 a 8 mensajes salientes a ~US$ 0,05 (hoy es US$ 0,16 a 0,21). Con 300 conversaciones por mes son **US$ 47 a 62 por mes sólo de Meta**, más que la IA. Las "primeras 1.000 conversaciones gratis" eran del modelo por conversación, que Meta marca como *Deprecated*.

| Opción | A favor | En contra |
|---|---|---|
| **A. Tech Provider, paga el comercio** | Es lo que Meta da sin trámite extra. BlendSoftware no pone plata ni corre riesgo de cobranza. Factura en pesos | El dueño tiene que cargar una tarjeta en WhatsApp Manager: otro paso donde se puede perder. Recibe dos facturas (Meta y BlendBot). El costo de Meta es variable y el dueño lo ve |
| B. Solution Partner, paga BlendSoftware y refactura | El dueño no ve a Meta. Precio cerrado | "lengthy process". Línea de crédito propia. Riesgo de que un comercio genere un gasto que no paga |
| C. Tech Provider con un Solution Partner que presta su línea de crédito | Experiencia de B sin ser Solution Partner | Dependencia y comisión de un tercero. No investigué condiciones comerciales |

**Recomendación: A.** Es la única que no agrega un trámite largo ni riesgo financiero mientras hay menos de 10 comercios. En el panel, después del alta, un paso explícito "cargá la tarjeta en Meta" con el link `https://business.facebook.com/wa/manage/home/` (Onboarding for Tech Providers, Step 5) y un estado que no se pone verde hasta que el primer mensaje sale. Revisar el precio del plan con la tabla de arriba antes de vender. Confianza: media; depende de cuánto le cueste al dueño promedio cargar la tarjeta, y eso no lo sabemos.

### 3.2 Coexistencia sí o no

Lo que dice Meta ([Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)):

- Requisitos: WhatsApp Business app "version **2.24.17** or higher", ser Tech Provider, Embedded Signup con session logging.
- Lo que se apaga en el celular: mensajes temporales, ver una vez, ubicación en tiempo real, listas de difusión (quedan de sólo lectura). Grupos, llamadas, catálogo, respuestas rápidas y etiquetas siguen en la app pero la API no los ve.
- Lo que manda la app sigue gratis: "messages sent by the business via the WhatsApp Business app will continue to be free".
- Hay que sincronizar historial y contactos dentro de las 24 horas, o el comercio tiene que repetir el alta. Ese paso se puede hacer una sola vez.
- El celular tiene que estar activo: desconexión por `PRIMARY_INACTIVITY` (~14 días) y `COMPANION_INACTIVITY` (~30 días).
- Para desconectar no hay API: el dueño lo hace desde la app ("Settings > Account > Business Platform > Disconnect Account").
- Argentina: la página no lista restricciones por país. **No verificado** que ande en Argentina.

| Opción | A favor | En contra |
|---|---|---|
| **A. Coexistencia como camino principal** | El dueño conserva su número y su app; mata la objeción "ese es mi número de toda la vida" (lo dice `docs/WHATSAPP.md`) | Más webhooks que digerir (`history`, `smb_message_echoes`, `smb_app_state_sync`). Ventana de 24 horas para sincronizar. **Problema de producto:** si el dueño contesta desde el celular, el bot no se entera y puede contestar encima. Hay que leer `smb_message_echoes` y pausar al bot en ese chat |
| B. Sólo número nuevo (Cloud API pura) | Más simple. Sin choque bot/humano | El comercio tiene que conseguir un número que no esté en ninguna app de WhatsApp. Fricción de venta alta |
| C. Las dos, eligiendo en el alta | Cubre a todos | Dos caminos que probar |

**Recomendación: C, en dos tiempos.** Etapas 1 a 6 con número nuevo (B), que es el camino más corto para probar el circuito entero. La coexistencia como etapa 7, con la regla "si el dueño escribió en ese chat en los últimos N minutos, el bot no contesta" resuelta **antes** de habilitarla. No es otra configuración: v4 la incluye en la misma configuración ("whatsapp_business_app_onboarding" figura en la tabla de Versions) y el flujo la ofrece sola si están suscriptos los webhooks. Confianza: media; no sabemos qué proporción de los comercios objetivo aceptaría un número nuevo.

### 3.3 El negocio de demo

Hoy el demo vive en `tenants.json` con el número de prueba de Meta.

| Opción | A favor | En contra |
|---|---|---|
| **A. Demo como un negocio más, conectado a mano** (una ruta admin que carga `wa_phone_id` + token sin pasar por el popup) | Se apaga `tenants.json` del todo y hay un solo camino de ruteo | Ruta admin que escribe tokens: hay que auditarla igual que el alta |
| B. Mantener `tenants.json` como fallback sólo para el demo | Cero trabajo | Dos fuentes de verdad para el ruteo. La que nadie mira se pudre |
| C. Pasar el demo por Embedded Signup con un chip propio | Prueba real del flujo, sirve para el App Review | Hace falta un número real |

**Recomendación: A ahora, C cuando haya chip.** Confianza: alta; la regla "una sola puerta" ya es la del outbox.

---

## 4. Cambios en el código, por componente

Leído en `main` (`34e5411`). Cada cambio con su riesgo.

### 4.1 Core (Go)

**a) Esquema.** Hoy `negocio` tiene `wa_phone_id TEXT UNIQUE` y `wa_waba_id TEXT` (`core/migrations/000001_motor.up.sql:24-25`, `core/internal/model/negocio.go:24-25`). Nueva migración `000009_whatsapp_conexion`, con tabla aparte para que el token no viaje nunca en `SELECT * FROM negocio` ni en `NegocioDesdeModel`:

```
whatsapp_conexion (
  negocio_id           UUID PRIMARY KEY REFERENCES negocio(id),
  waba_id              TEXT NOT NULL,
  phone_number_id      TEXT NOT NULL UNIQUE,
  business_id          TEXT,
  modo                 TEXT NOT NULL CHECK (modo IN ('cloud','coexistencia','manual')),
  estado               TEXT NOT NULL,   -- token_ok | suscripto | registrado | activo | desconectado | error
  token_cifrado        TEXT,            -- jamás en un response ni en un log
  pin_cifrado          TEXT,            -- para re-registrar tras cambio de display name
  token_vence_en       TIMESTAMPTZ,     -- NULL = no vence (sale de debug_token)
  ultimo_error         TEXT,
  conectado_por        UUID REFERENCES usuario(id),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

`negocio.wa_phone_id` se mantiene sincronizado, porque lo leen los workers de avisos y recordatorios (`core/internal/worker/aviso_pedido.go`, `recordatorios.go`, `cola.go` y otros) para armar el payload de `salidas_whatsapp`. El `down` borra la tabla y no toca `negocio`.
*Riesgo:* bajo. Ojo con el UNIQUE: dos negocios no pueden reclamar el mismo `phone_number_id`, y el alta tiene que devolver 409, no 500.

**b) Cifrado.** Ya existe `infra.Cifrador` (AES-256-GCM, nonce aleatorio por operación, error sin el dato) en `core/internal/infra/cifrado.go`. Se arma con `FISCAL_CIPHER_KEY` en `core/cmd/server/main.go:148-157`, y sin clave el módulo fiscal se apaga solo.
- **Reutilizar el código, no la clave.** Nueva variable `WA_CIPHER_KEY` (también `openssl rand -hex 32`) y una segunda instancia de `NewCifrador`. Así apagar ARCA no apaga WhatsApp, y una clave filtrada compromete un solo tipo de secreto. `ErrCifradoNoConfigurado` y el mensaje de error hoy nombran `FISCAL_CIPHER_KEY`; hay que parametrizar el nombre.
- **Mejora recomendada:** atar el texto cifrado al `negocio_id` con datos asociados de GCM (`Seal(..., aad=negocio_id)`), para que un token copiado de una fila a otra no descifre. Hoy `Cifrar` pasa `nil` como datos asociados. Es un método nuevo, no un cambio de firma.
- *Riesgo:* bajo. El código está probado (`cifrado_test.go`).

**c) Endpoint del alta: `POST /api/whatsapp/conexion`.** En el grupo `tenant`, con `RequireRole(RolDueno)`. El agente tiene que quedar afuera: `RestringirAgente` ya lo deja fuera porque la ruta no está en su allowlist, pero conviene un test que lo pruebe. Body: `{ code, waba_id, phone_number_id, business_id, evento }`. El `negocio_id` sale del JWT, como todo. Pasos:
1. Cambiar `code` por token (`GET /oauth/access_token`). Hay 30 segundos: esto va primero y sin nada lento delante.
2. **No creerle al navegador los IDs.** Con el token recién obtenido: `GET /<WABA_ID>/phone_numbers` (o `GET /debug_token` para ver los activos concedidos) y confirmar que `phone_number_id` pertenece a esa WABA. Sin esto, un dueño podría mandar el `phone_number_id` de otro comercio y quedarse con su ruteo.
3. Guardar el token cifrado con `estado = token_ok` **antes** de seguir: si después algo falla, no se pierde el token, que no se puede volver a pedir sin repetir el popup.
4. `POST /<WABA_ID>/subscribed_apps` → `suscripto`.
5. Si `evento != FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`: generar PIN de 6 dígitos con `crypto/rand`, guardarlo cifrado y `POST /<PHONE_NUMBER_ID>/register` → `registrado`. Si Graph devuelve `133016`, cortar y mostrar "esperá 72 horas"; no reintentar.
6. Rotar el token de agente (`RotarTokenAgente` ya existe en `negocio_token_service.go:35`) si el negocio no tiene uno. Ver 4.2 b.
7. Setear `negocio.wa_phone_id` y `wa_waba_id`, y auditar como `negocio.whatsapp.conectar`, igual que `AdminTokenHandler`.

`POST /api/whatsapp/conexion/reintentar` retoma desde el último estado guardado.
*Riesgo:* **alto.** Es la ruta que más rompe: credencial de terceros, 30 segundos de margen, rate limit de 72 horas y pasos que Meta no deja deshacer del todo. Pide tests de cada paso fallando por separado, con Graph falso.

**d) Desconexión: `DELETE /api/whatsapp/conexion`.** Dueño. `DELETE /<WABA_ID>/subscribed_apps`; en modo `cloud`, opcionalmente `POST /<PHONE_NUMBER_ID>/deregister`; borrar `token_cifrado` y `pin_cifrado`; `estado = desconectado`; `negocio.wa_phone_id = NULL`; auditar. Si Graph falla, igual se borra el token local: el corte de nuestro lado no puede depender de Meta.
*Riesgo:* medio. Liberar `wa_phone_id` deja los recordatorios pendientes de ese negocio sin número, y hoy `salidas.js` los descarta con un log (`gateway/src/salidas.js:58-64`). Es lo que corresponde, pero hay que decirlo en el panel.

**e) Ruta interna para el gateway.** Hoy el core no tiene ninguna ruta para otro servicio que no sea el agente: el único secreto interno, `INTERNAL_API_TOKEN`, es para core → sidecar ARCA (`core/internal/config/config.go:34-36`). Propuesta: `GET /internal/whatsapp/tenants/:phone_number_id` y `GET /internal/whatsapp/tenants` (lista de phone IDs activos), con un secreto propio `GATEWAY_INTERNAL_TOKEN` comparado en tiempo constante, **fuera** del grupo `/api` y sin pasar por `AutenticacionDual`. Devuelve `{ negocio_id, vertical, activo, graph_token, agente_token }`. El puerto del core está publicado (`docker-compose.yml:76-77`), así que la ruta no puede confiar en "es la red interna": el secreto es obligatorio.
*Riesgo:* **alto.** Es una ruta que entrega tokens en claro; si el secreto se filtra, se filtran todos los comercios. Mitigaciones: secreto largo, rechazar si está vacío (no arrancar en producción), no loguear el body, y limitar la exposición publicando `/internal` sólo en la red de compose. Esto último es un cambio de proxy que no está en este repo.

**f) Webhook `account_update`.** O lo procesa el gateway y avisa al core, o el core expone `POST /internal/whatsapp/eventos`. Ante `PARTNER_APP_UNINSTALLED` o `PARTNER_REMOVED` → `estado = desconectado`.
*Riesgo:* bajo.

**g) Config.** `META_APP_ID`, `META_APP_SECRET` (hoy sólo lo tiene el gateway), `WA_CIPHER_KEY`, `GATEWAY_INTERNAL_TOKEN`, `GRAPH_VERSION`. Validarlos en `Config.validate()` sólo si el módulo está prendido, con el mismo patrón que ARCA.

### 4.2 Gateway (Node)

**a) Tenants desde el core.** `gateway/src/tenants.js` hoy es un `Map` sincrónico armado desde un JSON. `porPhoneId` se usa en `webhook.js:148` y `salidas.js:58`, y `phoneIds()` en `index.js:117`, que arma la lista de colas del outbox. Cambio: un `crearTenantsRemotos({ coreUrl, token, ttlMs })` con la **misma interfaz pero `porPhoneId` async**, caché en memoria con TTL corto (30 a 60 segundos) y caché negativa corta para los IDs desconocidos, que hoy se descartan en silencio y tienen que seguir así sin pegarle al core en cada mensaje. `phoneIds()` se refresca con un intervalo.
*Riesgo:* medio. Pasar de sync a async toca los dos llamadores y sus tests. Y si el core está caído, el webhook no puede rutear: hay que decidir si se usa la última caché buena (recomendado, con un tope de tiempo) o se manda la disculpa.

**b) El token del agente.** Este es el hueco del plan. El MCP del agente se autentica contra el core con el `cop_…` en claro (`gateway/src/agente.js:146`), pero el core **sólo guarda su sha256** (`core/migrations/000002_token_agente.up.sql`, `core/internal/middleware/agent_auth.go:24-30`). Hoy el texto plano vive únicamente en `tenants.json`. Sin ese archivo, el gateway no tiene de dónde sacarlo. Opciones:
- **b1.** Guardar también el token de agente cifrado (`agente_token_cifrado` en `whatsapp_conexion`) y devolverlo por la ruta interna. Simple y simétrico con el token de Meta.
- **b2.** Token de agente efímero: la ruta interna emite uno nuevo por conversación, con TTL (hash en Redis), y el middleware lo acepta además del permanente. Si se filtra, vale minutos.
- **b3.** Que el gateway use una credencial de servicio con el `negocio_id` en un header. **Descartada:** rompe la garantía escrita en `agente.js:12-15`, la de que el proceso MCP "ya está atado a un solo negocio".

**Recomendación: b1 ahora, b2 si algún día el gateway corre en otra máquina.** Confianza: media.

**c) Envío con el token de cada negocio.** `enviarPorGraph` (`gateway/src/outbox.js:90-117`) usa `config.metaGraphToken`. Pasa a resolver el token por `mensaje.phone_number_id` con el mismo registro de tenants al momento de enviar. **El token no se guarda en el item de Redis:** hoy el item se serializa entero en `outbox:<id>`, `outbox:reintentos` y `outbox:muertos` (`outbox.js:150-165`), y meterle el token lo dejaría en claro en Redis y en la cola de muertos.
- Errores nuevos a tratar distinto: token inválido o revocado (código `190`; **no verificado** en la doc de WhatsApp, es el código general de Graph) y permisos (`200`, el que cita la doc para falta de acceso avanzado). Ninguno de los dos se arregla reintentando: van directo a la cola de muertos con motivo y le avisan al core que la conexión se cayó.
- `META_GRAPH_TOKEN` deja de ser obligatorio en `faltantesDeConfig` (`config.js:84-97`). Queda como opcional sólo si se mantiene la conexión `manual` del demo.
- *Riesgo:* medio. Es el camino de cada mensaje que sale.

**d) Versión de Graph.** `graphUrl` default `v21.0` (`config.js:49`); la doc actual usa `v25.0`. Subirla en una etapa propia, no mezclada con esto.
*Riesgo:* bajo, pero va separado para poder aislar un problema.

**e) Webhook.** El ruteo por `value.metadata.phone_number_id` (`webhook.js:40`) ya es el correcto para muchas WABAs. Lo que cambia:
1. `extraerEventos` hoy ignora todo campo que no sea `messages` (`webhook.js:39`). Hay que sumar `account_update` y, con coexistencia, `smb_message_echoes` y `history`.
2. El filtro de eco (`message.from === display_phone_number`, `webhook.js:51`) no alcanza con coexistencia: los mensajes que el dueño manda desde el celular llegan por otro campo y tienen que pausar al bot en ese chat.
3. La verificación GET usa un solo `META_VERIFY_TOKEN` (`webhook.js:98-109`), que sigue sirviendo porque no usamos override por WABA.

*Riesgo:* bajo sin coexistencia; medio con ella.

### 4.3 Agente

Sin cambios de código si se elige b1: el agente sigue recibiendo `AGENTE_TOKEN` y `VERTICAL` por entorno (`agente.js:146-148`). Con coexistencia, el system prompt necesita saber que un humano puede estar del otro lado. Eso es un cambio de SKILL, no de código.
*Riesgo:* bajo.

### 4.4 Panel (React)

- Nueva vista `WhatsApp` (ruta `soloDueno`, como la plata, `panel/src/App.tsx:54`) con tres estados: sin conectar (botón), conectando (paso a paso, con "reintentar" si quedó a medias) y conectado (número, WABA, estado, "falta cargar la tarjeta en Meta", botón desconectar con confirmación).
- Cargar el SDK de Facebook **sólo en esa vista**, no en `index.html`.
- El listener filtra `origin` y `data.type` como dice la doc. El `code` sale al core en el mismo callback, sin pasos intermedios, por los 30 segundos.
- El nginx del panel no tiene CSP ni `Cross-Origin-Opener-Policy` (`panel/nginx.conf:20-22`), así que hoy no bloquea el popup. Si algún día se agrega COOP `same-origin`, rompe el `postMessage` del popup. Dejarlo anotado en el nginx.
- El panel tiene que servirse por **HTTPS** desde un dominio cargado en "Allowed domains": "Only domains that have enabled HTTPS are supported".
- El campo `wa_phone_id` editable de `Admin.tsx:167-189` queda sólo para el admin de plataforma y para la conexión manual.
- *Riesgo:* medio. Es la cara que ve el dueño, y un `CANCEL` o un `ERROR` mal mostrados se leen como "esto no anda".

### 4.5 Lo que se borra

`gateway/tenants.example.json`, `TENANTS_PATH`, el bind mount de `docker-compose.yml:137-141` y `cargarTenantsTolerante` (`index.js:83-92`). Se borran en la última etapa, no antes.

### 4.6 Renovación y vencimiento del token

- Si el token sale "never expire" (default según Facebook Login for Business), no hay renovación: el token muere cuando el comercio nos saca o cuando nosotros desconectamos. `token_vence_en = NULL`.
- Si sale a 60 días (plantilla "With 60 Expiration Token"), hay dos caminos: renovar por API con `POST /<CLIENT_BUSINESS_ID>/system_user_access_tokens` (exige `business_management` y `appsecret_proof`, o sea más App Review), o pedirle al dueño que repita el popup antes del vencimiento.
- **Recomendación:** crear la configuración a mano eligiendo vencimiento "nunca" si el dashboard lo ofrece. En cualquier caso, guardar `expires_at` de `GET /debug_token` y un worker diario que avise en el panel a 7 días del vencimiento.

---

## 5. Orden de implementación

Cada etapa se despliega sola y se puede probar sola. Las 1 a 3 no necesitan nada de Meta.

| Etapa | Qué | Cómo se prueba | Depende de Meta |
|---|---|---|---|
| **0** | Arrancar ya la verificación del portfolio y preparar los dos videos del App Review con el número de prueba (API Setup + WhatsApp Manager) | Las solicitudes enviadas | Sí, pero sólo trámite |
| **1** | Core: migración `whatsapp_conexion` + `WA_CIPHER_KEY` + ruta interna `GET /internal/whatsapp/tenants…` + conexión `manual` por admin (token pegado a mano, como hoy en `tenants.json`) | Tests de repo y de la ruta (sin secreto: 401; secreto malo: 401; token nunca en el JSON de `/api/admin/negocios`). Cargar el demo por esta vía | No |
| **2** | Gateway: `tenants` remoto con caché, `porPhoneId` async, colas del outbox refrescadas. **`tenants.json` sigue de fallback** detrás de un flag | El demo responde igual que antes leyendo del core. Apagar el core un minuto: el gateway sigue con la caché | No |
| **3** | Gateway: envío con token por negocio, sin token en Redis; errores 190/200 a la cola de muertos sin reintento y aviso al core | Test: item en `outbox:muertos` sin campo de token. Token inválido a mano → `estado = error` | No |
| **4** | Panel + core: botón, `POST /api/whatsapp/conexion` con los pasos idempotentes, desconexión. Probado con un dueño que tenga rol en la app (acceso estándar) y un chip real | Alta de punta a punta con un número real; cortar la red entre el paso 3 y el 4 y reintentar; desconectar | Sí: configuración de Login for Business, dominio HTTPS |
| **5** | `account_update` (desconexión del lado del comercio) + aviso de vencimiento del token | Quitar la app desde Business Settings del comercio de prueba → el panel lo muestra desconectado | Sí: suscripción al campo |
| **6** | Sacar `tenants.json` y `META_GRAPH_TOKEN` obligatorio. Subir Graph a `v25.0` en un commit aparte | Smoke de compose sin el archivo | No |
| **7** | Coexistencia: webhooks `history` / `smb_message_echoes`, pausa del bot cuando escribe el dueño, sincronización dentro de las 24 horas | Alta con un número que ya usa WhatsApp Business; el dueño contesta desde el celular y el bot se calla | Sí: App Review aprobado (Tech Provider) |

App Review y Access Verification corren en paralelo desde la etapa 0. Hasta que salgan, el tope es 10 altas por semana y sólo con usuarios que tengan rol en la app.

---

## 6. Seguridad

**Tokens de negocio.**
- En reposo: cifrados con AES-256-GCM (`infra.Cifrador`) y clave `WA_CIPHER_KEY` fuera de la base. Con datos asociados = `negocio_id` si se hace la mejora de 4.1 b.
- Nunca en un response del panel, en un log ni en Redis.
- En tránsito: sólo core → gateway por la ruta interna, y en memoria del gateway con TTL corto.
- El PIN de registro, igual que el token.
- Rotación de `WA_CIPHER_KEY`: hoy no hay mecanismo para ARCA tampoco. Anotarlo como deuda compartida.

**Quién puede conectar y desconectar.**
- Conectar y desconectar: sólo `RolDueno` del propio negocio. El `negocio_id` sale del JWT, nunca del body.
- `RolOperador` no; `RolAgente` no (afuera de la allowlist de `RestringirAgente`).
- `RolAdmin` sólo por la conexión `manual` en `/api/admin/negocios`, auditada.
- Cada conexión, reintento y desconexión va a `audit_log` con el usuario.

**No creerle al navegador.** `waba_id` y `phone_number_id` llegan del `postMessage`. Se validan contra Graph con el token recién obtenido antes de guardar nada (paso 2 de 4.1 c). El UNIQUE sobre `phone_number_id` frena un segundo reclamo del mismo número.

**El `code`.** Vale 30 segundos y sólo sirve junto con el app secret, que vive en el server. Igual: el endpoint exige JWT de dueño y tiene rate limit por negocio.

**Que el webhook sea de Meta.** Ya resuelto y bien: firma `X-Hub-Signature-256` sobre el body crudo con `META_APP_SECRET`, comparación en tiempo constante y chequeo de longitud previo (`gateway/src/firma.js`, `gateway/src/index.js:41-59`); 401 sin firma (`webhook.js:113-117`). Con varias WABAs no cambia nada, porque la firma es por app ("using the post body payload and your app secret as the secret key", Create a webhook endpoint). El cambio necesario: que `account_update` también pase por esa misma puerta y no por una ruta nueva sin firma.

**El listener del popup.** Filtrar `event.origin.endsWith('facebook.com')`, como la doc. **Juicio:** ese filtro deja pasar `evilfacebook.com`. Es mejor parsear el origen y aceptar sólo `https://www.facebook.com` y `https://web.facebook.com`. De todos modos, lo que llega por ahí se revalida en el server.

**La ruta interna.** Secreto propio, en tiempo constante, obligatorio en producción. Fuera de `/api`. Idealmente no publicada fuera de la red de compose.

---

## 7. Lo no verificado

1. **Cuánto tarda la verificación del negocio y la Access Verification.** La doc oficial no da plazos. Sólo hay plazo para el App Review ("about 24 hours", promedio).
2. **Si el token de negocio vence.** La doc dice "never expire" por defecto (Facebook Login for Business) pero la plantilla recomendada se llama "With 60 Expiration Token". Mirar la configuración en el dashboard y `GET /debug_token` después del primer alta.
3. **Si la coexistencia funciona en Argentina.** La página no lista países excluidos, pero tampoco dice que esté disponible en todos.
4. **Si el número de prueba de Meta puede pasar por Embedded Signup.** No encontré nada; asumo que no.
5. **Si la app `1654068459715368` es de tipo Business, tiene el caso de uso WhatsApp y está colgada del portfolio Blendsoftware.** No tengo acceso al dashboard.
6. **El código de error de token revocado en la Cloud API.** Uso `190` porque es el de Graph en general; no lo encontré en las páginas de WhatsApp leídas.
7. **Que "Hasta 3 números sin trámite" de `docs/WHATSAPP.md` siga siendo cierto.** La doc actual habla de 10 altas por semana por defecto y de rol en la app para el acceso estándar; no encontré el número 3.
8. **Precios.** Las tarifas de la sección 3.1 son las vigentes desde el 1/10/2026 según la planilla oficial. Meta puede cambiarlas cada trimestre ("Meta may update rates up to quarterly"). No verifiqué si la factura a un comercio argentino sale en ARS por defecto.
9. **Hosted ES** (Embedded Signup alojado por Meta) existe en el índice de la doc y podría ahorrar el SDK en el panel. No lo leí.
