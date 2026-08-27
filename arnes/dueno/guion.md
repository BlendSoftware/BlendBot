# El dueño en el navegador — guión

Este guión lo ejecuta **un agente manejando Chrome de verdad**. No corre solo:
se corre antes de un release y después de tocar el panel (`panel/src/**`), que
es cuando puede haberse roto lo que sólo se ve en la pantalla.

No hace falta que hayas leído el resto del proyecto. Acá está todo.

## Qué se prueba acá y por qué no alcanza con la API

El arnés tiene dos dueños detrás de la misma interfaz:

| | quién lo maneja | cuándo corre |
|---|---|---|
| `arnes/actores/dueno/api.js` | la API del core | siempre, desatendido |
| **este guión** | un agente con Chrome | a mano, antes de un release |

El de la API hace los mismos gestos y afirma casi todo. **Casi.** Estas dos
cosas no las puede afirmar, y son la razón de que este archivo exista:

1. **El campo libre de la demora existe y funciona** (paso 6). Por API,
   confirmar con 33 minutos pasa **con el campo libre en la pantalla y sin él**:
   el core no sabe qué se dibujó. La decisión de producto dice que sin campo
   libre *"el producto miente"* — los presets eran 15/25/40 y el local quería 30.
   Sólo mirando la pantalla se defiende eso.
2. **El pedido aparece mientras el cliente todavía escribe** (paso 5). Por API
   se verifica que el **registro** existe. Que el dueño lo **vea**, solo, sin
   recargar, es otra afirmación —es render, no dato— y es la que el producto
   vende.

Todo lo demás se verifica solo. Si un paso de acá falla y el mismo escenario
pasa con el dueño por API, **el problema es del panel**. Esa atribución es todo
el valor de que existan las dos.

## Cómo se nombra un elemento

**Por rol, etiqueta y texto visible. Nunca por CSS.** El panel ya trae los
`aria-label` que hacen falta: las columnas son `region` con nombre, cada pedido
es un `article` con nombre, y el selector de demora es un `group` llamado
*"En cuánto sale"*.

> **Si un gesto te obliga a usar un selector de CSS o un `nth-child`, no lo
> resuelvas con el selector: eso es un hallazgo de accesibilidad del panel.**
> Anotalo en el reporte, hacé el gesto como puedas para no cortar la corrida, y
> dejá dicho qué elemento no se podía nombrar.

## Antes de empezar

### Lo que te tienen que dar

La corrida imprime este bloque (`datosParaElGuion()`); sin él no podés empezar,
porque el negocio, el usuario y el teléfono del cliente cambian en cada corrida:

```
  panel:             http://localhost:8081/panel/
  usuario:           arnes508634907
  contraseña:        arnes-clave-508634907
  negocio:           Parrilla Arnés 508634907 (f0188c6b-…)
  wa_phone_id:       arnes-508634907
  teléfono cliente:  5492611050863
  demora a escribir: 33 min (paso 6 — NO tiene que ser un preset)
```

La corrida tiene que estar **viva y esperándote**: el Graph falso (el teléfono
del cliente) vive dentro del proceso del arnés, y el paso 12 lee de ahí. Si la
corrida ya terminó, hacé igual los pasos 1 a 11 y marcá el 12 como **no
evaluable** — nunca lo des por bueno mirando la base.

### Los cuatro gotchas, y los cuatro se disfrazan de bug del panel

**1. La ventana tiene que estar adelante.** El tablero se refresca solo cada
15 segundos, pero **salta el refresco si la pestaña no está visible**
(`if (!document.hidden)`). Con la ventana de Chrome minimizada o tapada,
`document.visibilityState` vale `hidden` y el pedido **no aparece nunca**. Eso
no es una falla del panel: es el panel haciendo lo correcto.

> Comprobalo antes del paso 5, ejecutando en la página:
> `document.visibilityState`
> Si no dice `visible`: **ARNÉS ROTO**, no producto roto. Poné la ventana
> adelante, dejala en primer plano y repetí. No emitas veredicto.

**2. Un click "por referencia" puede no hacer nada.** En este panel, los clicks
sobre una referencia de elemento a veces no disparan el handler de React y la
pantalla no reacciona. **Un click que no surte efecto NO es "el panel no
respondió".** Antes de concluir nada: sacá una captura nueva, ubicá el elemento
y hacé click por coordenada. Si tampoco pasa nada, ahí sí es del panel.

