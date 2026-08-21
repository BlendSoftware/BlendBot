# El panel

> Este documento describe **el panel del negocio**. Además existe un **panel
> admin de la plataforma** (nuestro), donde se da de alta cada negocio con su
> vertical, número de WhatsApp, token y config. Es interno y mínimo en el v1:
> alta, edición y baja de tenants. Ver D20 en [`DECISIONES.md`](DECISIONES.md).
>
> **Vertical activo: gastronomía.** El panel es genérico y sabe adaptarse por
> `negocio.vertical`, y las secciones "En consultorio" / "En salud" de acá
> abajo documentan esa capacidad del motor. El vertical salud está
> discontinuado como oferta comercial (ver D21 en
> [`DECISIONES.md`](DECISIONES.md)); la vista operativa real hoy es siempre la
> de gastronomía.

## El principio que manda sobre todo lo demás

**Este panel se mira parado, en una tablet con grasa, un viernes a las nueve de
la noche, con gente gritando.**

No es una herramienta de análisis. Es un tablero que se entiende de un vistazo y
se opera con el pulgar.

Consecuencias de diseño, y no son negociables:

- **Botones grandes.** Se toca con el pulgar, no con un mouse
- **Cero navegación** en la pantalla operativa. Todo lo urgente en una vista
- **Alto contraste.** Se mira de lejos y con reflejo
- **Nada que requiera leer.** Estado por color y posición, no por texto
- **Funciona con mala conexión.** Optimista en la UI, reconcilia después

En consultorio el contexto es más tranquilo, pero la misma pantalla sirve. No se
diseñan dos.

---

## Vista 1: el tablero en vivo

**Es la pantalla. Las demás son secundarias.**

```
PENDIENTES (2) 🔔      EN COCINA (3)        LISTOS (1)
──────────────────    ─────────────────    ──────────────
#48 Sofía    20:51    #47 Juani   29:47    #45 Caro
   $9.500  🛵            $13.400  🏃           🛵 llamar
   [ OK ] [ ✕ ]       #46 Nico    12:03
                         $22.100  🛵
#49 Martín   20:52
   $6.500  🏃
   [ OK ] [ ✕ ]
```

- Se arrastra de columna o se toca el botón. Nada más
- **Los pendientes suenan hasta que alguien los toca.** Un compromiso sin
  confirmar es un cliente esperando
- El contador va en cuenta regresiva contra la demora prometida, y **se pone rojo
  cuando se pasa**
- Al confirmar, aparece el selector de demora: **presets configurables más campo
  libre siempre** (la corrección que salió al prototipar: el local eligió 30 y
  los presets eran 15/25/40)

### En consultorio, la misma vista es la agenda del día

```
VIE 21/8            Dra. Gómez        Dr. Álvarez
─────────────────────────────────────────────────────
 09:00              Ana Ruiz          ── libre ──
 09:45              ── libre ──       Pedro Sosa
 11:30              Juani Sarmiento
                    🆕 nuevo · OSEP
 16:15              ── libre ──       Lucía Paz
```

Los huecos libres **se ven**, y eso es información: un hueco a las 9:45 es plata
que se está por perder. Un toque y se le ofrece a la lista de espera.

---

## Vista 2: catálogo con el interruptor

Parece la pantalla más aburrida y **es la más importante del producto.**

```
HAMBURGUESAS
  Simple                 $6.500      [●] disponible
  Doble cheddar          $8.900      [●] disponible
  Bacon & cheddar        $9.500      [ ] SE ACABÓ
  Veggie                 $7.800      [●] disponible
```

El dueño toca "se acabó la bacon" y **el bot deja de ofrecerla en el mismo
segundo**.

Eso es lo que separa este producto de todos los bots que venden lo que no hay.
Sin esta pantalla, el resto no sirve: a las dos semanas el catálogo está
desactualizado y el asistente le miente a los clientes.

Es exactamente el hueco que deja la competencia, que carga el catálogo a mano en
su propia plataforma.

En consultorio: el mismo interruptor apaga una práctica o bloquea un profesional
que no viene.

---

## Vista 3: cierre del día

