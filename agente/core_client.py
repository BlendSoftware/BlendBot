"""Cliente HTTP del core Go.

El agente NUNCA toca la base: todo pasa por acá con `Authorization: Bearer cop_…`.
El otro trabajo de este módulo es traducir los códigos del core a mensajes que
un modelo pueda accionar: un 409 no es "error 409", es "ese hueco se acaba de
ocupar, ofrecé otro".
"""

from __future__ import annotations

from typing import Any

import httpx


class ErrorDelCore(Exception):
    """Falla ya traducida a algo que el modelo puede decirle al cliente.

    `codigo` es para ramificar en el server; `mensaje` es para que el modelo lo
    lea y actúe; `detalle` es el texto crudo del core, sólo para diagnóstico.
    """

    def __init__(
        self,
        mensaje: str,
        *,
        codigo: str = "error",
        status: int | None = None,
        detalle: str = "",
    ) -> None:
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.codigo = codigo
        self.status = status
        self.detalle = detalle

    def como_dict(self) -> dict[str, Any]:
        return {
            "ok": False,
            "error": self.mensaje,
            "codigo": self.codigo,
            "status": self.status,
            "detalle": self.detalle or None,
        }


def _detalle_de(resp: httpx.Response) -> str:
    """Saca el texto del sobre de error del core (`{"detail": "..."}`)."""
    try:
        cuerpo = resp.json()
    except Exception:  # noqa: BLE001 — cuerpo no-JSON (proxy, 502 de gateway)
        return resp.text[:200]
    if isinstance(cuerpo, dict):
        detalle = str(cuerpo.get("detail") or cuerpo.get("error") or "")
        campos = cuerpo.get("fields")
        if isinstance(campos, dict) and campos:
            detalle += " (" + "; ".join(f"{k}: {v}" for k, v in campos.items()) + ")"
        return detalle.strip()
    return str(cuerpo)[:200]


def traducir(status: int, detalle: str, contexto: str) -> ErrorDelCore:
    """Traduce un status del core a instrucción accionable para el modelo.

    `contexto` dice qué se estaba haciendo ("hold", "compromiso", "estado",
    "disponibilidad", "cliente", "catalogo", "negocio"): el mismo 409 significa
    "el hueco se ocupó" al reservar y "esa transición no existe" al cambiar
    estado.
    """
    d = (detalle or "").lower()

    if status in (401, 403):
        return ErrorDelCore(
            "El token del negocio no es válido o no tiene permiso. Esto es un problema de "
            "configuración del negocio, no del cliente: pedí disculpas, no reintentes "
            "y decile que en un rato lo contactan.",
            codigo="auth",
            status=status,
            detalle=detalle,
        )

    if status == 404:
        if contexto == "cliente":
            return ErrorDelCore(
                "No existe ficha para ese teléfono todavía.",
                codigo="no_encontrado",
                status=status,
                detalle=detalle,
            )
        return ErrorDelCore(
            "Eso no existe en el sistema del negocio. No lo des por hecho: verificá con "
            "las tools antes de afirmarle nada al cliente.",
            codigo="no_encontrado",
            status=status,
            detalle=detalle,
        )

    if status == 409:
        if contexto == "estado":
            return ErrorDelCore(
                "El core rechazó ese cambio de estado porque no es una transición válida "
                "desde el estado actual. No insistas: contale al cliente qué sí se puede "
                "hacer o derivalo al negocio.",
                codigo="transicion_invalida",
                status=status,
                detalle=detalle,
            )
        return ErrorDelCore(
            "Ese hueco se acaba de ocupar. Pedile disculpas al cliente, volvé a consultar "
            "disponibilidad y ofrecele otro horario. No lo des por reservado.",
            codigo="ocupado",
            status=status,
            detalle=detalle,
        )

    if status == 422:
        if "duracion" in d or "duración" in d:
            return ErrorDelCore(
                "Esa práctica no tiene la duración cargada en el sistema, así que no puedo "
                "calcular horarios. NO inventes una duración ni un horario: decile que para "
                "esa práctica lo van a contactar del negocio para agendar.",
                codigo="sin_duracion",
                status=status,
                detalle=detalle,
            )
        return ErrorDelCore(
            "Esa práctica no está disponible ahora. No la ofrezcas: proponé otra del "
            "catálogo o avisá que por esa tienen que llamar al negocio.",
            codigo="no_disponible",
            status=status,
            detalle=detalle,
        )

    if status >= 500:
        return ErrorDelCore(
            "El sistema del negocio no está respondiendo. No inventes datos ni des nada "
            "por agendado: decile al cliente que hubo un problema y que en un rato lo "
            "contactan.",
            codigo="core_caido",
            status=status,
            detalle=detalle,
        )

    return ErrorDelCore(
        f"El core rechazó el pedido ({contexto}): {detalle or 'sin detalle'}. Revisá los "
        "datos antes de reintentar; si no los tenés, preguntale al cliente.",
        codigo="pedido_invalido",
        status=status,
        detalle=detalle,
    )


