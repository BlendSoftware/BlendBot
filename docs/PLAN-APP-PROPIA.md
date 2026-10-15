# Plan: cada comercio conecta su WhatsApp con su propia app de Meta

> Investigado el **15/10/2026** contra la documentación oficial de Meta (páginas
> `.md` del índice `https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt`
> y las planillas de precios oficiales) y contra el código de `main` en `34e5411`.
> Es un plan: no se tocó código, ni Meta, ni nada desplegado.
>
> Complementa a `docs/PLAN-EMBEDDED-SIGNUP.md`, que queda para el día que
> BlendSoftware tenga CUIT y pueda ser Tech Provider. Donde este plan dice "como
> en el plan de Embedded Signup", es eso: se reutiliza tal cual.

---

## 1. Resumen

1. **La opción es viable según la doc de Meta.** Una app que sólo usa la WABA de su propio portfolio no necesita App Review ni acceso avanzado: "If you are a direct developer and only access your own business data, you do not need to undergo App Review or obtain Advanced access". No encontré nada que la haga inviable.
2. Lo que sí cambia frente a Embedded Signup: **no hay coexistencia** (es sólo para Tech Providers), así que el número del comercio **no puede estar en uso en ninguna app de WhatsApp**. Es la fricción de venta más grande.
3. El dueño hace en Meta lo mínimo (app, número, usuario del sistema, token, tarjeta) y pega cinco datos en el panel. **Nuestro backend hace el resto con su token y su app secret**: valida, configura el webhook de SU app, suscribe la app a la WABA, registra el número y muestra el estado.
4. El cambio de fondo en el código es el mismo que en Embedded Signup (negocios y tokens en la base, cifrados, ruteo desde el core), más uno propio: **un app secret por comercio**, que se resuelve con una URL de webhook por comercio (`/webhook/whatsapp/c/<webhook_id>`), atendida por el mismo handler.
5. Ocho etapas chicas; las cuatro primeras no necesitan ningún comercio real (Juani hace de "comercio 0" con su propio portfolio de prueba).

---

## 2. Lo que confirmé de Meta

Todas las URLs bajo `https://developers.facebook.com/documentation/business-messaging/whatsapp/`, salvo aclaración. Leídas el 15/10/2026.

### 2.1 App Review y modo de la app

| Afirmación | Cita | Fuente |
|---|---|---|
| Sin App Review ni acceso avanzado para datos propios | "If you are a direct developer and only access your own business data, you do not need to undergo App Review or obtain Advanced access for any permissions." | `permissions` |
| Lo mismo, dicho en la página de App Review | "if you are using the API for yourself as a Direct Developer, you do not need Advanced access or app review." | `solution-providers/app-review` |
| El App Review es para apps que usan otros | "If you are a partner and your clients will be using your app to access their data, your app must undergo App Review" | `permissions` |
| El acceso avanzado hace falta sólo para WABAs ajenas | "If your app uses the whatsapp_business_management permission to access WABAs not owned by your business, you must have Advanced access" | `permissions` |
| Las apps Business arrancan con acceso estándar | "Business apps are automatically approved for Standard Access for all Permissions and Features available to the Business app type" | `solution-providers/app-review` |
| **La app tiene que estar en modo Live** | "Make sure your app is in **Live** mode; some webhooks will not be sent if your app is in **Dev** mode." | `webhooks` (Troubleshooting) |

**Conclusión:** en el modelo "app propia" el comercio **es** el desarrollador directo: su app, su portfolio, su WABA. Encaja en la frase de `permissions`. Lo que hay que hacer sí o sí es **publicar la app (Live)**. Qué pide Meta para pasar a Live (URL de política de privacidad, ícono, categoría) **no lo verifiqué** en esta doc; en la creación aparece "A list of publishing requirements are listed. You may not have any at this point." (`get-started`, Step 1.6).

### 2.2 Verificación del negocio y límites sin verificar

| Tema | Cita | Fuente |
|---|---|---|
| Límite de mensajes iniciados por el negocio | "Newly created business portfolios have a messaging limit of 250" | `messaging-limits` |
| Qué cuenta para ese límite | "the maximum number of unique WhatsApp user phone numbers your business can deliver messages to, **outside of a customer service window**, within a moving 24-hour period." | `messaging-limits` |
| Es por portfolio | "calculated and set at the business portfolio level and are shared by all business phone numbers within a portfolio." | `messaging-limits` |
| Cómo sube | "Verify your business" o "Send 2,000 delivered messages outside of customer service windows [...] using templates with a high quality rating." | `messaging-limits` |
| Cantidad de números | "New business portfolios are initially capped at two registered business phone numbers." / "If your business becomes verified, or if you have reached a messaging limit of 2,000, Meta will automatically increase your cap to 20." | `business-phone-numbers/phone-numbers` |
| Display name | "When you reach a higher messaging limit, your business phone number's display name automatically undergoes verification" | `display-names` |
| Velocidad por número | "up to 80 messages per second (mps) by default" | `throughput` |

**Respuesta corta:** el portfolio del comercio **no necesita estar verificado** para operar. Las respuestas a mensajes que inicia el cliente (dentro de la ventana de 24 horas) **no tienen tope de cantidad**, sólo el de velocidad (80 por segundo). El tope de 250 por día afecta a recordatorios y avisos por plantilla del core (`salidas_whatsapp`) a clientes que no escribieron en las últimas 24 horas. Para un local alcanza.

