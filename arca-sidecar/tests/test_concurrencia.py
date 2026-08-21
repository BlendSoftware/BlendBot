"""
H6 — dos facturas del mismo tenant en paralelo no se pisan.

`/facturar` es sync (threadpool de FastAPI) y el pool devuelve el MISMO
AFIPClient a requests concurrentes del mismo negocio. `facturar()` muta estado
compartido: el dict `wsfev1.factura` (lo que se manda a ARCA) y el número
correlativo. Sin serializar, dos hilos se cruzan el DNI/importe y ARCA emite un
CAE con los datos mezclados. El fix es un `threading.Lock` por AFIPClient
alrededor de todo `facturar()`.

Nada acá toca la red: se le pone al cliente un WSFEv1 de mentira que abre a
propósito la ventana de cruce y delata si dos hilos entran a la vez.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

from afip_client import AFIPClient
from conftest import CERT_PEM, CUIT_VALIDO, KEY_PEM
from schemas import DOC_DNI, FacturarRequest


class WSFEConcurrente:
    """
    WSFEv1 doblado que instrumenta el cruce: cuenta cuántos hilos están dentro
    del armado a la vez y registra el DNI que ve cada CAESolicitar. El sleep en
    CrearFactura mantiene abierta la ventana en la que, sin lock, otro hilo
    sobreescribiría `self.factura`.
    """

    def __init__(self) -> None:
        self.factura: dict = {}
        self.Cuit = None
        self.Token = None
        self.Sign = None
        self.CAE = "71234567890123"
        self.Vencimiento = "20260901"
        self.Resultado = "A"
        self.ErrMsg = ""
        self.errores: list = []
        self.Observaciones: list = []

        self._m = threading.Lock()
        self._activos = 0
        self.max_activos = 0
        self.docs_vistos: list = []

    def CompUltimoAutorizado(self, tipo_cbte, punto_vta):
        return 0

    def CrearFactura(self, **kwargs):
        with self._m:
            self._activos += 1
            self.max_activos = max(self.max_activos, self._activos)
        self.factura = dict(kwargs)
        time.sleep(0.02)  # ventana de cruce
        return True

    def AgregarIva(self, **kwargs):
        self.factura.setdefault("iva", []).append(dict(kwargs))
        return True

    def CAESolicitar(self):
        # El nro_doc que ve el fisco tiene que ser el que puso ESTE hilo.
        self.docs_vistos.append(self.factura.get("nro_doc"))
        with self._m:
            self._activos -= 1
        return True


def _cliente_con_stub(tmp_path) -> tuple[AFIPClient, WSFEConcurrente]:
    stub = WSFEConcurrente()
    client = AFIPClient(
        cuit_emisor=CUIT_VALIDO,
        cert_path="/no/existe/cert.pem",  # no se lee: token ya válido y wsfev1 puesto
        key_path="/no/existe/key.pem",
        homologacion=True,
        cache_dir=str(tmp_path / "cache"),
        tenant_key="tenant-test",
    )
    # Token vivo + wsfev1 ya "conectado": facturar() no toca red ni certificados.
    client._wsfev1 = stub  # type: ignore[assignment]
    client._token = "TOK"
    client._sign = "SIG"
    client._token_expiracion = datetime.now() + timedelta(hours=1)
    return client, stub


def _request(dni: str) -> FacturarRequest:
    return FacturarRequest(
        cuit_emisor=CUIT_VALIDO,
        punto_venta=3,
        modo="homologacion",
        cert_pem=CERT_PEM,
        key_pem=KEY_PEM,
        tipo_cbte=11,
        concepto=2,
        doc_tipo=DOC_DNI,
        doc_nro=dni,
        importe_total=Decimal("15000.00"),
        fecha=date(2026, 8, 18),
        servicio_desde=date(2026, 8, 18),
        servicio_hasta=date(2026, 8, 18),
    )


def test_facturar_concurrente_del_mismo_tenant_no_cruza_estado(tmp_path):
    client, stub = _cliente_con_stub(tmp_path)

    dnis = [f"3000000{i}" for i in range(8)]
    errores: list = []

    def correr(dni: str) -> None:
        try:
            r = client.facturar(_request(dni))
            if not r.ok:
                errores.append((dni, r.error))
        except Exception as e:  # pragma: no cover - no debería pasar
            errores.append((dni, repr(e)))

    hilos = [threading.Thread(target=correr, args=(d,)) for d in dnis]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()

    assert errores == [], f"alguna factura falló: {errores}"

    # El lock serializó: nunca dos hilos dentro del armado a la vez.
    assert stub.max_activos == 1, (
        f"hubo {stub.max_activos} hilos facturando en paralelo sobre el mismo "
        "WSFEv1: el lock no serializó"
    )

    # Cada CAESolicitar vio un DNI distinto y están TODOS: nada se pisó ni se
    # duplicó.
    assert sorted(stub.docs_vistos) == sorted(dnis)


def test_clientes_de_distintos_tenants_no_comparten_lock(tmp_path):
    """El lock es por AFIPClient: dos tenants tienen locks distintos."""
    c1, _ = _cliente_con_stub(tmp_path / "a")
    c2, _ = _cliente_con_stub(tmp_path / "b")
    assert c1._facturar_lock is not c2._facturar_lock
