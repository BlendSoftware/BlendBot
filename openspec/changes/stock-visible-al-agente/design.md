## Context

La Capa 1 del control de stock (`cupo_jornada`, migración 000007) ya está entera y funciona: el cupo se carga por plato y por jornada abierta, confirmar un pedido lo descuenta (`ConControlDeCupos` en `motor_gastro.go:55`), cancelarlo lo devuelve, y `CHECK (consumido <= asignado)` hace que el árbitro de la sobreventa sea Postgres y no una condición de carrera en Go. Nada de eso hay que rehacerlo.

Lo que falta es que esa verdad llegue al único lugar donde se toma la decisión que importa: la boca del asistente. Hoy el camino es:

```
ver_catalogo → core GET /api/servicios?solo_disponibles=true
                     └─ filtra por servicio.disponible (el interruptor manual)
                        y NO mira cupo_jornada
```

`dto` del catálogo no tiene el cupo, `_servicio_visible` (`agente/server.py:243`) devuelve nombre, precio, duración, categoría y descripción, y listo. El cupo aparece por primera vez recién en `handler/compromisos.go:168`, traduciendo `ErrSinCupo` — o sea, después de que el cliente ya pidió.

Restricción dura del proyecto: **el motor no se toca**. Este cambio es aditivo y de lectura; el enforcement transaccional queda exactamente donde está.

## Goals / Non-Goals

**Goals:**
- Que `ver_catalogo` no ofrezca en `servicios` un plato cuyo cupo llegó a cero, de modo que el cliente nunca lo pida. (El core no lo filtra: lo manda marcado y el agente lo separa en `agotados_hoy`.)
- Que el dueño vea cumplida la promesa literal que le hace el panel hoy.
- Que el bot pueda decir "quedan 2" cuando queda poco, en vez de callarse o inventar.
- Cero migraciones y cero cambios en la máquina de estados.

**Non-Goals:**
- Insumos, recetas o descuento por ingrediente. Eso es el cambio `insumos-y-recetas` y se apoya sobre éste.
- Reservar cupo durante un `hold`. Hoy el cupo se mueve al confirmar, no al armar el pedido; cambiar eso es otro alcance y otra discusión.
- Sacar `ErrSinCupo` del handler. Sigue siendo la última línea contra la carrera de dos clientes pidiendo el último plato al mismo tiempo. Este cambio reduce la probabilidad de llegar ahí; no la elimina, y no debe pretender hacerlo.

## Decisions

### 1. El cupo se resuelve en el service del catálogo, no en el repo de servicios

El listado de servicios sigue saliendo de `ServicioRepository`; el service que arma la respuesta hace **una** lectura agrupada a `cupo_jornada` por la jornada abierta y mergea en memoria.

*Por qué:* mantiene `ServicioRepository` ignorante de la jornada (hoy no la conoce, y no tiene por qué). Y evita el N+1 obvio de preguntar el cupo plato por plato.

*Alternativa descartada:* un `JOIN LEFT` entre `servicio` y `cupo_jornada` en el repo. Es una consulta menos, pero acopla el catálogo a la jornada en la capa equivocada y obliga a pasar `jornada_id` por toda la firma del repositorio de servicios, que también usa el vertical salud, donde no hay cupos.

### 2. Sin jornada abierta, todo es ilimitado

Si no hay caja abierta, el catálogo se comporta como siempre: nada agotado. No se inventa una jornada implícita ni se devuelve un error.

*Por qué:* es el mismo criterio que ya tomó `cupoService.jornadaAbierta` para las escrituras, y es el comportamiento correcto para el negocio que no usa cupos. El día del deploy nadie cambia de comportamiento.

### 3. `restante: null` es "ilimitado", `restante: 0` es "agotado"

Un servicio sin fila en `cupo_jornada` viaja con `restante: null` y `agotado: false`. El cupo es opt-in plato por plato, igual que en la migración.

*Por qué:* distinguir "no lleva cuenta" de "lleva cuenta y está en cero" es la diferencia entre "no sé" y "no hay". El bot tiene que poder decir cosas distintas en cada caso, y un `0` que significa las dos cosas es exactamente cómo se inventan respuestas.

*Alternativa descartada:* `restante: -1` para ilimitado. Un centinela numérico invita a que alguien lo compare con `<= 0` y apague el plato equivocado.

### 4. `solo_disponibles=true` NO se toca: sigue filtrando sólo el interruptor manual

> **Esta decisión se revirtió durante el apply.** La versión original decía que
> `solo_disponibles=true` pasaba a significar "disponible Y no agotado". Se queda acá,
> tachada, porque el motivo del revert vale más que la decisión.