### 2.3 Token permanente de usuario del sistema

Fuente: `access-tokens`, sección "System user access tokens".

- "System user access tokens represent you, your business, organization, or people within your business" y son de larga duración.
- Admin vs. empleado: el admin tiene "full access to all WhatsApp Business Accounts (WABAs) and their assets"; el empleado necesita que le asignen cada WABA.
- Pasos de la doc: Meta Business Suite > configuración > **System Users** > **+Add** (nombre y rol) > clic en el usuario > **Assign assets** > la app con **Manage app** > **Generate token**, elegir la app, elegir el vencimiento, copiar.
- Permisos que lista la doc: `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`.

**Juicio (confianza media):** nosotros sólo necesitamos los dos de WhatsApp. `business_management` no lo usa ninguna llamada de este plan. En el video conviene pedir los dos y no el tercero (mínimo privilegio), pero si el dueño tilda los tres no se rompe nada.

**Juicio (confianza alta):** el error más probable del dueño es **no asignarle la WABA al usuario del sistema** (o elegir rol empleado sin darle la WABA). El token sale igual, pero no ve la cuenta. Por eso el backend lo valida con `debug_token` (ver 4.1).

### 2.4 Webhook

| Afirmación | Cita | Fuente |
|---|---|---|
| Se configura en la app | "navigate to the App Dashboard > WhatsApp > Configuration panel, and add your webhook endpoint URL to the **Callback URL** field, and your verification string to **Verify token** field." | `webhooks/create-webhook-endpoint` |
| **Se puede configurar por API, con token de app** | "you can use the Application Subscriptions API to configure webhooks as an alternative method, but it requires the use of an app token [...] use whatsapp_business_account as the object value." | `webhooks/create-webhook-endpoint` |
| El token de app sale del app secret | `access_token={your-app_id}\|{your-app_secret}` y "This request uses your app secret, so it must only be made using server-side code." | `https://developers.facebook.com/documentation/facebook-login/guides/access-tokens` |
| La suscripción por API también hace el handshake | El `callback_url` recibe "una solicitud GET cuando se intenta realizar la operación de publicación" | `https://developers.facebook.com/docs/graph-api/reference/application/subscriptions/` |
| La firma es con el app secret **de esa app** | "HMAC-SHA256 hash, calculated using the post body payload and your app secret as the secret key." | `webhooks/create-webhook-endpoint` |
| Hay que suscribir la app a cada WABA | "You must individually subscribe to every WABA for which you want to receive webhooks." Con `POST /<WABA_ID>/subscribed_apps`. | `solution-providers/manage-webhooks` |
| `subscribed_apps` acepta token de usuario del sistema | "a valid access token obtained through the appropriate OAuth flow or system user token." | `reference/whatsapp-business-account/subscribed-apps-api` |
| Reintentos | "Meta retries delivery with decreasing frequency until the request succeeds, for up to 7 days." | `webhooks` |
| `entry[].id` es la WABA | En el ejemplo de payload, `entry[0].id` y `metadata.phone_number_id` | `webhooks` |

**Respuesta: sí, nuestro backend lo puede hacer todo.** Con `app_id` y `app_secret` arma el token de app y llama `POST /<APP_ID>/subscriptions` (callback, verify token, campo `messages`). Con el token del usuario del sistema llama `POST /<WABA_ID>/subscribed_apps`. El dueño no tiene que tocar la pantalla de Webhooks. Queda como plan B grabado en video por si la llamada falla.

### 2.5 El número

| Afirmación | Cita | Fuente |
|---|---|---|
| Registro por API | `POST /<PHONE_NUMBER_ID>/register` con `pin` | `business-phone-numbers/registration` |
| El PIN | "If your verified business phone number does not have two-step verification enabled, set this value to a 6-digit number. This will be the newly verified business phone number's two-step verification PIN." Y si ya tiene: "set this value to your number's 6-digit two-step verification PIN." | `registration` |
| Requisito previo | Agregar el número a la WABA y "Verify ownership of the number" | `registration` |
| Límite | "limited to 10 requests per business number in a 72-hour moving window." Error `133016` | `registration` |
| El PIN se puede fijar por API | `POST /<PHONE_NUMBER_ID>` con `{"pin": "<6 dígitos>"}`; "There is no endpoint to disable two-step verification." | `business-phone-numbers/two-step-verification` |
| Alta completa por API (opcional) | `POST /<WABA_ID>/phone_numbers` (`cc`, `phone_number`, `verified_name`), `request_code` (SMS o VOICE), `verify_code`, `register` | `solution-providers/registering-phone-numbers` |
| **Número ya usado en WhatsApp** | "Numbers already in use with WhatsApp cannot be registered unless they are deleted first." | `business-phone-numbers/phone-numbers` |
| **Coexistencia** | "You must already be a Solution Partner or Tech Provider" y "You must use Embedded Signup with session logging" | `embedded-signup/onboarding-business-app-users` |

**Respuesta:** el backend registra el número con el token del comercio. La coexistencia **no aplica** fuera de Embedded Signup: el comercio necesita un chip nuevo o borrar la cuenta de WhatsApp de ese número antes.

