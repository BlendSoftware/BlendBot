# DESIGN.md — Copiloto Comercios (panel)

> **Vertical activo: gastronomía** (ver D21 en `docs/DECISIONES.md`). La
> escena de abajo, que fijó el tema claro del sistema, viene del piloto de
> consultorio (vertical hoy discontinuado); se conserva porque la decisión de
> color que originó (alto contraste para luz de mostrador) sigue siendo válida
> para las horas de preparación/día del local gastronómico. El "modo nocturno"
> que menciona el párrafo original sigue pendiente y gana prioridad ahora que
> gastronomía es el único vertical.

## Escena que fija el tema

Una secretaria de 45 años mira la agenda en una tablet apoyada en el mostrador
del consultorio, a las 9:30, con la luz de la ventana pegándole de frente a la
pantalla. **Tema claro, contraste alto.** (La vista de gastronomía nocturna
llega en v2 y se resolverá con un modo propio; no diseñar para ella ahora.)

## Estrategia de color: restrained + paleta funcional de estados

Los estados del compromiso se leen por color y posición (principio 4 de
PRODUCT.md), así que además del acento hay una paleta semántica deliberada.
Nada de blanco puro ni negro puro; todos los neutros tintados hacia el acento.
Evitar el reflejo "salud = blanco + teal": el acento es un **terracota cálido**.

```css
:root {
  /* Neutros papel, tintados cálidos (chroma 0.006) */
  --fondo:        oklch(0.975 0.006 60);
  --superficie:   oklch(0.99  0.004 60);
  --borde:        oklch(0.88  0.008 60);
  --tinta:        oklch(0.24  0.012 55);   /* texto principal */
  --tinta-suave:  oklch(0.45  0.010 55);

  /* Acento (terracota): acciones primarias, foco, marca. ≤10% de la superficie */
  --acento:       oklch(0.58 0.13 40);
  --acento-tinta: oklch(0.99 0.004 60);

  /* Estados del compromiso — se leen de lejos */
  --pendiente:    oklch(0.72 0.15 75);    /* ámbar: reclama atención */
  --confirmado:   oklch(0.62 0.10 155);   /* verde sobrio */
  --en-curso:     oklch(0.60 0.10 250);   /* azul actividad */
  --listo:        oklch(0.55 0.12 300);   /* violeta: listo para salir */
  --vencido:      oklch(0.55 0.18 25);    /* rojo: contador pasado */
  --hueco-libre:  oklch(0.93 0.02 130);   /* fondo verdoso pálido: plata por perder */
}
```

Regla: el color de estado va en **fondos y bloques grandes** (la tarjeta entera
del turno, la franja de la agenda), no en puntitos ni bordes laterales.

## Tipografía

- **Manrope** (Google Fonts) para todo, con `font-variant-numeric: tabular-nums`
  en horas y plata: la agenda y el cierre del día son columnas de números.
- Escala con ratio 1.33: 14 / 18 / 24 / 32 / 43. Cuerpo mínimo 16px; en la vista
  operativa los nombres y horas van a 18–24 porque se leen a un metro.
- Jerarquía por peso (400 / 600 / 800), no por gris cada vez más claro.
- Línea de texto corrido ≤70ch (casi no hay texto corrido: esto es un tablero).

## Layout

- La vista operativa (agenda/tablero) es **pantalla completa sin chrome**: una
  barra mínima arriba (día, negocio, avatar) y el resto es el tablero. Navegación
  a las demás vistas por una barra inferior de íconos grandes (tablet-first):
  **5 para el dueño** (agenda, catálogo, equipo, clientes y el cierre del día,
  que entró con E8) y **4 para el operador**, que no ve el cierre porque la
  plata del día no es suya (docs/PANEL.md → Roles). La lista de espera no está
  en la barra: se entra desde el hueco libre de la agenda, que es cuando
  importa.
- Ritmo de espaciado: 4 / 8 / 16 / 24 / 40. Densidad alta dentro del tablero,
  aire generoso alrededor de las acciones.
- Targets táctiles ≥48px. El interruptor de disponible es un switch GRANDE
  (56×32 mínimo) con el estado escrito al lado ("se acabó" / "disponible").
- Cards sólo donde son la affordance real (un turno en el tablero es una card;
  la lista de servicios es una LISTA con filas, no un grid de cards).

## Motion

- Transiciones de estado con ease-out-quart 200ms (color de fondo + posición).
- El pendiente nuevo entra con un slide-in corto y queda con un pulso sutil de
  fondo (opacity 0.9↔1, 2s) hasta que se toca. Nada de bounce.

## Componentes clave

- **TarjetaCompromiso**: hora grande, nombre, cobertura/total, fondo = estado,
  acciones [OK] [✕] de 48px. Contador regresivo que pasa a --vencido.
- **FilaServicio**: nombre + precio + switch disponible. Fila, no card.
- **Agenda**: columnas por profesional, franjas por hora; hueco libre con fondo
  --hueco-libre y, cuando hay gente anotada, un toque que lleva a la lista de
  espera ("3 esperando"). Sin nadie esperando el hueco no dice nada de más.
- **SelectorDemora**: presets del config + campo libre SIEMPRE (D8).

## Prohibiciones (heredadas de impeccable + propias)

Side-stripe borders; gradient text; glassmorphism; hero-metric template; grids
de cards idénticas; modal como primer reflejo (confirmar demora es un popover
inline, no un modal); #000/#fff puros; spinners genéricos donde alcanza un
estado optimista. Sin em dashes en el copy de UI.
