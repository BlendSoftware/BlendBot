# Copiloto Comercios

> Nombre de trabajo. Cambiar cuando haya marca.

**El WhatsApp del negocio contesta solo, sabe de verdad qué hay, y deja el
compromiso armado en un panel. Cuando se cobra, emite la factura.**

Un motor de compromisos con un asistente conversacional adelante y un panel de
control atrás, para dos verticales: **gastronomía** y **consultorios**.

---

## Por qué existe

No es un chatbot más. Hay decenas.

Lo que ninguno hace es **cerrar el círculo**: tomar el pedido o el turno,
gestionarlo con estados reales, cobrarlo y **emitir el comprobante de ARCA**.
Eso convierte al producto de "asistente" en "el sistema de gestión del negocio",
y es lo que hace que no te den de baja a los tres meses.

Y el timing no es casual: **desde el 1° de julio de 2026 la factura electrónica
es obligatoria para todos los monotributistas**, y los consultorios ya estaban
obligados por prestación. Miles de negocios chicos acaban de quedar obligados y
lo están resolviendo a mano en el portal de ARCA.

Ver [`docs/ARCA.md`](docs/ARCA.md).

---

## La idea en una tabla

Un pedido, una reserva de mesa y un turno médico son **el mismo objeto**:

| | Recurso que ocupa | Duración |
|---|---|---|
| **Pedido** | capacidad de cocina | una franja |
| **Reserva** | una mesa | un rato |
| **Turno** | un profesional | un rato |

Un solo motor, tres enchufes. Ver [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

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

**En desarrollo** (arrancó el 18/08/2026). El esqueleto del core Go corre:
migración del motor aplicada, máquina de estados con tests, `/health` en verde.
Ver `core/` y el [`Makefile`](Makefile) (`make infra && make core-run`).

**El bloqueante real sigue sin ser técnico: falta el primer cliente con nombre.**

Dos proyectos anteriores (BlendPOS V2, BlendPadel) murieron archivados a los
tres meses. No por el diseño. Porque no había nadie esperándolos.

- [ ] Conseguir el primer consultorio piloto (nombre y apellido)
- [x] Definir el modelo de datos del motor (`core/migrations/000001_motor.up.sql`)
- [ ] Alta de la app en Meta y primer número de prueba

---

## Origen

Sale de una sesión de diseño del **18/08/2026**. El contexto de por qué este
proyecto existe (la salida del frente laboral actual, los números que lo
financian, el plazo) vive en el vault, no acá.
