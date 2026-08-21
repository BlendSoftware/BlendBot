# Flujos

> **Vertical activo: gastronomía.** El Flujo A (pedido) y el Flujo D (reserva
> de mesa) son los flujos vigentes del producto. Los Flujos B y C (turno de
> consultorio, recordatorio anti-ausentismo) documentan el vertical salud,
> discontinuado como oferta comercial (ver D21 en
> [`DECISIONES.md`](DECISIONES.md)); se conservan como referencia de diseño
> del motor genérico, no como flujos activos.

Estos flujos **no son teoría**: salieron de prototipar la conversación a mano el
18/08/2026, con Juani haciendo de cliente y corrigiendo en vivo. Cada corrección
quedó anotada como decisión.

---

## Principios del asistente

1. **Mensajes cortos.** Es WhatsApp. Un párrafo largo espanta.
2. **Opciones numeradas** cuando hay bifurcación (en la API oficial son botones
   interactivos), pero **siempre acepta texto libre**. La gracia del LLM es
   entender "te piedo una hhhamburguesa doble cheddar yunas paps".
3. **Nunca re-pregunta lo que ya le dijeron.** Si el cliente escribió "lo paso a
   buscar", no se le pregunta si es delivery.
4. **Asume lo razonable y ofrece la alternativa**, en vez de interrogar.
5. **No promete lo que no sabe.** Ni tiempos ni precios ni disponibilidad.
6. **Confirma el resumen antes de cerrar**, siempre con el total.

---

## Flujo A: pedido en gastronomía

### La conversación, tal como quedó validada

```
Cliente ─▶ Hola

  🍔 Burger House
  ¡Hola! Soy el asistente del local, atiendo las 24hs.
  ¿Qué necesitás?
   1  Hacer un pedido
   2  Reservar mesa
   3  Ver la carta

Cliente ─▶ hacer un pedido

  ¡Buenísimo! Te paso la carta 👇

  Hamburguesas
  Simple              $6.500
  Doble cheddar       $8.900
  Bacon & cheddar     $9.500
  Veggie              $7.800

  Para compartir
  Papas               $4.500
  Papas cheddar y bacon  $5.800

  Bebidas
  Gaseosa 500ml       $2.500
  Agua                $2.000
  Cerveza IPA         $4.800

  Decime qué te sirvo y las cantidades. Podés escribirlo
  como te salga, yo lo armo 😉

Cliente ─▶ te piedo una hhhamburguesa doble cheddar yunas paps,
           lo paso a buscar

  ¡Listo! Te lo armo así:

   1×  Doble cheddar        $8.900
   1×  Papas                $4.500
   ─────────────────────────────────
   Total                   $13.400

   🏃 Retirás por el local

  (Las papas te las puse comunes. Si las querés con cheddar
   y bacon son $1.300 más, avisame.)

  ¿Para qué hora las querés?

Cliente ─▶ lo antes posible

  Perfecto, lo mando como "lo antes posible" 👌
  ¿A nombre de quién?

      ┌── acá el compromiso YA entró al panel como PENDIENTE ──┐

Cliente ─▶ Juani

  Gracias Juani 🙌
  Ya le pasé el pedido al local. En un minuto te confirmo
  la demora.

      ┌── el local confirma con 30 min desde el panel ──┐

  ✅ ¡Confirmado, Juani!
  Tu pedido ya está en cocina. Lo tenés listo a las 21:15 🕘
  Te aviso apenas esté para retirar.
```

### Lo que se corrigió al prototipar

| Error del primer intento | Corrección |
|---|---|
| El bot dijo "sale en 25 minutos, a las 21:10" | **El bot no promete demoras.** La demora la pone el local desde el panel. |
| El bot pedía la hora al cliente | Si dijo "lo antes posible", **no se le pregunta la hora**: se le pregunta el nombre y decide el local |
| El compromiso entraba al panel recién al final | **Entra apenas hay ítems.** La cocina lo ve venir mientras el tipo todavía escribe |
| Presets de demora 15/25/40 | El local eligió 30. **Presets sí, pero con campo libre siempre** |

### El orden que quedó

```
armar ítems  →  entra al panel PENDIENTE  →  pedir nombre
     →  avisar que espera confirmación
     →  el local: CONFIRMAR + demora  |  RECHAZAR
     →  avisar al cliente
     →  estados: EN_COCINA → LISTO → ENTREGADO
     →  cada cambio dispara aviso por WhatsApp
```

**El aviso de vuelta es la mitad del valor.** Es la diferencia entre un bot que
toma pedidos y un sistema que atiende.

---

## Flujo B: turno en consultorio

```
Cliente ─▶ Hola

  🦷 Odontología Del Valle
  ¡Hola! Soy el asistente del consultorio.
  ¿Qué necesitás?
   1  Sacar un turno
   2  Cancelar o reprogramar
   3  Hacer una consulta

Cliente ─▶ Sacar un turno

  Perfecto. ¿Qué necesitás?
   1  Consulta o control
   2  Limpieza
   3  Arreglo (caries, empaste)
   4  Urgencia, tengo dolor 🚨
   5  Otra cosa

Cliente ─▶ 3

  Un arreglo lleva unos 45 minutos.
  ¿Con quién preferís atenderte?
   1  Dra. Gómez     — primer turno 21/8
   2  Dr. Álvarez    — primer turno 19/8
   3  Me da igual, el que tenga antes

Cliente ─▶ 1

  Estos son los turnos libres de la Dra. Gómez 👇
   Vie 21/8 · 9:00 · 11:30 · 16:15
   Sáb 22/8 · 10:00
   Lun 24/8 · 8:30 · 15:00

  ¿Cuál te viene bien? Si preferís otro día, decime cuál
  y lo busco.

Cliente ─▶ el viernes

  Dale, viernes 21/8. ¿A qué hora?
   9:00 · 11:30 · 16:15

Cliente ─▶ 11:30

  Buenísimo. Te bloqueo el turno del viernes 21/8 a las
  11:30 por 10 minutos mientras completamos 🔒
  ¿Nombre y apellido?

Cliente ─▶ Juani Sarmiento

  Gracias, Juani 🙌
  ¿Con qué obra social o prepaga te atendés? Si es particular
  escribime "particular" y te paso el valor.

Cliente ─▶ osep

  ✅ Turno confirmado

  Juani Sarmiento
  Arreglo · Dra. Gómez
  Viernes 21/8 · 11:30  (45 min)
  OSEP

  Llevá carnet y DNI 📋

  Te escribo el jueves para confirmar. Si no podés venir
  avisame por acá y liberamos el turno para otro paciente 🙏
```

