"""El precio que el agente cotiza tiene que ser el que el core congela (H4).

Antes de esto el agente leía `precio_base` mientras el motor congelaba el precio
de la cobertura del cliente: el cliente cerraba el pedido con un número y en la
caja le aparecía otro.
"""

from __future__ import annotations

import copy

import httpx
import respx
from conftest import BASE, CATALOGO, NEGOCIO, TELEFONO

import server
from server import LineaPedida

CLIENTE_CON_CLUB = {
    "id": "cli-1",
    "telefono": TELEFONO,
    "nombre": "Juani",
    "cobertura_id": "cob-oro",
}

CLIENTE_SIN_CLUB = {"id": "cli-2", "telefono": TELEFONO, "nombre": "Juani", "cobertura_id": None}

# El mismo catálogo, pero como lo devuelve el core cuando se le pasa la
# cobertura: el Corte del Club Oro sale 9.000 en vez de 12.000.
CATALOGO_CLUB_ORO = copy.deepcopy(CATALOGO)
CATALOGO_CLUB_ORO[0]["precio_efectivo"] = "9000.00"


def _negocio(respx_mock):
    respx_mock.get("/api/negocio").mock(return_value=httpx.Response(200, json=NEGOCIO))
    respx_mock.get("/api/coberturas").mock(return_value=httpx.Response(200, json=[]))


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_el_catalogo_se_pide_con_la_cobertura_del_cliente(respx_mock, core):
    _negocio(respx_mock)
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE_CON_CLUB)
    )
    ruta = respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=CATALOGO_CLUB_ORO)
    )

    await server.datos_del_negocio()  # trae la ficha, como en toda conversación
    await server.ver_catalogo()

    pedidos = [r.url.params.get("cobertura_id") for r in (c.request for c in ruta.calls)]
    assert "cob-oro" in pedidos, f"el catálogo se pidió sin la cobertura: {pedidos}"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_cada_lectura_fresca_va_con_la_cobertura(respx_mock, core):
    # El catálogo dejó de cachearse (el stock es volátil y una carta guardada
    # ofrece el último plato después de vendido). La garantía que el cache
    # protegía tiene que seguir en pie sin él: TODAS las lecturas —no sólo la
    # primera— viajan con la cobertura del cliente, así el precio que se cotiza
    # es el que el core va a congelar (H4).
    _negocio(respx_mock)
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE_CON_CLUB)
    )
    ruta = respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=CATALOGO_CLUB_ORO)
    )

    await server.datos_del_negocio()
    primera = await server.ver_catalogo()
    segunda = await server.ver_catalogo()

    coberturas = [c.request.url.params.get("cobertura_id") for c in ruta.calls]
    assert len(coberturas) >= 2, "la segunda lectura salió de un cache de sesión"
    assert all(c == "cob-oro" for c in coberturas), f"alguna lectura fue sin cobertura: {coberturas}"
    for carta in (primera, segunda):
        corte = next(s for s in carta["servicios"] if s["nombre"] == "Corte")
        assert corte["precio"] == "9000.00"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_cotiza_el_precio_de_la_cobertura_no_el_de_lista(respx_mock, core):
    _negocio(respx_mock)
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE_CON_CLUB)
    )
    respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=CATALOGO_CLUB_ORO)
    )

    await server.datos_del_negocio()
    carta = await server.ver_catalogo()
    corte = next(s for s in carta["servicios"] if s["nombre"] == "Corte")
    assert corte["precio"] == "9000.00", "cotizó el precio de lista, no el del club"

    pedido = await server.armar_compromiso([LineaPedida(servicio="Corte")])
    assert pedido["total"] == "9000.00", f"el borrador no usó el precio del club: {pedido}"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_sin_cobertura_cotiza_el_precio_de_lista(respx_mock, core):
    _negocio(respx_mock)
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE_SIN_CLUB)
    )
    ruta = respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=CATALOGO)
    )

    await server.datos_del_negocio()
    carta = await server.ver_catalogo()

    corte = next(s for s in carta["servicios"] if s["nombre"] == "Corte")
    assert corte["precio"] == "12000.00"
    pedidos = [r.url.params.get("cobertura_id") for r in (c.request for c in ruta.calls)]
    assert all(p is None for p in pedidos), f"se mandó cobertura sin tenerla: {pedidos}"
