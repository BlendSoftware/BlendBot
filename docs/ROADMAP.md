# Roadmap

> **Pivote (21/08/2026):** el producto queda enfocado exclusivamente en
> **gastronomía**. El vertical salud/consultorios se discontinúa como oferta
> comercial (ver D21 en [`DECISIONES.md`](DECISIONES.md)). Las fases de acá
> abajo documentan cómo se construyó el motor genérico — muchas se probaron
> primero contra el piloto de consultorio, que ya no es el plan — y de acá en
> más todo el trabajo nuevo es sobre gastronomía. El motor sigue siendo
> genérico (soporta el tipo `profesional` a nivel de datos), pero no hay plan
> de vender salud.

## La regla que no se negocia

> **El núcleo se diseña genérico. El calendario libera lo que hay que vender.**

El motor de compromisos se diseñó sabiendo que iba a tener que servir a más de
un tipo de recurso (profesional, mesa, cocina). Pero **no se escribe una línea
de una feature nueva hasta que el negocio de al lado esté pagando por lo que ya
existe**. Nada de modificadores, nada de zonas de delivery, nada de tiempos de
preparación antes de tiempo. Eso vive en el diseño, no en el sprint.

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

- [ ] **Conseguir el primer local piloto de gastronomía.** Nombre y apellido.
- [x] Definir el modelo de datos del motor — implementado en `core/migrations/000001_motor.up.sql` (18/08/2026)
- [ ] Crear la app en Meta y pedir el número de prueba
- [ ] Mandar las 5 plantillas a aprobar (tardan)
- [x] Confirmar en fuente oficial el cambio de Meta del 1/10/2026 — confirmado, ver [`WHATSAPP.md`](WHATSAPP.md) (18/08/2026)
- [ ] Hablar con Franco y Lautaro: qué pasa con Blend y con el reparto si esto
      sale de ahí

> El punto uno es el único bloqueante real. Todo lo demás se puede hacer en
> paralelo. **Sin un cliente esperando, esto es otro BlendPadel.**

---

## Fase 1 · MVP del motor genérico

**Objetivo original: un consultorio real usándolo todos los días.** Esa
validación se hizo con el piloto de salud, vertical hoy discontinuado (ver la
nota de pivote arriba). Lo que se construyó es el motor genérico — sigue en
pie y hoy sirve a gastronomía.

**Construida entera el 19/08/2026** contra el caso de uso de consultorios.
Varios ítems abajo (agente con `SKILL.md` de salud, agenda de profesionales en
el panel) son específicos de ese piloto y no son el foco de ahora; lo que
importa hacia adelante es el motor, la disponibilidad, los holds y el catálogo,
que son genéricos y ya sirven al vertical activo.

### Core
- [x] Esqueleto Go a partir de BlendPos (auth, middleware, config, apierror, dto) — `core/` (19/08/2026)
- [x] Migraciones del motor: `negocio`, `recurso`, `servicio`, `horario`,
      `compromiso`, `hold`, `cliente`, `cobertura` — `core/migrations/` (19/08/2026)
- [x] Motor: crear compromiso, máquina de estados con validación (19/08/2026)
- [x] Disponibilidad: huecos reales descontando holds y excepciones (19/08/2026)
- [x] Holds con expiración (19/08/2026)
- [x] Catálogo con `disponible` (19/08/2026)
- [x] Precio por cobertura (19/08/2026)

### Agente
- [x] Servidor MCP con FastMCP — `agente/server.py` (19/08/2026)
- [x] Las 7 tools de [`ARQUITECTURA.md`](ARQUITECTURA.md) (19/08/2026)
- [x] `SKILL.md` del vertical salud, versionado — `agente/skills/` (19/08/2026)
- [x] Confirmación en dos pasos con `confirmado=True` (19/08/2026)

### Gateway
- [x] Webhook con verificación de firma e idempotencia — `gateway/src/` (19/08/2026)
- [x] Resolución de negocio por `phone_number_id` (19/08/2026)
- [x] Sesión de agente por número, con resume persistido a disco (19/08/2026)
- [x] Outbox con reintentos (19/08/2026)
- [ ] Embedded Signup **v4** + coexistence — necesita la app en Meta, que no está dada de alta

### Panel
- [x] Vista agenda del día (19/08/2026)
- [x] Catálogo con interruptor (19/08/2026)
- [x] Alta y edición de profesionales, horarios y excepciones (19/08/2026)
- [x] Ficha de cliente (19/08/2026)
- [x] Lista de espera: ver la cola, anotar a mano y sacar (19/08/2026)

### Anti ausentismo
- [x] Recordatorio automático 24hs antes con confirmar/cancelar (19/08/2026)
- [x] Liberación del hueco al cancelar (19/08/2026)
- [x] Lista de espera y oferta automática del hueco liberado (19/08/2026)

**Criterio de salida (reformulado para gastronomía):** el local pasa una semana
entera sin tocar el WhatsApp a mano. **Todavía no se cumplió: no hay local
piloto ni número productivo.**

---

## Fase 2 · Cobro y ARCA

**Es lo que convierte el asistente en un sistema.**

**Construida el 19/08/2026, probada contra homologación con certificados de
prueba.** Ningún CUIT real cargado todavía.

- [x] Cierre de compromiso con cobro (19/08/2026)
- [x] Adaptar el sidecar a Factura C y concepto "servicios" — `arca-sidecar/` (19/08/2026)
- [x] Certificados por tenant, cifrados (AES-256-GCM, clave fuera de la base) (19/08/2026)
- [x] Cola de reintentos por negocio, con backoff (19/08/2026)
- [x] Cierre del día en el panel (19/08/2026)
- [ ] Circuito completo probado en homologación **con certificados reales de un
      CUIT** — hoy corre contra el sidecar con certificados de prueba
- [ ] PDF de la factura al cliente por WhatsApp — hoy sale el aviso con número y
      CAE en texto, no el PDF

**Criterio de salida:** el local no entra más al portal de ARCA.

---

## Fase 3 · Cobrar

- [ ] Definir precio (ver [`PRODUCTO.md`](PRODUCTO.md))
- [ ] Alta de pago
- [ ] **Pasar los pilotos a pago**
- [ ] App Review de Tech Provider aprobado (arrancarlo en fase 1)
- [ ] Onboarding autoservicio: alta, catálogo, horarios, número

**Criterio de salida: el primer peso facturado.**

---

## Fase 4 · Analítica

- [ ] Reportes descriptivos
- [ ] Los accionables (demanda insatisfecha, clientes perdidos, ausentismo)
- [ ] Resumen semanal por WhatsApp
- [ ] Botón de re-activación

Va acá y no antes porque **antes no hay datos** y se ve vacío.

---

## Fase 5 · Vertical gastronomía

**Gastronomía es el único vertical del producto** (ver la nota de pivote al
principio de este documento). Construida el 20/08/2026 según
[`EPICS.md`](../EPICS.md) (epic E10):

- [x] `recurso` tipo cocina, con capacidad por franja (20/08/2026)
- [x] `recurso` tipo mesa, con capacidad por cubiertos (20/08/2026)
- [x] Política de confirmación humana con demora (20/08/2026)
- [x] Comanda: vista de cocina sin precios (20/08/2026)
- [ ] Modificadores ("sin cebolla") — el campo nota alcanza por ahora
- [x] Delivery: dirección, zona, radio (validación por config; falta geocoding real) (20/08/2026)
- [x] `SKILL.md` del vertical gastronomía (20/08/2026)

El motor no se tocó para sumar esto. **Si hubiera que tocarlo, el diseño
estaba mal.**

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
