# Copiloto Comercios

> Nombre de trabajo. Cambiar cuando haya marca.

**El WhatsApp del negocio contesta solo, sabe de verdad qué hay, y deja el
compromiso armado en un panel. Cuando se cobra, emite la factura.**

Un motor de compromisos con un asistente conversacional adelante y un panel de
control atrás, para **gastronomía**: restaurantes, hamburgueserías, pizzerías,
cafés y bares.

> El motor se diseñó genérico (soporta más de un tipo de vertical a nivel de
> datos), pero el producto que se vende y se opera hoy es exclusivamente
> gastronomía. Ver D21 en [`docs/DECISIONES.md`](docs/DECISIONES.md).

---

## Por qué existe

No es un chatbot más. Hay decenas.

Lo que ninguno hace es **cerrar el círculo**: tomar el pedido o la reserva de
mesa, gestionarlo con estados reales, cobrarlo y **emitir el comprobante de
ARCA**.
Eso convierte al producto de "asistente" en "el sistema de gestión del negocio",
y es lo que hace que no te den de baja a los tres meses.

Y el timing no es casual: **desde el 1° de julio de 2026 la factura electrónica
es obligatoria para todos los monotributistas**, y los consultorios ya estaban
obligados por prestación. Miles de negocios chicos acaban de quedar obligados y
lo están resolviendo a mano en el portal de ARCA.

Ver [`docs/ARCA.md`](docs/ARCA.md).

---

## La idea en una tabla

Un pedido y una reserva de mesa son **el mismo objeto**:

| | Recurso que ocupa | Duración |
|---|---|---|
| **Pedido** | capacidad de cocina | una franja |
| **Reserva** | una mesa | un rato |

Un solo motor. Ver [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## Los documentos

| Documento | Qué contiene |
|---|---|
| [`docs/REPOS-BASE.md`](docs/REPOS-BASE.md) | **Empezar por acá.** Qué se toma de cada uno de los tres repos, archivo por archivo |
| [`docs/PRODUCTO.md`](docs/PRODUCTO.md) | Qué se vende, a quién, por cuánto, contra quién |
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | El motor de compromisos, modelo de datos, stack, cómo se juntan los repos |
| [`docs/FLUJOS.md`](docs/FLUJOS.md) | Las conversaciones validadas, mensaje por mensaje, y el panel |
| [`docs/WHATSAPP.md`](docs/WHATSAPP.md) | Integración con la API oficial, costos reales, onboarding, fechas límite |
| [`docs/ARCA.md`](docs/ARCA.md) | El diferencial fiscal, normativa vigente, qué se adapta del sidecar |
| [`docs/PANEL.md`](docs/PANEL.md) | El dashboard: vistas, principios de diseño, analítica |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases, alcance del v1 y sobre todo lo que NO va |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Cada decisión tomada, con su porqué |

---

## Se construye sobre tres repos que ya existen

| Repo | Aporta |
|---|---|
| `BlendSoftware/BlendPos` | Backend Go, catálogo, cobro y **el sidecar de ARCA** |
| `Group-Active-IA/Skill-Moodle` | El patrón del agente: MCP con tools, panel, multi-tenant. MIT, copyright de Juani |
| `JuaniSarmiento/wa-claude` | El puente con el Agent SDK, sesiones, outbox. **Sin Baileys** |

Detalle archivo por archivo en [`docs/REPOS-BASE.md`](docs/REPOS-BASE.md).

---

## Estado

**Al 19/08/2026: el sistema entero está construido y corre de punta a punta en
esta máquina.** Arrancó el 18/08/2026.

Qué existe, y anda con tests:

| Pieza | Qué hace | Dónde |
|---|---|---|
| **Core** (Go + Postgres) | Motor de compromisos: catálogo con interruptor, precios, disponibilidad real, holds con expiración, máquina de estados, agenda del día, clientes, multi-tenant por token | `core/` |
| **Agente** (Python, MCP) | Las tools del vertical gastronomía sobre la API del core. El agente jamás toca la base | `agente/` |
| **Gateway** (Node) | WhatsApp Cloud API: webhook con firma, sesión por número, outbox con reintentos | `gateway/` |
| **Panel** (React + Vite) | Agenda operativa, catálogo, equipo y horarios, clientes, lista de espera, cierre del día | `panel/` |
| **Anti ausentismo** | Recordatorio 24hs antes, liberación del hueco al cancelar y oferta automática al primero de la lista de espera | `core/internal/worker/` |
| **Cobro + ARCA** | Cobro del compromiso, Factura C por tenant con certificados cifrados y cola de reintentos, contra el sidecar de ARCA | `core/` + `arca-sidecar/` |

Se levanta entero con Docker: `make up && make smoke` (ver el
[`Makefile`](Makefile) y [`scripts/smoke.sh`](scripts/smoke.sh), que recorre el
producto por la API real). Para desarrollar con el core en la máquina:
`make infra && make core-run`.

### Lo que NO está

Nada de esto es código: es trámite, plata o un cliente. Y es lo que separa
"corre en mi máquina" de "un local lo usa":

- **La app en Meta**: no está dada de alta. No hay número de WhatsApp productivo.
- **Las plantillas aprobadas**: las 5 plantillas del recordatorio y las
  confirmaciones no se mandaron a aprobar. Tardan.
- **El piloto con nombre y apellido**: sigue sin haber un local de gastronomía
  esperando esto. **Es el único bloqueante real.**
- **Los certificados de ARCA reales**: el circuito fiscal está entero, pero
  corre contra homologación con certificados de prueba. Ningún CUIT real cargado.
- **El deploy productivo**: dominio, TLS, backups y monitoreo. Hoy esto vive en
  una notebook.

Dos proyectos anteriores (BlendPOS V2, BlendPadel) murieron archivados a los
tres meses. No por el diseño. Porque no había nadie esperándolos.

- [ ] Conseguir el primer local piloto de gastronomía (nombre y apellido)
- [ ] Alta de la app en Meta y primer número de prueba
- [ ] Mandar las plantillas a aprobar
- [ ] Certificados de ARCA del piloto (homologación primero, producción después)
- [x] Motor de compromisos, agente, gateway, panel y anti ausentismo (19/08/2026)
- [x] Cobro y Factura C contra el sidecar de ARCA, en homologación (19/08/2026)

---

## Origen

Sale de una sesión de diseño del **18/08/2026**. El contexto de por qué este
proyecto existe (la salida del frente laboral actual, los números que lo
financian, el plazo) vive en el vault, no acá.