class CoreClient:
    """Envoltorio fino sobre httpx: un método por endpoint del core que el agente usa."""

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout_s: float = 15.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._propio = client is None
        self._http = client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout_s, connect=min(5.0, timeout_s)),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "copiloto-agente/1.0",
            },
        )

    async def aclose(self) -> None:
        if self._propio:
            await self._http.aclose()

    async def __aenter__(self) -> "CoreClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    # ── transporte ────────────────────────────────────────────────────────────

    async def _pedir(
        self,
        metodo: str,
        path: str,
        *,
        contexto: str,
        json: Any | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        try:
            resp = await self._http.request(metodo, path, json=json, params=params)
        except httpx.TimeoutException as e:
            raise ErrorDelCore(
                "El sistema del negocio tardó demasiado en responder. NO des la "
                "operación por hecha: decile al cliente que hubo demora y reintentá una "
                "sola vez si tiene sentido.",
                codigo="timeout",
                detalle=str(e),
            ) from e
        except httpx.HTTPError as e:
            raise ErrorDelCore(
                "No pude comunicarme con el sistema del negocio. No inventes datos: "
                "avisale al cliente que en un rato lo contactan.",
                codigo="sin_conexion",
                detalle=str(e),
            ) from e

        if resp.status_code >= 400:
            raise traducir(resp.status_code, _detalle_de(resp), contexto)

        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    # ── negocio y catálogo ────────────────────────────────────────────────────

    async def negocio(self) -> dict[str, Any]:
        return await self._pedir("GET", "/api/negocio", contexto="negocio") or {}

    async def servicios(self, categoria: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"solo_disponibles": "true"}
        if categoria:
            params["categoria"] = categoria
        datos = await self._pedir("GET", "/api/servicios", contexto="catalogo", params=params)
        return list(datos or [])

    async def categorias(self) -> list[dict[str, Any]]:
        datos = await self._pedir("GET", "/api/categorias", contexto="catalogo")
        return list(datos or [])

    async def recursos(self) -> list[dict[str, Any]]:
        datos = await self._pedir("GET", "/api/recursos", contexto="catalogo")
        return list(datos or [])

    async def coberturas(self) -> list[dict[str, Any]]:
        datos = await self._pedir("GET", "/api/coberturas", contexto="catalogo")
        return list(datos or [])

    # ── disponibilidad ────────────────────────────────────────────────────────

    async def consultar_disponibilidad(
        self,
        servicio_id: str,
        *,
        desde: str | None = None,
        dias: int | None = None,
        recurso_id: str | None = None,
    ) -> dict[str, Any]:
        cuerpo: dict[str, Any] = {"servicio_id": servicio_id}
        if desde:
            cuerpo["desde"] = desde
        if dias:
            cuerpo["dias"] = dias
        if recurso_id:
            cuerpo["recurso_id"] = recurso_id
        datos = await self._pedir(
            "POST", "/api/disponibilidad/consultar", contexto="disponibilidad", json=cuerpo
        )
        if isinstance(datos, list):  # el core puede devolver la lista pelada
            return {"huecos": datos}
        return datos or {}

    # ── clientes ──────────────────────────────────────────────────────────────

    async def cliente_por_telefono(self, telefono: str) -> dict[str, Any] | None:
        """None si todavía no tiene ficha — no es un error, es un cliente nuevo."""
        try:
            return await self._pedir(
                "GET", f"/api/clientes/por-telefono/{telefono}", contexto="cliente"
            )
        except ErrorDelCore as e:
            if e.codigo == "no_encontrado":
                return None
            raise

    async def crear_cliente(
        self,
        telefono: str,
        *,
        nombre: str | None = None,
        cobertura_id: str | None = None,
    ) -> dict[str, Any]:
        cuerpo: dict[str, Any] = {"telefono": telefono}
        if nombre:
            cuerpo["nombre"] = nombre
        if cobertura_id:
            cuerpo["cobertura_id"] = cobertura_id
        return await self._pedir("POST", "/api/clientes", contexto="cliente", json=cuerpo) or {}

    async def actualizar_cliente(
        self,
        cliente_id: str,
        *,
        nombre: str | None = None,
        cobertura_id: str | None = None,
    ) -> dict[str, Any]:
        cuerpo: dict[str, Any] = {}
        if nombre:
            cuerpo["nombre"] = nombre
        if cobertura_id:
            cuerpo["cobertura_id"] = cobertura_id
        return (
            await self._pedir(
                "PATCH", f"/api/clientes/{cliente_id}", contexto="cliente", json=cuerpo
            )
            or {}
        )

    # ── consultas ─────────────────────────────────────────────────────────────

    async def crear_consulta(
        self, pregunta: str, *, cliente_id: str | None = None
    ) -> dict[str, Any]:
        """Registra una pregunta que el agente no supo responder para que el local la
        conteste. `cliente_id` puede ir vacío (cliente sin ficha): el core lo admite null.
        """
        cuerpo: dict[str, Any] = {"pregunta": pregunta}
        if cliente_id:
            cuerpo["cliente_id"] = cliente_id
        return (
            await self._pedir("POST", "/api/consultas", contexto="consulta", json=cuerpo) or {}
        )

    # ── motor ─────────────────────────────────────────────────────────────────

    async def crear_hold(
        self, recurso_id: str, inicio: str, fin: str, sesion: str
    ) -> dict[str, Any]:
        cuerpo = {"recurso_id": recurso_id, "inicio": inicio, "fin": fin, "sesion": sesion}
        return await self._pedir("POST", "/api/holds", contexto="hold", json=cuerpo) or {}

    async def liberar_hold(self, hold_id: str, sesion: str) -> None:
        await self._pedir(
            "DELETE", f"/api/holds/{hold_id}", contexto="hold", params={"sesion": sesion}
        )

    async def crear_compromiso(self, cuerpo: dict[str, Any]) -> dict[str, Any]:
        return (
            await self._pedir("POST", "/api/compromisos", contexto="compromiso", json=cuerpo) or {}
        )

    async def transicionar(
        self,
        compromiso_id: str,
        estado: str,
        *,
        demora_min: int | None = None,
        recurso_id: str | None = None,
    ) -> dict[str, Any]:
        cuerpo: dict[str, Any] = {"estado": estado}
        if demora_min is not None:
            cuerpo["demora_min"] = demora_min
        if recurso_id:
            cuerpo["recurso_id"] = recurso_id
        return (
            await self._pedir(
                "PATCH", f"/api/compromisos/{compromiso_id}/estado", contexto="estado", json=cuerpo
            )
            or {}
        )

    async def compromiso(self, compromiso_id: str) -> dict[str, Any]:
        return (
            await self._pedir(
                "GET", f"/api/compromisos/{compromiso_id}", contexto="compromiso"
            )
            or {}
        )
