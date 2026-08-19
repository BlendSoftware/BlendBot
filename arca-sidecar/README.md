# Sidecar ARCA

Microservicio interno de facturación electrónica. Envuelve `pyafipws` para
hablar con **WSAA** (autenticación con certificado) y **WSFEv1** (emisión de
CAE), y le da al core de Go un único endpoint HTTP.

Base heredada de `BlendPos/afip-sidecar`, que factura en producción. Lo que
cambió acá es el modelo de operación, no la mecánica de ARCA.

---

## Qué cambió respecto del sidecar original

| Original (BlendPos) | Acá |
|---|---|
| Un solo negocio: CUIT, punto de venta y certificado en variables de entorno, cargados al arrancar | **Stateless multi-tenant**: todo llega en el body de cada request, incluidos los PEM |
| Certificados montados en `/certs` o inyectados en base64 al contenedor | Los PEM llegan descifrados desde el core y se materializan por tenant en `ARCA_CACHE_DIR`, `0600` dentro de un directorio `0700` |
| Un `AFIPClient` global + `POST /configurar` para recargarlo en caliente | Pool de clientes en memoria keyed por `sha256(cuit+modo+cert+key)`, LRU. `/configurar` se eliminó |
| Factura A/B de retail, con IVA discriminado, items y tributos | **Factura C (CbteTipo 11), concepto 2 (servicios)**: `FchServDesde/Hasta/FchVtoPago`, `ImpIVA=0`, `ImpNeto = total`, sin array IVA |
| Respuesta `{resultado, numero_comprobante, cae, observaciones...}`; los errores de ARCA salían como HTTP 502 | Respuesta `{ok, numero, cae, cae_vencimiento, error?}`; los errores del fisco son **200 con `ok:false`** y un mensaje legible |
| `/health` autenticaba contra ARCA en cada llamada | `/health` es liveness puro: sin auth y sin red |
| Token WSAA en Redis con una clave global | Clave por tenant: `arca:wsaa:<huella>:token`. Redis es opcional |
| 403 con token inválido | **401** |

Lo que **no** se tocó: los `patch_*.py`. Son la parte cara del asunto —
compatibilidad Python 2→3 de `pysimplesoap`/`pyafipws`, el CMS del WSAA, la RG
5616 y una lista larga de códigos de error de ARCA. El Dockerfile los aplica en
el mismo orden que en BlendPos.

La historia de esos parches está en `docs-heredados/` (`IMPLEMENTATION.md`,
`ESTADO_ACTUAL.md`). Describen el sidecar viejo: leer como archivo histórico,
no como documentación de este servicio.

---

## Contrato

### `POST /facturar`

Header `X-Internal-Token: $INTERNAL_API_TOKEN` (401 sin él).

```json
{
  "cuit_emisor": "20442477060",
  "punto_venta": 3,
  "modo": "homologacion",
  "cert_pem": "-----BEGIN CERTIFICATE-----\n...",
  "key_pem": "-----BEGIN PRIVATE KEY-----\n...",
  "tipo_cbte": 11,
  "concepto": 2,
  "doc_tipo": 99,
  "doc_nro": "0",
  "importe_total": "15000.00",
  "fecha": "2026-08-18",
  "servicio_desde": "2026-08-18",
  "servicio_hasta": "2026-08-18"
}
```

- `fecha`, `servicio_desde`, `servicio_hasta` aceptan `YYYY-MM-DD` y `YYYYMMDD`.
- `vencimiento_pago` es opcional; si falta se usa `fecha` (el cobro ya ocurrió).
- `concepto` 2 o 3 **exige** el período de servicio: si falta, 422.

Respuesta:

```json
{ "ok": true, "numero": 42, "cae": "71234567890123", "cae_vencimiento": "2026-09-01", "error": null }
```

```json
{ "ok": false, "numero": 42, "cae": null, "cae_vencimiento": null,
  "error": "ARCA rechazó el comprobante: [10016] El comprobante ya fue autorizado" }
```

**`cae_vencimiento` sale en ISO `YYYY-MM-DD`**, no en el `YYYYMMDD` que devuelve
ARCA. El core lo guarda en una columna `date`.

