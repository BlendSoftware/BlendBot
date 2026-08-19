# WhatsApp

> Datos verificados el **18/08/2026**. Meta cambia esto seguido: revalidar antes
> de fijar precio.

---

## La decisión: API oficial, nunca Baileys

`wa-claude` funciona con **Baileys**, que es WhatsApp por ingeniería inversa de
WhatsApp Web. El propio código lo delata: hay un `anti-ban.js`, hay un comentario
sobre el **incidente del 28/07** cuando la versión hardcodeada caducó, y hay que
buscar la versión vigente en runtime.

**Para Jarvis y Hugo está perfecto:** si banean, es el número propio.

**Para un cliente que paga, no.** Si Meta le banea el número al comercio, no le
rompiste una feature: le cortaste el canal por donde vende. Eso no es un bug, es
un juicio.

Y no hay razón económica para el riesgo: **las conversaciones de servicio, que
son el 95% del uso, hoy no se cobran**. La vía legal y la trucha cuestan casi lo
mismo.

**Consecuencia:** de `wa-claude` se rescata el puente con el Agent SDK, las
sesiones, el outbox y el store de mensajes. `bot.js` y `anti-ban.js` se tiran
enteros y se reemplazan por un receptor de webhooks y un cliente REST. Es menos
código.

---

## Costos (Argentina, 2026)

Meta pasó a **cobro por mensaje** el 1° de julio de 2025 y desde **abril de 2026
factura en pesos** para Argentina.

| Categoría | Costo | Cuándo aplica |
|---|---|---|
| **Servicio** | **Gratis hasta el 1/10/2026** — después, por mensaje (ver abajo) | El cliente escribe primero, dentro de la ventana de 24hs. **Es el 95% de nuestro uso.** |
| **Utility** | US$ 0,0075 | Lo inicia el negocio con info transaccional: recordatorio de turno, "pedido listo" |
| **Authentication** | US$ 0,0114 | Códigos. No lo usamos |
| **Marketing** | US$ 0,0625 | Promos que inicia el negocio. Solo en la re-activación de clientes |

Además: **las primeras 1.000 conversaciones de servicio por mes son gratis**, y
si el cliente entra por un anuncio click-to-WhatsApp, 72 horas sin cargo.

### ⚠️ El cambio del 1/10/2026 — CONFIRMADO en fuente oficial (18/08/2026)

Desde el **1 de octubre de 2026** Meta cobra **por mensaje** todo mensaje
no-template dentro de la ventana de servicio — **incluidas explícitamente las
respuestas generadas por IA de terceros**, que es exactamente nuestro caso.

Fuente oficial: [Meta for Developers — Pricing for non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)

Lo confirmado:

- **Cada mensaje de servicio se cobra individualmente**, a la tarifa por
  mensaje del mercado (comparable a utility/authentication). Las tarifas
  definitivas se publican **antes del 1/9/2026**.
- La **ventana de 72hs por entry point** (anuncio click-to-WhatsApp) sigue
  gratis.
- Un solo cargo por mensaje: un mensaje de servicio con contenido promocional
  no paga además tarifa de marketing.

Consecuencia para el modelo: **la fila "Servicio: Gratis" de arriba muere el
1/10/2026.** Con tarifa tipo utility (~US$ 0,0075 en Argentina hoy), una
conversación típica de 6-8 mensajes salientes costaría ~US$ 0,05: el costo de
canal pasa a ser del mismo orden que el costo de IA. El margen del plan ya lo
contemplaba; el precio se fija con este escenario como base, no como riesgo.

- [x] **Confirmado en la fuente oficial** (18/08/2026)
- [ ] Recalcular la tabla de costos cuando Meta publique el rate card de
      Argentina (antes del 1/9/2026)

---

## Costo de IA

Con el modelo barato para el chat y caché de prompts.

Una consulta típica: unos **5.000 tokens de entrada** (system prompt + tools +
catálogo + historial corto) y **150 de salida**. Casi siempre **dos turnos**,
porque hay una llamada a tool al core en el medio.

| Volumen mensual | Costo de IA |
|---|---|
| Chico (~300 conversaciones) | US$ 8 a 12 |
| Mediano (~1.000 conversaciones) | US$ 25 a 35 |

Con Haiku en vez de Flash, por tres. Con Sonnet, por diez. **De ahí sale la
arquitectura de modelos**: el chat en el barato, el fuerte solo quirúrgico.

Precios de referencia verificados en junio 2026 (input/output por millón):
Opus 4.8 $5/$25 · Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5 · Gemini 2.5 Flash
$0,30/$2,50 · GPT-5.4 $2,50/$15.

### Total por negocio

**US$ 10 a 35 por mes.** Casi todo es IA; WhatsApp es ruido mientras el cliente
inicie la conversación.

Contra un techo de mercado de $150.000 ARS + IVA (Basework), el margen es ancho.

---

## Onboarding

