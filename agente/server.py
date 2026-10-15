"""Servidor MCP del Copiloto de Comercios: las tools del agente conversacional.

Lo que el modelo puede hacer termina donde termina esta lista. No hay acceso a
la base, no hay SQL, no hay `negocio_id` ni `telefono` como argumento: el
negocio sale del token y el cliente del entorno de la sesión (ver settings.py).

Toda escritura va en dos pasos: primero `confirmado=False` (devuelve el resumen
para leerle al cliente) y recién con el OK explícito `confirmado=True`.

Correr: `uv run server.py` (transport stdio; lo lanza el gateway).
"""

from __future__ import annotations

import functools
from datetime import datetime
from decimal import Decimal
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

from fastmcp import FastMCP
from pydantic import BaseModel, Field

from core_client import CoreClient, ErrorDelCore
from resolucion import Resolucion, resolver
from sesion import Bloqueo, Borrador, LineaBorrador, a_decimal, plata, sesion
from settings import get_settings

mcp = FastMCP("copiloto-comercios")

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

# Desde cuántas porciones para abajo el número le llega al modelo. Arriba de esto
# el dato no es información, es rareza: mandarle `restante: 47` sólo invita a que
# le diga al cliente "quedan 47 bifes". Mismo criterio que `descripcion`: lo que no
# aporta, no viaja. Se ajusta con el dueño en dogfooding.
STOCK_ESCASO = 3

_cliente_core: CoreClient | None = None


def core() -> CoreClient:
    global _cliente_core
    if _cliente_core is None:
        cfg = get_settings()
        _cliente_core = CoreClient(cfg.core_url, cfg.agente_token, timeout_s=cfg.timeout_s)
    return _cliente_core


def usar_core(cliente: CoreClient | None) -> None:
    """Inyecta el cliente (tests). En producción lo arma `core()` de settings."""
    global _cliente_core
    _cliente_core = cliente


def _telefono() -> str:
    return get_settings().cliente_telefono


