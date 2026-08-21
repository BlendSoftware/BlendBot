"""
Copiloto Comercios — Sidecar ARCA · schemas
Modelos Pydantic del contrato stateless multi-tenant (E8 · W4-A ↔ W4-B).

Regla dura: los PEM (cert_pem / key_pem) NUNCA se loguean ni se devuelven en
mensajes de error. Los validadores de este módulo describen QUÉ está mal, jamás
el contenido.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# ── Constantes ARCA ───────────────────────────────────────────────────────────

FACTURA_C = 11          # CbteTipo — monotributo
CONCEPTO_PRODUCTOS = 1
CONCEPTO_SERVICIOS = 2
CONCEPTO_AMBOS = 3

DOC_CUIT = 80
DOC_CUIL = 86
DOC_DNI = 96
DOC_CONSUMIDOR_FINAL = 99

MODOS = ("homologacion", "produccion")


def validar_cuit(cuit: str) -> bool:
    """Dígito verificador de un CUIT/CUIL argentino."""
    cuit = str(cuit).strip()
    if len(cuit) != 11 or not cuit.isdigit():
        return False
    pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    resto = sum(int(cuit[i]) * pesos[i] for i in range(10)) % 11
    if resto == 0:
        verificador = 0
    elif resto == 1:
        return False
    else:
        verificador = 11 - resto
    return verificador == int(cuit[10])


def enmascarar_doc(doc_nro: str) -> str:
    """
    Enmascara el documento del receptor para los logs (Ley 25.326): deja sólo
    los últimos 3 dígitos, el resto con '•'. '0' (consumidor final) y valores
    muy cortos no llevan dato personal, se dejan tal cual.
    """
    s = str(doc_nro or "").strip()
    if len(s) <= 3:
        return s
    return "•" * (len(s) - 3) + s[-3:]


def _a_fecha(v: Any) -> Any:
    """Acepta date, 'YYYY-MM-DD' y 'YYYYMMDD'. Deja pasar lo demás a Pydantic."""
    if isinstance(v, str):
        s = v.strip()
        if len(s) == 8 and s.isdigit():
            return datetime.strptime(s, "%Y%m%d").date()
    return v


# ── Request ───────────────────────────────────────────────────────────────────


class FacturarRequest(BaseModel):
    """
    Todo lo necesario para emitir un comprobante llega en el body: el sidecar
    no guarda estado de ningún negocio entre requests.

    Contrato acordado con el worker facturador del core (Go).
    """

    # Emisor / tenant
    cuit_emisor: str = Field(..., description="CUIT del emisor, sólo dígitos")
    punto_venta: int = Field(..., ge=1, le=99999, description="Punto de venta habilitado en ARCA")
    modo: str = Field("homologacion", description="'homologacion' o 'produccion'")

    # Credenciales del tenant (PEM en texto plano, descifradas por el core)
    cert_pem: str = Field(..., repr=False, description="Certificado X.509 en PEM")
    key_pem: str = Field(..., repr=False, description="Clave privada en PEM")

    # Comprobante
    tipo_cbte: int = Field(FACTURA_C, description="11=Factura C (default), 6=B, 1=A")
    concepto: int = Field(CONCEPTO_SERVICIOS, ge=1, le=3, description="1=Productos, 2=Servicios, 3=Ambos")

    # Receptor
    doc_tipo: int = Field(DOC_CONSUMIDOR_FINAL, description="80=CUIT, 86=CUIL, 96=DNI, 99=Consumidor Final")
    doc_nro: str = Field("0", description="Documento del receptor; '0' para consumidor final")

    # Importes — Decimal, nunca float, en plata no se redondea de prepo
    importe_total: Decimal = Field(..., gt=Decimal("0"), description="Total del comprobante")

    # Fechas
    fecha: date = Field(..., description="Fecha del comprobante (YYYY-MM-DD)")
    servicio_desde: Optional[date] = Field(None, description="FchServDesde — obligatorio si concepto 2 o 3")
    servicio_hasta: Optional[date] = Field(None, description="FchServHasta — obligatorio si concepto 2 o 3")
    vencimiento_pago: Optional[date] = Field(
        None, description="FchVtoPago; si falta se usa `fecha` (el cobro ya ocurrió)"
    )

    model_config = {"extra": "ignore"}

    # — normalización de fechas —
    @field_validator("fecha", "servicio_desde", "servicio_hasta", "vencimiento_pago", mode="before")
    @classmethod
    def _normalizar_fechas(cls, v: Any) -> Any:
        return _a_fecha(v)

    # — emisor —
    @field_validator("cuit_emisor")
    @classmethod
    def _validar_cuit_emisor(cls, v: str) -> str:
        v = v.strip().replace("-", "").replace(".", "")
        if not v.isdigit() or len(v) != 11:
            raise ValueError("cuit_emisor debe tener 11 dígitos, sin guiones ni puntos")
        if not validar_cuit(v):
            raise ValueError("cuit_emisor inválido: el dígito verificador no cierra")
        return v

    @field_validator("modo")
    @classmethod
    def _validar_modo(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in MODOS:
            raise ValueError(f"modo debe ser uno de {MODOS}")
        return v

    # — receptor —
    @field_validator("doc_nro")
    @classmethod
    def _validar_doc_nro(cls, v: str) -> str:
        v = str(v).strip().replace("-", "").replace(".", "")
        if not v.isdigit():
            raise ValueError("doc_nro debe ser sólo números")
        return v

    @field_validator("doc_tipo")
    @classmethod
    def _validar_doc_tipo(cls, v: int) -> int:
        if v not in (DOC_CUIT, DOC_CUIL, DOC_DNI, DOC_CONSUMIDOR_FINAL):
            raise ValueError("doc_tipo debe ser 80 (CUIT), 86 (CUIL), 96 (DNI) o 99 (consumidor final)")
        return v

    @field_validator("tipo_cbte")
    @classmethod
    def _validar_tipo_cbte(cls, v: int) -> int:
        if v not in (1, 6, 11):
            raise ValueError("tipo_cbte soportado: 11 (Factura C), 6 (B) o 1 (A)")
        return v

    # — credenciales: se valida la FORMA, nunca se cita el contenido —
    @field_validator("cert_pem")
    @classmethod
    def _validar_cert(cls, v: str) -> str:
        if "-----BEGIN CERTIFICATE-----" not in v or "-----END CERTIFICATE-----" not in v:
            raise ValueError(
                "cert_pem no parece un certificado PEM válido "
                "(falta el bloque BEGIN/END CERTIFICATE)"
            )
        return v

    @field_validator("key_pem")
    @classmethod
    def _validar_key(cls, v: str) -> str:
        aperturas = (
            "-----BEGIN PRIVATE KEY-----",
            "-----BEGIN RSA PRIVATE KEY-----",
            "-----BEGIN ENCRYPTED PRIVATE KEY-----",
        )
        if not any(a in v for a in aperturas) or "-----END" not in v:
            raise ValueError(
                "key_pem no parece una clave privada PEM válida "
                "(falta el bloque BEGIN/END PRIVATE KEY)"
            )
        if "-----BEGIN ENCRYPTED PRIVATE KEY-----" in v:
            raise ValueError(
                "key_pem está cifrada con passphrase; el sidecar necesita la clave sin passphrase"
            )
        return v

    # — coherencia entre campos —
    @model_validator(mode="after")
    def _validar_conjunto(self) -> "FacturarRequest":
        if self.concepto in (CONCEPTO_SERVICIOS, CONCEPTO_AMBOS):
            if self.servicio_desde is None or self.servicio_hasta is None:
                raise ValueError(
                    "concepto 2 (servicios) exige servicio_desde y servicio_hasta"
                )
            if self.servicio_hasta < self.servicio_desde:
                raise ValueError("servicio_hasta no puede ser anterior a servicio_desde")

        if self.doc_tipo == DOC_CONSUMIDOR_FINAL:
            if self.doc_nro != "0":
                # ARCA sólo acepta 0 para el receptor sin identificar
                object.__setattr__(self, "doc_nro", "0")
        elif self.doc_nro in ("", "0"):
            raise ValueError("doc_nro es obligatorio cuando doc_tipo no es 99 (consumidor final)")

        if self.doc_tipo in (DOC_CUIT, DOC_CUIL) and not validar_cuit(self.doc_nro):
            raise ValueError("doc_nro inválido: el dígito verificador del CUIT/CUIL no cierra")

        if self.vencimiento_pago is None and self.concepto in (CONCEPTO_SERVICIOS, CONCEPTO_AMBOS):
            object.__setattr__(self, "vencimiento_pago", self.fecha)

        return self

    # — helpers de formato ARCA (YYYYMMDD) —
    @staticmethod
    def _afip_fecha(d: Optional[date]) -> Optional[str]:
        return d.strftime("%Y%m%d") if d else None

    @property
    def fecha_cbte_afip(self) -> str:
        return self._afip_fecha(self.fecha)  # type: ignore[return-value]

    @property
    def serv_desde_afip(self) -> Optional[str]:
        return self._afip_fecha(self.servicio_desde)

    @property
    def serv_hasta_afip(self) -> Optional[str]:
        return self._afip_fecha(self.servicio_hasta)

    @property
    def vto_pago_afip(self) -> Optional[str]:
        return self._afip_fecha(self.vencimiento_pago)

    def resumen_seguro(self) -> str:
        """Línea para logs. Sin PEMs, sin excepción."""
        return (
            f"cuit={self.cuit_emisor} pv={self.punto_venta} modo={self.modo} "
            f"tipo_cbte={self.tipo_cbte} concepto={self.concepto} "
            f"doc={self.doc_tipo}/{enmascarar_doc(self.doc_nro)} total={self.importe_total} "
            f"fecha={self.fecha.isoformat()}"
        )


# ── Response ──────────────────────────────────────────────────────────────────


class FacturarResponse(BaseModel):
    """
    Respuesta al worker del core. `ok=false` con `error` legible es una respuesta
    normal (HTTP 200): el core la guarda en `comprobante.last_error` y reintenta.
    """

    ok: bool = Field(..., description="True sólo si ARCA aprobó y devolvió CAE")
    numero: Optional[int] = Field(None, description="Número de comprobante asignado")
    cae: Optional[str] = Field(None, description="CAE de 14 dígitos")
    cae_vencimiento: Optional[str] = Field(
        None, description="Vencimiento del CAE en formato YYYY-MM-DD"
    )
    error: Optional[str] = Field(None, description="Error de ARCA en castellano legible")

    @classmethod
    def falla(cls, mensaje: str, numero: Optional[int] = None) -> "FacturarResponse":
        return cls(ok=False, numero=numero, cae=None, cae_vencimiento=None, error=mensaje)


class HealthResponse(BaseModel):
    """Response de /health — sin auth, sin tocar la red de ARCA."""

    ok: bool = True
    service: str = "arca-sidecar"
    version: str = "2.0.0"
    tenants_en_cache: int = 0
