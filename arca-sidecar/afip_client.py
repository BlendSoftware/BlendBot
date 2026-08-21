"""
Copiloto Comercios — Sidecar ARCA · cliente

Wrapper de pyafipws para WSAA (autenticación) y WSFEv1 (facturación).
Heredado de BlendPos/afip-sidecar, que factura en producción desde hace meses.

Qué cambió respecto del original:
  - Una instancia por TENANT (CUIT + certificado), no una global del proceso.
  - `facturar()` habla el contrato nuevo (Factura C, concepto servicios) y
    devuelve `FacturarResponse` con `ok/numero/cae/cae_vencimiento/error`
    en vez de propagar excepciones al handler.
  - Las claves de Redis para el token WSAA llevan la huella del tenant.

Qué NO cambió (y no se toca sin motivo demostrado):
  - El flujo WSAA con su manejo de `coe.alreadyAuthenticated`.
  - Las reglas de armado de la factura (ImpTotConc/ImpNeto, array IVA por tipo
    de comprobante, CondicionIVAReceptorId de la RG 5616). Cada una de esas
    líneas es un error de ARCA que ya costó sangre.

Flujo:
1. WSAA: autenticar con certificado X.509 → Token y Sign
2. Cache: token válido ~12h (memoria + Redis opcional)
3. WSFEv1: solicitar CAE con Token y Sign activos
4. Retry: si el token expiró, re-autenticar automáticamente
"""

# IMPORTANTE: Importar py3_compat PRIMERO para monkey-patch hashlib
import py3_compat  # noqa: F401  (efecto de import intencional)

# IMPORTANTE: Importar patch para __analizar_errores ANTES de usar WSFEv1
import patch_analizar_errores  # noqa: F401  (monkey patch por import)

import logging
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from pyafipws.wsaa import WSAA
from pyafipws.wsfev1 import WSFEv1

from schemas import (
    DOC_CUIL,
    DOC_CUIT,
    DOC_DNI,
    DOC_CONSUMIDOR_FINAL,
    FACTURA_C,
    FacturarRequest,
    FacturarResponse,
    validar_cuit,
)

logger = logging.getLogger("arca_client")


