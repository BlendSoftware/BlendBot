# Decisiones

Cada decisión con su porqué. Sesión del **18/08/2026**.

Sirven para dos cosas: no volver a discutirlas, y saber cuál revisar cuando algo
no funcione.

---

## D1 · Un solo motor de compromisos, no tres módulos

**Decisión.** Pedido, reserva de mesa y turno son el mismo objeto: un recurso
ocupado por un rato para un cliente, con estados.

**Por qué.** Es lo que permite dos verticales muy distintos compartiendo el 80%
del código, y que el panel y los reportes se escriban una sola vez.

**Cómo apareció.** Al describir el flujo de restaurante: *"lo mismo pero con
reserva"*. La abstracción salió sola de la descripción del negocio, no de querer
generalizar.

**Cuándo revisarla.** Si al sumar gastronomía hay que modificar el motor, estaba
mal diseñado.

---

## D2 · El vertical uno es consultorios, no gastronomía ni kioscos

**Decisión.** Salud primero. Gastronomía después de que salud cobre.

**Por qué.**
- El turno perdido vale mucho más que una hamburguesa
- El ausentismo es medible, y eso hace la venta fácil
- Ya pagan una secretaria: el costo de referencia está en su cabeza
- La agenda es el modelo más simple posible
- No hay hora pico, así que una falla no arruina el mejor momento de nadie
- Están obligados a facturar por prestación

**Descartado el kiosco.** A un kiosco le van al mostrador, no le escriben.
Laboratorio bueno, cliente pésimo.

---

## D3 · API oficial de WhatsApp, nunca Baileys

**Decisión.** Cloud API desde el día uno. De `wa-claude` se rescata todo menos
Baileys.

**Por qué.** Baileys es ingeniería inversa. Para Jarvis está bien: si banean, es
el número propio. **Para un cliente que paga, un baneo le corta el canal por
donde vende.** Y no hay razón económica: las conversaciones de servicio hoy no se
cobran.

**Evidencia en el propio código:** `anti-ban.js`, el incidente del 28/07 con la
versión caduca, la versión que hay que buscar en runtime.

---

## D4 · El agente nunca toca la base de datos

**Decisión.** El agente habla con el core por HTTP, como el MCP de Moodle habla
con la API de Moodle.

**Por qué.** El core queda determinístico y testeable, el 90% del producto no
pasa por un LLM (de ahí el margen), y un error del modelo no puede corromper
datos.

---

## D5 · La política de confirmación es configuración, no código

**Decisión.** `negocio.config.confirmacion` define si confirma el bot o el humano,
por tipo de compromiso. Gastronomía: humana. Salud: automática.

**Por qué.** La agenda de un consultorio sabe con certeza si un hueco está libre.
La cocina no: el sistema no puede saber que el parrillero está desbordado un
sábado a las 21. Si el bot acepta solo, el cliente espera algo que no llega.

Es el principio de oro del Copiloto Moodle: **la IA prepara, el humano confirma.**

**Cómo apareció.** Corrigiendo el roleplay: el bot prometió "25 minutos" y no
tenía cómo saberlo.

---

## D6 · El bot nunca promete tiempos ni precios que no le dieron

**Decisión.** La demora la pone el local desde el panel. El precio sale del
catálogo. La disponibilidad sale del motor.

**Por qué.** Un bot que inventa es peor que no tener bot: genera un compromiso
que el negocio no puede cumplir, y la culpa se la lleva el producto.

---

## D7 · El compromiso entra al panel antes de estar completo

**Decisión.** Apenas hay ítems, entra como `PENDIENTE`. El nombre y el resto se
completan después.

**Por qué.** La cocina lo ve venir mientras el cliente todavía escribe. Gana
tiempo real de preparación.

**Cómo apareció.** Corrección de Juani durante el prototipo.

---

## D8 · Presets con campo libre, siempre

**Decisión.** Toda entrada rápida (demoras, duraciones) ofrece atajos pero acepta
un valor arbitrario.

**Cómo apareció.** Los presets eran 15/25/40 y el local eligió **30**.

**Generalización:** cualquier lista de opciones que cierre el rango es una lista
mal diseñada.

---

## D9 · El hueco se bloquea mientras el cliente completa

**Decisión.** `hold` de 10 minutos configurable, atado a la sesión de WhatsApp.

**Por qué.** Sin eso, dos personas sacan el mismo turno mientras cargan sus datos.

---

## D10 · El profesional se elige después de la práctica, y nunca es obligatorio

**Decisión.** Primero qué necesita, después con quién. Siempre con la opción "el
que tenga antes". A un paciente conocido se le ofrece primero el suyo.

**Por qué.** No todos hacen todo. Un paciente nuevo no conoce a nadie. Y uno que
ya viene quiere al suyo, cosa que el sistema sabe por el número de WhatsApp.

---

## D11 · El interruptor de disponibilidad es la feature más importante del panel

**Decisión.** Un toque apaga un ítem y el agente deja de ofrecerlo al instante.

**Por qué.** Es lo que separa este producto de todos los bots que venden lo que
no hay. La competencia carga el catálogo a mano en su plataforma y se
desactualiza en dos semanas.