### Hasta 3 números: sin trámite

**Se puede arrancar esta semana.** Los tres pilotos entran sin registrarse como
Tech Provider.

A partir del cuarto número hace falta **App Review** con acceso avanzado a
`whatsapp_business_messaging` y `whatsapp_business_management`.

**Arrancar el App Review cuando el segundo piloto esté andando, no cuando
aparezca el cuarto cliente.** Tarda.

### Coexistence: la pieza que mata la objeción principal

El negocio **conserva su número de siempre y sigue usando su WhatsApp Business
app normal**, mientras la Cloud API maneja lo automático. El historial queda
sincronizado entre los dos.

Eso responde lo primero que va a decir cualquier dueño: *"ese es mi número de
toda la vida, no lo pierdo"*. No lo pierde. Nada cambia para él, salvo que ahora
contesta solo.

**Sin coexistence este producto no se vende.**

### Embedded Signup

El alta la hace Meta desde nuestra app con un flujo de un par de clics. El dueño
no arma certificados ni pelea con Business Manager.

Para vos, que sos fuerte en técnica y flojo en venta, esto es clave: **el
onboarding deja de ser una conversación y pasa a ser un botón.**

> ⚠️ **La v2 se deprecia el 15 de octubre de 2026. Implementar v4 directamente.**
> Todo tutorial que encuentres va a estar en v2. Ignoralo.

---

## Tech Provider vs Solution Partner

| | Tech Provider | Solution Partner |
|---|---|---|
| Línea de crédito de Meta | No | Sí |
| Factura a sus clientes por los mensajes | No | Sí |
| Quién paga los mensajes | Cada negocio, con su medio de pago | El partner, y lo refactura |

Como Tech Provider, **cada comercio paga sus mensajes directo a Meta**. Suena a
fricción en Argentina, donde no todos tienen tarjeta internacional.

**En nuestro caso hoy casi no existe**, porque nuestras conversaciones son de
servicio y hasta el 1/10/2026 son gratis. Desde esa fecha todo mensaje saliente
se cobra (ver arriba), así que el pago a Meta pasa a ser un costo operativo
mensual real, no solo de promos.

Basework resolvió esto siendo Tech Provider oficial y cobrando su plan en pesos,
dejando que Meta le cobre al cliente lo suyo. Mismo camino.

---

## Arquitectura de la integración

```
Meta ──POST──▶ /webhook/whatsapp
                    │
                    ├─ verificar firma X-Hub-Signature-256   ← obligatorio
                    ├─ responder 200 YA (Meta reintenta si tarda)
                    └─ encolar y procesar async
                            │
                            ├─ phone_number_id → negocio
                            ├─ from → cliente
                            └─ sesión de agente (resume por número)
```

### Reglas del gateway

1. **Responder 200 antes de procesar.** Meta reintenta si tardás, y ahí tenés el
   mensaje duplicado.
2. **Idempotencia por `message.id`.** Un reintento no puede crear dos pedidos.
3. **Verificar la firma del webhook** siempre.
4. **Outbox con reintentos** para lo saliente. Ya está resuelto en
   `wa-claude/src/outbox.js`.
5. **Historial propio.** No se depende del canal para saber qué se dijo.
6. **La ventana de 24hs es real**: pasado ese plazo solo se puede escribir con
   plantilla aprobada. El recordatorio de turno **es una plantilla**, hay que
   tenerla aprobada de antemano.

### Plantillas a aprobar antes del piloto

| Plantilla | Categoría | Para qué |
|---|---|---|
| `recordatorio_turno` | utility | 24hs antes, con botones confirmar/cancelar |
| `turno_confirmado` | utility | Comprobante del turno |
| `pedido_listo` | utility | "Ya lo podés retirar" |
| `hueco_liberado` | utility | Ofrecer una cancelación a la lista de espera |
| `reactivacion` | marketing | Clientes que dejaron de venir |

La aprobación tarda. **Mandarlas apenas exista la app**, no la semana del piloto.

---

## Checklist de arranque

- [ ] App en Meta for Developers, producto WhatsApp
- [ ] Business Manager verificado
- [ ] Webhook con URL pública y firma verificada
- [ ] Número de prueba andando (Meta da uno gratis)
- [ ] Las 5 plantillas mandadas a aprobar
- [ ] Embedded Signup **v4** implementado
- [ ] Coexistence habilitado en el flujo de alta
- [ ] Confirmar el cambio del 1/10 en fuente oficial
- [ ] App Review iniciado (cuando ande el piloto 2)

---

## Fuentes

- [Pricing on the WhatsApp Business Platform (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Embedded Signup Overview (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Onboard WhatsApp Business app users / Coexistence (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Become a Tech Provider (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Precios WhatsApp Business API Argentina 2026 (Basework)](https://www.basework.com.ar/precios-whatsapp-business-api-argentina)
- [WhatsApp Business API Pricing 2026 (Blueticks)](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