### 2.6 Facturación

| Afirmación | Cita | Fuente |
|---|---|---|
| Se cobra cada respuesta desde el 1/10/2026 | "Effective October 1, 2026, Meta will charge on a per-message basis for service messages" y "Any non-template message is charged as of October 1, 2026." | `pricing/non-template-messages` |
| Tarifa de servicio = utility | "By market, rates for service messages are the same as the rates for utility and authentication messages." Sin tramos por volumen. | `pricing/non-template-messages` |
| **Argentina, vigente** | Planilla oficial "Cost per message in USD [...] effective October 1, 2026", fila `Argentina \| USD \| 0.0618 \| 0.026 \| 0.026 \| n/a \| 0.026`. La de ARS: `Argentina \| ARS \| 89.562 \| 37.6798 \| 37.6798 \| n/a \| 37.6798` | planillas enlazadas en `pricing#rate-cards-and-volume-tiers`, bajadas el 15/10/2026 |
| Sin medio de pago, falla el envío | Error `131042` "There was an error related to your payment method", causas: "Payment account is not attached to a WhatsApp Business account" | `support/error-codes` |
| Gratis sólo con anuncios | "Messages sent within the 72-hour free entry point window, from Click to WhatsApp Ads [...] remain free" | `pricing/non-template-messages` |

**Respuesta:** cada respuesta del bot le cuesta al comercio **US$ 0,026 (ARS 37,68)**; un marketing, US$ 0,0618. Ojo: la página general `pricing.md` todavía dice "All non-template messages are free" y "effective July 1, 2026": **está desactualizada** frente a la página específica y a las planillas, que dicen 1/10/2026. Me quedo con las planillas.

**Juicio (confianza alta):** como desde el 1/10/2026 las respuestas se cobran, **sin tarjeta cargada el bot no puede contestar**, no sólo dejar de mandar plantillas. La tarjeta es un paso obligatorio del recorrido, no opcional.

---

## 3. El recorrido del dueño, para los videos

Supuesto de partida: el dueño tiene Facebook personal y una computadora. Recomiendo grabar **cuatro videos cortos** en lugar de uno largo; cada uno termina en algo que el panel puede comprobar.

Marcas: **[TRABA]** donde suele trabarse. **[PANEL]** lo que el panel muestra para destrabarlo.

### Video 0: antes de empezar (1 minuto, sin pantalla de Meta)

1. "Necesitás un número que **no tenga WhatsApp** (ni el común ni Business). Si querés usar el del local, primero borrás la cuenta de WhatsApp de ese número en el celular." **[TRABA]** Es la objeción grande. Si no lo sabe antes, se traba en el paso 2.3 sin entender por qué.
2. "Tené a mano una tarjeta de crédito o débito internacional." **[TRABA]** muchas débito no pasan.
3. "Vas a copiar 5 datos al panel. Tené abierto el panel en otra pestaña, en **WhatsApp > Conectar**."

### Video 1: crear la app y la cuenta de WhatsApp

1. Entra a `developers.facebook.com`, **Empezar**, se registra como desarrollador. **[TRABA]** Meta pide verificar el teléfono o la tarjeta de la cuenta personal.
2. **My Apps > Create App**. Nombre: "Bot de <local>". Caso de uso: **Connect with customers through WhatsApp**.
3. Portfolio: **crear uno nuevo con el nombre del local**. **[TRABA]** si elige un portfolio viejo de anuncios con otra persona como admin, después no puede crear el usuario del sistema.
4. "Publishing requirements": Next. **Create app**.
5. Queda en **Quickstart > Start using the API > API Setup**. Crea o elige la cuenta de WhatsApp Business (WABA). Copia el **WhatsApp Business Account ID**. **Dato 1.**
6. Arriba a la izquierda copia el **App ID**. **Dato 2.**
7. **App settings > Basic > App secret > Show**, pone su contraseña de Facebook, copia. **Dato 3.** **[TRABA]** confunde App secret con "Client token". El panel valida formato (32 caracteres hexadecimales) y lo dice en castellano.

### Video 2: el número

1. En **API Setup > Step 5 / Add phone number** (o desde WhatsApp Manager): nombre visible (el del local, sin "bot" ni signos raros), categoría, número.
2. Elige SMS o llamada, pone el código. **[TRABA]** si el número todavía tiene WhatsApp: error genérico de Meta. **[TRABA]** fijos sin SMS: elegir llamada.
3. Copia el **Phone number ID** del número nuevo (no el del número de prueba que crea Meta solo). **Dato 4.** **[TRABA, la más común]** copia el ID del número de prueba. **[PANEL]** el backend lo detecta: el número de prueba responde con un `display_phone_number` que empieza con `1555`, y avisa.
4. No hace falta que registre nada: eso lo hace el panel.

### Video 3: el token permanente

