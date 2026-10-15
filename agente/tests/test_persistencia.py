"""Persistencia del borrador y el hold entre procesos MCP.

El bug real: el gateway levanta un proceso MCP nuevo por cada mensaje de
WhatsApp (`mcpServers()` en `agente.js`), pero `sesion.py` asumía "una sesión
MCP = una conversación" y guardaba el borrador en un singleton de memoria del
proceso. El cliente armaba el pedido en un mensaje y, al confirmar en el
siguiente, `confirmar` respondía `sin_borrador` porque ese proceso ya murió.

Estos tests simulan el reinicio de proceso tirando el singleton en memoria
(`sesion_mod._sesion = None`) y comprobando que el siguiente `sesion()` lo
recupera del disco — exactamente lo que pasa de verdad entre dos mensajes.
"""

from __future__ import annotations

import copy
import hashlib
import json
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import respx
from conftest import BASE, CATALOGO, HUECOS, NEGOCIO, TELEFONO

import server
import sesion as sesion_mod
import settings as settings_mod
from server import LineaPedida
from sesion import Borrador, LineaBorrador, a_decimal, sesion

HUECO = HUECOS["huecos"][0]
AGENTE_TOKEN = "cop_tokendeprueba"  # el mismo que fija conftest.py por env


@pytest.fixture
def borradores_dir(tmp_path, monkeypatch):
    """Prende la persistencia a disco para este test, apuntando a un tmpdir."""
    monkeypatch.setenv("BORRADORES_DIR", str(tmp_path))
    settings_mod.get_settings.cache_clear()
    yield tmp_path
    settings_mod.get_settings.cache_clear()


def _reiniciar_proceso() -> None:
    """Simula que el proceso MCP murió: se pierde todo lo que había en
    memoria, igual que pasa de verdad entre dos mensajes de WhatsApp."""
    sesion_mod._sesion = None


def _ruta_del_archivo(
    directorio: Path, *, agente_token: str = AGENTE_TOKEN, telefono: str = TELEFONO
) -> Path:
    digesto = hashlib.sha256(f"{agente_token}:{telefono}".encode("utf-8")).hexdigest()
    return directorio / f"{digesto}.json"


def _base(respx_mock, *, politica="automatica"):
    negocio = copy.deepcopy(NEGOCIO)
    negocio["config"]["confirmacion"]["turno"] = politica
    respx_mock.get("/api/negocio").mock(return_value=httpx.Response(200, json=negocio))
    respx_mock.get("/api/servicios").mock(return_value=httpx.Response(200, json=CATALOGO))
    respx_mock.post("/api/disponibilidad/consultar").mock(
        return_value=httpx.Response(200, json=HUECOS)
    )
    respx_mock.post("/api/holds").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "h-1",
                "recurso_id": HUECO["recurso_id"],
                "inicio": HUECO["inicio"],
                "fin": HUECO["fin"],
                "expira_en": "2026-08-19T20:10:00-03:00",
            },
        )
    )


# ─────────────────────────────────────────────────────────────────────────────
# Los dos procesos, de punta a punta (lo que antes rompía)
# ─────────────────────────────────────────────────────────────────────────────


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_el_segundo_proceso_encuentra_el_borrador_que_armo_el_primero(
    respx_mock, core, borradores_dir
):
    _base(respx_mock)

    # "Proceso 1": arma el pedido y bloquea el horario.
    await server.consultar_disponibilidad("coloracion")
    await server.armar_compromiso([LineaPedida(servicio="coloracion")])
    await server.bloquear("Coty", HUECO["inicio"], HUECO["fin"])

    _reiniciar_proceso()

    # "Proceso 2": arranca de cero, sin nada en memoria.
    s = sesion()
    assert s.borrador is not None
    assert s.borrador.lineas[0].nombre == "Coloración fantasía"
    assert s.bloqueo is not None
    assert s.bloqueo.hold_id == "h-1"


@respx.mock(base_url=BASE, assert_all_called=False)
async def test_confirmar_en_el_segundo_proceso_ya_no_dice_sin_borrador(
    respx_mock, core, borradores_dir
):
    _base(respx_mock)
    respx_mock.get(f"/api/clientes/por-telefono/{TELEFONO}").mock(
        return_value=httpx.Response(404, json={"detail": "no encontrado"})
    )
    respx_mock.post("/api/clientes").mock(
        return_value=httpx.Response(
            201,
            json={"id": "cli-1", "telefono": TELEFONO, "nombre": None, "cobertura_id": None},
        )
    )
    respx_mock.patch("/api/clientes/cli-1").mock(
        return_value=httpx.Response(
            200,
            json={"id": "cli-1", "telefono": TELEFONO, "nombre": "Juani", "cobertura_id": None},
        )
    )
    respx_mock.post("/api/compromisos").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "com-1",
                "cliente_id": "cli-1",
                "estado": "pendiente",
                "tipo": "turno",
                "total": "25000.00",
                "inicio": HUECO["inicio"],
                "fin": HUECO["fin"],
            },
        )
    )
    respx_mock.patch("/api/compromisos/com-1/estado").mock(
        return_value=httpx.Response(200, json={"estado": "confirmado"})
    )

    await server.consultar_disponibilidad("coloracion")
    await server.armar_compromiso([LineaPedida(servicio="coloracion")])
    await server.bloquear("Coty", HUECO["inicio"], HUECO["fin"])

    # Acá es donde el bug pegaba: el proceso que armó el pedido muere,
    # el gateway levanta uno nuevo para leer "sí, confirmo".
    _reiniciar_proceso()

    r = await server.confirmar(nombre="Juani", confirmado=True)

    assert r["ok"] is True
    assert r["ejecutado"] is True
    assert r.get("codigo") != "sin_borrador"

    # Confirmado con éxito: el archivo no debe sobrevivir al compromiso.
    assert not _ruta_del_archivo(borradores_dir).exists()


