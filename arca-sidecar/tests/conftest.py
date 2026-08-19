"""
Fixtures comunes. Nada acá toca la red ni ARCA: pyafipws está doblado.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

TOKEN = "token-de-prueba"

# El token y el cache dir se leen al importar main/tenant_pool: van antes.
os.environ["INTERNAL_API_TOKEN"] = TOKEN
os.environ["ARCA_MODO_DEFAULT"] = "homologacion"
os.environ.pop("REDIS_URL", None)

from fake_pyafipws import escenario, instalar  # noqa: E402

instalar()

import tenant_pool  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

# ── Credenciales de mentira, con la forma correcta ────────────────────────────

CERT_PEM = (
    "-----BEGIN CERTIFICATE-----\n"
    "MIIB2jCCAUOgAwIBAgIJAKlaMPRUNOPARSEABLE0000000000000000000000000\n"
    "-----END CERTIFICATE-----\n"
)
KEY_PEM = (
    "-----BEGIN PRIVATE KEY-----\n"
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQFAKE00000000000\n"
    "-----END PRIVATE KEY-----\n"
)
OTRO_CERT_PEM = CERT_PEM.replace("MIIB2jCC", "MIIB2jCD")

CUIT_VALIDO = "20442477060"  # DV correcto


def request_valido(**overrides):
    """Body mínimo del contrato W4-A: Factura C de un servicio."""
    body = {
        "cuit_emisor": CUIT_VALIDO,
        "punto_venta": 3,
        "modo": "homologacion",
        "cert_pem": CERT_PEM,
        "key_pem": KEY_PEM,
        "tipo_cbte": 11,
        "concepto": 2,
        "doc_tipo": 99,
        "doc_nro": "0",
        "importe_total": "15000.00",
        "fecha": "2026-08-18",
        "servicio_desde": "2026-08-18",
        "servicio_hasta": "2026-08-18",
    }
    body.update(overrides)
    return body


@pytest.fixture(autouse=True)
def entorno_limpio(tmp_path, monkeypatch):
    """Cache de tenants aislado por test y escenario ARCA en cero."""
    tenant_pool.configurar_cache_dir(str(tmp_path / "arca_cache"))
    tenant_pool.resetear()
    escenario.reset()
    yield
    tenant_pool.resetear()


@pytest.fixture
def client():
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.fixture
def headers():
    return {"X-Internal-Token": TOKEN}


@pytest.fixture
def arca():
    """El ARCA falso, para armar el escenario de cada test."""
    return escenario