def traduce_errores(fn: Callable[..., Awaitable[dict]]) -> Callable[..., Awaitable[dict]]:
    """Un fallo del core no rompe la conversación: vuelve como dict accionable."""

    @functools.wraps(fn)
    async def envoltorio(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return await fn(*args, **kwargs)
        except ErrorDelCore as e:
            return e.como_dict()

    return envoltorio


# ── helpers de dominio ────────────────────────────────────────────────────────


async def _negocio() -> dict[str, Any]:
    s = sesion()
    if s.negocio is None:
        s.negocio = await core().negocio()
    return s.negocio


async def _categorias() -> dict[str, str]:
    """Mapa `categoria_id -> nombre`, cacheado por sesión.

    El `SKILL.md` le muestra al modelo la carta agrupada bajo títulos legibles
    («Para compartir», «Bebidas»), pero la tool le venía dando `categoria_id`, un
    UUID. Agrupar con eso obliga a inventarse los nombres, que es exactamente lo
    que la regla 5 le prohíbe. Faltaba el dato, no había nada que decidir.

    Se cachea, al revés que el catálogo: lo que se mueve a mitad de conversación
    es el stock, no cómo se llaman los rubros de la carta. Sin cache, esto sería
    una lectura extra en cada mensaje.
    """
    s = sesion()
    if s.categorias is None:
        try:
            s.categorias = {
                str(c["id"]): str(c["nombre"])
                for c in await core().categorias()
                if c.get("id") and c.get("nombre")
            }
        except Exception:  # noqa: BLE001
            # Quedarse sin los nombres degrada la respuesta; tumbar la
            # conversación por eso sería peor. El modelo simplemente no va a
            # poder agrupar, que es donde estábamos antes de este cambio.
            s.categorias = {}
    return s.categorias


def _rubro_conocido(categoria: str | None, categorias: dict[str, str]) -> str | None:
    """El `categoria_id` que se le puede pasar al core, o `None` para la carta entera.

    El core espera un UUID de rubro. El modelo a veces manda el nombre del rubro
    («bebidas») y a veces directamente un plato («Napolitana grande», en producción
    el 15/10): el core respondía 500 y el cliente se quedaba sin carta. El nombre se
    traduce a su id; lo que no es un rubro conocido no viaja.
    """
    if not categoria:
        return None
    if categoria in categorias:
        return categoria
    buscado = categoria.strip().casefold()
    for cid, nombre in categorias.items():
        if nombre.casefold() == buscado:
            return cid
    return None


def _agotado(servicio: dict[str, Any]) -> bool:
    """Si el plato lleva cuenta de porciones y hoy no queda ninguna.

    Se miran los dos campos que el core manda por el mismo hecho: `agotado` es el
    que manda, y `restante: 0` es esa misma verdad dicha con un número. Con uno solo
    alcanzaría, pero un plato en cero que se cuela a la carta termina en un cliente
    ilusionado, así que acá se paga barato ser redundante.

    `restante: null` es "este plato NO lleva cuenta" (ilimitado), que no es cero: por
    eso se compara contra 0 y nunca con `<= 0`.
    """
    return bool(servicio.get("agotado")) or servicio.get("restante") == 0


async def _catalogo_partido(
    categoria: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """`(vendibles, agotados_de_hoy)` de UNA sola lectura al core.

    El core ya filtró el interruptor manual del dueño (`solo_disponibles=true`): lo
    apagado en el panel no llega hasta acá y para el agente no existe, igual que
    siempre. Lo que sí llega es lo agotado, marcado — porque apagado y agotado no son
    lo mismo y el cliente merece oír una frase distinta en cada caso. Partirlo acá es
    quedarse con las dos verdades sin una segunda llamada.

    Se lee fresco en cada invocación, sin cache de sesión: el stock es justamente el
    dato que se mueve a mitad de conversación —en el servicio lleno, que es cuando
    esto importa— y una carta cacheada ofrece el último plato después de vendido.

    Lo que el cache protegía sigue en pie: los precios se piden CON la cobertura del
    cliente porque el core congela el de la cobertura y nosotros cotizábamos
    precio_base, así que el cliente cerraba el pedido con un número y en la caja le
    salía otro (H4). Esa garantía viaja en `cobertura_id`, que va en cada lectura; no
    dependía de guardar nada.
    """
    servicios = await core().servicios(categoria, _cobertura_del_cliente())
    vendibles: list[dict[str, Any]] = []
    agotados: list[dict[str, Any]] = []
    for sv in servicios:
        (agotados if _agotado(sv) else vendibles).append(sv)
    return vendibles, agotados


def _cobertura_del_cliente() -> str | None:
    """La cobertura de la ficha del que escribe, si tiene una. None es lo normal
    en gastronomía (nadie pide hamburguesas con obra social).

    Se lee de la sesión y NO se va a buscar al core: `datos_del_negocio` —la
    primera tool de toda conversación— ya trajo la ficha, así que para cuando se
    cotiza está en memoria. Cotizar no puede depender de una llamada más.
    """
    cliente = sesion().cliente
    if not cliente:
        return None
    cobertura_id = cliente.get("cobertura_id")
    return str(cobertura_id) if cobertura_id else None


def _precio_de(servicio: dict[str, Any]) -> Decimal:
    """El precio con el que hay que cotizar: el efectivo de la cobertura del
    cliente si el core lo resolvió, si no el de lista."""
    efectivo = servicio.get("precio_efectivo")
    return a_decimal(efectivo if efectivo is not None else servicio.get("precio_base"))


async def _recursos() -> list[dict[str, Any]]:
    s = sesion()
    if not s.recursos:
        try:
            s.recursos = [r for r in await core().recursos() if r.get("activo", True)]
        except ErrorDelCore:
            s.recursos = []
    return s.recursos


async def _cliente() -> dict[str, Any] | None:
    """Ficha del que escribe: se crea (o se recupera) apenas arranca la
    conversación, sin esperar a que confirme nada. Así todo el que habla por
    WhatsApp queda en la lista de clientes del panel, no sólo el que compra.
    Si el core no responde, no rompe la conversación: sigue sin ficha y
    `confirmar` la crea más adelante como red de contención.
    """
    s = sesion()
    if s.cliente is None:
        telefono = _telefono()
        if not telefono:
            return None
        try:
            cliente = await core().cliente_por_telefono(telefono)
            if cliente is None:
                cliente = await core().crear_cliente(telefono)
            s.cliente = cliente
        except ErrorDelCore:
            return None
    return s.cliente


async def _coberturas() -> list[dict[str, Any]]:
    negocio = await _negocio()
    cobs = negocio.get("coberturas")
    if isinstance(cobs, list) and cobs:
        return cobs
    try:
        return await core().coberturas()
    except ErrorDelCore:
        return []


async def _tz() -> ZoneInfo:
    negocio = await _negocio()
    try:
        return ZoneInfo(str(negocio.get("timezone") or "America/Argentina/Mendoza"))
    except Exception:  # noqa: BLE001 — tzdata rara: no vale romper la conversación
        return ZoneInfo("America/Argentina/Mendoza")


def _politica(negocio: dict[str, Any], tipo: str = "turno") -> str:
    config = negocio.get("config") or {}
    if isinstance(config, dict):
        conf = config.get("confirmacion") or {}
        if isinstance(conf, dict):
            return str(conf.get(tipo, "humana"))
    return "humana"


# El mismo objeto `compromiso` es turno, pedido o reserva según el vertical: en
# gastronomía un compromiso con entrega es un `pedido`; una mesa bloqueada sin
# entrega es una `reserva`. Fuera de gastronomía el motor devuelve siempre
# `turno` (nombre genérico). De acá sale también qué política de confirmación
# aplica (`confirmacion.pedido` vs `confirmacion.turno`).
def _tipo_compromiso(
    negocio: dict[str, Any],
    borrador: Borrador | None = None,
    bloqueo: Bloqueo | None = None,
) -> str:
    if str(negocio.get("vertical") or "").lower() != "gastronomia":
        return "turno"
    if bloqueo is not None and not (borrador and borrador.entrega):
        return "reserva"
    return "pedido"


_ENTREGAS = {
    "retira": "retira",
    "retiro": "retira",
    "takeaway": "retira",
    "take away": "retira",
    "paso a buscar": "retira",
    "lo paso a buscar": "retira",
    "delivery": "delivery",
    "envio": "delivery",
    "envío": "delivery",
    "a domicilio": "delivery",
    "en_local": "en_local",
    "en local": "en_local",
    "en el local": "en_local",
    "para comer aca": "en_local",
    "para comer acá": "en_local",
    "salon": "en_local",
    "salón": "en_local",
}


def _normalizar_entrega(entrega: str | None) -> str | None:
    """Lleva lo que diga el modelo al enum del core (retira/delivery/en_local)."""
    if not entrega:
        return None
    clave = entrega.strip().lower()
    return _ENTREGAS.get(clave, clave)


def _sin_encontrar(
    que: str,
    r: Resolucion,
    campo: str = "nombre",
    agotados: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Qué contestar cuando lo que pidió el cliente no está entre lo vendible.

    `agotados` distingue los dos "no": el plato que el negocio no tiene y el que hoy
    se terminó. Sin esto, un cliente que va derecho a pedir el bife agotado —sin pasar
    por `ver_catalogo`— se lleva un "eso no lo tienen" que es falso, y encima
    contradice lo que le diría el mismo bot un mensaje antes. Se pasa sólo desde los
    llamadores de servicio: recursos y coberturas no llevan cupo.
    """
    opciones = [str(c.get(campo, "")) for c in r.candidatos if c.get(campo)]
    if r.ambiguo:
        return {
            "ok": False,
            "codigo": "ambiguo",
            "error": f"«{que}» puede ser más de una cosa. Preguntale al cliente cuál es, "
            "no elijas vos.",
            "opciones": opciones,
        }
    # Recién si no matcheó nada vendible preguntamos si es algo que se terminó hoy.
    # Se resuelve con el mismo `resolver` que la carta, así "veggie" encuentra a la
    # "Hamburguesa Veggie" agotada igual que la encontraría si estuviera a la venta.
    ra = resolver(que, agotados or [], campo=campo)
    if ra.ok:
        nombre = str((ra.item or {}).get(campo, que))
        return {
            "ok": False,
            "codigo": "agotado",
            "error": f"«{nombre}» sí lo tienen, pero HOY SE TERMINÓ. Decíselo así: «se nos "
            "terminó hoy», NUNCA «no lo tenemos», que sería mentira. Ofrecele algo parecido "
            "de la carta. NO prometas que se repone, ni a qué hora vuelve, ni ofrezcas "
            "avisarle cuando haya: no hay forma de cumplirlo.",
            "agotado": nombre,
        }
    return {
        "ok": False,
        "codigo": "no_encontrado",
        "error": f"No encontré «{que}» en lo que ofrece el negocio. NO lo inventes: decile "
        "que eso no lo tienen y ofrecele lo que sí está.",
        "opciones": opciones,
    }


def _servicio_visible(s: dict[str, Any], categorias: dict[str, str] | None = None) -> dict[str, Any]:
    precio = _precio_de(s)
    visible = {
        "nombre": s.get("nombre"),
        "precio": str(precio),
        "precio_texto": plata(precio),
        "duracion_min": s.get("duracion_min"),
        "categoria_id": s.get("categoria_id"),
    }
    # El nombre del rubro, para que el modelo pueda agrupar la carta sin
    # inventarse los títulos. `categoria_id` se queda: sacarlo sería incompatible
    # sin ninguna ganancia.
    #
    # Un plato sin categoría no trae el campo, igual que la descripción no
    # cargada: si no está, el modelo no lo sabe y no lo afirma.
    cat_id = s.get("categoria_id")
    if cat_id and categorias:
        nombre_cat = categorias.get(str(cat_id))
        if nombre_cat:
            visible["categoria_nombre"] = nombre_cat
    # La descripción es lo que lleva el plato ("doble medallón, cheddar, panceta"):
    # sirve para responder "¿qué tiene la Doble bacon?" sin inventar. Sólo va si el
    # local la cargó; si no, ni aparece (no se rellena con nada).
    descripcion = s.get("descripcion")
    if descripcion:
        visible["descripcion"] = str(descripcion).strip()
    # Cuántas porciones quedan, SÓLO cuando quedan pocas: ahí sirve para avisar
    # "quedan 2" antes de que el cliente se ilusione con cuatro. Un plato ilimitado
    # (`restante: null`) o con stock de sobra no trae el campo, igual que la
    # descripción no cargada: si no está, el modelo no lo sabe y no lo afirma.
    restante = s.get("restante")
    if isinstance(restante, int) and not isinstance(restante, bool) and restante <= STOCK_ESCASO:
        visible["restante"] = restante
    return visible


async def _humanizar(momento_iso: str) -> dict[str, str]:
    """Fecha y hora en la timezone del negocio, listas para leerle al cliente."""
    try:
        dt = datetime.fromisoformat(momento_iso.replace("Z", "+00:00"))
    except ValueError:
        return {"fecha": momento_iso, "hora": ""}
    if dt.tzinfo is not None:
        dt = dt.astimezone(await _tz())
    return {
        "fecha": dt.strftime("%d/%m"),
        "dia": DIAS[dt.weekday()],
        "hora": dt.strftime("%H:%M"),
        "iso": momento_iso,
    }


# ── LAS TOOLS ─────────────────────────────────────────────────────────────────


@mcp.tool()
@traduce_errores
async def datos_del_negocio() -> dict[str, Any]:
    """Quién es el negocio: nombre, vertical, zona horaria, coberturas que atiende y su
    política de confirmación.

    ARRANCÁ POR ACÁ en toda conversación nueva: es lo que te dice cómo presentarte y si
    los turnos los confirmás vos (`confirmacion_turno = "automatica"`) o los tiene que
    confirmar alguien del negocio (`"humana"`). No asumas ninguna de las dos.

    Trae `info` (dirección, horarios de atención, teléfono, notas) SÓLO si el local la
    cargó. Con eso respondés "¿dónde quedan?", "¿a qué hora abren?", "¿tienen teléfono?".
    Si un dato de `info` no está, no lo sabés: no lo inventes — dejá la pregunta con
    `dejar_consulta` para que el local responda.

    No trae horarios de atención por recurso: eso sale de `consultar_disponibilidad`.
    """
    negocio = await _negocio()
    await _cliente()
    coberturas = await _coberturas()
    config = negocio.get("config") if isinstance(negocio.get("config"), dict) else {}
    config = config or {}
    # La info del local vive en config.info; el core la sube también al nivel de arriba
    # de /api/negocio. Leemos las dos por si acaso, sin romper si falta.
    info = negocio.get("info")
    if not isinstance(info, dict):
        info = config.get("info")
    info = info if isinstance(info, dict) else {}
    return {
        "ok": True,
        "nombre": negocio.get("nombre"),
        "vertical": negocio.get("vertical"),
        "timezone": negocio.get("timezone"),
        "confirmacion_turno": _politica(negocio, "turno"),
        # Gastronomía: el pedido casi siempre lo confirma el local ("humana"), que
        # además pone la demora desde el panel. El agente NUNCA inventa esa demora.
        "confirmacion_pedido": _politica(negocio, "pedido"),
        "confirmacion_reserva": _politica(negocio, "reserva"),
        "acepta_delivery": bool(config.get("acepta_delivery", False)),
        "radio_delivery_km": config.get("radio_delivery_km"),
        "hold_minutos": config.get("hold_minutos", 10),
        "coberturas": [c.get("nombre") for c in coberturas if c.get("nombre")],
        # Dirección / horarios / teléfono / notas del local, para responder esas
        # preguntas cuando están cargadas. Vacío = no cargado, no inventar.
        "info": {
            "direccion": info.get("direccion"),
            "horarios": info.get("horarios"),
            "telefono": info.get("telefono"),
            "notas": info.get("notas"),
        },
        "config": config,
    }


class LineaPedida(BaseModel):
    """Un ítem tal como lo pidió el cliente: el nombre en sus palabras, no un ID."""

    servicio: str = Field(description="Nombre del producto como lo dijo el cliente")
    cantidad: int = Field(default=1, ge=1, description="Cuántas veces. Casi siempre 1.")
    nota: str | None = Field(
        default=None,
        description="Aclaración operativa breve. NUNCA síntomas ni datos clínicos.",
    )


@mcp.tool()
@traduce_errores
async def ver_catalogo(categoria: str | None = None) -> dict[str, Any]:
    """Lo que el negocio puede vender AHORA, con precio y duración.

    `servicios` es la ÚNICA lista de la que se ofrece y de la que se toma pedido. No
    lista lo que está apagado en el panel (`disponible=false`) ni lo que hoy se agotó:
    si algo no está ahí, para el cliente no existe. Si te pide algo que no está en
    `servicios`, no se lo ofrezcas ni se lo armes — tampoco "por las dudas".

    `agotados_hoy` son NOMBRES, sin precio, de platos que el local sí tiene pero que hoy
    se terminaron. **No es una lista para ofrecer ni para tomar pedido.** Existe para una
    sola cosa: que cuando el cliente pregunte por uno de esos platos le digas "hoy se nos
    terminó" en vez de "no lo tenemos", que sería mentira. Después de decirlo, ofrecele
    algo de `servicios`. Nunca prometas que se repone, ni a qué hora vuelve, ni ofrezcas
    avisarle cuando haya: no hay nada en el sistema que pueda cumplir eso. Si la lista no
    viene, es que no se agotó nada.

    Un ítem trae `restante` sólo cuando quedan pocas porciones: ahí sí podés decir cuántas
    quedan. Si el campo no está, no sabés cuántas hay — no digas que hay de sobra ni que
    quedan pocas.

    Los precios que le digas al cliente salen de acá TAL CUAL. Si un precio no está en
    esta respuesta, no lo digas: no se estima ni se redondea.

    Cada ítem puede traer `categoria_nombre` (el rubro de la carta: «Para compartir»,
    «Bebidas»). Agrupá por ESE nombre cuando le leas la carta al cliente. Si un ítem no
    lo trae, va suelto: no le inventes un rubro ni lo metas en otro por parecido.

    Cada ítem puede traer `descripcion` (lo que lleva el plato). Si el cliente pregunta
    "¿qué tiene la Doble bacon?", respondé con ESA descripción textual. Si un ítem no la
    trae, no la sabés: no la inventes — usá `dejar_consulta` para que el local responda.

    Si la conversación se estiró, volvé a llamarla antes de cerrar: el stock se mueve y
    esta tool consulta fresco cada vez.
    """
    categorias = await _categorias()
    servicios, agotados = await _catalogo_partido(_rubro_conocido(categoria, categorias))
    # Sólo el nombre: con precio, `agotados_hoy` parecería una carta paralela y sería
    # cuestión de tiempo que el modelo cotice de ahí.
    agotados_hoy = [str(s.get("nombre")) for s in agotados if s.get("nombre")]
    # Ausente cuando no hay nada agotado: una lista vacía en la respuesta es una
    # invitación a mencionarla, y no hay nada que mencionar.
    hoy = {"agotados_hoy": agotados_hoy} if agotados_hoy else {}
    if not servicios:
        return {
            "ok": True,
            "servicios": [],
            **hoy,
            "aviso": "No queda nada para vender ahora mismo. Decilo así —si hay "
            "`agotados_hoy`, que hoy se terminó, no que no lo tienen— y ofrecé que lo "
            "contacten del negocio. No inventes productos.",
        }
    return {
        "ok": True,
        "servicios": [_servicio_visible(s, categorias) for s in servicios],
        **hoy,
        "nota": "Precios y duraciones son los reales: leelos textuales, no los estimes.",
    }


@mcp.tool()
@traduce_errores
async def consultar_disponibilidad(
    servicio: str,
    desde: str | None = None,
    recurso: str | None = None,
) -> dict[str, Any]:
    """Huecos REALES para una práctica. Ya descuenta agenda ocupada, excepciones y holds
    de otras personas.

    - `servicio`: el nombre como lo dijo el cliente; lo resuelvo contra el catálogo.
    - `desde`: fecha `YYYY-MM-DD` desde la que buscar. Sin esto, arranca hoy.
    - `recurso`: nombre del recurso (mesa, repartidor, etc.), si el cliente pidió uno
      puntual. Sin esto, todos.

    Los horarios que le ofrezcas al cliente salen SOLO de acá. Si la respuesta viene
    vacía, no hay turno en ese rango: ofrecé buscar en otra fecha, nunca inventes uno.
    Copiá `inicio` y `fin` tal cual para `bloquear`.
    """
    servicios, agotados = await _catalogo_partido()
    r = resolver(servicio, servicios)
    if not r.ok:
        return _sin_encontrar(servicio, r, agotados=agotados)
    sv = r.item or {}

    recurso_id = None
    if recurso:
        rr = resolver(recurso, await _recursos())
        if not rr.ok:
            return _sin_encontrar(recurso, rr)
        recurso_id = (rr.item or {}).get("id")

    datos = await core().consultar_disponibilidad(
        str(sv.get("id")), desde=desde, recurso_id=recurso_id
    )
    crudos = datos.get("huecos") if isinstance(datos, dict) else None
    huecos: list[dict[str, Any]] = []
    for h in list(crudos or []):
        inicio = str(h.get("inicio", ""))
        cuando = await _humanizar(inicio)
        huecos.append(
            {
                "recurso": h.get("recurso") or h.get("recurso_nombre"),
                "recurso_id": h.get("recurso_id"),
                "inicio": inicio,
                "fin": str(h.get("fin", "")),
                **cuando,
            }
        )

    sesion().ultimos_huecos = huecos
    if not huecos:
        return {
            "ok": True,
            "servicio": sv.get("nombre"),
            "huecos": [],
            "aviso": "No hay huecos en ese rango. Ofrecé buscar en otra fecha o con otro "
            "recurso. NO ofrezcas un horario que no esté en esta lista.",
        }
    return {
        "ok": True,
        "servicio": sv.get("nombre"),
        "duracion_min": datos.get("duracion_min") or sv.get("duracion_min"),
        "huecos": huecos,
        "nota": "Mostrale pocos por vez (3 o 4) agrupados por día. Para reservar uno, "
        "llamá a `bloquear` copiando `inicio` y `fin` textuales.",
    }


@mcp.tool()
@traduce_errores
async def armar_compromiso(
    lineas: list[LineaPedida],
    entrega: str | None = None,
    direccion: str | None = None,
    nota: str | None = None,
) -> dict[str, Any]:
    """Arma el borrador de lo que el cliente pidió y devuelve el resumen con el total.

    NO reserva NADA y NO escribe en el sistema: es una cuenta hecha con los precios del
    catálogo para que se la leas al cliente. Para que exista de verdad tiene que pasar
    por `confirmar` (el OK del cliente), y si ocupa agenda (por ejemplo una reserva de
    mesa) también por `bloquear` (el horario).

    - `lineas`: los ítems que pidió. Suelen ser varios (una hamburguesa, unas papas, una
      gaseosa); si es una reserva de mesa alcanza con un ítem.
    - `entrega`: `retira` (lo pasa a buscar), `delivery` (se lo llevan)
      o `en_local` (come en el salón). Si el cliente ya lo dijo, ponelo y NO se lo
      vuelvas a preguntar.
    - `direccion`: sólo si `entrega=delivery`. La dirección donde llevar el pedido.
    - `nota`: una aclaración de TODO el pedido, no de un ítem: "tocar timbre 3B",
      "sin cubiertos", "es para las 21:30". Las modificaciones de un plato puntual
      ("sin cebolla") van en la nota de esa línea, no acá.

    Llamala apenas tengas claro qué pidió, aunque falten datos: en gastronomía el pedido
    entra al panel apenas hay ítems, así la cocina lo ve venir. Si después agrega o cambia
    algo, volvé a llamarla: reemplaza el borrador anterior.
    """
    servicios, agotados = await _catalogo_partido()
    if not servicios:
        return {
            "ok": False,
            "codigo": "sin_catalogo",
            # Si la carta entera se agotó, "no tiene nada" también sería mentira: el
            # negocio tiene, se le terminó. Es la misma distinción que `agotado`.
            "error": "No queda nada para vender ahora mismo. No armes nada."
            + (
                " Lo que pidió se terminó HOY: decíselo así, no que no lo tienen."
                if agotados
                else ""
            ),
        }

    entrega = _normalizar_entrega(entrega)
    borrador = Borrador(entrega=entrega, direccion=direccion, nota=nota)
    for pedida in lineas:
        r = resolver(pedida.servicio, servicios)
        if not r.ok:
            return _sin_encontrar(pedida.servicio, r, agotados=agotados)
        sv = r.item or {}
        borrador.lineas.append(
            LineaBorrador(
                servicio_id=str(sv.get("id")),
                nombre=str(sv.get("nombre")),
                cantidad=pedida.cantidad,
                precio_unit=_precio_de(sv),
                duracion_min=sv.get("duracion_min"),
                nota=pedida.nota,
            )
        )

    sesion().fijar_borrador(borrador)
    falta_direccion = borrador.entrega == "delivery" and not borrador.direccion
    salida = {
        "ok": True,
        **borrador.como_dict(),
        "persistido": False,
        "falta_direccion": falta_direccion,
        "aviso": "Esto TODAVÍA NO está confirmado. Leele el resumen con el total, y si "
        "ocupa agenda elegí el horario con `bloquear`. Recién con el OK explícito llamá a "
        "`confirmar`.",
    }
    if falta_direccion:
        salida["aviso"] = (
            "Es delivery: pedile la dirección (calle y número) antes de confirmar y volvé "
            "a llamar a `armar_compromiso` con `direccion`. Mostrale igual el total ahora."
        )
    return salida


@mcp.tool()
@traduce_errores
async def bloquear(recurso: str, inicio: str, fin: str) -> dict[str, Any]:
    """Bloquea el hueco elegido mientras el cliente completa sus datos (típico: 10 min).

    Sin esto, dos personas sacan el mismo turno mientras una escribe su nombre. Llamala
    APENAS el cliente elige horario, antes de pedirle nombre y cobertura.

    `recurso`, `inicio` y `fin` se copian TEXTUALES del hueco que devolvió
    `consultar_disponibilidad`. Si el core dice que ya está ocupado, pedí disculpas,
    volvé a consultar disponibilidad y ofrecé otro.

    Bloquear no es reservar: el turno recién existe cuando `confirmar` lo escribe.
    """
    # Un recurso aparece en varios huecos: sin deduplicar, resolver lo lee como empate.
    por_id = {
        str(h["recurso_id"]): {"id": h["recurso_id"], "nombre": h.get("recurso")}
        for h in sesion().ultimos_huecos
        if h.get("recurso_id")
    }
    candidatos = list(por_id.values()) or await _recursos()
    r = resolver(recurso, candidatos)
    if not r.ok:
        return _sin_encontrar(recurso, r)
    elegido = r.item or {}

    s = sesion()
    if s.bloqueo:  # el cliente cambió de horario: soltamos el anterior
        try:
            await core().liberar_hold(s.bloqueo.hold_id, _telefono())
        except ErrorDelCore:
            pass
        s.bloqueo = None

    hold = await core().crear_hold(str(elegido.get("id")), inicio, fin, _telefono())
    s.fijar_bloqueo(
        Bloqueo(
            hold_id=str(hold.get("id")),
            recurso_id=str(hold.get("recurso_id") or elegido.get("id")),
            recurso=str(elegido.get("nombre")),
            inicio=str(hold.get("inicio") or inicio),
            fin=str(hold.get("fin") or fin),
            expira_en=hold.get("expira_en"),
        )
    )
    cuando = await _humanizar(s.bloqueo.inicio)
    return {
        "ok": True,
        **s.bloqueo.como_dict(),
        **cuando,
        "aviso": "Hueco bloqueado, TODAVÍA no confirmado. Avisale al cliente que se lo "
        "guardás unos minutos mientras completan, pedile nombre y cobertura, y cerrá con "
        "`confirmar`.",
    }


@mcp.tool()
@traduce_errores
async def confirmar(
    compromiso_borrador: str | None = None,
    nombre: str | None = None,
    cobertura: str | None = None,
    confirmado: bool = False,
) -> dict[str, Any]:
    """Cierra el compromiso: crea/actualiza la ficha del cliente y lo escribe en el panel.

    ESCRITURA, y el negocio lo ve en el panel. Llamala primero SIN `confirmado`: te
    devuelve el resumen exacto (ítems o práctica, entrega, día/hora si tiene, total) para
    que se lo leas al cliente. Recién cuando él dice que sí, repetí con `confirmado=true`.
    Nunca confirmes sin ese OK explícito.

    - `nombre`: nombre completo, como lo escribió el cliente.
    - `cobertura`: sólo si el negocio maneja coberturas (obra social, prepaga, etc.) y el
      cliente la dijo. La resuelvo contra las que atiende el negocio; si no está, te lo
      aviso para que preguntes.
    - `compromiso_borrador`: el `borrador_id` de `armar_compromiso`. Vacío = el actual.

    La política sale de la config del negocio, por tipo. Si es `"automatica"` (típico de
    turnos: la agenda ya sabe si el hueco está libre), queda confirmado y se lo decís así.
    Si es `"humana"` (típico de pedidos: la cocina se satura), queda PENDIENTE: avisale
    que el local le confirma —y en gastronomía le pone la demora— y NO se lo des por
    cerrado ni inventes vos la demora.
    """
    s = sesion()
    borrador = s.borrador
    if borrador is None:
        return {
            "ok": False,
            "codigo": "sin_borrador",
            "error": "No hay nada armado. Llamá primero a `armar_compromiso` con lo que "
            "pidió el cliente.",
        }
    if compromiso_borrador and compromiso_borrador != borrador.id:
        return {
            "ok": False,
            "codigo": "borrador_viejo",
            "error": f"Ese borrador ya no es el vigente (el actual es {borrador.id}). "
            "Volvé a armarlo si el cliente cambió el pedido.",
        }
    if borrador.duracion_min and s.bloqueo is None:
        return {
            "ok": False,
            "codigo": "sin_hueco",
            "error": "Esa práctica ocupa agenda y todavía no elegiste horario. Consultá "
            "disponibilidad, que el cliente elija, y bloqueá el hueco antes de confirmar.",
        }

    negocio = await _negocio()
    tipo = _tipo_compromiso(negocio, borrador, s.bloqueo)
    politica = _politica(negocio, tipo)

    cobertura_id = None
    cobertura_nombre = None
    aviso_cobertura = None
    if cobertura:
        coberturas = await _coberturas()
        if not coberturas:
            aviso_cobertura = (
                "El negocio no tiene coberturas cargadas, así que no puedo registrar la "
                "obra social. No le prometas cobertura: que lo consulte en el negocio."
            )
        else:
            rc = resolver(cobertura, coberturas)
            if not rc.ok:
                salida = _sin_encontrar(cobertura, rc)
                salida["error"] = (
                    f"«{cobertura}» no está entre las coberturas que atiende el negocio. "
                    "Preguntale al cliente si tiene otra o si va como particular; no le "
                    "asegures que se la toman."
                )
                return salida
            cobertura_id = str((rc.item or {}).get("id"))
            cobertura_nombre = (rc.item or {}).get("nombre")

    resumen = {
        "borrador_id": borrador.id,
        "tipo": tipo,
        "cliente_nombre": nombre or (s.cliente or {}).get("nombre"),
        "telefono": _telefono(),
        "cobertura": cobertura_nombre,
        **borrador.como_dict(),
        "turno": s.bloqueo.como_dict() if s.bloqueo else None,
        "politica_confirmacion": politica,
    }
    if s.bloqueo:
        resumen["cuando"] = await _humanizar(s.bloqueo.inicio)

    if not confirmado:
        return {
            "ok": True,
            "ejecutado": False,
            "resumen": resumen,
            "aviso": (
                "NO se agendó nada todavía. Leele este resumen al cliente con día, hora, "
                "recurso y total, y pedile que confirme. Con su sí, repetí esta tool "
                "con confirmado=true."
            ),
            "siguiente_paso": "confirmar(confirmado=true)",
        }

    # 14/10: el cliente pidió, dijo "lo voy a retirar" y el bot confirmó sin
    # volver a `armar_compromiso` con `entrega`. El pedido quedó en el core con
    # `entrega` NULL y el aviso de "listo" (que depende de `entrega`, ver
    # `core/internal/service/motor_gastro.go`) nunca salió. Un `pedido` sin
    # `entrega` se rechaza ACÁ, antes de tocar el core.
    if tipo == "pedido" and not borrador.entrega:
        return {
            "ok": False,
            "codigo": "falta_entrega",
            "error": "Falta saber si el pedido es para retirar, delivery o comer en el "
            "local. Preguntáselo al cliente y volvé a llamar a armar_compromiso con "
            "entrega.",
        }

    if not resumen["cliente_nombre"]:
        return {
            "ok": False,
            "codigo": "falta_nombre",
            "error": "Falta el nombre del cliente para la ficha. Pediselo y volvé a llamar "
            "con `nombre`.",
        }

    if borrador.entrega == "delivery" and not borrador.direccion:
        return {
            "ok": False,
            "codigo": "falta_direccion",
            "error": "Es un pedido con delivery y no hay dirección. Pedísela al cliente "
            "(calle y número), volvé a armar el pedido con `direccion` y recién ahí confirmá.",
        }

    # 1) ficha del cliente: `_cliente()` ya la creó al arrancar la conversación
    # (datos_del_negocio), así que acá casi siempre es completar lo que falta:
    # el nombre (todavía no lo teníamos) y la cobertura si la dijo recién ahora.
    telefono = _telefono()
    cliente = await _cliente() or await core().cliente_por_telefono(telefono)
    if cliente is None:
        cliente = await core().crear_cliente(
            telefono, nombre=str(resumen["cliente_nombre"]), cobertura_id=cobertura_id
        )
    else:
        cambios: dict[str, Any] = {}
        if not cliente.get("nombre") and resumen["cliente_nombre"]:
            cambios["nombre"] = str(resumen["cliente_nombre"])
        if cobertura_id and cliente.get("cobertura_id") != cobertura_id:
            cambios["cobertura_id"] = cobertura_id
        if cambios:
            cliente = await core().actualizar_cliente(str(cliente.get("id")), **cambios)
    s.cliente = cliente
    # Antes acá se descartaba el catálogo cacheado si recién ahora supimos la
    # cobertura (H4). Ya no hace falta: el catálogo no se cachea y cada lectura sale
    # con la cobertura que tenga la ficha en ese momento.

    # 2) el compromiso. `sesion` va para que el hold propio no cuente como solape.
    cuerpo: dict[str, Any] = {
        "cliente_id": str(cliente.get("id")),
        "tipo": tipo,
        "origen": "whatsapp",
        "sesion": telefono,
        "lineas": [
            {"servicio_id": l.servicio_id, "cantidad": l.cantidad, **({"nota": l.nota} if l.nota else {})}
            for l in borrador.lineas
        ],
    }
    if s.bloqueo:
        cuerpo.update(
            {
                "recurso_id": s.bloqueo.recurso_id,
                "inicio": s.bloqueo.inicio,
                "fin": s.bloqueo.fin,
            }
        )
    if borrador.entrega:
        cuerpo["entrega"] = borrador.entrega
    if borrador.direccion:
        cuerpo["direccion"] = borrador.direccion
    if borrador.nota:
        cuerpo["nota"] = borrador.nota

    compromiso = await core().crear_compromiso(cuerpo)
    compromiso_id = str(compromiso.get("id"))

    # 3) política del negocio: la agenda sabe si el hueco está libre, la cocina no.
    estado = str(compromiso.get("estado", "pendiente"))
    if politica == "automatica":
        confirmado_resp = await core().transicionar(compromiso_id, "confirmado")
        estado = str(confirmado_resp.get("estado", "confirmado"))

    cuando = await _humanizar(s.bloqueo.inicio) if s.bloqueo else {}
    recurso_asignado = s.bloqueo.recurso if s.bloqueo else None
    total = a_decimal(compromiso.get("total") or borrador.total)

    # El core congela el precio de la cobertura del cliente. Si la cobertura se
    # declaró recién en esta llamada, el borrador que el cliente aceptó tenía el
    # precio de lista y el total real es otro: hay que DECÍRSELO, no dejar que
    # se entere en la caja (H4).
    cotizado = borrador.total
    aviso_precio = None
    if total != cotizado:
        aviso_precio = (
            f"OJO: el total final es {plata(total)} y vos le habías dicho {plata(cotizado)} "
            "(cambió el precio al aplicar su cobertura). Decíselo con el número nuevo, "
            "no repitas el viejo."
        )

    s.limpiar_compromiso()

    if tipo == "pedido":
        if estado == "confirmado":
            mensaje = (
                "Pedido CONFIRMADO. Confirmale que ya está en cocina. Si el local cargó una "
                "demora (`demora_min`), decísela; si no, que el local se la manda por acá "
                "apenas lo confirme."
            )
        else:
            # El aviso no nombra plazos: lo que dice acá el modelo lo repite casi
            # textual, y "en un minuto" le ganaba a la regla 2 del SKILL.
            mensaje = (
                "Pedido PENDIENTE: en gastronomía lo confirma el local, que además pone la "
                "demora desde el panel. Decile que ya le pasaste el pedido al local y que el "
                "local le manda la demora por acá apenas lo confirme. Sin plazos tuyos: "
                "NUNCA inventes vos la demora ni lo des por confirmado."
            )
    elif estado == "confirmado":
        mensaje = (
            "Turno CONFIRMADO. Decíselo con día, hora y recurso asignado, y que si no puede "
            "venir avise por acá."
        )
    else:
        mensaje = (
            "Quedó PENDIENTE: la política del negocio es que confirma una persona del "
            "negocio. Decile que ya lo pasaste y que le confirman en un rato. NO se lo "
            "des por confirmado."
        )

    return {
        "ok": True,
        "ejecutado": True,
        "compromiso_id": compromiso_id,
        "tipo": tipo,
        "estado": estado,
        "cliente": resumen["cliente_nombre"],
        "cobertura": cobertura_nombre,
        "entrega": borrador.entrega,
        "direccion": borrador.direccion,
        "total": str(total),
        "total_texto": plata(total),
        "cuando": cuando or None,
        "recurso": recurso_asignado,
        "aviso": mensaje,
        **({"aviso_cobertura": aviso_cobertura} if aviso_cobertura else {}),
        **({"aviso_precio": aviso_precio} if aviso_precio else {}),
    }


@mcp.tool()
@traduce_errores
async def cancelar(compromiso_id: str, motivo: str, confirmado: bool = False) -> dict[str, Any]:
    """Cancela un turno ya agendado y libera el hueco para otro cliente.

    ESCRITURA. Llamala primero SIN `confirmado`: te devuelve qué se va a cancelar para que
    el cliente confirme que es ese. Recién con su OK, repetí con `confirmado=true`.

    `motivo` es lo que dijo el cliente, en una línea.

    Si el core rechaza la transición, el turno ya no está en un estado cancelable: no
    insistas, decile que se comunique con el negocio. Después de cancelar, ofrecele
    buscar otro turno.
    """
    datos = await core().compromiso(compromiso_id)

    # Dueño del compromiso: sólo el cliente que lo pidió puede cancelarlo. Sin
    # esto, un cliente con un UUID ajeno cancela el turno de otro del mismo
    # negocio y dispara la oferta a la lista de espera (H9). Se resuelve la ficha
    # por CLIENTE_TELEFONO —igual que `confirmar`— y se compara contra el dueño.
    telefono = _telefono()
    cliente = await _cliente() or (
        await core().cliente_por_telefono(telefono) if telefono else None
    )
    cliente_id = str(cliente.get("id")) if cliente else None
    if not cliente_id or str(datos.get("cliente_id") or "") != cliente_id:
        return {
            "ok": False,
            "codigo": "no_es_tuyo",
            "error": "Ese turno no figura a nombre de este cliente, así que no lo puedo "
            "cancelar desde acá. Si cree que hay un error, que se comunique con el negocio. "
            "NO intentes con otro número ni con otro código.",
        }

    if not confirmado:
        cuando = await _humanizar(str(datos.get("inicio") or "")) if datos.get("inicio") else None
        return {
            "ok": True,
            "ejecutado": False,
            "compromiso_id": compromiso_id,
            "estado_actual": datos.get("estado"),
            "cuando": cuando,
            "motivo": motivo,
            "aviso": "Todavía NO se canceló. Confirmá con el cliente que es este turno y "
            "repetí con confirmado=true.",
        }

    datos = await core().transicionar(compromiso_id, "cancelado")
    return {
        "ok": True,
        "ejecutado": True,
        "compromiso_id": compromiso_id,
        "estado": datos.get("estado", "cancelado"),
        "motivo": motivo,
        "aviso": "Turno cancelado y hueco liberado. Agradecele el aviso (libera el lugar "
        "para otro cliente) y ofrecele buscar otro turno.",
    }


@mcp.tool()
@traduce_errores
async def dejar_consulta(pregunta: str) -> dict[str, Any]:
    """Registra una pregunta que NO podés verificar con ninguna otra tool, para que el
    local la responda. Es la alternativa a inventar: si no lo sabés, lo dejás asentado.

    Usala cuando el cliente pregunta algo que NO está en el catálogo (`ver_catalogo`,
    incluida la `descripcion` de cada plato) ni en los datos del local
    (`datos_del_negocio`, incluido `info`: dirección, horarios, teléfono): promos que no
    ves, si tienen estacionamiento, si un plato es apto celíaco, si hacen factura A, etc.
    NO la uses para lo que sí podés chequear con una tool — para eso está la tool.

    Registra la consulta a nombre del cliente que escribió (lo resuelvo por su teléfono,
    no es argumento) y queda pendiente en el panel del local. Después de llamarla, decile
    al cliente que le pasaste la pregunta al local y que en un rato le responden — sin
    prometer un dato que todavía no tenés.

    - `pregunta`: lo que preguntó el cliente, en sus palabras, en una línea.
    """
    pregunta = (pregunta or "").strip()
    if not pregunta:
        return {
            "ok": False,
            "codigo": "sin_pregunta",
            "error": "No hay ninguna pregunta para dejar. Registrá lo que preguntó el "
            "cliente, textual y en una línea.",
        }

    # Cliente resuelto por CLIENTE_TELEFONO, igual que `confirmar`/`cancelar`. Puede no
    # tener ficha todavía (core no respondió, o cliente nuevo sin registrar): la consulta
    # se deja igual con cliente_id vacío, no perdemos la pregunta por eso.
    telefono = _telefono()
    cliente = await _cliente() or (
        await core().cliente_por_telefono(telefono) if telefono else None
    )
    cliente_id = str(cliente.get("id")) if cliente else None

    consulta = await core().crear_consulta(pregunta, cliente_id=cliente_id)
    return {
        "ok": True,
        "registrada": True,
        "consulta_id": consulta.get("id"),
        "pregunta": pregunta,
        "aviso": "Consulta registrada para el local. Decile al cliente que le pasaste la "
        "pregunta y que en un rato le responden. NO inventes la respuesta ni prometas un "
        "dato que todavía no tenés.",
    }


if __name__ == "__main__":
    sesion().telefono = _telefono()
    mcp.run()