# ─────────────────────────────────────────────────────────────────────────────
# Vencimiento: 30 minutos
# ─────────────────────────────────────────────────────────────────────────────


def test_un_borrador_de_mas_de_30_minutos_se_ignora_y_se_borra(borradores_dir):
    ruta = _ruta_del_archivo(borradores_dir)
    vencido = datetime.now(timezone.utc) - timedelta(minutes=31)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(
        json.dumps(
            {
                "guardado_en": vencido.isoformat(),
                "borrador": {
                    "id": "bor_viejo",
                    "entrega": None,
                    "direccion": None,
                    "nota": None,
                    "lineas": [],
                },
                "bloqueo": None,
            }
        ),
        encoding="utf-8",
    )

    _reiniciar_proceso()
    s = sesion()

    assert s.borrador is None
    assert not ruta.exists()  # no se arrastra: se borra solo al detectarse vencido


def test_un_borrador_de_menos_de_30_minutos_se_recupera(borradores_dir):
    ruta = _ruta_del_archivo(borradores_dir)
    reciente = datetime.now(timezone.utc) - timedelta(minutes=29)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(
        json.dumps(
            {
                "guardado_en": reciente.isoformat(),
                "borrador": {
                    "id": "bor_fresco",
                    "entrega": "retira",
                    "direccion": None,
                    "nota": None,
                    "lineas": [
                        {
                            "servicio_id": "sv-1",
                            "nombre": "Papas",
                            "cantidad": 2,
                            "precio_unit": "3500",
                            "duracion_min": None,
                            "nota": None,
                        }
                    ],
                },
                "bloqueo": None,
            }
        ),
        encoding="utf-8",
    )

    _reiniciar_proceso()
    s = sesion()

    assert s.borrador is not None
    assert s.borrador.id == "bor_fresco"
    assert s.borrador.lineas[0].precio_unit == a_decimal("3500")
    assert isinstance(s.borrador.lineas[0].precio_unit, type(a_decimal("1")))  # Decimal, no float


# ─────────────────────────────────────────────────────────────────────────────
# Aislamiento: por negocio y por cliente
# ─────────────────────────────────────────────────────────────────────────────


def test_aislamiento_entre_dos_telefonos(borradores_dir, monkeypatch):
    s = sesion()
    s.fijar_borrador(Borrador(entrega="retira"))
    ruta_a = _ruta_del_archivo(borradores_dir)
    assert ruta_a.exists()

    otro_telefono = "5491111111111"
    monkeypatch.setenv("CLIENTE_TELEFONO", otro_telefono)
    settings_mod.get_settings.cache_clear()
    _reiniciar_proceso()

    s_b = sesion()
    assert s_b.borrador is None  # el teléfono B no ve el borrador del A
    assert ruta_a.exists()  # y el archivo del A sigue intacto


def test_aislamiento_entre_dos_negocios(borradores_dir, monkeypatch):
    s = sesion()
    s.fijar_borrador(Borrador(entrega="retira"))
    ruta_negocio_a = _ruta_del_archivo(borradores_dir)
    assert ruta_negocio_a.exists()

    monkeypatch.setenv("AGENTE_TOKEN", "cop_otro_negocio")
    settings_mod.get_settings.cache_clear()
    _reiniciar_proceso()

    s_b = sesion()
    assert s_b.borrador is None  # el otro negocio no ve el borrador del A
    ruta_negocio_b = _ruta_del_archivo(borradores_dir, agente_token="cop_otro_negocio")
    assert ruta_negocio_b != ruta_negocio_a
    assert ruta_negocio_a.exists()


# ─────────────────────────────────────────────────────────────────────────────
# El nombre del archivo nunca lleva el token, y el contenido tampoco
# ─────────────────────────────────────────────────────────────────────────────


def test_el_archivo_no_expone_el_token(borradores_dir):
    s = sesion()
    borrador = Borrador(entrega="retira")
    borrador.lineas.append(
        LineaBorrador(
            servicio_id="sv-1", nombre="Hamburguesa", cantidad=1, precio_unit=a_decimal("8900")
        )
    )
    s.fijar_borrador(borrador)

    archivos = list(borradores_dir.iterdir())
    assert len(archivos) == 1
    assert AGENTE_TOKEN not in archivos[0].name
    assert TELEFONO not in archivos[0].name
    contenido = archivos[0].read_text(encoding="utf-8")
    assert AGENTE_TOKEN not in contenido


# ─────────────────────────────────────────────────────────────────────────────
# Escritura atómica y permisos 600
# ─────────────────────────────────────────────────────────────────────────────


def test_escritura_atomica_con_permisos_600(borradores_dir):
    s = sesion()
    s.fijar_borrador(Borrador(entrega="retira"))

    ruta = _ruta_del_archivo(borradores_dir)
    assert ruta.exists()
    modo = stat.S_IMODE(ruta.stat().st_mode)
    assert modo == 0o600
    # no quedan archivos temporales colgados
    assert [p.name for p in borradores_dir.iterdir()] == [ruta.name]


# ─────────────────────────────────────────────────────────────────────────────
# Sin BORRADORES_DIR configurado: se comporta como hoy, sólo en memoria
# ─────────────────────────────────────────────────────────────────────────────


def test_sin_directorio_configurado_sigue_siendo_solo_en_memoria():
    assert settings_mod.get_settings().borradores_dir == ""
    s = sesion()
    s.fijar_borrador(Borrador(entrega="retira"))  # no debe explotar ni escribir nada
    assert s.borrador is not None
