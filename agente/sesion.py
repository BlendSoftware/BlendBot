"""Estado de la conversación, en memoria del proceso.

Una sesión MCP = una conversación de WhatsApp, así que un singleton de proceso
alcanza y sobra: cuando la conversación termina, el proceso muere con ella.

Acá viven el borrador del compromiso (que NO está persistido: existe sólo hasta
que `confirmar` lo escribe en el core) y el hueco bloqueado por el hold.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any


def a_decimal(valor: Any) -> Decimal:
    """El core serializa `decimal.Decimal` como string. Plata: nunca float."""
    if isinstance(valor, Decimal):
        return valor
    try:
        return Decimal(str(valor if valor is not None else "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def plata(monto: Decimal) -> str:
    """`$8.900` — formato argentino, para que el modelo lo copie tal cual."""
    entero = monto.quantize(Decimal("1")) if monto == monto.to_integral_value() else monto
    txt = f"{entero:,.0f}" if monto == monto.to_integral_value() else f"{monto:,.2f}"
    return "$" + txt.replace(",", "·").replace(".", ",").replace("·", ".")


@dataclass
class LineaBorrador:
    servicio_id: str
    nombre: str
    cantidad: int
    precio_unit: Decimal
    duracion_min: int | None = None
    nota: str | None = None

    @property
    def subtotal(self) -> Decimal:
        return self.precio_unit * self.cantidad

    def como_dict(self) -> dict[str, Any]:
        return {
            "servicio": self.nombre,
            "cantidad": self.cantidad,
            "precio_unit": str(self.precio_unit),
            "precio_unit_texto": plata(self.precio_unit),
            "subtotal_texto": plata(self.subtotal),
            "duracion_min": self.duracion_min,
            "nota": self.nota,
        }


@dataclass
class Borrador:
    """Lo que el cliente pidió, todavía sin escribir en el core."""

    id: str = field(default_factory=lambda: f"bor_{uuid.uuid4().hex[:8]}")
    lineas: list[LineaBorrador] = field(default_factory=list)
    entrega: str | None = None
    direccion: str | None = None
    # Aclaración de TODO el pedido (no de un ítem): "tocar timbre 3B",
    # "sin cubiertos", "es para las 21:30". Va al campo nota del compromiso.
    nota: str | None = None

    @property
    def total(self) -> Decimal:
        return sum((l.subtotal for l in self.lineas), Decimal("0"))

    @property
    def duracion_min(self) -> int | None:
        duraciones = [l.duracion_min * l.cantidad for l in self.lineas if l.duracion_min]
        return sum(duraciones) if duraciones else None

    def como_dict(self) -> dict[str, Any]:
        return {
            "borrador_id": self.id,
            "lineas": [l.como_dict() for l in self.lineas],
            "total": str(self.total),
            "total_texto": plata(self.total),
            "duracion_min": self.duracion_min,
            "entrega": self.entrega,
            "direccion": self.direccion,
            "nota": self.nota,
        }


@dataclass
class Bloqueo:
    """El hold vigente: el hueco que el cliente eligió mientras completa datos."""

    hold_id: str
    recurso_id: str
    recurso: str
    inicio: str
    fin: str
    expira_en: str | None = None

    def como_dict(self) -> dict[str, Any]:
        return {
            "hold_id": self.hold_id,
            "recurso": self.recurso,
            "inicio": self.inicio,
            "fin": self.fin,
            "expira_en": self.expira_en,
        }


@dataclass
class Sesion:
    telefono: str = ""
    negocio: dict[str, Any] | None = None
    # El catálogo NO se guarda acá: se lee fresco en cada llamada. El stock del día
    # es el dato que se mueve a mitad de conversación, y una carta cacheada sigue
    # ofreciendo el último plato después de vendido. Los recursos sí se cachean: no
    # cambian durante una charla.
    recursos: list[dict[str, Any]] = field(default_factory=list)
    ultimos_huecos: list[dict[str, Any]] = field(default_factory=list)
    borrador: Borrador | None = None
    bloqueo: Bloqueo | None = None
    cliente: dict[str, Any] | None = None
    creada_en: datetime = field(default_factory=datetime.now)

    def limpiar_compromiso(self) -> None:
        """Después de confirmar: el borrador y el hold ya no son del agente."""
        self.borrador = None
        self.bloqueo = None
        self.ultimos_huecos = []


_sesion: Sesion | None = None


def sesion() -> Sesion:
    global _sesion
    if _sesion is None:
        _sesion = Sesion()
    return _sesion


def reiniciar_sesion(telefono: str = "") -> Sesion:
    """Sólo para tests y para el arranque del proceso."""
    global _sesion
    _sesion = Sesion(telefono=telefono)
    return _sesion
