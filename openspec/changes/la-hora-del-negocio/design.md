## Context

Un local abre a las 20:00 y cierra a las 00:30. Esas dos horas son del local, no del servidor: el "día" de una parrilla de Mendoza no empieza ni termina cuando lo dice UTC. Todo el producto ya está construido sobre esa idea — `negocio.timezone` es una columna, el cierre de caja se calcula por la TZ del negocio (`GET /api/cierre` devuelve `"timezone"` en el cuerpo), y `formato.ts` documenta en su primera línea que el core manda las horas ya localizadas.

El contrato está escrito y es el correcto. Lo que falta es que el core lo cumpla en más de un lugar.

Hoy la localización vive en un método de un DTO:

```
dto/compromiso_dto.go:144   func (r *CompromisoResponse) EnTimezone(loc *time.Location)
        ↑ único llamador ↓
service/motor_gastro.go:135  resp[i].EnTimezone(loc)      (listado)
service/motor_gastro.go:308  resp.EnTimezone(loc)         (unitario, vía localizado)
```

Nada más en la API pasa por ahí. No es que se hayan olvidado seis endpoints: es que el diseño pide acordarse, y acordarse no escala. La medición del `proposal.md` (seis de siete en UTC) es el resultado esperable de un mecanismo opt-in que lleva meses en uso.

Restricción del cambio: **el panel no se toca**. `horaDe` corta el string a propósito y ese `a propósito` está bien argumentado en el archivo. Si el core cumple, el panel ya funciona.

## Goals / Non-Goals

**Goals:**
- Que toda hora que sale de la API esté en la TZ del negocio, sin excepciones.
- Que un endpoint nuevo **no pueda** salir en UTC por descuido. Que el error sea ruidoso y temprano, no silencioso y en producción.
- Sacar la resolución de TZ del camino de los services: es una preocupación del borde HTTP, no del dominio.
- Cero migraciones, cero cambios de esquema, cero cambios en el panel.

**Non-Goals:**
- Cambiar cómo se **guarda** la hora. Postgres sigue en `timestamptz` UTC, que es la decisión correcta y no está en discusión.
- Cambiar cómo **entra** la hora. Los requests siguen aceptando cualquier offset y parseándose como instante.
- Formatear para humanos en el core. El core manda RFC3339 con offset; quién lo convierte en `"20:01"` sigue siendo el panel.
- Soportar que un usuario vea el panel en su propia timezone. Es deliberadamente lo contrario: ver decisión §1.

## Decisions

### 1. Localiza el core, no el panel

*Por qué no el panel:* la conversión en el navegador usaría la TZ del **espectador**, no la del negocio. Un dueño mirando el panel desde un viaje a España vería el cierre de caja a horas distintas que su encargado en el local, sobre los mismos datos. Peor todavía, los dos tendrían razón según su reloj y ninguno según el negocio. El día de un local es uno solo y lo define el local.

*Por qué el core:* es el único lugar que conoce `negocio.timezone` sin tener que preguntárselo a nadie. Y ya es donde vive la decisión para compromisos y para el cierre de caja; esto la extiende, no la inventa.

*Alternativa descartada:* mandar UTC siempre y que el panel reciba también el `timezone` del negocio para convertir. Es defendible y es lo que haría una API pública. Se descarta porque duplica la regla en dos lenguajes, obliga a que **cada** pantalla del panel acarree la TZ, y contradice un contrato ya escrito y ya funcionando para compromisos. El costo de cambiar de bando ahora es mayor que el de completar el bando elegido.

### 2. El tipo carga la obligación: `dto.Hora`

```go
type Hora struct {
    t   time.Time
    loc *time.Location
}

func (h Hora) MarshalJSON() ([]byte, error) {
    if h.loc == nil {
        return nil, fmt.Errorf("dto.Hora sin timezone: ...")
    }
    return json.Marshal(h.t.In(h.loc).Format(time.RFC3339Nano))
}
```

*Por qué:* invierte el default. Hoy, olvidarse produce una hora corrida que nadie nota hasta que un dueño la lee. Con esto, olvidarse produce un error en el primer test que serialice ese endpoint. Es la diferencia entre un bug que se descubre en producción y uno que no compila el CI.

Es el mismo criterio que el resto del repo ya aplica: el `CHECK (consumido <= asignado)` de `cupo_jornada` no *documenta* que no se sobrevenda, lo **impide**; la unidad del insumo se elige una vez y no se convierte nunca para que el error de conversión no exista. Acá igual: no alcanza con documentar que hay que localizar.

*Alternativa descartada:* dejar `time.Time` y agregar las seis llamadas faltantes. Arregla lo medido hoy y garantiza la séptima regresión. Es exactamente el arreglo que `lo-que-el-producto-promete` §3 propone, y es por eso que este cambio existe aparte: el hallazgo era correcto, el alcance era chico.