Códigos: `200` siempre que el request sea válido (incluso si ARCA rechaza),
`401` token interno inválido, `422` request malformado, `500` sólo si se rompe
el sidecar.

El 422 devuelve `{ok:false, error, detalles:[{campo, mensaje}]}` **sin el valor
rechazado**: el body trae claves privadas y el handler por defecto de FastAPI
las hubiese devuelto en el error.

### `GET /health`

Sin auth, sin red: `{ok, service, version, tenants_en_cache}`.

---

## Cómo correr

```bash
uv venv .venv && . .venv/bin/activate
uv pip install -r requirements-dev.txt
pytest                      # 60 tests, sin red
```

`pyafipws` **no está en el venv de desarrollo** — su `setup.py` es Python 2 y
sólo se instala parcheado, dentro de la imagen. Los tests lo doblan
(`tests/fake_pyafipws.py`), así que corren en cualquier lado.

Para levantar el servicio de verdad hace falta la imagen:

```bash
docker build -t arca-sidecar .
docker run --rm -p 8001:8001 -e INTERNAL_API_TOKEN=dev-token arca-sidecar
curl localhost:8001/health
```

Variables en `.env.example`. Ninguna es un certificado.

Para el compose raíz del proyecto:

```yaml
  arca-sidecar:
    build: ./arca-sidecar
    environment:
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      ARCA_MODO_DEFAULT: homologacion
      REDIS_URL: redis://redis:6379/0
    depends_on: [redis]
```

Y en el core: `ARCA_SIDECAR_URL=http://arca-sidecar:8001`.

> El sidecar **no se publica a internet**. Sólo lo llama el worker facturador
> del core, por la red interna.

---

## Probar en homologación con certificados reales

1. Generar CSR y clave: `./generate_certs.sh` (pide CUIT y razón social).
2. Subir el CSR a ARCA (portal → *Administración de Certificados Digitales*),
   descargar el `.crt` y asociarlo al servicio **wsfe**.
3. Dar de alta un **punto de venta** de tipo *Factura Electrónica — Webservice*.
   Sin eso, ARCA rechaza con `602`/`10016` y no es culpa del código.
4. Cargarlos en el negocio vía `PUT /api/admin/negocios/:id/fiscal` del core
   (que los cifra) con `modo: "homologacion"`, o probar directo:

```bash
curl -s localhost:8001/facturar \
  -H "X-Internal-Token: $INTERNAL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d @- <<JSON | jq
{
  "cuit_emisor": "20xxxxxxxx9",
  "punto_venta": 1,
  "modo": "homologacion",
  "cert_pem": $(jq -Rs . < homo.crt),
  "key_pem": $(jq -Rs . < homo.key),
  "tipo_cbte": 11, "concepto": 2,
  "doc_tipo": 99, "doc_nro": "0",
  "importe_total": "1000.00",
  "fecha": "$(date +%F)",
  "servicio_desde": "$(date +%F)",
  "servicio_hasta": "$(date +%F)"
}
JSON
```

Cosas que van a pasar y no son bugs:

- **`coe.alreadyAuthenticated`**: ARCA todavía tiene vivo el ticket anterior de
  ese certificado. Expira solo (hasta 5 h). El sidecar lo reporta con un mensaje
  claro y el core reintenta.
- **El primer request de cada tenant tarda**: baja el WSDL y firma el CMS. Los
  siguientes reusan el token 12 h.
- **Homologación se cae seguido.** Por eso existe la cola de reintentos del core.

---

## Notas de operación

- Los PEM viven en disco mientras el tenant esté en el cache. Ese disco tiene
  que ser efímero (tmpfs o volumen del contenedor), nunca un backup.
- Nada de credenciales en los logs: los schemas tienen `repr=False` en los PEM,
  el logging usa `resumen_seguro()` y el handler de 422 recorta el input. Si
  agregás logs, respetalo.
- `ARCA_MAX_TENANTS_CACHE` (default 50) acota la memoria. Al desalojar por LRU
  se pierde el token de ese negocio, no la factura.