**3. Las coordenadas envejecen.** El popover de la demora se dibuja **encima**
de la tarjeta, y el botón **«Rechazar» queda a unos 50 píxeles del campo libre**.
Un click con coordenadas de una captura vieja rechaza el pedido, y `rechazado`
es un estado **terminal**: no hay vuelta atrás y la corrida se perdió.
**Sacá una captura nueva justo antes de cada click del paso 6.**

**4. El cartel de "listo" dura 2,5 segundos.** El aviso verde de que se respondió
una pregunta se borra solo. No lo pongas como condición de nada: lo que se
asevera es que la pregunta **se fue de la lista**.

---

## Paso 1 — Poné la ventana adelante

**Qué hacer.** Abrí (o traé al frente) la ventana de Chrome donde vas a
trabajar. Dejala visible, sin minimizar y sin taparla con otra.

**Qué tiene que ser cierto.** Ejecutado en la página, `document.visibilityState`
devuelve `visible`.

Si devuelve `hidden`: **arnés roto**, no hay veredicto. Ver gotcha 1.

---

## Paso 2 — Abrí el panel, sin sesión de nadie

**Qué hacer.** Andá a `<panel>/login` (por ejemplo
`http://localhost:8081/panel/login`).

Si en vez del formulario te aparece un tablero con pedidos, **ya hay una sesión
abierta de otro negocio**: tocá el botón **«Salir»** de arriba a la derecha y
esperá. El logout puede tardar unos segundos; esperá a ver el formulario, no
asumas que falló.

**Qué tiene que ser cierto.**
- Se ve el título **«Buen día. Entrá para ver la agenda.»**
- Hay un campo **«Usuario»**, un campo **«Contraseña»** y un botón **«Entrar»**.

---

## Paso 3 — El cambio de contraseña obligatorio

> **Este paso sólo se puede hacer si te dieron la contraseña *provisoria*** —la
> que entrega el alta del negocio y sirve una sola vez—. Hoy la corrida cambia
> esa contraseña por API antes de llamarte y te pasa la definitiva, así que
> **lo normal es que este paso NO aplique**.

**Qué hacer.** Entrá con el usuario y la contraseña provisoria.

**Qué tiene que ser cierto.**
- Caés en la pantalla **«Elegí una contraseña tuya»**, con los campos
  **«Contraseña nueva»** y **«Repetila»** y el botón **«Guardar y entrar»**.
- **No podés salir de esa pantalla**: si intentás ir al tablero escribiendo la
  dirección a mano, te devuelve acá. Es una puerta, no un cartel.
- Con una contraseña de menos de 8 caracteres aparece *«Tiene que tener al
  menos 8 caracteres»* y el botón queda apagado.
- Con las dos distintas aparece *«Las dos no coinciden»* y el botón queda apagado.

**Si te dieron la contraseña definitiva**, no inventes: marcá este paso como
**no evaluable** en el reporte y seguí. Un paso que no se pudo hacer se anuncia;
no se da por bueno.

---

## Paso 4 — Entrá

**Qué hacer.** Escribí el usuario y la contraseña y tocá **«Entrar»**.

**Qué tiene que ser cierto.**
- No te vuelven a pedir que cambies la contraseña.
- Arriba a la izquierda se lee **el nombre del negocio de la corrida**
  (ej. *«Parrilla Arnés 508634907»*). Si dice otro nombre, entraste al negocio
  equivocado: **pará acá**, todo lo que sigue sería sobre datos ajenos.
- Se ve un tablero con las columnas **«Pendientes»**, **«En cocina»**,
  **«Listos»** y **«Para cobrar»** — no una agenda de turnos. (Si vieras una
  agenda, el negocio no quedó como gastronomía y eso es una falla.)
- Abajo hay una barra de secciones con **«Pedidos»**, **«Comanda»**, **«Carta»**,
  **«Stock»**, **«El local»**, **«Clientes»** y **«Cierre»**.

---

## Paso 5 — El pedido aparece solo, mientras el cliente escribe  ⭐ CARDINAL

Esta es una de las dos aserciones que justifican todo este archivo.

**Qué hacer.** Cuando entres, el cliente todavía está dictando su pedido y
**todavía no dio su nombre**. **No recargues, no toques nada, no navegues.**
Quedate mirando el tablero hasta un minuto.

**Qué tiene que ser cierto.**
- En la columna **«Pendientes»** aparece una tarjeta **sola**, sin que vos hayas
  recargado nada.
