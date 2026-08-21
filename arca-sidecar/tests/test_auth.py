"""
El sidecar es interno: sin el token compartido no se factura.
"""

import main
from conftest import request_valido


def test_sin_header_no_se_factura(client, arca):
    r = client.post("/facturar", json=request_valido())
    assert r.status_code == 401
    assert arca.facturas_creadas == []


def test_sin_token_configurado_no_se_factura(client, arca, monkeypatch):
    """
    H10: si INTERNAL_API_TOKEN no está configurado, /facturar responde 503 y no
    emite nada — ni con un header. La auth NO depende de ARCA_MODO_DEFAULT.
    """
    monkeypatch.setattr(main, "INTERNAL_API_TOKEN", "")
    r = client.post(
        "/facturar",
        json=request_valido(),
        headers={"X-Internal-Token": "lo-que-sea"},
    )
    assert r.status_code == 503
    assert "INTERNAL_API_TOKEN" in r.json()["detail"]
    assert arca.facturas_creadas == []


def test_sin_token_configurado_health_sigue_ok(client, monkeypatch):
    """/health nunca pide token, tampoco cuando el token falta."""
    monkeypatch.setattr(main, "INTERNAL_API_TOKEN", "")
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


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
