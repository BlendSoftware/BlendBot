"""El flujo del turno completo, con el core mockeado: catálogo → huecos → hold →
resumen (confirmado=False) → escritura (confirmado=True)."""

from __future__ import annotations

import copy

import httpx
import respx
from conftest import BASE, CATALOGO, HUECOS, NEGOCIO, TELEFONO

import server
from server import LineaPedida

HUECO = HUECOS["huecos"][0]

CLIENTE = {"id": "cli-1", "telefono": TELEFONO, "nombre": "Juani Sarmiento", "cobertura_id": "cob-osep"}

COMPROMISO = {
    "id": "com-1",
    "estado": "pendiente",
    "tipo": "turno",
    "total": "25000.00",
    "inicio": HUECO["inicio"],
    "fin": HUECO["fin"],
}


def _base(respx_mock, *, politica="automatica"):
    """Lo que siempre está: negocio, catálogo, disponibilidad y hold."""
    negocio = copy.deepcopy(NEGOCIO)
    negocio["config"]["confirmacion"]["turno"] = politica
    respx_mock.get("/api/negocio").mock(return_value=httpx.Response(200, json=negocio))
    respx_mock.get("/api/servicios").mock(return_value=httpx.Response(200, json=CATALOGO))
    respx_mock.post("/api/disponibilidad/consultar").mock(
        return_value=httpx.Response(200, json=HUECOS)
    )
    respx_mock.post("/api/holds").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "h-1",
                "recurso_id": HUECO["recurso_id"],
                "inicio": HUECO["inicio"],
                "fin": HUECO["fin"],
                "expira_en": "2026-08-19T20:10:00-03:00",
            },
        )
    )