El parámetro sigue significando lo que significaba: filtra `servicio.disponible`, en el
`WHERE` del repo. La respuesta filtrada igual trae `restante` y `agotado` marcados.

*Por qué se revirtió:* el estrechamiento parecía el "default seguro" — quien ya pasaba el
parámetro obtenía el comportamiento correcto sin cambiar su llamada. Pero al implementarlo,
los dos agentes chocaron con la misma pared por caminos independientes: si el listado
filtrado no trae los agotados, el agente **no tiene con qué armar `agotados_hoy`**, y para
conseguirlos terminó dejando de mandar el parámetro y reaplicando el filtro de `disponible`
en Python. O sea que el interruptor manual del dueño pasó a filtrarse en el cliente. Ese
precio no lo vale ningún default.

El error de fondo fue conceptual: `disponible=false` ("el dueño lo apagó") y `agotado`
("se terminó hoy") son **dos estados distintos que merecen dos frases distintas al
cliente**. Colapsarlos en un solo parámetro booleano obliga a quien consume a resignar
algo para volver a separarlos. El "consumidor hipotético" al que el default seguro
protegía no existe: la auditoría encontró que hay exactamente uno que pasa el parámetro
—el agente— y es justo el que estamos enseñando a manejar agotados explícitamente.

*Lección para el resto del roadmap:* cuando un filtro tenga que responder dos preguntas,
son dos campos, no un parámetro más inteligente.

### 5. Se elimina el cache de catálogo en la sesión del agente

`_catalogo` (`agente/server.py:77`) guarda el catálogo en `s.catalogo` y lo reusa mientras no cambie la cobertura. Eso se saca: `ver_catalogo` lee fresco siempre.

*Por qué:* el stock es precisamente el dato volátil. Un cache por sesión rompe esta feature justo en el escenario donde más importa — el servicio lleno, donde los platos se agotan a mitad de la conversación. Y la garantía que el cache protegía (H4: no cotizar con la cobertura vieja) se mantiene igual leyendo fresco, porque la lectura ya viaja con `cobertura_id`. Una lectura fresca es *más* consistente con lo que el core va a congelar al crear el compromiso, no menos.

*Costo:* una consulta indexada por llamada a la tool. Una conversación de WhatsApp hace unas pocas. El cache era una optimización contra un costo que no existe.

*A verificar en apply:* que ningún test dependa de que el catálogo se sirva del cache. Si alguno lo hace, se ajusta el test, no la decisión.

### 6. El agente muestra `restante` sólo cuando queda poco

`_servicio_visible` agrega `restante` a la respuesta únicamente cuando el plato lleva cuenta y queda poco (umbral a fijar en apply, arrancar con `<= 3`). Ilimitado o con stock holgado: el campo no viaja.

*Por qué:* mismo criterio que ya usa `descripcion` — lo que no está cargado, ni aparece. Mandarle `restante: 47` al modelo es ruido que invita a decirle al cliente "quedan 47 bifes", que no es información, es rareza.

## Risks / Trade-offs

- **El catálogo pasa a tocar `cupo_jornada` en cada listado** → una sola consulta agrupada por jornada, sobre el índice `idx_cupo_negocio (negocio_id, jornada_id)` que ya existe. Medir en el test de integración si el listado se degrada con carta grande.
- **Ventana de carrera entre el listado y la confirmación** → sigue existiendo y es correcta que exista. Dos clientes pueden ver el último plato a la vez; el que confirma segundo se come `ErrSinCupo`. Este cambio achica la ventana de minutos a segundos; no la cierra, y el diseño no debe fingir que sí.
- **Estrechar `solo_disponibles` es un cambio de comportamiento sobre un contrato vivo** → auditar los llamadores (agente y panel hoy) antes de mergear, y dejar el assert en el smoke para que se note si alguien depende de lo viejo.
- **Sacar el cache podría degradar la latencia percibida de la conversación** → medir. Si duele, la respuesta correcta no es volver a cachear el stock: es cachear precio y descripción por separado del stock.

## Migration Plan

Sin migración de base. Es deploy directo del core y del agente, en ese orden: el core primero (los campos nuevos son aditivos y el agente viejo los ignora), el agente después. Rollback = revertir el agente; el core con los campos de más no rompe a nadie.

## Open Questions

- Umbral de "queda poco" para mostrar `restante`. Arrancar con `<= 3` y ajustarlo con el dueño en dogfooding.
- ¿El plato agotado tiene que desaparecer del catálogo, o aparecer marcado como agotado para que el bot pueda decir "el bife se nos terminó" en vez de hacer de cuenta que nunca existió? La segunda es mejor conversación y peor superficie de error. Decidir en `specs`.