1. `business.facebook.com/settings` > **Usuarios > Usuarios del sistema > Agregar**. Nombre "blendbot", rol **Administrador**. **[TRABA]** si no es admin del portfolio, el botón no aparece. **[TRABA]** Meta puede pedir aceptar términos de usuarios del sistema.
2. Clic en el usuario > **Asignar activos**: la **app** (control total) y la **cuenta de WhatsApp** (control total). **[TRABA, crítica]** asignar sólo la app. **[PANEL]** el backend lo detecta con `debug_token` y muestra "al token le falta la cuenta de WhatsApp: volvé al paso 2".
3. **Generar token**: elige la app, vencimiento **Nunca**, tilda `whatsapp_business_messaging` y `whatsapp_business_management`. Copia. **Dato 5.** **[TRABA]** el token se muestra una sola vez. **[TRABA]** dejar el vencimiento por defecto (60 días). **[PANEL]** si `expires_at` no es 0, avisa "generalo de nuevo con vencimiento Nunca".

### Video 4: pegar en el panel, tarjeta y publicar

1. En el panel, **WhatsApp > Conectar**: pega los cinco datos y toca **Conectar**. El panel muestra una lista que se va poniendo en verde (ver sección 4.2).
2. **Tarjeta:** el panel le da el link a WhatsApp Manager > **Facturación** > agregar medio de pago. **[TRABA]** moneda y zona horaria se fijan una sola vez; recomendar ARS y Buenos Aires. **[PANEL]** el estado "tarjeta" queda en amarillo hasta el primer envío que no devuelva `131042`.
3. **Publicar la app:** en el dashboard, pasar de **Development** a **Live** (cargar URL de política de privacidad si la pide). **[TRABA]** Meta pide la URL. Podemos ofrecer una página `/privacidad/<local>` generada por BlendBot (decisión pendiente, ver sección 9). **[PANEL]** el backend no puede leer el modo de la app con certeza (sección 9); lo infiere: si a los N minutos de conectado llega el handshake pero no llega ningún mensaje de la prueba, sugiere revisar Live.
4. **Prueba:** el panel dice "mandá 'hola' al número desde tu celular personal". Cuando llega, el estado queda todo en verde.

**El verify token no aparece en ningún video:** lo genera y lo usa el backend. Sólo se muestra en el plan B manual (ver 4.3).

---

## 4. Lo que hace el backend con el token del comercio

### 4.1 Validar (todo antes de guardar como "conectado")

Con los cinco datos, el core hace, en este orden y sin creerle a nada de lo que pegó el dueño:

| # | Llamada | Qué confirma | Error que se muestra |
|---|---|---|---|
| 1 | `GET /debug_token?input_token=<TOKEN>&access_token=<APP_ID>\|<APP_SECRET>` | Que App ID y App secret son correctos (si no, la llamada falla), que el token es de **esa** app (`app_id`), `is_valid`, `expires_at` (0 = no vence), `scopes` y `granular_scopes[].target_ids` con la WABA | "El App secret no corresponde a esa app", "El token es de otra app", "Al token le falta la cuenta de WhatsApp", "El token vence: generalo con Nunca" |
| 2 | `GET /<WABA_ID>/phone_numbers` (token del comercio) | Que el `phone_number_id` es de esa WABA; trae `display_phone_number`, `verified_name`, `status`, `name_status`, `quality_rating` | "Ese número no es de esa cuenta", "Pegaste el número de prueba" |
| 3 | UNIQUE en la base | Que ningún otro negocio tiene ese `phone_number_id` o esa WABA | 409 "Ese número ya está conectado a otro local" |

Campos de `debug_token` citados de `https://developers.facebook.com/docs/graph-api/reference/debug_token/`: `app_id`, `expires_at`, `is_valid`, `scopes`, `granular_scopes` con `target_ids`, y se llama con "un token de acceso a la app". El paso 1 valida a la vez el par app id + secret y el token, en una sola llamada.

Si el paso 1 pasa, se guarda todo cifrado con `estado = validado`. Desde ahí cada paso siguiente es idempotente y reintentable.

### 4.2 Configurar (lo que el dueño ve ponerse en verde)

| Estado | Llamada | Notas |
|---|---|---|
| `webhook_app` | `POST /<APP_ID>/subscriptions` con token de app: `object=whatsapp_business_account`, `callback_url=https://<host>/webhook/whatsapp/c/<webhook_id>`, `verify_token=<generado>`, `fields=messages` | Meta hace el GET de verificación **durante** la llamada, así que el `verify_token` y el `webhook_id` tienen que estar guardados y el gateway tiene que poder resolverlos **antes** de llamar. Se verifica después con `GET /<APP_ID>/subscriptions` |
| `suscripto` | `POST /<WABA_ID>/subscribed_apps` sin body (token del comercio) | Sin body, para no dejar un override viejo: "Subscribing without post body parameters removes the alternate callback URL" (`webhooks/override`). Se verifica con `GET /<WABA_ID>/subscribed_apps` |
| `registrado` | Si `status` del número ya es `CONNECTED`: nada. Si no: PIN de 6 dígitos con `crypto/rand`, guardado cifrado, `POST /<PHONE_NUMBER_ID>/register` | Si Graph devuelve `133016`, cortar y mostrar "Meta bloqueó el registro 72 horas"; no reintentar solo. Si devuelve error de PIN (el número ya tenía verificación en dos pasos), pedirle al dueño que la cambie en WhatsApp Manager > número > Two-step verification y pegue el PIN, o probar `POST /<PHONE_NUMBER_ID>` con el PIN nuestro (sección 9) |
| `esperando_mensaje` | Ninguna | El panel pide "mandá hola" |
| `activo` | Llegó un mensaje firmado a la URL de ese comercio | Confirma de punta a punta: Live, suscripción, firma |
| `tarjeta_ok` | El primer envío no devolvió `131042` | Independiente de `activo` |

