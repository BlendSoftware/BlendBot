"""Estado de la conversación, persistido entre procesos MCP (por negocio+cliente).

El gateway levanta un proceso MCP NUEVO por cada mensaje de WhatsApp
(`mcpServers()` en `agente.js`): "una sesión MCP = una conversación" NO es
cierto, y asumirlo era el bug — el cliente armaba el pedido en un mensaje y al
confirmar en el siguiente, ese proceso ya había muerto y `confirmar` no
encontraba nada.

Acá viven el borrador del compromiso (que sigue sin estar escrito en el core:
eso lo hace recién `confirmar`) y el hueco bloqueado por el hold. Mientras dura
el proceso, el singleton de memoria alcanza; para que sobreviva AL proceso, se
espeja a un archivo por (negocio, cliente) en `BORRADORES_DIR` — si el gateway
no lo configuró, se sigue comportando exactamente como antes: sólo en memoria.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from settings import get_settings

# Pasados los 30 minutos, un borrador en disco se trata como si no existiera
# (se ignora y se borra): mismo criterio que el hold del core, para que el
# cliente nunca "retome" un pedido que ya se enfrió.
VENCIMIENTO_SEG = 30 * 60


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

    def a_persistir(self) -> dict[str, Any]:
        """Para el archivo de sesión: plata como texto, nunca float."""
        return {
            "servicio_id": self.servicio_id,
            "nombre": self.nombre,
            "cantidad": self.cantidad,
            "precio_unit": str(self.precio_unit),
            "duracion_min": self.duracion_min,
            "nota": self.nota,
        }

    @classmethod
    def desde_persistido(cls, d: dict[str, Any]) -> "LineaBorrador":
        return cls(
            servicio_id=str(d["servicio_id"]),
            nombre=str(d["nombre"]),
            cantidad=int(d["cantidad"]),
            precio_unit=a_decimal(d.get("precio_unit")),
            duracion_min=d.get("duracion_min"),
            nota=d.get("nota"),
        )


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

    @property
    def entrega_texto(self) -> str | None:
        """`entrega` + `direccion` ya combinados en una frase lista para leerle al
        cliente, con el mismo formato que `SKILL.md` le muestra al modelo
        («Delivery a Av Demo 250»).

        15/10: `como_dict()` exponía `entrega` y `direccion` sueltos y el modelo,
        al releerlos para redactar la respuesta, dedujo mal y dijo "sigue siendo
        para retirar" en un pedido delivery. Resolver la combinación ACÁ, una
        sola vez, le saca al modelo la inferencia que venía fallando.
        """
        if self.entrega is None:
            return None  # todavía no se decidió: no hay nada que decir
        if self.entrega == "retira":
            return "Retira por el local"
        if self.entrega == "delivery":
            return f"Delivery a {self.direccion}" if self.direccion else "Delivery (falta la dirección)"
        if self.entrega == "en_local":
            return "Come en el local"
        return None

    def como_dict(self) -> dict[str, Any]:
        return {
            "borrador_id": self.id,
            "lineas": [l.como_dict() for l in self.lineas],
            "total": str(self.total),
            "total_texto": plata(self.total),
            "duracion_min": self.duracion_min,
            "entrega": self.entrega,
            "direccion": self.direccion,
            "entrega_texto": self.entrega_texto,
            "nota": self.nota,
        }

    def a_persistir(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "entrega": self.entrega,
            "direccion": self.direccion,
            "nota": self.nota,
            "lineas": [l.a_persistir() for l in self.lineas],
        }

    @classmethod
    def desde_persistido(cls, d: dict[str, Any]) -> "Borrador":
        borrador = cls(
            id=str(d["id"]), entrega=d.get("entrega"), direccion=d.get("direccion"), nota=d.get("nota")
        )
        borrador.lineas = [LineaBorrador.desde_persistido(li) for li in d.get("lineas", [])]
        return borrador


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

    def a_persistir(self) -> dict[str, Any]:
        return {
            "hold_id": self.hold_id,
            "recurso_id": self.recurso_id,
            "recurso": self.recurso,
            "inicio": self.inicio,
            "fin": self.fin,
            "expira_en": self.expira_en,
        }

    @classmethod
    def desde_persistido(cls, d: dict[str, Any]) -> "Bloqueo":
        return cls(
            hold_id=str(d["hold_id"]),
            recurso_id=str(d["recurso_id"]),
            recurso=str(d["recurso"]),
            inicio=str(d["inicio"]),
            fin=str(d["fin"]),
            expira_en=d.get("expira_en"),
        )


def _directorio_configurado() -> str | None:
    """`BORRADORES_DIR`, o `None` si el gateway no lo seteó (modo legacy)."""
    try:
        valor = get_settings().borradores_dir
    except Exception:  # noqa: BLE001 — sin settings válidos, no hay persistencia
        return None
    return valor or None


def _clave_archivo(agente_token: str, telefono: str) -> str:
    """SHA-256 de token+teléfono: identifica el archivo sin exponer el token
    en el nombre (y el contenido tampoco lo guarda)."""
    digesto = hashlib.sha256(f"{agente_token}:{telefono}".encode("utf-8")).hexdigest()
    return f"{digesto}.json"


def _ruta_archivo(directorio: str, agente_token: str, telefono: str) -> Path:
    return Path(directorio) / _clave_archivo(agente_token, telefono)


def _escribir_atomico(ruta: Path, datos: dict[str, Any]) -> None:
    """Archivo temporal + rename: un corte a mitad no deja el archivo mocho.
    Permisos 600: el borrador es del negocio y del cliente, de nadie más."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(ruta.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(datos, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, ruta)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _cargar_desde_disco(
    directorio: str, agente_token: str, telefono: str
) -> tuple[Borrador | None, Bloqueo | None]:
    """`(borrador, bloqueo)` vigentes, o `(None, None)` si no hay archivo o si
    venció: pasados los 30 minutos se ignora Y se borra, no se arrastra."""
    ruta = _ruta_archivo(directorio, agente_token, telefono)
    try:
        crudo = ruta.read_text(encoding="utf-8")
    except OSError:
        return None, None
    try:
        datos = json.loads(crudo)
    except (ValueError, TypeError):
        return None, None

    guardado_en = datos.get("guardado_en")
    momento = None
    if guardado_en:
        try:
            momento = datetime.fromisoformat(guardado_en)
        except ValueError:
            momento = None
    vencido = momento is None or (datetime.now(timezone.utc) - momento).total_seconds() > VENCIMIENTO_SEG
    if vencido:
        try:
            ruta.unlink()
        except OSError:
            pass
        return None, None

    borrador = Borrador.desde_persistido(datos["borrador"]) if datos.get("borrador") else None
    bloqueo = Bloqueo.desde_persistido(datos["bloqueo"]) if datos.get("bloqueo") else None
    return borrador, bloqueo


