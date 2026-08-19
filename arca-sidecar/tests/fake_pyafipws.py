"""
Doble de pyafipws para los tests.

Los tests NO tocan la red: pyafipws real requiere el build parcheado del
Dockerfile y, sobre todo, hablar con ARCA. Acá se instala en `sys.modules` un
paquete `pyafipws` falso con la misma superficie que usa `afip_client`:

  - WSAA.Autenticar(...) → devuelve un TA y deja Token/Sign
  - WSFEv1.CrearFactura(**kwargs) → guarda lo que se le pidió emitir
  - WSFEv1.CAESolicitar() → responde según el escenario que arme el test

`escenario` es el mando a distancia: cada test lo configura antes de pegarle
al endpoint.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Escenario:
    """Qué va a contestar el ARCA falso."""

    # WSAA
    wsaa_falla: bool = False
    wsaa_excepcion: str = ""

    # WSFEv1
    ultimo_autorizado: int = 7
    cae_solicitar_ok: bool = True
    resultado: str = "A"
    cae: str = "71234567890123"
    vencimiento: str = "20260901"
    err_msg: str = ""
    errores: List[Any] = field(default_factory=list)
    observaciones: List[Any] = field(default_factory=list)

    # Registro de lo que pasó
    facturas_creadas: List[Dict[str, Any]] = field(default_factory=list)
    ivas_agregados: List[Dict[str, Any]] = field(default_factory=list)
    facturas_finales: List[Dict[str, Any]] = field(default_factory=list)
    autenticaciones: int = 0
    conexiones: int = 0

    def reset(self) -> None:
        self.__init__()  # type: ignore[misc]


escenario = Escenario()


class WSAA:
    HOMO = True

    def __init__(self) -> None:
        self.Token: Optional[str] = None
        self.Sign: Optional[str] = None
        self.Excepcion = ""
        self.Traceback = ""

    def Autenticar(self, service, certificate, privatekey, wsdl=None, cache=None, **kw):
        escenario.autenticaciones += 1
        if escenario.wsaa_falla:
            self.Excepcion = escenario.wsaa_excepcion or "error generico de WSAA"
            return None
        self.Token = "TOKEN-FALSO"
        self.Sign = "SIGN-FALSA"
        return "<loginTicketResponse/>"


class WSFEv1:
    HOMO = True

    def __init__(self) -> None:
        self.Cuit = None
        self.Token = None
        self.Sign = None
        self.factura: Dict[str, Any] = {}
        self.errores: List[Any] = []
        self.Observaciones: List[Any] = []
        self.Obs = ""
        self.ErrMsg = ""
        self.CAE = ""
        self.Vencimiento = ""
        self.Resultado = ""
        self.Reproceso = ""
        self.AppServerStatus = "OK"
        self.DbServerStatus = "OK"
        self.AuthServerStatus = "OK"

    # pyafipws real tiene este método privado; patch_analizar_errores lo envuelve.
    # La versión "original" replica el bug: revienta si Err viene como lista.
    def __analizar_errores(self, ret):
        err = ret["Errors"]["Err"]
        self.errores.append({"codigo": err["Code"], "mensaje": err["Msg"]})

    def Conectar(self, wsdl=None, cache=None, **kw):
        escenario.conexiones += 1
        return True

    def Dummy(self):
        return True

    def CompUltimoAutorizado(self, tipo_cbte, punto_vta):
        return escenario.ultimo_autorizado

    def CrearFactura(self, **kwargs):
        self.factura = dict(kwargs)
        escenario.facturas_creadas.append(dict(kwargs))
        return True

    def AgregarIva(self, **kwargs):
        escenario.ivas_agregados.append(dict(kwargs))
        self.factura.setdefault("iva", []).append(dict(kwargs))
        return True

    def CAESolicitar(self):
        escenario.facturas_finales.append(dict(self.factura))
        self.ErrMsg = escenario.err_msg
        self.errores = list(escenario.errores)
        self.Observaciones = list(escenario.observaciones)
        self.Obs = "S" if escenario.observaciones else ""
        if not escenario.cae_solicitar_ok:
            return None
        self.Resultado = escenario.resultado
        if escenario.resultado == "A":
            self.CAE = escenario.cae
            self.Vencimiento = escenario.vencimiento
        return self.CAE or True

    def CompConsultar(self, tipo_cbte, punto_vta, nro):
        return None


def instalar() -> None:
    """Registra el paquete falso en sys.modules antes de importar afip_client."""
    pkg = types.ModuleType("pyafipws")
    pkg.__path__ = []  # type: ignore[attr-defined]

    mod_wsaa = types.ModuleType("pyafipws.wsaa")
    mod_wsaa.WSAA = WSAA

    mod_wsfev1 = types.ModuleType("pyafipws.wsfev1")
    mod_wsfev1.WSFEv1 = WSFEv1

    pkg.wsaa = mod_wsaa  # type: ignore[attr-defined]
    pkg.wsfev1 = mod_wsfev1  # type: ignore[attr-defined]

    sys.modules["pyafipws"] = pkg
    sys.modules["pyafipws.wsaa"] = mod_wsaa
    sys.modules["pyafipws.wsfev1"] = mod_wsfev1
