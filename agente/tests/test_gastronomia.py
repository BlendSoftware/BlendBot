"""El flujo del pedido de gastronomía, con el core mockeado.

Diferencias con un compromiso con agenda (turno): el pedido tiene varios ítems, hay
entrega (retira/delivery/en_local), no ocupa agenda (no hay hold) y —lo central— la
política es "humana": el agente arma el pedido y queda PENDIENTE; lo confirma el
local desde el panel.
"""

from __future__ import annotations

import copy
import json

import httpx
import respx
from conftest import BASE, TELEFONO

import server
from server import LineaPedida

# ── fixtures de datos, propias del vertical ───────────────────────────────────

GASTRO_NEGOCIO = {
    "id": "neg-burger",
    "nombre": "Burger House",
    "vertical": "gastronomia",
    "timezone": "America/Argentina/Mendoza",
    "config": {
        "confirmacion": {"pedido": "humana", "reserva": "humana"},
        "acepta_delivery": True,
        "radio_delivery_km": 3,
        "demoras_sugeridas": [15, 25, 40],
    },
    # un local de comida no tiene coberturas
    "coberturas": [],
}

# Lo que devuelve /api/servicios con `solo_disponibles=true`. Ese filtro es el
# INTERRUPTOR MANUAL del dueño y nada más: la "Veggie" la apagaron en el panel
# (`disponible=false`), así que el core no la manda y para el agente no existe.
# Lo que se agotó hoy es otra cosa y SÍ llega, marcado — ver MENU_CON_STOCK. La
# comida no lleva `duracion_min` (no ocupa agenda).
MENU = [
    {"id": "sv-doble", "nombre": "Doble cheddar", "precio_base": "8900.00", "disponible": True},
    {"id": "sv-papas", "nombre": "Papas", "precio_base": "4500.00", "disponible": True},
    {"id": "sv-gaseosa", "nombre": "Gaseosa 500ml", "precio_base": "2500.00", "disponible": True},
]

# La misma carta un rato después, con el cupo del día resuelto por el core. Las
# cuatro situaciones que el agente tiene que saber distinguir:
#   · Doble cheddar → se terminó HOY (`agotado`), y viene igual porque el
#     cliente merece oír "se nos terminó" y no "no lo tenemos";
#   · Papas         → quedan pocas (2): ahí sí se puede decir cuántas;
#   · Gaseosa       → `restante: null`, no lleva cuenta: no se sabe cuántas hay;
#   · Simple        → stock holgado (40): el número no es información, es ruido.
MENU_CON_STOCK = [
    {
        "id": "sv-doble",
        "nombre": "Doble cheddar",
        "precio_base": "8900.00",
        "disponible": True,
        "restante": 0,
        "agotado": True,
    },
    {
        "id": "sv-papas",
        "nombre": "Papas",
        "precio_base": "4500.00",
        "disponible": True,
        "restante": 2,
        "agotado": False,
    },
    {
        "id": "sv-gaseosa",
        "nombre": "Gaseosa 500ml",
        "precio_base": "2500.00",
        "disponible": True,
        "restante": None,
        "agotado": False,
    },
    {
        "id": "sv-simple",
        "nombre": "Simple",
        "precio_base": "6900.00",
        "disponible": True,
        "restante": 40,
        "agotado": False,
    },
]

# La noche que se vendió todo: no queda NADA para vender, pero el negocio sí
# tiene carta. Son dos frases distintas y el agente no puede confundirlas.
MENU_TODO_AGOTADO = [
    {**s, "restante": 0, "agotado": True} for s in MENU_CON_STOCK if s["nombre"] != "Simple"
]

CLIENTE = {"id": "cli-9", "telefono": TELEFONO, "nombre": "Juani"}

PEDIDO = {"id": "ped-1", "estado": "pendiente", "tipo": "pedido", "total": "13400.00"}

# La carta con la descripción cargada (lo que lleva cada plato). El core la trae en
# `GET /api/servicios`; el agente la usa para responder "¿qué tiene la Doble bacon?".
MENU_CON_DESCRIPCION = [
    {
        "id": "sv-doble",
        "nombre": "Doble bacon",
        "precio_base": "9500.00",
        "disponible": True,
        "descripcion": "Doble medallón, cheddar, panceta y salsa de la casa",
    },
    # sin descripción cargada: el agente NO la puede inventar
    {"id": "sv-papas", "nombre": "Papas", "precio_base": "4500.00", "disponible": True},
]