`POST /api/whatsapp/conexion/reintentar` retoma desde el último estado guardado, como en Embedded Signup.

### 4.3 Plan B manual

Si `POST /<APP_ID>/subscriptions` falla (por ejemplo, una app sin el producto Webhooks habilitado), el panel muestra la URL y el verify token de ese comercio con un botón "copiar" y el video de respaldo: **WhatsApp > Configuration > Edit > Callback URL + Verify token > Verify and save > Manage > messages: Subscribe**. El backend sigue con `subscribed_apps` igual.

### 4.4 Mostrar el estado (vista permanente)

Un chequeo de salud (al abrir la vista, y un worker cada 6 horas) con el token del comercio: `debug_token` (sigue válido), `GET /<PHONE_NUMBER_ID>?fields=status,name_status,quality_rating,messaging_limit_tier` y `GET /<WABA_ID>/subscribed_apps`. **No verifiqué** el nombre exacto de cada campo del número en esta pasada; los que usa el plan de Embedded Signup (`name_status`) sí están citados.

Muestra: número y nombre visible, "token OK / revocado", "webhook OK / sin mensajes hace X", "nombre visible aprobado / en revisión / rechazado", "tarjeta OK / falta", límite de mensajes (250) y calidad.

---

## 5. Cambios por componente

Lo que se reutiliza sin cambios del plan de Embedded Signup: tabla `whatsapp_conexion`, `WA_CIPHER_KEY` con su propia instancia de `infra.Cifrador` (`core/internal/infra/cifrado.go`) y datos asociados = `negocio_id`, la ruta interna para el gateway con `GATEWAY_INTERNAL_TOKEN`, el registro de tenants remoto con caché en el gateway, el envío con token por negocio sin token en Redis, el token `cop_` del agente guardado cifrado (opción b1), y la desconexión. Acá van sólo las diferencias.

### 5.1 Core (Go)

**a) Esquema.** `whatsapp_conexion` (migración `000009`) con estas columnas extra o distintas:

```
modo               TEXT NOT NULL CHECK (modo IN ('app_propia','embedded','manual'))
app_id             TEXT            -- sólo app_propia
app_secret_cifrado TEXT            -- sólo app_propia; NULL = se usa META_APP_SECRET global
webhook_id         TEXT UNIQUE     -- 22+ caracteres aleatorios, va en la URL
verify_token_cifrado TEXT          -- por comercio
pin_cifrado        TEXT
token_cifrado      TEXT
token_vence_en     TIMESTAMPTZ     -- NULL = no vence (expires_at = 0)
UNIQUE (waba_id)                    -- además del UNIQUE de phone_number_id
```

`webhook_id` **no es** el `negocio_id` ni un slug: es aleatorio para que la URL no diga de quién es y para poder rotarla sin tocar el negocio.

**b) Endpoints de panel**, grupo `tenant`, `RequireRole(RolDueno)` (el `negocio_id` sale del JWT):
- `POST /api/whatsapp/conexion` con `{ app_id, app_secret, waba_id, phone_number_id, token }`: hace 4.1 y arranca 4.2.
- `POST /api/whatsapp/conexion/reintentar`.
- `GET /api/whatsapp/conexion`: estado, sin secretos (sección 7).
- `PUT /api/whatsapp/conexion/token` y `PUT /api/whatsapp/conexion/app-secret`: rotación (sección 7).
- `DELETE /api/whatsapp/conexion`.
- Admin de plataforma: los mismos bajo `/api/admin/negocios/:id/whatsapp`, auditados, con el patrón de `AdminFiscalHandler` (`core/internal/handler/admin_fiscal.go:12-22`: "Los certificados ENTRAN por acá y no salen nunca").

**c) Cliente de Graph** en el core (`core/internal/infra/graph.go`): `DebugToken`, `PhoneNumbers`, `SuscribirApp` (`/<APP_ID>/subscriptions`), `SuscribirWABA`, `Registrar`, `Salud`. Interfaz para poder testear con un Graph falso. **El token de app (`app_id|app_secret`) se arma en memoria en cada llamada y nunca se loguea**; las URLs con `access_token=` en query no pueden ir a ningún log de requests (preferir el header `Authorization: Bearer`).

**d) Ruta interna para el gateway**, además de las del plan de Embedded Signup:
- `GET /internal/whatsapp/webhooks/:webhook_id` → `{ negocio_id, waba_id, phone_number_ids, app_secret, verify_token, activo }`.
- `POST /internal/whatsapp/eventos` → el gateway avisa "llegó el primer mensaje" (`activo`), "firma inválida N veces" (`error_firma`), "Graph devolvió 190/131042" (`token_revocado` / `falta_tarjeta`).

**e) Workers:** chequeo de salud (4.4) y aviso de vencimiento si `token_vence_en` no es NULL.