- La tarjeta se llama (nombre accesible) `Pedido #XXXX de <alguien>, sin confirmar`.
  Mientras el cliente no dio su nombre, `<alguien>` es
  **`Sin nombre (NNNN)`**, donde `NNNN` son los **últimos cuatro dígitos del
  teléfono del cliente** que te dieron. Es así como se identifica la tarjeta de
  esta corrida: no te guíes por el `#XXXX`, que no lo sabés de antemano.
- La tarjeta muestra, y esto también hay que mirarlo:
  - cada ítem con su cantidad (ej. `2 × Doble cheddar`);
  - la modificación de la línea como una etiqueta al lado del plato
    (ej. `sin panceta`) — **si el pedido tenía una modificación y no se ve, es
    una falla**: en la cocina eso es lo que evita que salga mal;
  - el total en plata (ej. `$ 22.300`);
  - la forma de entrega (`Retira`, `Delivery` o `En el local`), y si es
    delivery, la dirección.
- Hay dos botones: **«Confirmar»** y **«Rechazar»**.

**Antes de dar por fallado este paso**, verificá el gotcha 1
(`document.visibilityState === 'visible'`). Con la ventana tapada, el tablero
no se refresca **por diseño** y esto no es una falla del panel.

---

## Paso 6 — Confirmá con una demora que NO es preset  ⭐ CARDINAL

La otra aserción cardinal. Leé el gotcha 3 antes de tocar nada.

**Qué hacer.**
1. Sacá una **captura nueva**.
2. Tocá **«Confirmar»** en la tarjeta del paso 5.
3. Sacá **otra captura**: el popover se dibujó encima y todo se movió.
4. Hacé click en el campo de texto cuyo recuadro dice **«otro»** (su etiqueta,
   que no se ve pero está, es **«Otra cantidad de minutos»**).
5. Escribí **`33`** — o el número que te haya dado la corrida. Lo único que
   importa es que **no sea ninguno de los presets** que ves dibujados.
6. Apretá **Enter**. *(Enter manda el formulario. Es más seguro que buscar el
   botón «Listo», que está pegado a «Rechazar».)*

**Qué tiene que ser cierto.**
- Al tocar «Confirmar» se abre un bloque llamado **«En cuánto sale»**, con el
  texto **«¿En cuánto sale?»**.
- Hay **botones de preset** con los minutos del negocio (por defecto
  **«15 min»**, **«25 min»**, **«40 min»**).
- **Existe un campo de texto además de los presets.** Si no existe, o si no se
  puede escribir en él, **este paso falla y es la falla más importante que este
  guión puede encontrar**: sin campo libre el producto miente.
- El campo **sólo acepta dígitos**: si escribís letras, no entran.
- El botón **«Listo»** está apagado con el campo vacío y se enciende al escribir
  un número.
- Al mandar, el popover se cierra y el pedido queda confirmado con **33**
  minutos (lo verificás en el paso 7).

Si en cualquier momento el pedido aparece como **rechazado**, le pegaste a
«Rechazar» (gotcha 3). Es un estado terminal: **la corrida se perdió**, pedí una
nueva y volvé al paso 1. No lo reportes como falla del producto.

---

## Paso 7 — La tarjeta se mueve sola y arranca el contador

**Qué hacer.** No recargues. Mirá el tablero.

**Qué tiene que ser cierto.**
- La tarjeta **ya no está en «Pendientes»**: está en **«En cocina»**.
- La tarjeta muestra el contador de la demora: **«33 min»**, y va bajando. Si se
  pasó del plazo, muestra **«+N min»** resaltado.
- El resumen de arriba dice **«todo confirmado»** (o el número de pendientes que
  queden).
- Los botones de la tarjeta ahora son **«Empezar»** y **«Cancelar»**.

---

## Paso 8 — Movelo a listo: son dos gestos, no uno

**Qué hacer.**
1. Tocá **«Empezar»**.
2. Sacá una captura nueva (los botones cambian).
3. Tocá **«Listo»**. **Ojo: el botón grande y de color es «Entregado», no
   «Listo».** «Listo» es el otro, el de al lado. Si tocás «Entregado» saltás un
   estado y el paso no se puede repetir.

**Qué tiene que ser cierto.**
- Después de «Empezar», la tarjeta sigue en **«En cocina»** y sus botones pasan
  a ser **«Entregado»** y **«Listo»**.
- Después de «Listo», la tarjeta se va a la columna **«Listos»** y le queda un
  solo botón: **«Entregado»**.

---

## Paso 9 — La franja de preguntas sin responder

