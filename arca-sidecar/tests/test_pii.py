"""
H14: el documento del receptor es dato personal (Ley 25.326) y no puede quedar
en claro en los logs. resumen_seguro() —la línea que se loguea a INFO por cada
factura— debe enmascararlo.
"""

import logging

from conftest import request_valido
from schemas import FacturarRequest, enmascarar_doc


def test_enmascarar_doc_deja_solo_ultimos_tres():
    assert enmascarar_doc("30123456") == "•••••456"
    assert enmascarar_doc("20442477060") == "••••••••060"


def test_enmascarar_doc_no_toca_consumidor_final():
    # "0" no lleva dato personal: nada que ocultar.
    assert enmascarar_doc("0") == "0"


def test_resumen_seguro_no_lleva_el_documento_completo():
    dni = "30123456"
    req = FacturarRequest(**request_valido(doc_tipo=96, doc_nro=dni))
    resumen = req.resumen_seguro()
    assert dni not in resumen
    assert "•••••456" in resumen


def test_log_de_factura_no_filtra_el_documento(client, arca, headers, caplog):
    """El INFO 'Factura pedida' que emite /facturar no puede traer el DNI."""
    dni = "30123456"
    with caplog.at_level(logging.INFO):
        client.post(
            "/facturar",
            json=request_valido(doc_tipo=96, doc_nro=dni),
            headers=headers,
        )
    assert dni not in caplog.text
