"""
Los patch_*.py son oro heredado de BlendPos: sin ellos pysimplesoap y pyafipws
no arrancan en Python 3. Este módulo no los reescribe, sólo verifica que sigan
enteros después de la mudanza.

Ojo: la mayoría son SCRIPTS que reescriben site-packages al ejecutarse (los
corre el Dockerfile durante el build). Importarlos acá rompería el entorno de
test, así que se compilan, no se ejecutan. El único que sí es importable —
porque es un monkey patch en runtime — es patch_analizar_errores, y ese se
prueba de verdad.
"""

import ast
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
PATCHES = sorted(RAIZ.glob("patch_*.py"))

# Los que el Dockerfile aplica en el build. Si alguno desaparece, la imagen
# queda rota recién en runtime contra ARCA: mejor enterarse acá.
APLICADOS_EN_BUILD = [
    "patch_pysimplesoap.py",
    "patch_helpers.py",
    "patch_setuppy.py",
    "patch_wsaa.py",
    "patch_wsaa_openssl2.py",
    "patch_wsaa_b64.py",
    "patch_utils.py",
    "patch_wsfev1_final.py",
]


def test_hay_patches():
    assert len(PATCHES) >= 15, "faltan parches heredados"


@pytest.mark.parametrize("archivo", PATCHES, ids=lambda p: p.name)
def test_cada_patch_es_python_valido(archivo):
    # utf-8-sig: patch_setuppy.py viene con BOM desde BlendPos. El intérprete
    # lo tolera al ejecutarlo; ast.parse no. No se toca el archivo por eso.
    ast.parse(archivo.read_text(encoding="utf-8-sig"), filename=str(archivo))


@pytest.mark.parametrize("nombre", APLICADOS_EN_BUILD)
def test_los_patches_del_dockerfile_estan_presentes(nombre):
    assert (RAIZ / nombre).exists()


def test_el_dockerfile_sigue_aplicando_todos_los_patches_del_build():
    dockerfile = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
    for nombre in APLICADOS_EN_BUILD:
        assert nombre in dockerfile, f"el Dockerfile ya no aplica {nombre}"


def test_py3_compat_parchea_hashlib_para_aceptar_str():
    import hashlib

    import py3_compat  # noqa: F401  — el import es el que parchea

    # pyafipws (código Python 2) le pasa str a hashlib; sin el parche esto revienta
    h = hashlib.md5("texto plano")
    h.update("más texto")
    assert h.hexdigest()


def test_patch_analizar_errores_sobrevive_a_errores_en_lista():
    """
    El bug original: pyafipws hacía error['Err']['Code'] y explotaba cuando ARCA
    devolvía Err como lista. El parche tiene que absorberlo y dejar los errores
    en self.errores.
    """
    import patch_analizar_errores  # noqa: F401  — aplica el monkey patch al importar
    from pyafipws.wsfev1 import WSFEv1

    wsfe = WSFEv1()
    ret = {"Errors": {"Err": [{"Code": 10071, "Msg": "El objeto IVA no debe informarse"}]}}

    wsfe._WSFEv1__analizar_errores(ret)  # no debe lanzar

    assert wsfe.errores == [{"codigo": 10071, "mensaje": "El objeto IVA no debe informarse"}]


def test_patch_analizar_errores_tambien_con_un_error_solo():
    from pyafipws.wsfev1 import WSFEv1

    wsfe = WSFEv1()
    wsfe._WSFEv1__analizar_errores({"Errors": {"Err": {"Code": 600, "Msg": "Token vencido"}}})
    assert wsfe.errores == [{"codigo": 600, "mensaje": "Token vencido"}]