def _carta(respx_mock, menu):
    """El negocio de siempre con la carta que pida el test. Devuelve la ruta del
    catálogo, para poder contar cuántas veces se leyó."""
    respx_mock.get("/api/negocio").mock(
        return_value=httpx.Response(200, json=copy.deepcopy(GASTRO_NEGOCIO))
    )
    # un local de comida no tiene coberturas: el fallback pega al endpoint
    respx_mock.get("/api/coberturas").mock(return_value=httpx.Response(200, json=[]))
    return respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=copy.deepcopy(menu))
    )


def _base(respx_mock):
    """Lo que siempre está: negocio de gastronomía y su carta, todo con stock."""
    return _carta(respx_mock, MENU)


def _con_escritura(respx_mock):
    """Suma el alta de cliente y la creación del pedido, y devuelve el mock de POST."""
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE)
    )
    return respx_mock.post("/api/compromisos").mock(
        return_value=httpx.Response(201, json=PEDIDO)
    )


# ── tests ─────────────────────────────────────────────────────────────────────


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_datos_del_negocio_expone_politica_de_pedido_y_delivery(respx_mock, core):
    _base(respx_mock)
    # `datos_del_negocio` ahora también registra al que escribe (`_cliente()`).
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE)
    )
    r = await server.datos_del_negocio()

    assert r["ok"] and r["vertical"] == "gastronomia"
    assert r["confirmacion_pedido"] == "humana"
    assert r["acepta_delivery"] is True


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_la_carta_no_ofrece_lo_que_apagaron_en_el_panel(respx_mock, core):
    _base(respx_mock)
    r = await server.ver_catalogo()

    nombres = [s["nombre"] for s in r["servicios"]]
    assert nombres == ["Doble cheddar", "Papas", "Gaseosa 500ml"]
    assert "Veggie" not in nombres
    assert r["servicios"][0]["precio_texto"] == "$8.900"
    # Sin nada agotado la lista ni viaja: una lista vacía en la respuesta es una
    # invitación a mencionarla, y no hay nada que mencionar.
    assert "agotados_hoy" not in r


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_pedir_lo_que_apagaron_en_el_panel_no_se_inventa(respx_mock, core):
    _base(respx_mock)
    # La Veggie la apagaron en el panel: el core no la manda ni marcada, así que
    # el agente no la puede armar y responde el "no" del plato que no tienen.
    r = await server.armar_compromiso([LineaPedida(servicio="veggie")])

    assert r["ok"] is False and r["codigo"] == "no_encontrado"
    assert "NO lo inventes" in r["error"]


