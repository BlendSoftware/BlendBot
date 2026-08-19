"""
El sidecar es interno: sin el token compartido no se factura.
"""

from conftest import request_valido


def test_sin_header_no_se_factura(client, arca):
    r = client.post("/facturar", json=request_valido())
    assert r.status_code == 401
    assert arca.facturas_creadas == []


def test_token_equivocado_no_se_factura(client, arca):
    r = client.post("/facturar", json=request_valido(), headers={"X-Internal-Token": "otro"})
    assert r.status_code == 401
    assert arca.facturas_creadas == []


def test_health_no_pide_token(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["service"] == "arca-sidecar"


def test_health_no_habla_con_arca(client, arca):
    client.get("/health")
    assert arca.autenticaciones == 0
    assert arca.conexiones == 0
