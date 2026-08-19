# PRODUCT.md — Copiloto Comercios (panel)

register: product

## Qué es

El panel de control de un SaaS argentino: el WhatsApp del negocio contesta solo
(agente IA), toma pedidos/reservas/turnos, y este panel es donde el negocio los
opera. Cuando se cobra, emite la factura de ARCA. Dos verticales sobre el mismo
motor: consultorios (primero) y gastronomía.

Fuente completa: `docs/PRODUCTO.md` y `docs/PANEL.md` (escritos con el fundador).

## Usuarios

- **La secretaria del consultorio** (usuaria principal, v1): mira la agenda del
  día en una tablet o PC en el mostrador, con luz natural, mañana tranquila.
  No es técnica. Si el panel la hace sentir reemplazada, sabotea el producto.
- **El profesional dueño**: entra poco; quiere ver el día y la plata de un vistazo.
- **El cajero/dueño gastronómico** (v2): parado, tablet con grasa, viernes 21hs,
  gente gritando. Opera con el pulgar, mira de lejos.
- **Admin de la plataforma** (nosotros): alta de negocios, token del agente.

## Principios estratégicos (de docs/PANEL.md, no negociables)

1. Se entiende de un vistazo y se opera con el pulgar. Botones grandes (touch ≥48px).
2. Cero navegación en la pantalla operativa: todo lo urgente en una vista.
3. Alto contraste: se mira de lejos y con reflejo.
4. Nada que requiera leer: estado por color y posición, no por texto.
5. Los pendientes reclaman atención hasta que alguien los toca.
6. El interruptor de disponibilidad es la feature más importante del producto.
7. Presets siempre con campo libre (D8).
8. Los huecos libres SE VEN: un hueco es plata por perderse.

## Tono y marca

Español rioplatense neutro profesional (tuteo suave, sin slang). Cálido, directo,
cero jerga técnica: la secretaria jamás lee "tenant", "commit" ni "estado inválido".
Nombre de trabajo "Copiloto"; sin identidad visual heredada: la define DESIGN.md.

## Anti-referencias

- Dashboards SaaS genéricos con grids de cards idénticas y hero-metrics.
- Paneles médicos "blanco + teal hospital".
- Sistemas gastronómicos recargados tipo POS de los 2000.
- Todo lo que parezca "admin template comprado".