**f) Config:** `WA_CIPHER_KEY`, `GATEWAY_INTERNAL_TOKEN`, `PUBLIC_WEBHOOK_BASE_URL` (para armar `callback_url`), `GRAPH_VERSION`. Se validan sólo si el módulo está prendido, como ARCA.

### 5.2 Gateway (Node)

**a) El app secret por comercio: saber con qué secreto validar antes de confiar en el body.**

Hoy hay una sola ruta `RUTA_WEBHOOK = '/webhook/whatsapp'` (`gateway/src/index.js:24`) y un solo secreto: `firmaValida(req.rawBody, firma, config.metaAppSecret)` (`gateway/src/webhook.js:114`).

Opciones:

| Opción | Cómo | Problema |
|---|---|---|
| **A. URL por comercio** | `POST /webhook/whatsapp/c/:webhookId`. El `webhookId` sale del path, que no es parte del body: se busca el secreto con eso, se valida la firma sobre el raw body, y recién ahí se parsea | Ninguno serio. Es "un endpoint" en el sentido de un solo handler y un solo router |
| B. Una URL, leer `entry[0].id` del body sin firmar para elegir el secreto | Se parsea JSON no confiable para elegir candidato; la firma igual se verifica después | Funciona para el POST, **pero el GET de verificación no trae body**: no hay forma de saber qué verify token comparar. Obliga a un verify token global |
| C. Una URL, probar todos los secretos | HMAC con cada uno | O(N) por request y un secreto equivocado nunca se detecta |

**Recomendación: A.** Confianza alta. Es la única que permite verify token por comercio, no lee nada del body antes de validar, y deja detectar "firma inválida en el comercio X" (secreto rotado). Detalles:

1. El middleware `express.raw` sigue montado sobre `/webhook/whatsapp` (`index.js:40-56`) y cubre el subpath.
2. Router nuevo `crearRouterPorComercio` en `webhook.js`: `GET /c/:webhookId` compara `hub.verify_token` con el del comercio **en tiempo constante** (hoy el global se compara con `===`, `webhook.js:103`; vale corregirlo de paso). `POST /c/:webhookId` busca `{ app_secret, ... }` en el registro remoto (caché en memoria, TTL corto, caché negativa para ids desconocidos), `firmaValida(rawBody, firma, app_secret)`, 401 si no.
3. **Chequeo de pertenencia después de la firma.** El comercio **conoce su propio app secret**, así que puede firmar lo que quiera. Una firma válida con el secreto de A prueba que el body lo armó Meta **o el comercio A**, nada más. Por eso, después de validar: todo `entry[].id` tiene que ser la WABA de A y todo `value.metadata.phone_number_id` tiene que ser un número de A. Lo que no cumpla se descarta y se loguea (sin el body). Sin este chequeo, el dueño de A puede inyectar mensajes "de clientes" en el bot de B. **Este es el punto de seguridad nuevo de la opción app propia.**
4. La ruta vieja `/webhook/whatsapp` con `META_APP_SECRET` y `META_VERIFY_TOKEN` globales queda para el demo y, el día de mañana, para los comercios `embedded` (que firman con el secreto de la app de BlendSoftware).
5. Un 401 repetido en un `webhookId` válido se cuenta y se avisa al core (`error_firma`): es el síntoma de "el dueño reseteó el App secret".

**b) Verify token: por comercio.** Lo genera el core (32 bytes aleatorios), lo guarda cifrado y lo usa él mismo en `POST /<APP_ID>/subscriptions`. Global sería más simple, pero con la opción A no cuesta nada que sea por comercio y un verify token filtrado no sirve para los demás. Confianza media-alta: el verify token no protege mucho (sólo el handshake); la razón fuerte es que no hay que mostrar uno compartido a cada dueño en el plan B.

**c) Envío:** igual que el plan de Embedded Signup (token por `phone_number_id` resuelto al enviar, nunca en el item de Redis). Errores nuevos a mapear a la cola de muertos sin reintento y con aviso al core: `190` "Your access token has expired", `0` "We were unable to authenticate the app user", `131042` pago, `131031` cuenta restringida (todos en `support/error-codes`).

**d) `extraerEventos`** (`webhook.js:35-60`) no cambia: ya rutea por `metadata.phone_number_id`.

### 5.3 Agente

Sin cambios de código: sigue recibiendo `AGENTE_TOKEN` y `VERTICAL` por entorno (`gateway/src/agente.js:146-148`), con el token `cop_` guardado cifrado (opción b1 del otro plan).

### 5.4 Panel (React)

- Vista **WhatsApp** (`soloDueno`): formulario de cinco campos con validación de formato local (IDs numéricos, App secret 32 hexadecimales, token que empieza con `EAA`; **supuesto**, ver sección 9) y ayuda contextual con el link al video de cada campo.
- Al conectar: la lista de estados de 4.2 con su error en castellano y botón "reintentar".
- Conectado: número, nombre visible, estados de 4.4, "Token: cargado el 15/10, termina en …a1b2", "App secret: cargado el 15/10", botones **Reemplazar token**, **Reemplazar App secret**, **Desconectar**. Nunca un botón "ver".
- El campo `wa_phone_id` editable de `Admin.tsx` queda sólo para el admin.
- Sin SDK de Facebook ni popup: esta opción no necesita HTTPS en "Allowed domains" ni COOP.

