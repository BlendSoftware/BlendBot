# Producto

## En una frase

**El WhatsApp del negocio contesta solo, sabe de verdad qué hay, deja el
compromiso armado en un panel, y cuando se cobra emite la factura.**

---

## Qué problema resuelve

Un negocio chico en Argentina vive en WhatsApp. Y ahí pasan tres cosas malas
todos los días:

1. **Interrumpe.** El dueño está cobrando o cocinando, y el teléfono suena con
   "¿tenés mesa para el sábado?" por décima vez.
2. **Se pierde.** Lo que llega fuera de horario o en el pico no se contesta, y
   ese cliente le escribe al de enfrente.
3. **Queda suelto.** El pedido o la reserva vive en un chat, se anota en un
   papel, y de ahí no sale a ningún sistema. Nadie sabe cuánto se vendió por
   WhatsApp.

Y desde julio de 2026 hay una cuarta: **están obligados a facturar
electrónicamente** y lo están haciendo a mano.

---

## Qué se entrega

### 1. El asistente en WhatsApp

Atiende 24/7 en el número que el negocio ya tiene. Entiende lenguaje natural
con errores de tipeo, no un menú de árboles.

- Contesta lo repetitivo (precios, horarios, disponibilidad, dirección)
- **Toma el compromiso**: un pedido o una reserva de mesa
- Avisa cuando el estado cambia

### 2. El panel de control

Una pantalla que se opera de un vistazo, con el pulgar, en una tablet.

- El tablero de compromisos en vivo, por estado
- La carta o la agenda, con un interruptor por ítem
- El cierre del día
- La analítica, que además **puede actuar** por WhatsApp

Ver [`PANEL.md`](PANEL.md).

### 3. La facturación

Cuando el compromiso se cobra, sale el comprobante de ARCA. Sin entrar al portal.

Ver [`ARCA.md`](ARCA.md).

---

## A quién

### Gastronomía (el único vertical)

Hamburgueserías, pizzerías, cafés, bares con reserva de mesa.

**Por qué gastronomía:**

| Razón | Detalle |
|---|---|
| El pedido perdido es plata que se va al de enfrente | Cada consulta sin contestar en el pico es una venta que se cae. |
| La demanda insatisfecha es medible | Se le muestra al dueño cuánto le preguntaron por algo que no tenía en la carta. |
| El interruptor de disponible es la venta fácil | "Se acabó" apaga el ítem al instante; la competencia lo carga a mano y se desactualiza. |
| Facturan sí o sí | Desde el 1/7/2026 la factura electrónica es obligatoria para todos los monotributistas. |

### Quién NO es cliente

- **Kioscos y almacenes.** A un kiosco le van al mostrador, no le escriben. Es
  buen laboratorio y pésimo cliente: margen finito y poca consulta previa.
- **Cadenas y franquicias.** Ciclo de venta largo, compras por licitación,
  requisitos de integración. No en el v1.
- **Cualquiera que no tenga el problema del WhatsApp.** Si no le escriben, no
  hay dolor que resolver.

---

## Por qué nos van a elegir

| | Bot de WhatsApp genérico | Este producto |
|---|---|---|
| Contesta preguntas | Sí | Sí |
| Sabe qué hay realmente | No, lee un catálogo cargado a mano | Sí, lee el sistema |
| Toma el compromiso | A veces | Sí, con estados y capacidad |
| Se le puede decir "se acabó" | Hay que editar el catálogo | Un interruptor, y el bot deja de ofrecerlo al segundo |
| **Emite la factura** | **No** | **Sí** |
| Actúa sobre los datos | Muestra reportes | Manda el mensaje |

El foso son **las dos últimas filas**. Contestar lo hace cualquiera. Cerrar el
círculo hasta el comprobante fiscal, no.

---

## Competencia

### Basework (Argentina, Buenos Aires)

Meta Tech Provider oficial. Suite para PyMEs: WhatsApp con IA, catálogo, turnos,
cotizaciones, canales internos tipo Slack, videollamadas, control horario con GPS.