Esto depende de que el cliente le haya preguntado algo al bot que el bot no
supiera contestar. Si la corrida no incluye una consulta, marcá los pasos 9 a 11
como **no aplican** y saltá al 12.

**Qué hacer.** Volvé al tablero (**«Pedidos»** en la barra de abajo) y mirá
arriba, entre el encabezado y las columnas.

**Qué tiene que ser cierto.**
- Aparece una franja con un número y el texto **«Una pregunta sin responder»**
  (o **«N preguntas sin responder»**), y a la derecha **«Responder →»**.
- Esa franja **no está cuando no hay preguntas pendientes**: no ocupa lugar ni
  dice nada de más.

---

## Paso 10 — Abrí las preguntas

**Qué hacer.** Tocá la franja.

**Qué tiene que ser cierto.**
- Caés en una pantalla titulada **«Preguntas»**, con la bajada *«Lo que el
  asistente no supo contestar. Respondé acá y el cliente lo recibe por
  WhatsApp.»*
- Está la pregunta del cliente, **textual**, con su nombre (o su teléfono) al
  lado.
- Hay un campo para escribir (su etiqueta es **«Respuesta para <nombre>»**) y un
  botón **«Responder»** que arranca apagado.

---

## Paso 11 — Respondé

**Qué hacer.** Escribí la respuesta que te dio la corrida (si no te dieron una,
`Sí, hay cochera en la esquina.` sirve) y tocá **«Responder»**.

**Ojo:** acá **Enter no manda** — el campo es de varias líneas y Enter escribe
un renglón. Hay que tocar el botón. Sacá una captura nueva antes de tocarlo.

**Qué tiene que ser cierto.**
- La pregunta **se va de la lista**. Si era la única, queda el mensaje
  **«No hay preguntas sin responder.»**
- (Opcional, dura 2,5 segundos: aparece un aviso *«Listo, le avisamos a
  <nombre>.»*. **No lo pongas como condición**: si ya se borró, no es una falla.)
- De vuelta en el tablero, la franja del paso 9 **ya no está**.

---

## Paso 12 — Cerrá el círculo: qué recibió el cliente

Este paso **no se hace en el navegador**: se lee del teléfono del cliente, que
en el arnés es un servidor falso que guarda todo lo que el producto le manda a
WhatsApp. La corrida te dice cómo verlo.

**Qué hacer.** Pedile a la corrida los mensajes recibidos por el teléfono del
cliente.

**Qué tiene que ser cierto.**
- Llegó el aviso de la confirmación, y **trae la demora que vos escribiste**:
  `¡Listo, <nombre>! Confirmamos tu pedido 🍔 Sale en ~33 min. Total $22.300.
  Cualquier cosa te avisamos por acá.`
  Lo que se asevera es que **dice 33**, el número que pusiste a mano en el campo
  libre. Si dijera 15, 25 o 40, el campo libre no hizo lo que dice hacer.
- Llegó la respuesta a la pregunta: `Sobre tu consulta: <lo que escribiste>`.
- Se asevera sobre lo **recibido**, nunca sobre lo encolado. Un mensaje encolado
  no es un mensaje recibido, y esa diferencia es la mitad del valor del producto.

Si la corrida ya no está viva, marcá este paso **no evaluable**. No lo des por
bueno mirando la base de datos: eso verificaría que el core lo escribió, no que
el cliente lo recibió.

---

## Qué tenés que devolver

**El mismo formato que la corrida automática.** No es un capricho: si las dos
salidas no se leen igual, comparar esta corrida con la desatendida deja de ser
un vistazo y pasa a ser un trabajo — y un trabajo que nadie hace es una
comparación que no existe. Esa comparación es todo el valor de que existan las
dos implementaciones del dueño.

### La línea de tiempo

Un renglón por paso, numerado, con el actor adelante. Acá el actor es siempre
`🧑‍🍳 dueño`; los otros tres que pueden aparecer en una corrida completa son
`👤 cliente`, `🤖 bot` y `⚙️ sistema`. Debajo de cada paso, **qué gesto hiciste**.

```
🧑‍🍳 dueño · pedido-feliz · modo navegador

  turno 1 · 🧑‍🍳 dueño — entré al panel como arnes508634907
  turno 2 · 🧑‍🍳 dueño — me quedé mirando el tablero, sin recargar
  turno 3 · 🧑‍🍳 dueño — confirmé el pedido con 33 minutos, escritos a mano
  turno 4 · 🧑‍🍳 dueño — toqué «Empezar» y después «Listo»
```

### Cada aserción