---

## 6. Etapas

Cada una se despliega sola y se prueba sola. Las 1 a 4 no necesitan ningún comercio: Juani arma un portfolio, una app y un chip propios ("comercio 0"), que además sirven para grabar los videos.

| Etapa | Qué | Cómo se prueba | Necesita |
|---|---|---|---|
| **0** | Juani hace el recorrido entero como dueño con su propio portfolio, graba en borrador y anota dónde se trabó. Confirma las dudas de la sección 9 (Live, token de app para `subscriptions`, PIN) | Lista de dudas cerradas | Un chip sin WhatsApp y una tarjeta |
| **1** | Core: migración `whatsapp_conexion` (con `app_id`, `app_secret_cifrado`, `webhook_id`, `verify_token_cifrado`), `WA_CIPHER_KEY`, rutas internas (por `phone_number_id` y por `webhook_id`) con `GATEWAY_INTERNAL_TOKEN` | Tests de repo y de ruta: sin secreto 401, ningún secreto en `/api/...`, cifrado atado a `negocio_id` | Nada |
| **2** | Gateway: registro remoto con caché + router `/webhook/whatsapp/c/:webhookId` (handshake por comercio, firma por comercio, chequeo de pertenencia). La ruta vieja sigue igual | Tests: firma con el secreto de A en la URL de A pasa; con el de B falla; body firmado por A con el `phone_number_id` de B se descarta; GET con verify token de otro, 403 | Nada |
| **3** | Gateway: envío con token por negocio, sin token en Redis, errores 190/0/131042/131031 a muertos con aviso | Test: item en `outbox:muertos` sin token | Nada |
| **4** | Core: `POST /api/whatsapp/conexion` con la validación de 4.1 y cliente de Graph con interfaz | Tests con Graph falso por cada error de 4.1; después, con el comercio 0 real | Comercio 0 |
| **5** | Core: configuración automática de 4.2 (subscriptions, subscribed_apps, register) idempotente y reintentable | Comercio 0: conectar de cero, cortar entre pasos, reintentar; borrar la suscripción a mano y ver que "reintentar" la repone | Comercio 0 |
| **6** | Panel: vista WhatsApp completa + chequeo de salud + rotación + desconexión | Comercio 0: resetear el App secret en Meta y ver el aviso; revocar el token y ver el aviso | Comercio 0 |
| **7** | Primer comercio real con Juani al lado, cronometrando | Mensaje de un cliente real contestado | Un comercio |
| **8** | Sacar `tenants.json` y `META_GRAPH_TOKEN` obligatorio; Graph a `v25.0` en commit aparte | Smoke de compose sin el archivo | Nada |

---

## 7. Seguridad

**Qué se guarda y cómo.** Token del usuario del sistema, App secret, verify token, PIN y token `cop_`: cifrados con AES-256-GCM (`infra.Cifrador`) y `WA_CIPHER_KEY`, con datos asociados = `negocio_id` (un texto cifrado copiado a otra fila no descifra). `app_id`, `waba_id`, `phone_number_id` y `webhook_id` van en claro: son identificadores, no credenciales.

**El App secret es más sensible que en Embedded Signup.** Con él se arma el token de app del comercio y se puede **redirigir su webhook a cualquier URL** (`POST /<APP_ID>/subscriptions`) o firmar payloads falsos. Por eso: nunca sale del core salvo por la ruta interna al gateway, que lo necesita para validar firmas, y en el gateway vive sólo en memoria con TTL.

**Nunca en logs ni en Redis.**
- El cliente de Graph usa `Authorization: Bearer` y no `?access_token=` en la URL, para que ningún log de requests lo capture.
- Los errores de Graph se loguean con código y mensaje, no con la request.
- El gateway no loguea bodies de la ruta interna.
- Redis: el item del outbox no lleva token (ya decidido en el otro plan); la caché de tenants es en memoria del proceso, no en Redis.
- El audit log registra "se cargó / reemplazó el token" con usuario y fecha, nunca el valor (patrón de `admin_fiscal.go`).

**Quién puede verlos o cambiarlos.**
- **Ver: nadie.** Ninguna respuesta de `/api` devuelve un secreto, ni al dueño ni al admin. El panel muestra "cargado el X" y los últimos 4 caracteres del token (no del App secret).
- **Cargar, reemplazar, desconectar:** `RolDueno` del propio negocio y `RolAdmin` de plataforma, auditado. `RolOperador` no. `RolAgente` no (afuera de la allowlist de `RestringirAgente`; con un test que lo pruebe).
- El chequeo de pertenencia del webhook (5.2 a.3) impide que un dueño use su App secret contra otro comercio.

