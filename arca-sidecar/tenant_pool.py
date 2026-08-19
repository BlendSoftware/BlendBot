"""
Copiloto Comercios — Sidecar ARCA · pool de clientes por tenant

El sidecar es stateless respecto del negocio: los certificados llegan en cada
request. Pero re-autenticar contra WSAA en cada factura es peor que un mal
negocio — ARCA responde `coe.alreadyAuthenticated` y te deja afuera. El token
dura ~12 horas.

Solución: cache de clientes AFIP en memoria, keyed por
sha256(cuit + modo + cert_pem + key_pem). Los PEM se materializan una sola vez
en disco (0600, dentro de un directorio 0700 por tenant) porque pyafipws firma
el CMS leyendo archivos, no strings.

Nada de esto se loguea: en los logs sólo viaja la huella (los primeros 12
caracteres del sha256), nunca el CUIT junto al material criptográfico ni el
contenido de los PEM.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from afip_client import AFIPClient
from schemas import FacturarRequest

logger = logging.getLogger("tenant_pool")

CACHE_DIR = Path(os.getenv("ARCA_CACHE_DIR", "/tmp/arca_cache"))
MAX_TENANTS = int(os.getenv("ARCA_MAX_TENANTS_CACHE", "50"))

_lock = threading.Lock()
_clientes: "OrderedDict[str, AFIPClient]" = OrderedDict()
_rdb = None
_rdb_intentado = False


def huella(cuit_emisor: str, modo: str, cert_pem: str, key_pem: str) -> str:
    """Identidad estable del par (tenant, credenciales). No reversible."""
    h = hashlib.sha256()
    h.update(cuit_emisor.encode())
    h.update(b"\x00")
    h.update(modo.encode())
    h.update(b"\x00")
    h.update(cert_pem.strip().encode())
    h.update(b"\x00")
    h.update(key_pem.strip().encode())
    return h.hexdigest()


def _redis():
    """Cliente Redis opcional: si no hay, el token vive sólo en memoria."""
    global _rdb, _rdb_intentado
    if _rdb_intentado:
        return _rdb
    _rdb_intentado = True
    url = os.getenv("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis as redis_sync

        rdb = redis_sync.from_url(url, decode_responses=False, socket_timeout=3)
        rdb.ping()
        _rdb = rdb
        logger.info("Redis conectado — cache de token WSAA persistente habilitado")
    except Exception as e:  # pragma: no cover - depende del entorno
        logger.warning("Sin Redis (%s): el token WSAA vivirá sólo en memoria", e)
        _rdb = None
    return _rdb


def _materializar_certs(fp: str, cert_pem: str, key_pem: str) -> tuple[Path, Path]:
    """
    Escribe los PEM del tenant a disco con permisos restrictivos.
    Idempotente: si la huella ya tiene archivos, no reescribe.
    """
    tenant_dir = CACHE_DIR / "tenants" / fp[:32]
    tenant_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(tenant_dir, 0o700)

    cert_path = tenant_dir / "cert.pem"
    key_path = tenant_dir / "key.pem"

    for path, contenido in ((cert_path, cert_pem), (key_path, key_pem)):
        if path.exists():
            continue
        # Abrir con O_CREAT|O_EXCL y modo 0600: nunca queda legible por otros
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(contenido if contenido.endswith("\n") else contenido + "\n")

    return cert_path, key_path


def obtener_cliente(req: FacturarRequest) -> AFIPClient:
    """
    Devuelve el AFIPClient del tenant, creándolo si es la primera factura de
    esas credenciales. Reusa el token WSAA mientras siga vivo.
    """
    fp = huella(req.cuit_emisor, req.modo, req.cert_pem, req.key_pem)

    with _lock:
        cliente = _clientes.get(fp)
        if cliente is not None:
            _clientes.move_to_end(fp)
            return cliente

        cert_path, key_path = _materializar_certs(fp, req.cert_pem, req.key_pem)
        cliente = AFIPClient(
            cuit_emisor=req.cuit_emisor,
            cert_path=str(cert_path),
            key_path=str(key_path),
            homologacion=(req.modo != "produccion"),
            cache_dir=str(CACHE_DIR / "tenants" / fp[:32]),
            rdb=_redis(),
            tenant_key=fp[:32],
        )
        _clientes[fp] = cliente
        logger.info("Cliente ARCA creado para tenant %s (modo %s)", fp[:12], req.modo)

        while len(_clientes) > MAX_TENANTS:
            viejo, _ = _clientes.popitem(last=False)
            logger.info("Tenant %s desalojado del cache (LRU)", viejo[:12])

        return cliente


def cantidad() -> int:
    with _lock:
        return len(_clientes)


def resetear() -> None:
    """Sólo para tests y para el /reload manual."""
    global _rdb, _rdb_intentado
    with _lock:
        _clientes.clear()
    _rdb = None
    _rdb_intentado = False


def configurar_cache_dir(path: str) -> None:
    """Permite a los tests apuntar el cache a un tmpdir."""
    global CACHE_DIR
    CACHE_DIR = Path(path)