---

## D12 · ARCA no se posterga: es la puerta de entrada

**Decisión.** La facturación está en la fase 2, no en el "algún día".

**Por qué.** Todos los bots contestan, ninguno factura. Y desde el **1/7/2026**
la factura electrónica es obligatoria para todos los monotributistas, con los
consultorios ya obligados por prestación. Entró en vigencia hace seis semanas.

**Corrige una suposición previa** de que restaurantes y consultorios "no se
manejan con AFIP". Es al revés, y el timing es un regalo.

---

## D13 · No hay plan Free

**Decisión.** Los pilotos son gratis por tiempo limitado y con nombre. No hay
tier gratuito permanente.

**Por qué.** El Copiloto Moodle ya enseñó que **desplegado no es lo mismo que en
uso**. Un plan gratis llena de cuentas que no usan nada y no dicen nada.

---

## D14 · El panel actúa, no solo muestra

**Decisión.** Todo reporte accionable termina en un botón que manda el mensaje.

**Por qué.** Es la ventaja estructural de tener el canal integrado. Un reporte de
Excel no puede hacer nada con 23 clientes perdidos; este sí.

---

## D15 · Analítica al final, modelo de datos al principio

**Decisión.** La pantalla de reportes va en la fase 4. El modelo que la habilita
se define en la fase 1.

**Por qué.** Los reportes son queries si el dato está bien guardado, y son
imposibles si está mal. Y sin historia, la pantalla se ve vacía y parece un
producto pobre.

---

## D16 · BlendPos es la cantera, no el punto de partida

**Decisión.** Se diseña el modelo nuevo y se le trae lo que sirve. No se abre
BlendPos para agregarle turnos.

**Por qué.** BlendPos tiene **un solo cliente** y es un POS de retail: inventario
por SKU, compras, proveedores. Nada de eso le sirve ni a una hamburguesería ni a
un consultorio. Arrastrarlo entero es cargar peso.

**Lo que sí vale:** el sidecar de ARCA, auth, auditoría, catálogo, precios por
lista, cobro, y la arquitectura handler/service/repository.

**Corrige una suposición previa** de que el POS instalado era el foso. Con un
cliente no hay base instalada. **El foso es ARCA**, no el POS.

---

## D17 · Skill-Moodle se puede usar comercialmente

**Verificado.** `LICENSE` dice **MIT, copyright Juan Ignacio Sarmiento**. MIT
permite usar, modificar, sublicenciar y vender.

**Por qué importa.** Vive en la organización `Group-Active-IA`, atada al frente
laboral del que se quiere salir. La licencia despeja la duda: el patrón se puede
llevar sin pedirle permiso a nadie.

---

## D18 · Panel y resumen por WhatsApp, los dos

**Decisión.** El panel para el que entra, el resumen semanal para el que no.

**Por qué.** La mayoría de los dueños no va a entrar nunca al panel. Si el valor
solo vive adentro, para ellos el producto no existe.

---

## D19 · Nada de historia clínica

**Decisión.** Se guarda nombre, teléfono, cobertura y tipo de práctica. **Nada de
motivo de consulta en texto libre, nada de diagnósticos.**

**Por qué.** Es otro producto, con otro marco legal. La tentación de "ya que
estamos" acá cuesta caro (Ley 25.326).

---

## D20 · Dos paneles: el admin de la plataforma y el del negocio

**Decisión.** Hay dos niveles de panel. El **panel admin** es nuestro: ahí se da
de alta un negocio, se le asigna vertical, número de WhatsApp, token y config.
El **panel del negocio** es el de `PANEL.md`, y su sección de catálogo se adapta
por `negocio.vertical`: **Carta/Stock** en gastronomía, **Profesionales/Agenda**
en consultorios. Mismo componente, mismo interruptor.

**Por qué.** El alta de tenants no puede vivir dentro del panel del negocio (un
tenant no se da de alta a sí mismo), y no se diseñan dos catálogos: es la misma
tabla `servicio` con otro nombre en pantalla.

**Alcance v1.** El admin es mínimo: alta, edición y baja de negocios. El
onboarding autoservicio recién va en la fase 3 del roadmap.

---

## Suposiciones que hay que confirmar

| Suposición | Cómo se confirma | Riesgo si es falsa |
|---|---|---|
| ~~Meta empieza a cobrar la ventana de servicio el 1/10/2026~~ **CONFIRMADA (18/08/2026)** en la [doc oficial de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages). Tarifas antes del 1/9/2026. | — | Ya absorbido: el precio se fija con ese costo adentro |
| Las prestaciones de salud exentas de IVA igual emiten comprobante | Contador | Alto: bloquea la fase 2 |
| El sidecar se adapta a Factura C sin reescribir | Probar en homologación | Medio: más trabajo del previsto |
| Un consultorio paga entre $60.000 y $90.000 por mes | Preguntárselo al piloto | Alto: define el modelo |
| La secretaria adopta en vez de sabotear | Primera reunión con ella presente | Alto: define la retención |