*Alternativa descartada:* un middleware que recorra el response por reflexión reescribiendo `time.Time`. Una sola línea de código y cero cambios en los DTOs, pero es magia: nadie que lea un handler entiende por qué la hora que devuelve no es la que puso. Este repo elige lo explícito de forma consistente (ver `resolverRestante`, que documenta el orden de sus fuentes "para que el día que alguien rompa esa validación el catálogo no cambie de opinión"). La reflexión va contra esa línea. **Pero sí se usa reflexión en un test** — ver §5.

### 3. La timezone se resuelve una vez por request, en un middleware

Cuelga después del middleware de auth, que es quien ya extrajo el `negocio_id` del JWT. Lee el negocio, hace `time.LoadLocation` y deja el `*time.Location` en el contexto de gin.

*Por qué:* hoy `locNegocio` (`motor_gastro.go:312`) lee el negocio de la base **cada vez que arma un response**. Un listado de compromisos paga una consulta extra que no aporta nada. Una vez por request es estrictamente mejor y además saca a los services de tener que conocer la config del negocio para poder contestar — `motor_gastro` deja de necesitar `m.negocios` para esto.

*Consecuencia buscada:* `localizado()` y `locNegocio()` se eliminan. Este cambio agrega un tipo y borra dos funciones.

### 4. Sin negocio en el contexto, el response no lleva horas

Las rutas de `/api/admin/*` operan sobre la plataforma: el admin no tiene `negocio_id` (lo verificamos: su JWT trae `negocio_id: ""` y el login devuelve `negocio_id: null`). Ahí no hay TZ que resolver.

La regla es explícita y no accidental: **si no hay negocio en el contexto, el middleware no pone location, y un response que intente serializar una `Hora` falla.** No hay fallback a UTC ni a la TZ del proceso.

*Por qué tan duro:* un fallback silencioso a UTC reintroduce exactamente el bug que este cambio elimina, y lo reintroduce en el lugar donde menos se mira. Hoy ningún response de admin expone timestamps, así que la regla no rompe nada. El día que alguien agregue uno, se va a enterar en el acto y va a tener que decidir a propósito en qué hora lo muestra — que es la decisión correcta para un panel de plataforma con negocios en husos distintos.

### 5. El test que evita la octava regresión

Un test que recorra por reflexión los structs de respuesta de `internal/dto` y falle si alguno expone un `time.Time` (o `*time.Time`) en un campo con tag `json`.

*Por qué reflexión acá y no en producción:* en un test, la magia se paga una vez y protege para siempre; en el camino de un request, se paga en cada lectura de cada handler por cualquiera que quiera entender el código. Un test que falla dice exactamente qué campo y qué archivo.

Necesita distinguir request de response. Se resuelve con la convención que el repo ya usa —`...Input` / `...Request` para entrada, `...Response` / `...Resumen` para salida— y una lista explícita de excepciones, vacía al empezar. Si la convención no alcanza en algún caso, la excepción se escribe con su motivo al lado, no se afloja el test.

## Risks / Trade-offs

- **Superficie del refactor.** Se tocan nueve archivos de DTO y sus constructores. Es mecánico pero no es chico, y un `Hora` mal construido en un sitio que ningún test cubre es un 500 en vez de una hora corrida. Mitigación: el test de §5 encuentra los campos migrados; los tests de integración por endpoint del `tasks.md` cubren la construcción. Un 500 ruidoso en un endpoint sin cobertura sigue siendo mejor que una hora silenciosamente mal, que es lo que hay hoy.
- **tzdata en la imagen.** `time.LoadLocation` la necesita. Hoy funciona para compromisos, así que está; pero el cambio la vuelve crítica para toda la API. Si el `Dockerfile` usa una base `scratch` o `alpine` sin `tzdata`, esto pasa de un endpoint roto a la API entera rota. Se verifica antes de empezar (tarea 1.1), no después.
- **`Hora` no es `time.Time`.** Cualquier código que hoy haga aritmética sobre un campo de response deja de compilar. Es una ventaja disfrazada de costo: esa aritmética estaba operando sobre un valor cuya TZ dependía del proceso.

## Migration Plan

No hay migración de datos. El orden de trabajo es: verificar tzdata → tipo `Hora` con sus tests → middleware → migrar DTOs de a uno con su test de integración → borrar `localizado`/`locNegocio` → el test de reflexión al final, cuando ya tiene que pasar en verde.

El test de reflexión va último a propósito: escrito primero, es un muro rojo que no distingue avance de estancamiento.

## Open Questions

- ¿El agente (Python) muestra hoy alguna hora corrida al cliente por leer `expira_en` de un hold o `creado_en` de una consulta? Se responde con un test antes de decidir si hay que tocar algo del lado del agente. La sospecha es que sí y que este cambio lo arregla solo.
- ¿`ComprobanteResponse.CAEVence` (que es `*string` con formato `YYYY-MM-DD`, no un `time.Time`) queda fuera del alcance? Es una fecha fiscal que ARCA define en su propio huso; convertirla sería incorrecto. Propuesta: queda fuera y se documenta en el campo por qué, para que el test de §5 no la reclame el día que alguien la convierta a `time.Time`.