# ── El stock del día: lo agotado no se ofrece, pero se puede nombrar ──────────


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_la_carta_no_ofrece_un_plato_agotado(respx_mock, core):
    # El cliente pide una recomendación y la Doble cheddar se terminó: no puede
    # estar entre lo que se ofrece.
    _carta(respx_mock, MENU_CON_STOCK)
    r = await server.ver_catalogo()

    nombres = [s["nombre"] for s in r["servicios"]]
    assert "Doble cheddar" not in nombres
    assert nombres == ["Papas", "Gaseosa 500ml", "Simple"]


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_el_agotado_viaja_aparte_con_el_nombre_y_sin_precio(respx_mock, core):
    # Para poder decir "hoy se nos terminó" en vez de "no lo tenemos". Sólo el
    # nombre: con precio, `agotados_hoy` parecería una carta paralela y sería
    # cuestión de tiempo que el modelo cotice de ahí.
    _carta(respx_mock, MENU_CON_STOCK)
    r = await server.ver_catalogo()

    assert r["agotados_hoy"] == ["Doble cheddar"]
    assert all(isinstance(x, str) for x in r["agotados_hoy"])


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_carta_entera_agotada_no_deja_nada_para_vender(respx_mock, core):
    # Se vendió todo: `servicios` vacío con el aviso, y los nombres aparte. El
    # aviso NO puede decir que el negocio no tiene nada — tiene, se le terminó.
    _carta(respx_mock, MENU_TODO_AGOTADO)
    r = await server.ver_catalogo()

    assert r["ok"] and r["servicios"] == []
    assert r["agotados_hoy"] == ["Doble cheddar", "Papas", "Gaseosa 500ml"]
    assert "No queda nada para vender" in r["aviso"]
    assert "no inventes productos" in r["aviso"].lower()


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_pedir_un_plato_agotado_suena_distinto_de_uno_que_no_tienen(respx_mock, core):
    # El cliente va derecho a pedir sin pasar por `ver_catalogo`. Antes se
    # llevaba un "eso no lo tienen" que es falso y que contradice lo que el
    # mismo bot le diría un mensaje antes.
    _carta(respx_mock, MENU_CON_STOCK)
    r = await server.armar_compromiso([LineaPedida(servicio="doble cheddar")])

    assert r["ok"] is False
    assert r["codigo"] == "agotado", "un plato agotado no es un `no_encontrado`"
    assert r["agotado"] == "Doble cheddar"
    assert "se nos terminó hoy" in r["error"]
    assert "NUNCA «no lo tenemos»" in r["error"]
    # Y no promete reposición ni ofrece avisar cuando haya.
    assert "NO prometas que se repone" in r["error"]


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_con_la_carta_entera_agotada_no_arma_nada_y_no_dice_que_no_tienen(
    respx_mock, core
):
    _carta(respx_mock, MENU_TODO_AGOTADO)
    r = await server.armar_compromiso([LineaPedida(servicio="doble cheddar")])

    assert r["ok"] is False and r["codigo"] == "sin_catalogo"
    assert "No queda nada para vender ahora mismo" in r["error"]
    assert "se terminó HOY" in r["error"]
    assert "no tiene nada" not in r["error"]


# ── Avisar cuando queda poco ─────────────────────────────────────────────────


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_avisa_cuantas_quedan_cuando_queda_poco(respx_mock, core):
    _carta(respx_mock, MENU_CON_STOCK)
    r = await server.ver_catalogo()

    papas = next(s for s in r["servicios"] if s["nombre"] == "Papas")
    assert papas["restante"] == 2


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_con_stock_holgado_no_dice_cuantas_quedan(respx_mock, core):
    # `restante: 40` al modelo es ruido que invita a decir "quedan 40 hamburguesas".
    _carta(respx_mock, MENU_CON_STOCK)
    r = await server.ver_catalogo()

    simple = next(s for s in r["servicios"] if s["nombre"] == "Simple")
    assert "restante" not in simple


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_con_plato_ilimitado_no_dice_cuantas_quedan(respx_mock, core):
    # `restante: null` es "no lleva cuenta": el agente no sabe cuántas hay, y lo
    # que no sabe no lo afirma ni lo niega. Mismo criterio que `descripcion`.
    _carta(respx_mock, MENU_CON_STOCK)
    r = await server.ver_catalogo()

    gaseosa = next(s for s in r["servicios"] if s["nombre"] == "Gaseosa 500ml")
    assert "restante" not in gaseosa


