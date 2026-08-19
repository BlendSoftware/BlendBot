"""Fixtures compartidas. El entorno se setea ANTES de importar settings."""

from __future__ import annotations

import os

os.environ.setdefault("CORE_URL", "http://core.test")
os.environ.setdefault("AGENTE_TOKEN", "cop_tokendeprueba")
os.environ.setdefault("CLIENTE_TELEFONO", "5492611234567")

import pytest  # noqa: E402

import server  # noqa: E402
from core_client import CoreClient  # noqa: E402
from sesion import reiniciar_sesion  # noqa: E402

TELEFONO = "5492611234567"
BASE = "http://core.test"

NEGOCIO = {
    "id": "neg-1",
    "nombre": "Odontología Del Valle",
    "vertical": "salud",
    "timezone": "America/Argentina/Mendoza",
    "config": {"confirmacion": {"turno": "automatica"}, "hold_minutos": 10},
    "coberturas": [
        {"id": "cob-osep", "nombre": "OSEP"},
        {"id": "cob-part", "nombre": "Particular"},
    ],
}

CATALOGO = [
    {
        "id": "sv-consulta",
        "nombre": "Consulta",
        "duracion_min": 30,
        "precio_base": "12000.00",
        "disponible": True,
    },
    {
        "id": "sv-control",
        "nombre": "Consulta de control",
        "duracion_min": 20,
        "precio_base": "9000.00",
        "disponible": True,
    },
    {
        "id": "sv-limpieza",
        "nombre": "Limpieza",
        "duracion_min": 30,
        "precio_base": "18000.00",
        "disponible": True,
    },
    {
        "id": "sv-arreglo",
        "nombre": "Arreglo (caries)",
        "duracion_min": 45,
        "precio_base": "25000.00",
        "disponible": True,
    },
]

HUECOS = {
    "servicio_id": "sv-arreglo",
    "duracion_min": 45,
    "huecos": [
        {
            "recurso_id": "rec-gomez",
            "recurso": "Dra. Gómez",
            "inicio": "2026-08-21T11:30:00-03:00",
            "fin": "2026-08-21T12:15:00-03:00",
        },
        {
            "recurso_id": "rec-gomez",
            "recurso": "Dra. Gómez",
            "inicio": "2026-08-21T16:15:00-03:00",
            "fin": "2026-08-21T17:00:00-03:00",
        },
    ],
}


@pytest.fixture(autouse=True)
def sesion_limpia():
    """Una sesión MCP = una conversación: cada test arranca en cero."""
    reiniciar_sesion(TELEFONO)
    yield
    reiniciar_sesion()


@pytest.fixture
async def core():
    """CoreClient real (respx intercepta el transporte) inyectado en el server."""
    cliente = CoreClient(BASE, "cop_tokendeprueba", timeout_s=5.0)
    server.usar_core(cliente)
    yield cliente
    server.usar_core(None)
    await cliente.aclose()
