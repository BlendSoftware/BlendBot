"""
El camino feliz y los errores del fisco. Todo contra el pyafipws falso.
"""

from conftest import CERT_PEM, KEY_PEM, OTRO_CERT_PEM, request_valido


def test_factura_c_de_servicio_pide_cae_y_devuelve_el_contrato(client, headers, arca):
    arca.ultimo_autorizado = 41

    r = client.post("/facturar", json=request_valido(), headers=headers)

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "ok": True,
        "numero": 42,  # último autorizado + 1
        "cae": "71234567890123",
        "cae_vencimiento": "2026-09-01",  # ARCA manda YYYYMMDD, salimos en ISO
        "error": None,
    }


def test_arma_la_factura_como_manda_arca_para_factura_c_servicios(client, headers, arca):
    client.post("/facturar", json=request_valido(), headers=headers)

    assert len(arca.facturas_creadas) == 1
    f = arca.facturas_creadas[0]

    # Factura C, concepto servicios
    assert f["tipo_cbte"] == 11
    assert f["concepto"] == 2
    assert f["punto_vta"] == 3

    # Fechas de servicio obligatorias con concepto 2, en formato ARCA
    assert f["fecha_cbte"] == "20260818"
    assert f["fecha_serv_desde"] == "20260818"
    assert f["fecha_serv_hasta"] == "20260818"
    assert f["fecha_venc_pago"] == "20260818"  # default: la fecha del comprobante

    # Monotributo: el total va entero en neto, sin IVA ni exento ni tributos
    assert f["imp_total"] == 15000.00
    assert f["imp_neto"] == 15000.00
    assert f["imp_iva"] == 0.00
    assert f["imp_tot_conc"] == 0.00
    assert f["imp_op_ex"] == 0.00
    assert f["imp_trib"] == 0.00

    # Un solo comprobante
    assert f["cbt_desde"] == f["cbt_hasta"]

    # RG 5616: condición de IVA del receptor (consumidor final)
    assert arca.facturas_finales[0]["condicion_iva_receptor_id"] == 5

    # Factura C NO lleva array IVA (ARCA 10071)
    assert arca.ivas_agregados == []


def test_vencimiento_de_pago_explicito_se_respeta(client, headers, arca):
    client.post(
        "/facturar",
        json=request_valido(vencimiento_pago="2026-08-25"),
        headers=headers,
    )
    assert arca.facturas_creadas[0]["fecha_venc_pago"] == "20260825"


def test_receptor_con_dni_va_como_consumidor_final(client, headers, arca):
    client.post(
        "/facturar",
        json=request_valido(doc_tipo=96, doc_nro="30123456"),
        headers=headers,
    )
    f = arca.facturas_creadas[0]
    assert f["tipo_doc"] == 96
    assert f["nro_doc"] == "30123456"
    assert arca.facturas_finales[0]["condicion_iva_receptor_id"] == 5


def test_error_de_arca_vuelve_legible_y_sin_cae(client, headers, arca):
    arca.cae_solicitar_ok = False
    arca.errores = [{"codigo": 10016, "mensaje": "El comprobante ya fue autorizado"}]

    r = client.post("/facturar", json=request_valido(), headers=headers)

    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["cae"] is None
    assert "10016" in body["error"]
    assert "ya fue autorizado" in body["error"]


def test_rechazo_de_arca_no_se_confunde_con_exito(client, headers, arca):
    arca.resultado = "R"
    arca.observaciones = [{"Code": 10013, "Msg": "Fecha del comprobante fuera de rango"}]

    r = client.post("/facturar", json=request_valido(), headers=headers)

    body = r.json()
    assert body["ok"] is False
    assert body["cae"] is None
    assert "10013" in body["error"]
    assert "fuera de rango" in body["error"]


def test_falla_de_wsaa_no_tumba_el_sidecar(client, headers, arca):
    arca.wsaa_falla = True
    arca.wsaa_excepcion = "certificado no registrado para el servicio wsfe"

    r = client.post("/facturar", json=request_valido(), headers=headers)

    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "wsfe" in body["error"]


def test_already_authenticated_devuelve_mensaje_entendible(client, headers, arca):
    arca.wsaa_falla = True
    arca.wsaa_excepcion = "coe.alreadyAuthenticated: El CEE ya posee un TA valido"

    body = client.post("/facturar", json=request_valido(), headers=headers).json()

    assert body["ok"] is False
    assert "ticket de acceso anterior" in body["error"]


def test_cuit_del_receptor_igual_al_emisor_se_frena_antes_de_arca(client, headers, arca):
    body = client.post(
        "/facturar",
        json=request_valido(doc_tipo=80, doc_nro="20442477060"),
        headers=headers,
    ).json()

    assert body["ok"] is False
    assert "10069" in body["error"]
    assert arca.facturas_creadas == []  # ni se molestó en llamar a ARCA


# ── Multi-tenant ──────────────────────────────────────────────────────────────


def test_mismo_tenant_reusa_cliente_y_token(client, headers, arca):
    client.post("/facturar", json=request_valido(), headers=headers)
    client.post("/facturar", json=request_valido(), headers=headers)

    assert client.get("/health").json()["tenants_en_cache"] == 1
    # Un solo WSAA para las dos facturas: el token dura 12h
    assert arca.autenticaciones == 1


def test_certificados_distintos_son_tenants_distintos(client, headers, arca):
    client.post("/facturar", json=request_valido(), headers=headers)
    client.post(
        "/facturar",
        json=request_valido(cert_pem=OTRO_CERT_PEM),
        headers=headers,
    )

    assert client.get("/health").json()["tenants_en_cache"] == 2
    assert arca.autenticaciones == 2


def test_los_pem_se_escriben_con_permisos_cerrados(client, headers):
    import os
    import stat

    import tenant_pool

    client.post("/facturar", json=request_valido(), headers=headers)

    tenants = list((tenant_pool.CACHE_DIR / "tenants").iterdir())
    assert len(tenants) == 1
    cert = tenants[0] / "cert.pem"
    key = tenants[0] / "key.pem"
    assert cert.read_text().strip() == CERT_PEM.strip()
    assert key.read_text().strip() == KEY_PEM.strip()
    assert stat.S_IMODE(os.stat(key).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(tenants[0]).st_mode) == 0o700