```
VIERNES 21/8

  Compromisos          34        Por WhatsApp        28  (82%)
  Facturado      $412.700        Por teléfono         6
  Ticket promedio $12.138        Cancelados           2
                                 Ausentes             1

  [ Cerrar caja y facturar ]
```

Ahí engancha ARCA. Ver [`ARCA.md`](ARCA.md).

En salud suma **ausentismo del día** y el corte por cobertura (cuánto es OSEP,
cuánto es particular), que es lo que el profesional mira para saber qué le entra
de verdad.

---

## Vista 4: analítica

**Cuidado con el orden.** La pantalla es fácil; el problema es que **sin datos se
ve vacía y parece un producto pobre**. Un local con tres semanas de uso no tiene
"día de mayor venta".

**Lo que hay que hacer ahora no es la pantalla, es el dato.** Si cada compromiso
guarda producto, cantidad, hora, día, canal, cliente y total, todos los reportes
son queries. Si se guarda mal desde el compromiso número uno, ningún reporte lo
arregla después.

### Descriptivo: lo que ya sabe

Más vendido, hora pico, día fuerte, evolución mensual.

Está bien tenerlo, pero **no impresiona a nadie**. Al dueño le mostrás "los
viernes a las 21 es tu pico" y te contesta "sí, hace ocho años que laburo acá".

### Accionable: lo que vale plata

- **"Te preguntaron 14 veces por algo que no tenés en la carta."** Demanda
  insatisfecha, que hoy se evapora entera
- **"El 30% de los que preguntan no terminan pidiendo, y se caen justo cuando les
  decís la demora."** Eso es un problema operativo que nadie estaba viendo
- **"Los martes vendés 40% menos que el promedio."**
- **"Tenés 23 clientes que pedían seguido y hace más de un mes que no vuelven."**
- En salud: **"tu ausentismo es del 18% y el recordatorio lo bajó al 7%."** Ese
  número es la renovación del contrato

### Y la diferencia que no puede dar nadie más

**El panel no solo muestra: puede actuar.**

Un reporte de Excel no puede hacer nada con esos 23 clientes que se fueron. Este
sí, porque **tiene el WhatsApp de todos del otro lado**.

```
  23 clientes hace más de 30 días que no vuelven

  [ Mandarles una promo ]
```

Eso ya no es un dashboard. Es un panel que vende.

**Ojo con el costo:** ese mensaje lo inicia el negocio, así que es categoría
marketing, US$ 0,0625 por cliente. Baratísimo contra recuperar uno, pero va en el
número y hay que mostrarlo antes de mandar.

---

## Además: el resumen por WhatsApp

Decisión tomada: **las dos cosas.** Panel para el que quiere entrar, y resumen
automático para el que no va a entrar nunca.

```
  📊 Tu semana en Burger House

  142 pedidos  ·  $1.847.200
  ↑ 12% vs la semana pasada

  Lo más pedido: Doble cheddar (61)
  Tu pico: viernes 21 a 22hs
  ⚠️ Te pidieron milanesas 14 veces y no las tenés

  Ver todo → panel.copiloto.ar/r/x7k2
```

La mayoría de los dueños **nunca va a entrar al panel**. Si el valor solo vive
adentro, para ellos el producto no existe. El resumen del lunes a la mañana es
lo que los mantiene enganchados, y el link es lo que los hace entrar cuando algo
les llama la atención.

---

## Roles

| Rol | Ve |
|---|---|
| **Dueño** | Todo, incluida la plata y la analítica |
| **Operador** (cajero, secretaria) | Tablero, catálogo, clientes. Sin reportes de facturación |
| **Cocina** | Solo el tablero, sin precios ni datos del cliente |

En un negocio chico son la misma persona y se usa un solo rol. **La vista de
cocina sin precios recién hace falta cuando hay una tablet en la cocina**, así
que no va en el v1.

---

## Lo que NO va en el v1

Anotarlo para cuando tiente:

- Stock de insumos
- Gestión de empleados y horarios
- Cupones y fidelización
- Reportes de marketing con embudos
- Multi-sucursal
- App móvil nativa (el panel es web y responsive)

**Nada de eso hace que el pedido salga de la cocina ni que el paciente llegue al
turno.**
