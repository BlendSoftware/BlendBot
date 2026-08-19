# ARCA · el diferencial

> **AFIP ya no existe.** Desde octubre de 2024 es **ARCA** (Agencia de
> Recaudación y Control Aduanero). Dato menor pero importante al hablar con
> contadores.

---

## Por qué esto es el foso

Todos los bots de WhatsApp del mercado contestan. **Ninguno factura.**

Si el turno se toma, se cobra y sale el comprobante fiscal, el producto deja de
ser un asistente y pasa a ser **el sistema de gestión del negocio**. Y de un
sistema de gestión no te dan de baja a los tres meses.

Esto no se copia en un fin de semana. Certificados, WSAA, WSFEv1, los reintentos,
los códigos de error crípticos del fisco: son meses de dolor que **ya están
pagados** en `BlendPos/afip-sidecar`.

---

## El timing, que es regalado

**Desde el 1° de julio de 2026 la factura electrónica es obligatoria para TODOS
los monotributistas.** Se terminaron los talonarios en papel.

Y los consultorios ya estaban obligados antes:

> "Si tenés un consultorio en Argentina, estás obligado a emitir factura
> electrónica por cada prestación, sin importar si sos monotributista o
> responsable inscripto."

También quedaron alcanzados colegios privados, prepagas y entidades civiles que
cobran directo a sus afiliados.

**Eso entró en vigencia hace seis semanas.**

O sea que ahora mismo hay miles de consultorios, kinesiólogos, psicólogos y
locales chicos que **acaban de quedar obligados** y lo están resolviendo entrando
al portal de ARCA a mano, una factura por vez, o pagándole al contador.

Ese es el gancho. No hay que crear el dolor: lo creó el Estado hace seis semanas.

---

## Cómo cambia el pitch

Sin ARCA:

> "Te contesto el WhatsApp y te agendo los turnos."

Con ARCA:

> "Los pacientes te piden turno por WhatsApp y vos contestás cuando podés. Esto
> contesta solo, te agenda el turno, y **cuando cobrás la consulta te emite la
> factura sola**. No entrás más a ARCA."

La primera compite contra veinte. La segunda no compite contra nadie.

---

## Qué hay hoy en BlendPos

```
afip-sidecar/
  main.py                    FastAPI
  afip_client.py             el cliente
  schemas.py                 modelos de request/response
  certs/                     certificados (NUNCA al repo)
  generate_certs.sh          generación de CSR y certificados
  download_afip_chain.sh     cadena de confianza
  patch_wsaa*.py             ~8 parches al WSAA (auth)
  patch_wsfev1*.py           ~9 parches al WSFEv1 (facturación)
  patch_pysimplesoap.py      la librería SOAP no funciona sin esto
  py3_compat.py              compatibilidad
  Dockerfile · docker-compose.yml
  AFIP_ARQUITECTURA.md · IMPLEMENTATION.md · ESTADO_ACTUAL.md
```

Del lado Go: `internal/service/facturacion_service.go`,
`model/comprobante.go`, `model/configuracion_fiscal.go`,
`handler/configuracion_fiscal.go`.

Y en las migraciones ya está resuelto lo difícil de operar:

- `000003_comprobante_retry` — reintentos cuando ARCA se cae, que se cae
- `000010_comprobante_unique_venta` — un comprobante por venta, sin duplicados

**Esa cantidad de parches es la prueba de por qué esto es un foso.** Nadie
atraviesa eso por gusto.

---

## Qué hay que adaptar

El sidecar está armado para el comprobante de un comercio de retail. Para los
verticales nuevos cambia **el tipo de comprobante y el tratamiento impositivo**,
no la mecánica.

| Tema | Qué revisar |
|---|---|
| **Tipo de comprobante** | Un monotributista emite **Factura C**. El sidecar hoy apunta al caso de comercio. Es un parámetro más en el request. |
| **Servicios de salud** | Tienen tratamiento propio de IVA (muchas prestaciones exentas). **Exento no es "no facturar"**: igual se emite comprobante. Consultar con contador antes de codear. |
| **Concepto** | WSFEv1 distingue productos, servicios y ambos. Un turno es **servicio**, y eso obliga a informar fecha de servicio desde/hasta. |
| **Punto de venta** | Cada negocio tiene el suyo. Ya está en `configuracion_fiscal`. |
| **Certificados por tenant** | Hoy es un certificado. Multi-tenant necesita uno por CUIT, guardado cifrado. **Es el trabajo más grande de la adaptación.** |
| **Operaciones > $10.000.000** | Obligan a identificar al cliente, sin comprobante anónimo. Poco probable acá, pero está |

---

## Multi-tenant fiscal: la parte delicada

Es lo único genuinamente nuevo del módulo, y es sensible:

1. **Un certificado y una clave privada por negocio.** Nunca compartidos.
2. **Cifrados en reposo**, con la clave fuera de la base. Mismo criterio que las
   credenciales de Moodle en el Copiloto: AES, vault aparte.
3. **Nunca en el repo, nunca en logs, nunca en una nota.** `certs/` va al
   `.gitignore` y se verifica que no haya quedado nada en el historial.
4. El **token del WSAA dura 12 horas**: cachearlo por CUIT y renovarlo, no pedir
   uno por factura.
5. **La cola de reintentos es por negocio.** Si ARCA se cae, no puede trabarse
   todo el sistema.

---

## Flujo completo

```
compromiso COMPLETADO
        │
        ▼
   POST /api/cobros          medio de pago, monto
        │
        ▼
   venta (BlendPos)          el modelo ya existe
        │
        ▼
   facturacion_service (Go)
        │
        ▼
   sidecar ARCA (Python)     WSAA → WSFEv1
        │
        ├─ ok    → CAE + vencimiento → comprobante
        └─ error → cola de reintento (migration 3)
        │
        ▼
   PDF al cliente por WhatsApp   ← el toque que lo hace parecer magia
```

**Mandarle la factura al paciente por el mismo WhatsApp donde sacó el turno** es
el remate. Cierra el círculo entero en un solo canal.

---

## Pendientes

- [ ] Confirmar con contador el tratamiento de IVA en prestaciones de salud
- [ ] Adaptar el sidecar a Factura C y concepto "servicios"
- [ ] Diseñar el almacenamiento cifrado de certificados por tenant
- [ ] Probar el circuito completo en el **homologación** de ARCA antes de producción
- [ ] Definir qué pasa si el negocio todavía no dio de alta el punto de venta
      (onboarding fiscal asistido: probablemente valga como feature aparte)

---

## Fuentes

- [ARCA 2026: quiénes deberán emitir facturas electrónicas (El Cronista)](https://www.cronista.com/informacion-gral/arca-2026-quienes-deberan-emitir-facturas-electronicas-a-partir-de-ahora-y-que-cambios-deben-acatar/)
- [ARCA amplió la factura electrónica desde julio 2026 (Ámbito)](https://www.ambito.com/economia/arca-amplio-la-factura-electronica-y-todas-estas-personas-deberan-emitir-comprobantes-julio-2026-n6247735)
- [Facturación electrónica ARCA para médicos](https://www.medicai.com.ar/blog/arca-facturacion-electronica-2026)
- [Normativa AFIP/ARCA para Factura Electrónica](https://www.tusfacturas.app/normativa-afip-factura-electronica.html)