# ── El stock se lee fresco ───────────────────────────────────────────────────


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_la_segunda_lectura_ve_el_stock_de_ahora(respx_mock, core):
    # El asistente listó la carta, se vendió el último Doble cheddar y el cliente
    # vuelve a preguntar. La segunda lectura NO lo puede seguir ofreciendo: el
    # catálogo no se cachea por sesión justo por esto.
    ruta = respx_mock.get("/api/servicios").mock(
        side_effect=[
            httpx.Response(200, json=copy.deepcopy(MENU)),
            httpx.Response(200, json=copy.deepcopy(MENU_CON_STOCK)),
        ]
    )
    respx_mock.get("/api/negocio").mock(
        return_value=httpx.Response(200, json=copy.deepcopy(GASTRO_NEGOCIO))
    )
    respx_mock.get("/api/coberturas").mock(return_value=httpx.Response(200, json=[]))

    primera = await server.ver_catalogo()
    assert "Doble cheddar" in [s["nombre"] for s in primera["servicios"]]

    segunda = await server.ver_catalogo()
    assert "Doble cheddar" not in [s["nombre"] for s in segunda["servicios"]]
    assert segunda["agotados_hoy"] == ["Doble cheddar"]
    assert len(ruta.calls) == 2, "la segunda lectura salió de un cache de sesión"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_arma_pedido_de_dos_items_con_total_y_no_persiste(respx_mock, core):
    _base(respx_mock)
    escritura = respx_mock.post("/api/compromisos")

    r = await server.armar_compromiso(
        [LineaPedida(servicio="doble cheddar"), LineaPedida(servicio="papas")],
        entrega="retira",
    )

    assert r["ok"] and r["persistido"] is False
    assert r["total"] == "13400.00" and r["total_texto"] == "$13.400"
    assert r["entrega"] == "retira"
    assert len(r["lineas"]) == 2
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_lo_paso_a_buscar_se_normaliza_a_retira(respx_mock, core):
    _base(respx_mock)
    r = await server.armar_compromiso(
        [LineaPedida(servicio="doble cheddar")], entrega="lo paso a buscar"
    )

    assert r["ok"] and r["entrega"] == "retira"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_pedido_confirmado_queda_pendiente_por_politica_humana(respx_mock, core):
    _base(respx_mock)
    creacion = _con_escritura(respx_mock)
    transicion = respx_mock.patch("/api/compromisos/ped-1/estado")

    await server.armar_compromiso(
        [LineaPedida(servicio="doble cheddar"), LineaPedida(servicio="papas")],
        entrega="retira",
    )
    # paso 1: resumen, sin escribir
    previo = await server.confirmar(nombre="Juani")
    assert previo["ejecutado"] is False and previo["resumen"]["tipo"] == "pedido"
    assert not creacion.called

    # paso 2: con el OK, escribe pero queda PENDIENTE (lo confirma el local)
    r = await server.confirmar(nombre="Juani", confirmado=True)

    assert r["ok"] and r["ejecutado"] and r["estado"] == "pendiente"
    assert r["tipo"] == "pedido" and "PENDIENTE" in r["aviso"]
    assert not transicion.called  # el agente NO confirma solo

    cuerpo = json.loads(creacion.calls[0].request.read())
    assert cuerpo["tipo"] == "pedido" and cuerpo["entrega"] == "retira"
    assert cuerpo["origen"] == "whatsapp"
    assert len(cuerpo["lineas"]) == 2
    # un pedido de comida no ocupa agenda: no lleva recurso ni horario
    assert "recurso_id" not in cuerpo and "inicio" not in cuerpo
    assert "negocio_id" not in cuerpo and "telefono" not in cuerpo


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_nota_de_pedido_viaja_al_core(respx_mock, core):
    # Una aclaración de todo el pedido ("tocar timbre 3B") va al campo nota del
    # compromiso, distinta de las notas por línea.
    _base(respx_mock)
    creacion = _con_escritura(respx_mock)

    await server.armar_compromiso(
        [LineaPedida(servicio="doble cheddar")],
        entrega="delivery",
        direccion="Aristóbulo del Valle 1567",
        nota="tocar timbre 3B",
    )
    r = await server.confirmar(nombre="Juani", confirmado=True)
    assert r["ok"] and r["ejecutado"]

    cuerpo = json.loads(creacion.calls[0].request.read())
    assert cuerpo["nota"] == "tocar timbre 3B"
    assert cuerpo["direccion"] == "Aristóbulo del Valle 1567"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_delivery_sin_direccion_no_confirma_y_la_pide(respx_mock, core):
    _base(respx_mock)
    escritura = _con_escritura(respx_mock)

    # al armar, ya avisa que falta la dirección (pero muestra el total igual)
    armado = await server.armar_compromiso(
        [LineaPedida(servicio="doble cheddar")], entrega="delivery"
    )
    assert armado["ok"] and armado["falta_direccion"] is True

    # y no deja confirmar un delivery sin dirección
    bloqueado = await server.confirmar(nombre="Juani", confirmado=True)
    assert bloqueado["ok"] is False and bloqueado["codigo"] == "falta_direccion"
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_delivery_con_direccion_confirma_y_la_manda_al_core(respx_mock, core):
    _base(respx_mock)
    creacion = _con_escritura(respx_mock)

    await server.armar_compromiso(
        [LineaPedida(servicio="doble cheddar")],
        entrega="delivery",
        direccion="San Martín 1234",
    )
    r = await server.confirmar(nombre="Juani", confirmado=True)

    assert r["ok"] and r["estado"] == "pendiente"
    assert r["entrega"] == "delivery" and r["direccion"] == "San Martín 1234"

    cuerpo = json.loads(creacion.calls[0].request.read())
    assert cuerpo["entrega"] == "delivery"
    assert cuerpo["direccion"] == "San Martín 1234"