Planes: Free · **$150.000 ARS + IVA** · **$290.000 ARS + IVA**.

**Qué nos dice:**
- El mercado existe y **paga seis cifras mensuales**. Es la mejor referencia de
  precio que tenemos.
- **No integran con ningún sistema de gestión.** Su IA contesta desde un catálogo
  cargado a mano en su plataforma. Ese catálogo se desactualiza en dos semanas y
  la IA empieza a mentirle a los clientes. Ese es el hueco entero.
- **Hacen ocho cosas.** Un producto que hace ocho pierde contra uno que hace una
  perfecta, cuando esa una es la que se usa todos los días.
- **Ser Tech Provider es una ventaja real de ellos**: pueden cobrar en pesos sin
  BSP extranjero. Hay que igualarlo. Ver [`WHATSAPP.md`](WHATSAPP.md).

**Fuerzas cruzadas, y conviene saberlo antes de empezar:** su fundador viene de
veinte años operando una PyME y sabe vender. Ahí nos gana hoy. Nosotros ganamos
en profundidad técnica. Su debilidad es nuestra fortaleza y al revés.

### Otros

- **Gastronomía**: Fudo, Bistrosoft, Maxirest. Sistemas de gestión completos, sin
  agente conversacional serio. PedidosYa se lleva una comisión enorme.
- **Turnos**: agendas online genéricas, la mayoría sin WhatsApp nativo y sin ARCA.
- **Facturación**: TusFacturas, Facturante y similares. Facturan bien y no tienen
  nada de lo demás.

Nadie está en la intersección. Ahí vamos.

---

## Precio

**Todavía sin decidir.** Referencias para decidirlo:

| Dato | Valor |
|---|---|
| Costo de IA por negocio | US$ 10 a 35 por mes |
| Costo de WhatsApp (servicio) | ~0 hasta el 1/10/2026; después por mensaje (tarifas antes del 1/9). Ver [`WHATSAPP.md`](WHATSAPP.md) |
| Techo del mercado local | $150.000 ARS + IVA (Basework) |

Hipótesis inicial: **un plan único en pesos, en el orden de $60.000 a $90.000**,
por debajo de Basework y muy por encima del costo. Con margen de sobra para
bancar el aumento de IA si Meta empieza a cobrar la ventana de servicio.

**No hacer plan Free.** El Copiloto Moodle ya enseñó que "desplegado" no es
"en uso": un plan gratis llena de cuentas que no usan nada y no dicen nada.

---

## Cómo se vende

**Regla: no salir a buscar desconocidos.** Vender es la parte que más cuesta acá,
así que el proceso se diseña para no depender de eso.

1. **Tres pilotos gratis, dos meses**, a gente conocida o de segundo grado. Sin
   trámite: la API oficial permite hasta 3 números sin registro de Tech Provider.
2. **Medir una sola cosa** y mostrarla: ventas fuera de horario, o demanda
   insatisfecha recuperada. Un número, no un reporte.
3. **Pedir la presentación, no la venta.** Un dueño conforme te presenta a dos
   colegas. Los comerciantes hablan entre ellos mucho más que los tutores
   universitarios.
4. Recién con eso, precio y cobro.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Meta cobra la ventana de servicio desde el 1/10/2026** (confirmado en fuente oficial el 18/08/2026) | Ya no es riesgo: es dato. El precio se fija con ese costo adentro. Tarifas exactas antes del 1/9/2026. Ver [`WHATSAPP.md`](WHATSAPP.md) |
| El bot dice una barbaridad a un cliente | Tools acotadas, nada de improvisar precios, y confirmación humana donde hay riesgo |
| Alcance infinito | La regla del roadmap: enfocado en gastronomía, nada de sumar verticales nuevos sin un cliente esperando. Ver [`ROADMAP.md`](ROADMAP.md) |
| Se diseña lindo y no hay cliente | **Este es el riesgo real.** Ya mató a BlendPOS V2 y a BlendPadel |