async def _hasta_el_hold():
    await server.consultar_disponibilidad("arreglo")
    await server.armar_compromiso([LineaPedida(servicio="arreglo")])
    return await server.bloquear("Dra. Gómez", HUECO["inicio"], HUECO["fin"])


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_catalogo_solo_lista_lo_disponible(respx_mock, core):
    _base(respx_mock)
    r = await server.ver_catalogo()

    assert r["ok"]
    assert [s["nombre"] for s in r["servicios"]][0] == "Consulta"
    assert r["servicios"][3]["precio_texto"] == "$25.000"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_disponibilidad_traduce_a_dia_y_hora_del_negocio(respx_mock, core):
    _base(respx_mock)
    r = await server.consultar_disponibilidad("arreglo")

    assert r["ok"] and len(r["huecos"]) == 2
    assert r["huecos"][0]["hora"] == "11:30"
    assert r["huecos"][0]["dia"] == "viernes"
    assert r["duracion_min"] == 45


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_practica_que_no_existe_no_se_inventa(respx_mock, core):
    _base(respx_mock)
    r = await server.consultar_disponibilidad("ortodoncia invisible")

    assert r["ok"] is False
    assert r["codigo"] == "no_encontrado"
    assert "NO lo inventes" in r["error"]


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_armar_compromiso_no_persiste_y_calcula_el_total(respx_mock, core):
    _base(respx_mock)
    escritura = respx_mock.post("/api/compromisos")

    r = await server.armar_compromiso(
        [LineaPedida(servicio="limpiesa"), LineaPedida(servicio="arreglo")]
    )

    assert r["ok"] and r["persistido"] is False
    assert r["total"] == "43000.00"
    assert r["total_texto"] == "$43.000"
    assert r["duracion_min"] == 75
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_confirmar_sin_hueco_bloqueado_no_escribe(respx_mock, core):
    _base(respx_mock)
    escritura = respx_mock.post("/api/compromisos")
    await server.armar_compromiso([LineaPedida(servicio="arreglo")])

    r = await server.confirmar(nombre="Juani", confirmado=True)

    assert r["ok"] is False and r["codigo"] == "sin_hueco"
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_confirmado_false_devuelve_resumen_y_no_escribe(respx_mock, core):
    _base(respx_mock)
    escritura = respx_mock.post("/api/compromisos")
    await _hasta_el_hold()

    r = await server.confirmar(nombre="Juani Sarmiento", cobertura="osep")

    assert r["ok"] and r["ejecutado"] is False
    assert r["resumen"]["cobertura"] == "OSEP"
    assert r["resumen"]["cuando"]["hora"] == "11:30"
    assert r["resumen"]["total_texto"] == "$25.000"
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_confirmado_true_crea_cliente_compromiso_y_confirma(respx_mock, core):
    _base(respx_mock, politica="automatica")
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(404, json={"detail": "no encontrado"})
    )
    alta = respx_mock.post("/api/clientes").mock(
        return_value=httpx.Response(201, json=CLIENTE)
    )
    creacion = respx_mock.post("/api/compromisos").mock(
        return_value=httpx.Response(201, json=COMPROMISO)
    )
    transicion = respx_mock.patch("/api/compromisos/com-1/estado").mock(
        return_value=httpx.Response(200, json={**COMPROMISO, "estado": "confirmado"})
    )

    await _hasta_el_hold()
    await server.confirmar(nombre="Juani Sarmiento", cobertura="osep")
    r = await server.confirmar(nombre="Juani Sarmiento", cobertura="osep", confirmado=True)

    assert r["ok"] and r["ejecutado"] and r["estado"] == "confirmado"
    assert r["profesional"] == "Dra. Gómez"
    assert "CONFIRMADO" in r["aviso"]

    cuerpo_alta = alta.calls[0].request.read().decode()
    assert TELEFONO in cuerpo_alta and "cob-osep" in cuerpo_alta

    import json

    cuerpo = json.loads(creacion.calls[0].request.read())
    assert cuerpo["tipo"] == "turno" and cuerpo["origen"] == "whatsapp"
    # el hold propio no puede bloquear al compromiso que lo consume
    assert cuerpo["sesion"] == TELEFONO
    assert cuerpo["recurso_id"] == HUECO["recurso_id"]
    assert cuerpo["inicio"] == HUECO["inicio"]
    assert cuerpo["lineas"] == [{"servicio_id": "sv-arreglo", "cantidad": 1}]
    assert "negocio_id" not in cuerpo and "telefono" not in cuerpo
    assert transicion.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_politica_humana_deja_el_turno_pendiente(respx_mock, core):
    _base(respx_mock, politica="humana")
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(200, json=CLIENTE)
    )
    respx_mock.post("/api/compromisos").mock(return_value=httpx.Response(201, json=COMPROMISO))
    transicion = respx_mock.patch("/api/compromisos/com-1/estado")

    await _hasta_el_hold()
    r = await server.confirmar(nombre="Juani Sarmiento", confirmado=True)

    assert r["estado"] == "pendiente"
    assert "PENDIENTE" in r["aviso"]
    assert not transicion.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_hueco_ocupado_al_bloquear_pide_ofrecer_otro(respx_mock, core):
    _base(respx_mock)
    respx_mock.post("/api/holds").mock(
        return_value=httpx.Response(409, json={"detail": "solapado"})
    )

    await server.consultar_disponibilidad("arreglo")
    r = await server.bloquear("Dra. Gómez", HUECO["inicio"], HUECO["fin"])

    assert r["ok"] is False and r["codigo"] == "ocupado"
    assert "otro horario" in r["error"]


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_cobertura_que_el_negocio_no_atiende_se_pregunta(respx_mock, core):
    _base(respx_mock)
    escritura = respx_mock.post("/api/compromisos")
    await _hasta_el_hold()

    r = await server.confirmar(nombre="Juani", cobertura="Swiss Medical", confirmado=True)

    assert r["ok"] is False
    assert "OSEP" in r["opciones"]
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_confirmar_sin_nombre_no_escribe(respx_mock, core):
    _base(respx_mock)
    escritura = respx_mock.post("/api/compromisos")
    await _hasta_el_hold()

    r = await server.confirmar(confirmado=True)

    assert r["ok"] is False and r["codigo"] == "falta_nombre"
    assert not escritura.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_cancelar_en_dos_pasos(respx_mock, core):
    _base(respx_mock)
    respx_mock.get("/api/compromisos/com-1").mock(
        return_value=httpx.Response(200, json={**COMPROMISO, "estado": "confirmado"})
    )
    patch = respx_mock.patch("/api/compromisos/com-1/estado").mock(
        return_value=httpx.Response(200, json={**COMPROMISO, "estado": "cancelado"})
    )

    previo = await server.cancelar("com-1", "no puedo ir")
    assert previo["ejecutado"] is False and previo["estado_actual"] == "confirmado"
    assert not patch.called

    hecho = await server.cancelar("com-1", "no puedo ir", confirmado=True)
    assert hecho["ejecutado"] and hecho["estado"] == "cancelado"
    assert patch.called


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_cambiar_de_horario_libera_el_hold_anterior(respx_mock, core):
    _base(respx_mock)
    liberacion = respx_mock.delete("/api/holds/h-1").mock(return_value=httpx.Response(204))

    await _hasta_el_hold()
    otro = HUECOS["huecos"][1]
    r = await server.bloquear("Dra. Gómez", otro["inicio"], otro["fin"])

    assert r["ok"] and liberacion.called