@dataclass
class Sesion:
    telefono: str = ""
    negocio: dict[str, Any] | None = None
    # El catálogo NO se guarda acá: se lee fresco en cada llamada. El stock del día
    # es el dato que se mueve a mitad de conversación, y una carta cacheada sigue
    # ofreciendo el último plato después de vendido. Los recursos sí se cachean: no
    # cambian durante una charla.
    # Las categorías SÍ se cachean, y no contradice lo de arriba: el catálogo se
    # mueve durante una charla (se agota un plato), el mapa de categorías de la
    # carta no. Cachearlo evita una lectura por cada `ver_catalogo`, que el
    # agente llama en cada mensaje de cada conversación.
    categorias: dict[str, str] | None = None
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
        self.borrar_persistido()

    def _ruta_persistido(self, directorio: str) -> Path:
        cfg = get_settings()
        return _ruta_archivo(directorio, cfg.agente_token, self.telefono or cfg.cliente_telefono)

    def persistir(self) -> None:
        """Espeja borrador + hold a disco, si el gateway configuró el
        directorio. Si falla el disco, seguimos en memoria: peor es tumbar la
        conversación por un `IOError`."""
        directorio = _directorio_configurado()
        if not directorio:
            return
        datos = {
            "guardado_en": datetime.now(timezone.utc).isoformat(),
            "borrador": self.borrador.a_persistir() if self.borrador else None,
            "bloqueo": self.bloqueo.a_persistir() if self.bloqueo else None,
        }
        try:
            _escribir_atomico(self._ruta_persistido(directorio), datos)
        except OSError:
            pass

    def borrar_persistido(self) -> None:
        directorio = _directorio_configurado()
        if not directorio:
            return
        try:
            self._ruta_persistido(directorio).unlink()
        except OSError:
            pass

    def fijar_borrador(self, borrador: Borrador | None) -> None:
        """Reemplaza el borrador vigente y lo espeja a disco en el acto: el
        próximo mensaje puede caer en OTRO proceso MCP."""
        self.borrador = borrador
        self.persistir()

    def fijar_bloqueo(self, bloqueo: Bloqueo | None) -> None:
        self.bloqueo = bloqueo
        self.persistir()


_sesion: Sesion | None = None


def sesion() -> Sesion:
    global _sesion
    if _sesion is None:
        _sesion = _sesion_al_arrancar()
    return _sesion


def _sesion_al_arrancar() -> Sesion:
    """Arranque real de un proceso MCP: si hay un borrador vigente de este
    negocio+cliente en `BORRADORES_DIR`, lo recupera — es la continuación de
    la MISMA conversación, sólo que en un proceso nuevo."""
    try:
        cfg = get_settings()
    except Exception:  # noqa: BLE001 — sin settings (tests viejos), blanco y en memoria
        return Sesion()
    s = Sesion(telefono=cfg.cliente_telefono)
    directorio = cfg.borradores_dir or None
    if directorio:
        s.borrador, s.bloqueo = _cargar_desde_disco(directorio, cfg.agente_token, cfg.cliente_telefono)
    return s


def reiniciar_sesion(telefono: str = "") -> Sesion:
    """Sólo para tests: una sesión en blanco, sin tocar lo que haya en disco."""
    global _sesion
    _sesion = Sesion(telefono=telefono)
    return _sesion
