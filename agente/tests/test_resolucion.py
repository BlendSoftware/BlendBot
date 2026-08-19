"""El paciente escribe como puede: acá se prueba que igual llegue a la práctica."""

from __future__ import annotations

from conftest import CATALOGO

from resolucion import normalizar, resolver


def test_normalizar_saca_acentos_y_espacios():
    assert normalizar("  Dra.   GÓMEZ ") == "dra. gomez"


def test_nombre_exacto_le_gana_al_que_lo_contiene():
    # "Consulta" y "Consulta de control" empiezan igual: el exacto manda.
    r = resolver("consulta", CATALOGO)
    assert r.ok and r.item["id"] == "sv-consulta"


def test_typo_resuelve_por_similitud():
    r = resolver("limpiesa", CATALOGO)
    assert r.ok and r.item["id"] == "sv-limpieza"


def test_resuelve_por_contencion():
    r = resolver("arreglo", CATALOGO)
    assert r.ok and r.item["id"] == "sv-arreglo"


def test_frase_larga_del_paciente():
    r = resolver("un arreglo de caries", CATALOGO)
    assert r.ok and r.item["id"] == "sv-arreglo"


def test_lo_que_no_esta_no_se_inventa():
    r = resolver("ortodoncia invisible", CATALOGO)
    assert not r.ok
    assert not r.ambiguo


def test_empate_real_devuelve_candidatos_para_preguntar():
    recursos = [
        {"id": "r1", "nombre": "Dra. Gómez"},
        {"id": "r2", "nombre": "Dr. Gómez"},
    ]
    r = resolver("gomez", recursos)
    assert not r.ok
    assert r.ambiguo
    assert {c["id"] for c in r.candidatos} == {"r1", "r2"}


def test_catalogo_vacio_no_resuelve_nada():
    assert not resolver("consulta", []).ok
