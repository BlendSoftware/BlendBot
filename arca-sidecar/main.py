"""
Copiloto Comercios — Sidecar ARCA
Microservicio interno que envuelve pyafipws:
  - WSAA  (autenticación con certificado)
  - WSFEv1 (facturación electrónica — emisión de CAE)

Stateless y multi-tenant: cada request trae el CUIT, el punto de venta y el
certificado del negocio. El sidecar no guarda configuración de nadie.

Servicio INTERNO: sólo lo llama el worker facturador del core (Go), con el
header X-Internal-Token. Nunca se expone a internet.
"""

# IMPORTANTE: py3_compat va PRIMERO — monkey-patch de hashlib para pyafipws
import py3_compat  # noqa: F401

import logging
import os
import sys
from typing import Any, Dict

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

import tenant_pool
from afip_client import AFIPClient  # noqa: F401  (mantiene el orden de patches)
from schemas import FacturarRequest, FacturarResponse, HealthResponse

VERSION = "2.0.0"

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("arca-sidecar")

# ── Auth ──────────────────────────────────────────────────────────────────────
# El sidecar sólo debe ser alcanzable desde el core. INTERNAL_API_TOKEN es un
# secreto compartido: aunque el puerto quede expuesto por accidente, no sirve.

INTERNAL_API_TOKEN: str = os.getenv("INTERNAL_API_TOKEN", "")

if os.getenv("ARCA_MODO_DEFAULT", "homologacion").lower() == "produccion" and not INTERNAL_API_TOKEN:
    raise RuntimeError(
        "FATAL: INTERNAL_API_TOKEN es obligatorio en producción. "
        'Generá uno con: python -c "import secrets; print(secrets.token_hex(32))"'
    )


async def verificar_token_interno(
    x_internal_token: str = Header(None, alias="X-Internal-Token"),
) -> None:
    """401 si el token no coincide. Si no hay token configurado (dev), pasa."""
    if not INTERNAL_API_TOKEN:
        return
    if x_internal_token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Token interno inválido")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Copiloto Comercios — Sidecar ARCA",
    version=VERSION,
    description="Microservicio interno de facturación electrónica (WSAA + WSFEv1)",
    docs_url="/docs" if os.getenv("ARCA_DOCS", "false").lower() == "true" else None,
    redoc_url=None,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    422 con mensaje claro y SIN el valor que falló.

    Esto no es cosmética: el body trae cert_pem y key_pem, y el handler por
    defecto de FastAPI devuelve el input rechazado. Un PEM en un mensaje de
    error es un PEM en los logs del que llame.
    """
    detalles = []
    for err in exc.errors():
        campo = ".".join(str(p) for p in err.get("loc", []) if p != "body")
        mensaje = str(err.get("msg", "inválido"))
        # Pydantic prefija "Value error, " a lo que levantan los validadores;
        # el mensaje lo termina leyendo el dueño del negocio.
        for ruido in ("Value error, ", "Assertion failed, "):
            if mensaje.startswith(ruido):
                mensaje = mensaje[len(ruido) :]
        detalles.append({"campo": campo or "body", "mensaje": mensaje})

    logger.warning("Request inválido: %s", [d["campo"] for d in detalles])
    return JSONResponse(
        status_code=422,
        content={
            "ok": False,
            "error": "Datos inválidos: "
            + "; ".join(f"{d['campo']}: {d['mensaje']}" for d in detalles),
            "detalles": detalles,
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Nunca devolvemos el body ni nada que pueda arrastrar credenciales."""
    logger.exception("Excepción no capturada en %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": f"Error interno del sidecar: {exc}"},
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """
    Liveness del proceso. Sin auth y sin tocar la red de ARCA: un health check
    no puede depender de que el fisco esté de buen humor.
    """
    return HealthResponse(
        ok=True,
        service="arca-sidecar",
        version=VERSION,
        tenants_en_cache=tenant_pool.cantidad(),
    )


@app.post(
    "/facturar",
    response_model=FacturarResponse,
    dependencies=[Depends(verificar_token_interno)],
)
def facturar(req: FacturarRequest) -> FacturarResponse:
    """
    Emite un comprobante electrónico en ARCA (WSFEv1) para el tenant del body.

    Devuelve SIEMPRE 200 con `{ok, numero, cae, cae_vencimiento, error?}`
    cuando el request es válido: los errores del fisco son parte del negocio,
    no fallas de transporte. El core guarda `error` en `last_error` y reintenta.

    401 → token interno inválido · 422 → request malformado.
    """
    logger.info("→ Factura pedida: %s", req.resumen_seguro())

    try:
        cliente = tenant_pool.obtener_cliente(req)
    except Exception as e:
        logger.exception("No se pudo preparar el cliente del tenant")
        return FacturarResponse.falla(
            f"No se pudieron preparar los certificados del negocio: {e}"
        )

    resp = cliente.facturar(req)

    if resp.ok:
        logger.info("✓ CAE %s — comprobante %s", resp.cae, resp.numero)
    else:
        logger.warning("✗ Sin CAE: %s", resp.error)

    return resp


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "arca-sidecar",
        "version": VERSION,
        "endpoints": {"health": "GET /health", "facturar": "POST /facturar"},
    }


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("ARCA_PORT", "8001")),
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
        access_log=True,
        reload=False,
    )
