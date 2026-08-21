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

# Lo que devuelve /api/servicios ya viene filtrado por `solo_disponibles=true`:
# la "Veggie" se acabó (disponible=false), así que NO está en esta lista. La
# comida no lleva `duracion_min` (no ocupa agenda).
MENU = [
    {"id": "sv-doble", "nombre": "Doble cheddar", "precio_base": "8900.00", "disponible": True},
    {"id": "sv-papas", "nombre": "Papas", "precio_base": "4500.00", "disponible": True},
    {"id": "sv-gaseosa", "nombre": "Gaseosa 500ml", "precio_base": "2500.00", "disponible": True},
]

CLIENTE = {"id": "cli-9", "telefono": TELEFONO, "nombre": "Juani"}

PEDIDO = {"id": "ped-1", "estado": "pendiente", "tipo": "pedido", "total": "13400.00"}


def _base(respx_mock):
    """Lo que siempre está: negocio de gastronomía y su carta."""
    respx_mock.get("/api/negocio").mock(
        return_value=httpx.Response(200, json=copy.deepcopy(GASTRO_NEGOCIO))
    )
    respx_mock.get("/api/servicios").mock(return_value=httpx.Response(200, json=MENU))
    # un local de comida no tiene coberturas: el fallback pega al endpoint
    respx_mock.get("/api/coberturas").mock(return_value=httpx.Response(200, json=[]))


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
async def test_la_carta_no_ofrece_lo_que_se_acabo(respx_mock, core):
    _base(respx_mock)
    r = await server.ver_catalogo()

    nombres = [s["nombre"] for s in r["servicios"]]
    assert nombres == ["Doble cheddar", "Papas", "Gaseosa 500ml"]
    assert "Veggie" not in nombres
    assert r["servicios"][0]["precio_texto"] == "$8.900"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_pedir_lo_que_se_acabo_no_se_inventa(respx_mock, core):
    _base(respx_mock)
    # la Veggie se acabó: no está en la carta, así que el agente no la puede armar
    r = await server.armar_compromiso([LineaPedida(servicio="veggie")])

    assert r["ok"] is False and r["codigo"] == "no_encontrado"
    assert "NO lo inventes" in r["error"]


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