### Decisiones que salieron de este flujo

**El profesional se elige DESPUÉS de la práctica.** Tres razones:

1. No todos hacen todo. Sabiendo qué necesita, ya se sabe quiénes pueden.
2. Un paciente nuevo no conoce a nadie. Preguntarle "¿con quién?" es hacerlo
   elegir a ciegas.
3. Un paciente que ya viene quiere al suyo, y **eso el sistema lo sabe solo**
   porque lo reconoce por el número de WhatsApp.

Y **nunca es obligatorio**: siempre está la opción "el que tenga antes", porque
mucha gente prioriza la fecha sobre la persona.

**Mostrar el primer turno libre de cada profesional** al lado del nombre. Deja
elegir informado en vez de a ciegas.

**Mostrar la duración de la práctica.** El paciente necesita saber cuánto le
ocupa el día.

**El hueco se bloquea mientras completa los datos.** Sin el `hold`, dos personas
sacan el mismo turno.

**El bot confirma solo.** A diferencia de gastronomía: la agenda ya sabe si el
hueco está libre, no hay ambigüedad. Es configuración (`confirmacion.turno`),
así que un consultorio que quiera validar cobertura lo puede cambiar.

**Avisar qué llevar.** Carnet, DNI, orden. Reduce los problemas del día del turno.

---

## Flujo C: el recordatorio anti ausentismo

**Es la funcionalidad que sola paga el sistema.** No es una notificación: es una
conversación con consecuencia.

```
    24hs antes, automático:

  🦷 Odontología Del Valle
  Hola Juani, te recuerdo tu turno de mañana:
  Viernes 21/8 · 11:30 · Dra. Gómez

   1  Confirmo, voy
   2  No puedo ir

Cliente ─▶ 2

  Listo, cancelé tu turno. ¿Querés que te busque otro?
   1  Sí, buscame otro
   2  Después veo

      ┌── el hueco se libera y entra a la lista de espera ──┐

    Y a los que estaban esperando:

  Hola Sofía, se liberó un turno con la Dra. Gómez
  mañana 21/8 a las 11:30. ¿Lo querés?
   1  Sí, lo tomo
   2  No, gracias
```

### Por qué importa

- Un ausente son 30 o 60 minutos de profesional que **no se recuperan**
- El recordatorio con confirmación baja el ausentismo de forma medible
- **Y cuando alguien cancela, el hueco se re-vende solo.** Eso es ingreso nuevo,
  no ahorro
- Es un número que se le muestra al dueño: turnos perdidos antes / después

### Ojo con el costo

Este mensaje **lo inicia el negocio**, así que no es conversación de servicio: es
categoría **utility**, US$ 0,0075. Irrelevante contra recuperar un turno, pero va
en el número. Ver [`WHATSAPP.md`](WHATSAPP.md).

---

## Flujo D: reserva de mesa

Mismo motor, recurso `mesa`.

```
Cliente ─▶ quiero reservar para el sábado a la noche

  ¿Para cuántas personas?

Cliente ─▶ 4

  Para 4 el sábado 22/8 tengo:
   20:00 · 20:30 · 22:15

Cliente ─▶ 20:30

  Perfecto. ¿A nombre de quién?
```

Lo que cambia respecto del turno: la **capacidad es por cubiertos**, no por
bloque de tiempo. Una mesa de 4 no sirve para 6. El motor lo resuelve con
`recurso.capacidad`.

---

## Casos borde que hay que resolver

Ninguno está resuelto todavía. Van al roadmap.

| Caso | Qué tiene que pasar |
|---|---|
| El local **no confirma nunca** un pedido | Timeout: a los N minutos se le avisa al cliente y se alerta al local |
| El cliente **manda un audio** | Transcribir. `wa-claude/src/voice.js` ya lo hace |
| Pide algo que **no está en la carta** | No inventar. Decir que no y **registrarlo** para el reporte de demanda insatisfecha |
| Pide algo con `disponible=false` | "Se nos acabó", ofrecer alternativa de la misma categoría |
| **Quiere hablar con una persona** | Escalar. El agente marca la conversación y el panel la muestra arriba |
| Escribe **fuera de horario** | Atiende igual, pero aclara cuándo abre y para cuándo agenda |
| **Cancela un pedido ya en cocina** | Solo el local decide. El bot no cancela algo que ya se está cocinando |
| Pregunta un **síntoma clínico** | Nunca opina. Deriva a la consulta |
| Dos personas piden **el mismo último turno** | El `hold` gana. El segundo ve el hueco ya ocupado |
| El cliente **cambia el pedido a mitad** | La sesión con resume lo permite. El compromiso se recalcula si todavía está `PENDIENTE` |