# ── E12: descripción de plato, info del local y consultas ─────────────────────


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_la_carta_trae_la_descripcion_para_responder_que_lleva(respx_mock, core):
    # "¿qué tiene la Doble bacon?" se responde con la descripción cargada, no de memoria.
    respx_mock.get("/api/negocio").mock(
        return_value=httpx.Response(200, json=copy.deepcopy(GASTRO_NEGOCIO))
    )
    respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=MENU_CON_DESCRIPCION)
    )
    r = await server.ver_catalogo()

    doble = next(s for s in r["servicios"] if s["nombre"] == "Doble bacon")
    assert doble["descripcion"] == "Doble medallón, cheddar, panceta y salsa de la casa"
    # el ítem sin descripción cargada NO la trae (no se inventa)
    papas = next(s for s in r["servicios"] if s["nombre"] == "Papas")
    assert "descripcion" not in papas


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_datos_del_negocio_expone_info_del_local(respx_mock, core):
    # dirección/horarios/teléfono para responder "¿dónde quedan?" cuando están cargados.
    negocio = copy.deepcopy(GASTRO_NEGOCIO)
    negocio["info"] = {
        "direccion": "San Martín 1234",
        "horarios": "Todos los días de 20 a 00",
        "telefono": "2614445566",
    }
    respx_mock.get("/api/negocio").mock(return_value=httpx.Response(200, json=negocio))
    respx_mock.get("/api/servicios").mock(return_value=httpx.Response(200, json=MENU))
    respx_mock.get("/api/coberturas").mock(return_value=httpx.Response(200, json=[]))
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE)
    )
    r = await server.datos_del_negocio()

    assert r["ok"]
    assert r["info"]["direccion"] == "San Martín 1234"
    assert r["info"]["horarios"] == "Todos los días de 20 a 00"
    assert r["info"]["telefono"] == "2614445566"
    assert r["info"]["notas"] is None  # no cargada → vacía, no inventada


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_dejar_consulta_registra_la_pregunta_a_nombre_del_cliente(respx_mock, core):
    # Lo que el bot no puede verificar se registra en vez de inventarse.
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE)
    )
    alta = respx_mock.post("/api/consultas").mock(
        return_value=httpx.Response(
            201, json={"id": "con-1", "pregunta": "¿tienen estacionamiento?", "estado": "pendiente"}
        )
    )

    r = await server.dejar_consulta("¿tienen estacionamiento?")

    assert r["ok"] and r["registrada"] is True and r["consulta_id"] == "con-1"
    cuerpo = json.loads(alta.calls[0].request.read())
    assert cuerpo["pregunta"] == "¿tienen estacionamiento?"
    assert cuerpo["cliente_id"] == "cli-9"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_dejar_consulta_no_pierde_la_pregunta_sin_ficha_de_cliente(respx_mock, core):
    # Aunque el core no pueda dar/crear la ficha, la consulta se deja igual (sin cliente_id):
    # nunca se pierde la pregunta ni se responde inventando.
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(404, json={"detail": "sin ficha"})
    )
    respx_mock.post("/api/clientes").mock(return_value=httpx.Response(500, json={"detail": "caido"}))
    alta = respx_mock.post("/api/consultas").mock(
        return_value=httpx.Response(201, json={"id": "con-2", "estado": "pendiente"})
    )

    r = await server.dejar_consulta("¿el alfajor es sin TACC?")

    assert r["ok"] and r["registrada"] is True
    cuerpo = json.loads(alta.calls[0].request.read())
    assert cuerpo["pregunta"] == "¿el alfajor es sin TACC?"
    assert "cliente_id" not in cuerpo


async def test_dejar_consulta_vacia_no_postea_nada(core):
    # Sin pregunta no hay nada que dejar: guard, sin tocar el core.
    r = await server.dejar_consulta("   ")
    assert r["ok"] is False and r["codigo"] == "sin_pregunta"