Con **cuatro cosas** y ninguna es opcional:

| campo | qué va |
|---|---|
| **actor** | quién se salió del libreto si esto falla. Acá, el dueño. |
| **frase** | qué protege la aserción, en castellano. La frase de `FLUJOS.md` o del `SKILL.md`, **nunca un nombre de variable**: es lo que alguien va a leer a las once de la noche. |
| **esperaba** | qué tenía que ser cierto |
| **llegó** | qué pasó de verdad |

### La línea de falla

Es el entregable de verdad. Este es el formato exacto:

```
✗ pedido-feliz · turno 3 · 🧑‍🍳 dueño · N1 «el local confirma con la demora que él eligió»
    esperaba: existe un campo libre además de los presets 15/25/40 y acepta 33
    llegó:    el selector sólo dibuja los tres presets; no hay dónde escribir 33
    nivel 1 (estado) · guion.md paso 6 · D8 · salida/pedido-feliz/paso-6.png
```

La primera línea nombra las cuatro cosas sin las que la falla no sirve: **qué
escenario, qué turno, qué actor, y qué regla en su frase humana**. La última
dice dónde mirar.

### Sobre las capturas

**Capturá el paso que falla, y sólo ése.** La captura es **evidencia**, nunca
aserción: un chequeo que compara pantallas falla por medio píxel de antialiasing
y lo único que enseña es a ignorar el rojo.

### Sobre los pasos que no pudiste hacer

Un paso que no se pudo hacer **se anuncia como no evaluable**. Nunca se marca en
verde y nunca se saltea en silencio. Y distinguí siempre las dos clases de rojo:

- **PRODUCTO ROTO (exit 1)** — el gesto se hizo y la pantalla no hizo lo que
  promete.
- **ARNÉS ROTO (exit 2)** — no pudiste hacer el gesto: la ventana estaba tapada,
  la corrida ya no estaba viva, te faltaban los datos. **No hay veredicto sobre
  el producto.**

Confundirlas es la forma más rápida de perder una hora arreglando un bug que no
existe. Y un arnés que dice rojo cuando en realidad se quedó sin una dependencia
entrena a desconfiar del rojo; el día que alguien aprende a ignorar el rojo, el
arnés murió y nadie se enteró.

### Sobre las capturas

**Capturá el paso que falla, y sólo ése.** La captura es **evidencia**, nunca
aserción: un chequeo que compara pantallas falla por medio píxel de antialiasing
y lo único que enseña es a ignorar el rojo.

### Sobre los pasos que no pudiste hacer

Un paso que no se pudo hacer **se anuncia como no evaluable**. Nunca se marca en
verde y nunca se saltea en silencio. Y distinguí siempre las dos clases de rojo:

- **PRODUCTO** — el gesto se hizo y la pantalla no hizo lo que promete.
- **ARNÉS ROTO** — no pudiste hacer el gesto: la ventana estaba tapada, la
  corrida ya no estaba viva, te faltaban los datos. **No hay veredicto sobre el
  producto.**

Confundirlas es la forma más rápida de perder una hora arreglando un bug que no
existe.

---

## Hallazgos ya conocidos

Estos ya se encontraron corriendo este guión. **No los vuelvas a reportar como
nuevos**, pero si alguno desapareció, decilo: quiere decir que se arregló.

1. **La hora de las preguntas se muestra en UTC, no en la hora del local.**
   En la pantalla «Preguntas», una consulta hecha a las 22:48 de Mendoza se
   muestra como **01:48**. Los pedidos sí se muestran en la hora del local; las
   consultas no. *(El core manda `creado_en` en UTC y el panel lee la hora del
   texto tal cual.)*
2. **«Rechazar» queda a 50 píxeles del campo libre de la demora**, debajo del
   popover, y rechazar es irreversible. Es el gotcha 3 y también es un riesgo
   real para el dueño con el pulgar apurado en una tablet.
3. **El botón principal del pedido en curso es «Entregado», no «Listo».** Quien
   apura, saltea un estado.

## Lo que este guión NO prueba

Para que nadie lo lea de más:

- No prueba el resto del panel: ni Carta, ni Stock, ni Cierre, ni Clientes, ni
  Comanda, ni el Admin. Eso lo cubren los tests de componente del panel, que son
  más rápidos y ya existen.
- No prueba qué dijo el bot. Eso es de las aserciones del dicho, con su juez.
- No prueba el navegador ajeno: se corre en el Chrome que haya. Una falla que
  sólo pase en otro navegador no la va a encontrar.