**Rotación.**
- *Token del comercio:* el dueño genera otro en el usuario del sistema y lo pega en **Reemplazar token**. El core lo valida igual que en 4.1 antes de pisar el anterior; si no valida, queda el viejo. Después el panel le recuerda revocar el viejo en Meta (no hay forma de que lo hagamos nosotros sin `business_management`).
- *App secret:* si el dueño lo resetea en Meta, el webhook empieza a dar 401 en su URL; el gateway lo avisa (`error_firma`) y el panel pide el nuevo. Al pegarlo, el core lo valida con `debug_token` y vuelve a llamar `POST /<APP_ID>/subscriptions`.
- *Verify token y `webhook_id`:* rotables desde el admin (genera nuevos y re-suscribe). Útil si una URL se filtra y empieza a recibir basura.
- *`WA_CIPHER_KEY`:* no hay mecanismo, igual que `FISCAL_CIPHER_KEY`. Deuda compartida; dejar una columna `clave_version` desde la migración 000009 cuesta poco y evita otra migración.
- *Desconexión:* borra token, App secret, verify token y PIN; `DELETE /<WABA_ID>/subscribed_apps` si el token todavía sirve. El corte de nuestro lado no depende de que Meta responda.

**Lo que no se puede evitar:** el dueño tiene en su mano el App secret y el token. Si los pega en un chat o en un mail, quedan expuestos fuera de BlendBot. El video tiene que decir "esto no se lo mandes a nadie, ni a nosotros: pegalo sólo en el panel".

---

## 8. Lo que se reutiliza para migrar a Embedded Signup

El día que BlendSoftware sea Tech Provider:

| Pieza | Se reutiliza | Cambia |
|---|---|---|
| Tabla `whatsapp_conexion`, cifrado, `WA_CIPHER_KEY` | Toda | Las filas nuevas entran con `modo = 'embedded'`, `app_id` y `app_secret_cifrado` NULL |
| Ruta interna, registro remoto, caché, envío por token | Todo | Nada |
| Pasos 4.2 (`subscribed_apps`, `register`, estados, reintento) | Todo | Antes se cambia el `code` del popup por el token |
| Validación 4.1 paso 2 (`phone_numbers`) y UNIQUE | Todo | El paso 1 pasa a ser `debug_token` con el token de la app de BlendSoftware |
| Webhook | La ruta vieja `/webhook/whatsapp` con el secreto global ya existe y queda para `embedded` | Se suma `account_update` |
| Panel: vista de estado, desconexión, avisos | Todo | El formulario de cinco campos se reemplaza por el botón de Embedded Signup |

Migrar un comercio de `app_propia` a `embedded`: hace el popup con su misma WABA; el core pisa la fila (cambia `modo`, borra `app_secret` y `webhook_id`) y el dueño puede borrar su app. **No verificado:** si una WABA puede estar suscripta a dos apps a la vez durante la transición (la doc de `subscribed_apps` devuelve una lista, lo que sugiere que sí).

La única pieza que muere con la migración es el router por comercio (`/c/:webhookId`) y los videos 1 a 3.

---

## 9. Lo no verificado

1. **Qué exige Meta para pasar la app a Live** (política de privacidad, ícono, categoría, verificación de la cuenta de desarrollador). La doc sólo dice que los requisitos aparecen al crear la app y que en Dev "some webhooks will not be sent". Se cierra en la etapa 0.
2. **Si `POST /<APP_ID>/subscriptions` con token de app anda para el objeto `whatsapp_business_account` en una app recién creada**, sin que el dueño haya abierto la pantalla de Webhooks. La doc de WhatsApp lo ofrece como alternativa; no lo probé. Si no anda, queda el plan B manual (4.3).
3. **Si el número agregado desde la UI de Meta queda ya registrado** (y con qué PIN), y si `POST /<PHONE_NUMBER_ID>` con `pin` sirve para fijar el PIN antes de registrar. El backend consulta `status` primero para no gastar intentos del límite de 10 cada 72 horas.
4. **Formato del token y del App secret** para la validación local (`EAA…`, 32 hexadecimales). Es lo que se ve en la práctica, no lo encontré en la doc. Si falla, se valida sólo contra Graph.
5. **Límite de usuarios del sistema en un portfolio sin verificar.** La página de ayuda de Meta (`https://www.facebook.com/business/help/503306463479099`) no se pudo leer. Si hubiera tope, con uno alcanza.
6. **Términos de Meta.** La doc separa "direct developer" de "partner whose clients use your app". En este modelo la app es del comercio y BlendSoftware opera el software con credenciales que el comercio le da, como lo haría un programador contratado. No leí los términos de la WhatsApp Business Solution ni las Platform Terms para confirmar que no haya una cláusula contra eso. **Juicio, confianza media:** encaja en la letra de `permissions`, pero es la duda más importante del plan.
7. **El nombre visible de un portfolio sin verificar.** La doc dice que se revisa al subir de límite; no dice qué ve el cliente antes (nombre o sólo número).
8. **Precios.** Las tarifas son las de las planillas oficiales "effective October 1, 2026". La página general `pricing.md` sigue diciendo que las respuestas son gratis: está desactualizada. Meta puede cambiar tarifas "up to quarterly". No verifiqué si a un comercio argentino le facturan en ARS por defecto.
9. **Campos del chequeo de salud** (`messaging_limit_tier`, `quality_rating`, `status` del número): son los nombres de la API que usa el plan anterior y el ejemplo de `messaging-limits` (`whatsapp_business_manager_messaging_limit`), pero no los verifiqué uno por uno.
10. **Si Meta pide algo extra al portfolio nuevo para crear una WABA** (la búsqueda de ayuda menciona "a limited number of WhatsApp Business Accounts before your business [...] verification"). Con una WABA por comercio alcanza.
