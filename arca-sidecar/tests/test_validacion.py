"""
Lo que entra mal tiene que salir 422 con un mensaje que se entienda,
y sin arrastrar credenciales en la respuesta.
"""

from conftest import CERT_PEM, KEY_PEM, request_valido


def _campos(body):
    return {d["campo"] for d in body["detalles"]}


def test_cert_pem_malformado_es_422_con_mensaje_claro(client, headers, arca):
    r = client.post(
        "/facturar",
        json=request_valido(cert_pem="esto no es un certificado"),
        headers=headers,
    )

    assert r.status_code == 422
    body = r.json()
    assert body["ok"] is False
    assert "cert_pem" in _campos(body)
    assert "certificado PEM" in body["error"]
    assert arca.facturas_creadas == []


def test_key_pem_malformada_es_422(client, headers):
    r = client.post("/facturar", json=request_valido(key_pem="-----BEGIN NADA-----"), headers=headers)
    assert r.status_code == 422
    assert "key_pem" in _campos(r.json())


def test_key_cifrada_con_passphrase_se_rechaza_explicando(client, headers):
    key = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----\n"
    r = client.post("/facturar", json=request_valido(key_pem=key), headers=headers)
    assert r.status_code == 422
    assert "passphrase" in r.json()["error"]


def test_la_respuesta_de_error_nunca_filtra_el_pem(client, headers):
    """
    El handler por defecto de FastAPI devuelve el input rechazado. Con un PEM
    adentro eso sería una fuga de credenciales en el log del que llame.
    """
    r = client.post(
        "/facturar",
        json=request_valido(punto_venta=0),  # falla otro campo, el body igual trae los PEM
        headers=headers,
    )
    assert r.status_code == 422
    crudo = r.text
    assert "BEGIN CERTIFICATE" not in crudo
    assert "BEGIN PRIVATE KEY" not in crudo
    assert CERT_PEM.strip().splitlines()[1] not in crudo
    assert KEY_PEM.strip().splitlines()[1] not in crudo


def test_concepto_servicios_sin_fechas_de_servicio_es_422(client, headers):
    body = request_valido()
    del body["servicio_desde"]
    del body["servicio_hasta"]

    r = client.post("/facturar", json=body, headers=headers)
    assert r.status_code == 422
    assert "servicio_desde" in r.json()["error"]


def test_periodo_de_servicio_al_reves_es_422(client, headers):
    r = client.post(
        "/facturar",
        json=request_valido(servicio_desde="2026-08-20", servicio_hasta="2026-08-01"),
        headers=headers,
    )
    assert r.status_code == 422
    assert "anterior" in r.json()["error"]


def test_cuit_emisor_invalido_es_422(client, headers):
    r = client.post("/facturar", json=request_valido(cuit_emisor="20442477061"), headers=headers)
    assert r.status_code == 422
    assert "cuit_emisor" in _campos(r.json())


def test_importe_cero_es_422(client, headers):
    r = client.post("/facturar", json=request_valido(importe_total="0"), headers=headers)
    assert r.status_code == 422
    assert "importe_total" in _campos(r.json())


def test_acepta_fechas_en_formato_arca_yyyymmdd(client, headers, arca):
    r = client.post(
        "/facturar",
        json=request_valido(fecha="20260818", servicio_desde="20260818", servicio_hasta="20260818"),
        headers=headers,
    )
    assert r.status_code == 200
    assert arca.facturas_creadas[0]["fecha_cbte"] == "20260818"


def test_modo_produccion_apunta_a_las_urls_productivas(client, headers):
    import tenant_pool

    r = client.post("/facturar", json=request_valido(modo="produccion"), headers=headers)
    assert r.status_code == 200

    cliente = next(iter(tenant_pool._clientes.values()))
    assert cliente.homologacion is False
    assert "wsaa.afip.gov.ar" in cliente.wsaa_url
    assert "servicios1.afip.gov.ar" in cliente.wsfev1_url


def test_modo_desconocido_es_422(client, headers):
    r = client.post("/facturar", json=request_valido(modo="testing"), headers=headers)
    assert r.status_code == 422
    assert "modo" in _campos(r.json())


def test_el_mensaje_de_422_no_arrastra_ruido_de_pydantic(client, headers):
    r = client.post("/facturar", json=request_valido(cert_pem="nada"), headers=headers)
    assert "Value error" not in r.text
