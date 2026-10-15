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


PIZZAS = [
    {"id": "muz", "nombre": "Muzzarella grande"},
    {"id": "fug", "nombre": "Fugazzeta grande"},
    {"id": "nap", "nombre": "Napolitana grande"},
    {"id": "emp", "nombre": "Empanada de carne"},
]


def test_el_apodo_con_el_tamano_no_empata_con_otra_del_mismo_tamano():
    # Producción, 15/10: "3 muzzas grandes" salía ambiguo entre Muzzarella y
    # Fugazzeta porque "grande" pesaba más que "muzza" en la similitud.
    assert resolver("muzza grande", PIZZAS).item["id"] == "muz"
    assert resolver("muzzas grandes", PIZZAS).item["id"] == "muz"


def test_cada_palabra_tiene_que_arrancar_una_palabra_del_plato():
    assert resolver("empanadas de carne", PIZZAS).item["id"] == "emp"
    assert resolver("napo grande", PIZZAS).item["id"] == "nap"


def test_el_tamano_solo_sigue_siendo_ambiguo():
    r = resolver("grande", PIZZAS)
    assert r.ambiguo and {c["id"] for c in r.candidatos} >= {"muz", "fug", "nap"}
