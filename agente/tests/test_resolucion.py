"""El cliente escribe como puede: acá se prueba que igual llegue al producto."""

from __future__ import annotations

from conftest import CATALOGO

from resolucion import normalizar, resolver


def test_normalizar_saca_acentos_y_espacios():
    assert normalizar("  María   PÉREZ ") == "maria perez"


def test_nombre_exacto_le_gana_al_que_lo_contiene():
    # "Corte" y "Corte de puntas" empiezan igual: el exacto manda.
    r = resolver("corte", CATALOGO)
    assert r.ok and r.item["id"] == "sv-corte"


def test_typo_resuelve_por_similitud():
    r = resolver("labado", CATALOGO)
    assert r.ok and r.item["id"] == "sv-lavado"


def test_resuelve_por_contencion():
    r = resolver("coloracion", CATALOGO)
    assert r.ok and r.item["id"] == "sv-color"


def test_frase_larga_del_cliente():
    r = resolver("una coloración fantasía completa", CATALOGO)
    assert r.ok and r.item["id"] == "sv-color"


def test_lo_que_no_esta_no_se_inventa():
    r = resolver("alisado brasileño", CATALOGO)
    assert not r.ok
    assert not r.ambiguo


def test_empate_real_devuelve_candidatos_para_preguntar():
    recursos = [
        {"id": "r1", "nombre": "Estilista González"},
        {"id": "r2", "nombre": "Ayudante González"},
    ]
    r = resolver("gonzalez", recursos)
    assert not r.ok
    assert r.ambiguo
    assert {c["id"] for c in r.candidatos} == {"r1", "r2"}


def test_catalogo_vacio_no_resuelve_nada():
    assert not resolver("corte", []).ok
