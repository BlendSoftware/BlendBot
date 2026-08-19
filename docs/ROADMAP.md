# Roadmap

## La regla que no se negocia

> **El núcleo se diseña para los dos verticales. El calendario libera uno solo.**

El motor de compromisos se diseña sabiendo que después entra gastronomía. Pero
**no se escribe una línea de comanda de cocina hasta que el primer consultorio
pague**. Nada de modificadores, nada de zonas de delivery, nada de tiempos de
preparación. Eso vive en el diseño, no en el sprint.

### Por qué esta regla existe

Dos proyectos anteriores murieron exactamente así:

| Proyecto | Qué pasó |
|---|---|
| **BlendPOS V2** | SaaS multi-tenant. Tres meses en pausa, archivado el 11/08/2026 |
| **BlendPadel** | Red social con matchmaking ELO. Mismo final, mismo día |

Ninguno murió por el diseño. **Murieron porque no había nadie esperándolos.**

Y hay una segunda regla que sale de la misma historia:

> **El proyecto tiene que facturar antes de estar terminado.**

Un proyecto sin ingreso temprano muere de desgano. Descartar cualquier cosa que
necesite construirse entera antes del primer peso.

---

## Fase 0 · Antes de escribir código

**Duración: días, no semanas.**

- [ ] **Conseguir el primer consultorio piloto.** Nombre y apellido.
- [x] Definir el modelo de datos del motor — implementado en `core/migrations/000001_motor.up.sql` (18/08/2026)
- [ ] Crear la app en Meta y pedir el número de prueba
- [ ] Mandar las 5 plantillas a aprobar (tardan)
- [x] Confirmar en fuente oficial el cambio de Meta del 1/10/2026 — confirmado, ver [`WHATSAPP.md`](WHATSAPP.md) (18/08/2026)
- [ ] Consultar con contador el IVA en prestaciones de salud
- [ ] Hablar con Franco y Lautaro: qué pasa con Blend y con el reparto si esto
      sale de ahí

> El punto uno es el único bloqueante real. Todo lo demás se puede hacer en
> paralelo. **Sin un cliente esperando, esto es otro BlendPadel.**

---

## Fase 1 · MVP consultorios

**Objetivo: un consultorio real usándolo todos los días.**

### Core
- [ ] Esqueleto Go a partir de BlendPos (auth, middleware, config, apierror, dto)
- [ ] Migraciones del motor: `negocio`, `recurso`, `servicio`, `horario`,
      `compromiso`, `hold`, `cliente`, `cobertura`
- [ ] Motor: crear compromiso, máquina de estados con validación
- [ ] Disponibilidad: huecos reales descontando holds y excepciones
- [ ] Holds con expiración
- [ ] Catálogo con `disponible` (adaptado de `producto_service.go`)
- [ ] Precio por cobertura (adaptado de `lista_precios`)

### Agente
- [ ] Servidor MCP con FastMCP (patrón de `Skill-Moodle/mcp/server.py`)
- [ ] Las 7 tools de [`ARQUITECTURA.md`](ARQUITECTURA.md)
- [ ] `SKILL.md` del vertical salud, versionado
- [ ] Confirmación en dos pasos con `confirmado=True`

### Gateway
- [ ] Webhook con verificación de firma e idempotencia
- [ ] Resolución de negocio por `phone_number_id`
- [ ] Sesión de agente por número, con resume persistido a disco
- [ ] Outbox con reintentos (de `wa-claude/src/outbox.js`)
- [ ] Embedded Signup **v4** + coexistence

### Panel
- [ ] Vista agenda del día
- [ ] Catálogo con interruptor
- [ ] Alta y edición de profesionales, horarios y excepciones
- [ ] Ficha de cliente

### Anti ausentismo
- [ ] Recordatorio automático 24hs antes con confirmar/cancelar
- [ ] Liberación del hueco al cancelar
- [ ] Lista de espera y oferta automática del hueco liberado

**Criterio de salida:** el consultorio pasa una semana entera sin tocar el
WhatsApp a mano.

---

## Fase 2 · Cobro y ARCA

**Es lo que convierte el asistente en un sistema.**

- [ ] Cierre de compromiso con cobro
- [ ] Adaptar el sidecar a Factura C y concepto "servicios"
- [ ] Certificados por tenant, cifrados
- [ ] Cola de reintentos por negocio
- [ ] Circuito completo probado en homologación
- [ ] PDF de la factura al cliente por WhatsApp
- [ ] Cierre del día en el panel

**Criterio de salida:** el consultorio no entra más al portal de ARCA.

---

## Fase 3 · Cobrar

- [ ] Definir precio (ver [`PRODUCTO.md`](PRODUCTO.md))
- [ ] Alta de pago
- [ ] **Pasar los pilotos a pago**
- [ ] App Review de Tech Provider aprobado (arrancarlo en fase 1)
- [ ] Onboarding autoservicio: alta, catálogo, horarios, número

**Criterio de salida: el primer peso facturado.**

> Hasta acá **no se escribió una línea de gastronomía**.

---

## Fase 4 · Analítica

- [ ] Reportes descriptivos
- [ ] Los accionables (demanda insatisfecha, clientes perdidos, ausentismo)
- [ ] Resumen semanal por WhatsApp
- [ ] Botón de re-activación

Va acá y no antes porque **antes no hay datos** y se ve vacío.

---

## Fase 5 · Vertical gastronomía

**Recién con el vertical uno cobrando.**

- [ ] `recurso` tipo cocina, con capacidad por franja
- [ ] `recurso` tipo mesa, con capacidad por cubiertos
- [ ] Política de confirmación humana con demora
- [ ] Comanda: vista de cocina sin precios
- [ ] Modificadores ("sin cebolla")
- [ ] Delivery: dirección, zona, radio
- [ ] `SKILL.md` del vertical gastronomía

El motor no se toca. **Si hay que tocarlo, el diseño estaba mal.**

---

## Fase 6 · Después

Nada de esto se piensa hasta acá:

- Voz por llamada. Linda en demo, se come tres meses en latencia, costo por
  minuto y ruido de local. **Fase 3 de tu idea original, y sigue estando bien
  ahí.**
- Integración con e-commerce
- Multi-sucursal
- App nativa
- Marketplace de integraciones

---

## Cronograma realista

No hay fechas. Hay condiciones de salida.

Pero sí hay un marco: esto se construye **con el sueldo puesto**, en los ratos
que dejan dos frentes de trabajo. Eso significa poco tiempo por día y ninguna
tolerancia al desperdicio.

**Cada semana que no acerca al primer peso facturado es una semana perdida.**