class AFIPClient:
    """
    Cliente ARCA (ex AFIP) de UN tenant: maneja autenticación (WSAA) y
    facturación electrónica (WSFEv1) para un CUIT y su certificado.
    """

    def __init__(
        self,
        cuit_emisor: str,
        cert_path: str,
        key_path: str,
        homologacion: bool = True,
        cache_dir: str = "/tmp/arca_cache",
        rdb=None,
        tenant_key: str = "default",
    ):
        self.cuit_emisor = cuit_emisor
        self.cert_path = cert_path
        self.key_path = key_path
        self.homologacion = homologacion
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.tenant_key = tenant_key

        # Redis opcional: persiste el token WSAA entre reinicios del sidecar.
        self._rdb = rdb

        # Subdirectorio para tickets (separado del cache WSDL)
        self.tickets_dir = self.cache_dir / "tickets"
        self.tickets_dir.mkdir(parents=True, exist_ok=True)

        # Subdirectorio para cache WSDL de pysimplesoap
        self.wsdl_cache_dir = self.cache_dir / "wsdl"
        self.wsdl_cache_dir.mkdir(parents=True, exist_ok=True)

        # Estado interno
        self._wsfev1: Optional[WSFEv1] = None
        # Candado de facturación: el sidecar sirve /facturar sync (threadpool de
        # FastAPI) y el pool devuelve ESTE mismo cliente a requests concurrentes
        # del mismo tenant. facturar() muta estado compartido —el dict
        # `wsfev1.factura` y el número correlativo (ultimo+1)—, así que dos
        # facturas en paralelo se pisaban y salía un CAE con importe/DNI
        # cruzados. Serializamos por tenant; distintos tenants tienen distinto
        # cliente y distinto lock, así que siguen facturando en paralelo.
        self._facturar_lock = threading.Lock()
        self._token: Optional[str] = None
        self._sign: Optional[str] = None
        self._token_expiracion: Optional[datetime] = None
        self._ultima_autenticacion: Optional[str] = None

        # URLs de ARCA
        if homologacion:
            self.wsaa_url = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl"
            self.wsfev1_url = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL"
        else:
            self.wsaa_url = "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl"
            self.wsfev1_url = "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL"

        logger.info(
            "Cliente ARCA inicializado — tenant: %s, modo: %s",
            self.tenant_key,
            "HOMOLOGACION" if homologacion else "PRODUCCION",
        )

    # ── Cache Redis del token WSAA ────────────────────────────────────────────
    # El token dura ~12 horas. Persistirlo evita re-autenticar en cada reinicio
    # (ARCA castiga eso con "alreadyAuthenticated"). Las claves llevan la huella
    # del tenant: en multi-tenant compartir la clave sería un desastre fiscal.

    _REDIS_TTL_SEC = 43200  # 12 horas — vida del token de ARCA

    def _redis_key(self, campo: str) -> str:
        return f"arca:wsaa:{self.tenant_key}:{campo}"

    def _save_token_to_cache(self) -> None:
        if self._rdb is None or not self._token or not self._sign or not self._token_expiracion:
            return
        try:
            pipe = self._rdb.pipeline()
            pipe.set(self._redis_key("token"), self._token, ex=self._REDIS_TTL_SEC)
            pipe.set(self._redis_key("sign"), self._sign, ex=self._REDIS_TTL_SEC)
            pipe.set(
                self._redis_key("expiracion"),
                self._token_expiracion.isoformat(),
                ex=self._REDIS_TTL_SEC,
            )
            pipe.execute()
        except Exception as e:
            logger.warning("No se pudo guardar el token WSAA en Redis: %s", e)

    def _load_token_from_cache(self) -> bool:
        if self._rdb is None:
            return False
        try:
            token = self._rdb.get(self._redis_key("token"))
            sign = self._rdb.get(self._redis_key("sign"))
            exp = self._rdb.get(self._redis_key("expiracion"))
            if not token or not sign or not exp:
                return False

            if isinstance(token, bytes):
                token = token.decode()
            if isinstance(sign, bytes):
                sign = sign.decode()
            if isinstance(exp, bytes):
                exp = exp.decode()

            expiracion = datetime.fromisoformat(exp)
            if datetime.now() >= (expiracion - timedelta(minutes=5)):
                return False

            self._token = token
            self._sign = sign
            self._token_expiracion = expiracion
            logger.info(
                "Token WSAA restaurado desde Redis para tenant %s — válido hasta %s",
                self.tenant_key,
                expiracion.strftime("%Y-%m-%d %H:%M:%S"),
            )
            return True
        except Exception as e:
            logger.warning("No se pudo restaurar el token WSAA desde Redis: %s", e)
            return False

    # ── WSAA ──────────────────────────────────────────────────────────────────

    def _validar_certificados(self):
        if not os.path.exists(self.cert_path):
            raise FileNotFoundError("El certificado del negocio no está disponible en disco")
        if not os.path.exists(self.key_path):
            raise FileNotFoundError("La clave privada del negocio no está disponible en disco")

    def _token_valido(self) -> bool:
        if not self._token or not self._sign or not self._token_expiracion:
            return False
        # Renovar 5 minutos antes de expirar, por las dudas
        return datetime.now() < (self._token_expiracion - timedelta(minutes=5))

    def autenticar(self, forzar: bool = False) -> Dict[str, str]:
        """
        Autentica con WSAA para obtener Token y Sign.

        Raises:
            Exception: si ARCA rechaza la autenticación.
        """
        if not forzar and self._token_valido():
            return {
                "token": self._token,
                "sign": self._sign,
                "expiracion": self._token_expiracion.isoformat(),
            }

        if not forzar and self._load_token_from_cache():
            return {
                "token": self._token,
                "sign": self._sign,
                "expiracion": self._token_expiracion.isoformat(),
            }

        logger.info("Autenticando con WSAA — tenant %s", self.tenant_key)
        self._validar_certificados()

        try:
            wsaa = WSAA()
            wsaa.HOMO = self.homologacion

            # Cache del ticket de acceso, por tenant
            ta_file = self.tickets_dir / f"ta_{self.cuit_emisor}_wsfe.xml"
            if forzar and ta_file.exists():
                ta_file.unlink()

            ta = wsaa.Autenticar(
                "wsfe",  # service (posicional)
                self.cert_path,  # certificate (posicional)
                self.key_path,  # privatekey (posicional)
                wsdl=self.wsaa_url,
                cache="",  # cache vacío deshabilita el pickle (problemas Python 2/3)
            )

            if not ta:
                excepcion = wsaa.Excepcion or ""
                # coe.alreadyAuthenticated: ARCA dice que ya hay un TA vivo para
                # este certificado. Pasa si el token anterior se emitió y no se
                # guardó (crash). Expira solo (máx. 5hs). No es fatal.
                if "alreadyAuthenticated" in excepcion:
                    raise Exception(f"WSAA_ALREADY_AUTHENTICATED: {excepcion}")
                if getattr(wsaa, "Traceback", None):
                    logger.error("Traceback de pyafipws:\n%s", wsaa.Traceback)
                raise Exception(f"WSAA auth falló: {excepcion}")

            self._token = wsaa.Token
            self._sign = wsaa.Sign
            # pyafipws no expone la expiración; ARCA da ~12h
            self._token_expiracion = datetime.now() + timedelta(hours=12)
            self._ultima_autenticacion = datetime.now().isoformat()
            self._save_token_to_cache()

            logger.info(
                "Autenticación WSAA exitosa — tenant %s, token válido hasta %s",
                self.tenant_key,
                self._token_expiracion.strftime("%Y-%m-%d %H:%M:%S"),
            )

            return {
                "token": self._token,
                "sign": self._sign,
                "expiracion": self._token_expiracion.isoformat(),
            }

        except Exception as e:
            logger.error("Error al autenticar con WSAA (tenant %s): %s", self.tenant_key, e)
            raise

    # ── WSFEv1 ────────────────────────────────────────────────────────────────

    def _get_wsfev1(self) -> WSFEv1:
        """Instancia de WSFEv1 con token activo; autentica si hace falta."""
        if not self._token_valido():
            self.autenticar()

        if self._wsfev1 is None:
            self._wsfev1 = WSFEv1()
            self._wsfev1.HOMO = self.homologacion
            self._wsfev1.Conectar(wsdl=self.wsfev1_url, cache=str(self.wsdl_cache_dir))

        # Credenciales en cada llamada, por si rotó el token
        self._wsfev1.Cuit = self.cuit_emisor
        self._wsfev1.Token = self._token
        self._wsfev1.Sign = self._sign
        return self._wsfev1

    def probar_conexion(self) -> Dict[str, Any]:
        """Dummy de WSFEv1. Sólo se usa a mano: /health no toca la red."""
        try:
            wsfe = self._get_wsfev1()
            wsfe.Dummy()
            return {
                "conectado": True,
                "app_server": wsfe.AppServerStatus,
                "db_server": wsfe.DbServerStatus,
                "auth_server": wsfe.AuthServerStatus,
                "ultima_autenticacion": self._ultima_autenticacion,
            }
        except Exception as e:
            return {
                "conectado": False,
                "error": str(e),
                "ultima_autenticacion": self._ultima_autenticacion,
            }

    def obtener_ultimo_comprobante(self, punto_venta: int, tipo_cbte: int) -> int:
        """Último número emitido para ese PV y tipo (0 si es el primero)."""
        wsfe = self._get_wsfev1()
        ultimo = wsfe.CompUltimoAutorizado(tipo_cbte, punto_venta)
        if getattr(wsfe, "ErrMsg", ""):
            logger.warning("Advertencia al pedir el último comprobante: %s", wsfe.ErrMsg)
        return int(ultimo) if ultimo else 0

    # ── Facturación ───────────────────────────────────────────────────────────

    def facturar(self, req: FacturarRequest) -> FacturarResponse:
        """
        Pide el CAE a ARCA. Nunca lanza por errores del fisco: los devuelve en
        `FacturarResponse.error` para que el core los guarde y reintente.

        Serializado por tenant: toma `self._facturar_lock` alrededor de todo el
        armado + CAESolicitar, porque el WSFEv1 (y su número correlativo) es
        compartido y no reentrante.
        """
        with self._facturar_lock:
            return self._facturar_serializado(req)

    def _facturar_serializado(self, req: FacturarRequest) -> FacturarResponse:
        logger.info("Solicitando CAE — %s", req.resumen_seguro())

        numero_cbte: Optional[int] = None
        try:
            # Validaciones que ARCA castiga con códigos crípticos
            if req.doc_tipo == DOC_CUIT and req.doc_nro.strip() == str(self.cuit_emisor).strip():
                return FacturarResponse.falla(
                    "El CUIT del receptor no puede ser igual al del emisor "
                    "(ARCA 10069). Revisá los datos del cliente."
                )
            if req.doc_tipo in (DOC_CUIT, DOC_CUIL) and not validar_cuit(req.doc_nro):
                return FacturarResponse.falla(
                    f"El CUIT/CUIL del receptor ({req.doc_nro}) es inválido (ARCA 10015)."
                )

            wsfe = self._get_wsfev1()

            ultimo = self.obtener_ultimo_comprobante(req.punto_venta, req.tipo_cbte)
            numero_cbte = ultimo + 1

            # Importes. Factura C (monotributo): ImpTotConc = 0, el total va
            # entero en ImpNeto, sin IVA discriminado ni exento ni tributos.
            # El monotributista no es agente de IVA: no hay nada que abrir.
            imp_total = float(round(req.importe_total, 2))
            imp_neto = imp_total
            imp_tot_conc = 0.00
            imp_op_ex = 0.00
            imp_iva = 0.00
            imp_trib = 0.00

            wsfe.CrearFactura(
                concepto=req.concepto,
                tipo_doc=req.doc_tipo,
                nro_doc=req.doc_nro,
                tipo_cbte=req.tipo_cbte,
                punto_vta=req.punto_venta,
                cbt_desde=numero_cbte,
                cbt_hasta=numero_cbte,  # un solo comprobante
                imp_total=imp_total,
                imp_tot_conc=imp_tot_conc,
                imp_neto=imp_neto,
                imp_iva=imp_iva,
                imp_trib=imp_trib,
                imp_op_ex=imp_op_ex,
                fecha_cbte=req.fecha_cbte_afip,
                # Concepto 2/3 (servicios): ARCA exige el período y el vencimiento
                fecha_venc_pago=req.vto_pago_afip,
                fecha_serv_desde=req.serv_desde_afip,
                fecha_serv_hasta=req.serv_hasta_afip,
                moneda_id="PES",
                moneda_ctz=1.0,
            )

            # RG 5616: condición de IVA del receptor (obligatoria desde 2024)
            # 5 = Consumidor Final | 1 = IVA Responsable Inscripto
            if req.doc_tipo in (DOC_DNI, DOC_CONSUMIDOR_FINAL):
                condicion_iva = 5
            elif req.doc_tipo == DOC_CUIT:
                condicion_iva = 1
            else:
                condicion_iva = 5  # default seguro
            wsfe.factura["condicion_iva_receptor_id"] = int(condicion_iva)

            # Array IVA según tipo de comprobante:
            #  - C (11): NO se informa (ARCA 10071 si va)
            #  - B  (6): alícuota 0% no discriminada
            #  - A  (1): discriminado obligatorio (ARCA 10070)
            # Alícuotas: 3=0%, 4=10.5%, 5=21%, 6=27%
            if req.tipo_cbte == FACTURA_C:
                pass
            else:
                wsfe.AgregarIva(iva_id=3, base_imp=imp_neto, importe=0.00)

            logger.debug("Factura armada para tenant %s: %s", self.tenant_key, wsfe.factura)

            resultado = wsfe.CAESolicitar()

            if not resultado:
                return FacturarResponse.falla(self._mensaje_error(wsfe), numero=numero_cbte)

            cae = getattr(wsfe, "CAE", None)
            vencimiento = getattr(wsfe, "Vencimiento", None)
            resultado_arca = getattr(wsfe, "Resultado", "")

            if resultado_arca != "A" or not cae:
                return FacturarResponse.falla(
                    self._mensaje_error(wsfe, prefijo=f"ARCA no aprobó el comprobante (resultado {resultado_arca or 'desconocido'})"),
                    numero=numero_cbte,
                )

            logger.info(
                "CAE obtenido — tenant %s, nro %s, vto %s",
                self.tenant_key,
                numero_cbte,
                vencimiento,
            )
            return FacturarResponse(
                ok=True,
                numero=numero_cbte,
                cae=str(cae),
                cae_vencimiento=_iso(vencimiento),
                error=None,
            )

        except FileNotFoundError as e:
            return FacturarResponse.falla(str(e), numero=numero_cbte)
        except Exception as e:
            msg = str(e)
            if "WSAA_ALREADY_AUTHENTICATED" in msg:
                return FacturarResponse.falla(
                    "ARCA todavía tiene activo un ticket de acceso anterior para este "
                    "certificado. Se reintenta automáticamente cuando expire.",
                    numero=numero_cbte,
                )
            logger.exception("Error al facturar (tenant %s): %s", self.tenant_key, e)
            return FacturarResponse.falla(f"Error al comunicarse con ARCA: {msg}", numero=numero_cbte)

    # ── Errores legibles ──────────────────────────────────────────────────────

    @staticmethod
    def _mensaje_error(wsfe, prefijo: str = "ARCA rechazó el comprobante") -> str:
        """
        Junta todo lo que ARCA haya dicho — ErrMsg, errores y observaciones —
        en una sola línea legible. El core la guarda en `last_error` y termina
        en la pantalla del dueño del negocio, así que tiene que entenderse.
        """
        partes: list[str] = []

        err_msg = getattr(wsfe, "ErrMsg", "") or ""
        if err_msg.strip():
            partes.append(err_msg.strip())

        for err in getattr(wsfe, "errores", None) or []:
            if isinstance(err, dict):
                partes.append(f"[{err.get('codigo', err.get('Code', '?'))}] {err.get('mensaje', err.get('Msg', ''))}")
            else:
                partes.append(str(err))

        for obs in getattr(wsfe, "Observaciones", None) or []:
            if isinstance(obs, dict):
                partes.append(f"[{obs.get('Code', '?')}] {obs.get('Msg', '')}")
            else:
                partes.append(str(obs))

        # Deduplicar preservando orden
        vistos = set()
        limpio = []
        for p in partes:
            p = p.strip()
            if p and p not in vistos:
                vistos.add(p)
                limpio.append(p)

        detalle = " | ".join(limpio) if limpio else "sin detalle"
        return f"{prefijo}: {detalle}"


def _iso(fecha_afip) -> Optional[str]:
    """ARCA devuelve YYYYMMDD; el core espera una fecha ISO."""
    if not fecha_afip:
        return None
    s = str(fecha_afip).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s
