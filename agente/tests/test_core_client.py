"""El core contestando cosas feas: lo que importa es qué le llega al modelo."""

from __future__ import annotations

import httpx
import pytest
import respx
from conftest import BASE, CATALOGO, NEGOCIO

from core_client import ErrorDelCore


@respx.mock(base_url=BASE)
async def test_servicios_manda_token_y_solo_disponibles(respx_mock, core):
    ruta = respx_mock.get("/api/servicios").mock(
        return_value=httpx.Response(200, json=CATALOGO)
    )
    servicios = await core.servicios()

    assert len(servicios) == 4
    pedido = ruta.calls[0].request
    assert pedido.headers["authorization"] == "Bearer cop_tokendeprueba"
    assert pedido.url.params["solo_disponibles"] == "true"


@respx.mock(base_url=BASE)
async def test_negocio_devuelve_config(respx_mock, core):
    respx_mock.get("/api/negocio").mock(return_value=httpx.Response(200, json=NEGOCIO))
    datos = await core.negocio()
    assert datos["config"]["confirmacion"]["turno"] == "automatica"


@respx.mock(base_url=BASE)
async def test_hold_solapado_le_dice_al_modelo_que_ofrezca_otro(respx_mock, core):
    respx_mock.post("/api/holds").mock(
        return_value=httpx.Response(409, json={"detail": "el hueco se solapa"})
    )
    with pytest.raises(ErrorDelCore) as e:
        await core.crear_hold("rec-coty", "2026-08-21T11:30:00-03:00", "2026-08-21T12:15:00-03:00", "549")

    assert e.value.codigo == "ocupado"
    assert "se acaba de ocupar" in e.value.mensaje
    assert "ofrecele otro horario" in e.value.mensaje.lower()


@respx.mock(base_url=BASE)
async def test_transicion_invalida_no_se_confunde_con_hueco_ocupado(respx_mock, core):
    respx_mock.patch("/api/compromisos/c-1/estado").mock(
        return_value=httpx.Response(409, json={"detail": "transicion invalida"})
    )
    with pytest.raises(ErrorDelCore) as e:
        await core.transicionar("c-1", "completado")

    assert e.value.codigo == "transicion_invalida"
    assert "hueco" not in e.value.mensaje


@respx.mock(base_url=BASE)
async def test_422_sin_duracion_explica_que_no_se_inventa_horario(respx_mock, core):
    respx_mock.post("/api/disponibilidad/consultar").mock(
        return_value=httpx.Response(
            422, json={"detail": "el servicio no tiene duracion_min cargada"}
        )
    )
    with pytest.raises(ErrorDelCore) as e:
        await core.consultar_disponibilidad("sv-x")

    assert e.value.codigo == "sin_duracion"
    assert "NO inventes" in e.value.mensaje


@respx.mock(base_url=BASE)
async def test_422_generico_es_servicio_no_disponible(respx_mock, core):
    respx_mock.post("/api/disponibilidad/consultar").mock(
        return_value=httpx.Response(422, json={"detail": "servicio no disponible"})
    )
    with pytest.raises(ErrorDelCore) as e:
        await core.consultar_disponibilidad("sv-x")

    assert e.value.codigo == "no_disponible"


@respx.mock(base_url=BASE)
async def test_cliente_nuevo_no_es_error(respx_mock, core):
    respx_mock.get("/api/clientes/por-telefono/549261").mock(
        return_value=httpx.Response(404, json={"detail": "no encontrado"})
    )
    assert await core.cliente_por_telefono("549261") is None


@respx.mock(base_url=BASE)
async def test_token_invalido_es_problema_de_configuracion(respx_mock, core):
    respx_mock.get("/api/negocio").mock(
        return_value=httpx.Response(401, json={"detail": "token invalido"})
    )
    with pytest.raises(ErrorDelCore) as e:
        await core.negocio()

    assert e.value.codigo == "auth"
    assert "no reintentes" in e.value.mensaje


@respx.mock(base_url=BASE)
async def test_core_caido_no_habilita_inventar(respx_mock, core):
    respx_mock.get("/api/servicios").mock(return_value=httpx.Response(503, text="bad gateway"))
    with pytest.raises(ErrorDelCore) as e:
        await core.servicios()

    assert e.value.codigo == "core_caido"
    assert "No inventes" in e.value.mensaje


@respx.mock(base_url=BASE)
async def test_timeout_no_da_la_operacion_por_hecha(respx_mock, core):
    respx_mock.post("/api/compromisos").mock(side_effect=httpx.ReadTimeout("tardó"))
    with pytest.raises(ErrorDelCore) as e:
        await core.crear_compromiso({"cliente_id": "cli-1"})

    assert e.value.codigo == "timeout"
    assert "NO des la operación por hecha" in e.value.mensaje


@respx.mock(base_url=BASE)
async def test_liberar_hold_tolera_204_sin_cuerpo(respx_mock, core):
    ruta = respx_mock.delete("/api/holds/h-1").mock(return_value=httpx.Response(204))
    assert await core.liberar_hold("h-1", "549261") is None
    assert ruta.calls[0].request.url.params["sesion"] == "549261"


@respx.mock(base_url=BASE)
async def test_error_de_validacion_incluye_los_campos(respx_mock, core):
    respx_mock.post("/api/clientes").mock(
        return_value=httpx.Response(
            400, json={"detail": "Error de validacion", "fields": {"telefono": "requerido"}}
        )
    )
    with pytest.raises(ErrorDelCore) as e:
        await core.crear_cliente("")

    assert e.value.codigo == "pedido_invalido"
    assert "telefono" in e.value.detalle
