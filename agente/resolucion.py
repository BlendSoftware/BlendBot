"""Traducir lo que escribe un cliente a la entidad real del catálogo.

El modelo nunca manda IDs: manda "hamburguesa doble", "papas grandes" o "el
mozo juan". Acá se resuelve contra lo que el core devolvió. Si hay empate real se
devuelven los candidatos para que el agente PREGUNTE en vez de adivinar: elegir
mal un producto es peor que repreguntar.
"""

from __future__ import annotations

import difflib
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Sequence

CORTE = 0.62  # ratio mínimo de difflib para considerar que se parecen
EMPATE = 0.05  # si el segundo está a menos de esto del primero, es ambiguo


def normalizar(texto: str) -> str:
    """minúsculas, sin acentos, sin espacios de más. La comparación vive acá."""
    plano = unicodedata.normalize("NFKD", (texto or "").strip().lower())
    plano = "".join(c for c in plano if not unicodedata.combining(c))
    return " ".join(plano.split())


def _singular(palabra: str) -> str:
    """"muzzas" → "muzza", "grandes" → "grande". Sólo la "s" final: alcanza para
    comparar comienzos de palabra y no inventa raíces."""
    return palabra[:-1] if len(palabra) > 3 and palabra.endswith("s") else palabra


def _palabras_comunes(nombres: list[str]) -> set[str]:
    """Palabras (en singular) que aparecen en más de un nombre del catálogo."""
    vistas: dict[str, int] = {}
    for valor in nombres:
        for p in {_singular(t) for t in valor.split()}:
            vistas[p] = vistas.get(p, 0) + 1
    return {p for p, veces in vistas.items() if veces > 1}


def _sin_comunes(valor: str, comunes: set[str]) -> str:
    propias = [t for t in valor.split() if _singular(t) not in comunes]
    return " ".join(propias) or valor


@dataclass(frozen=True)
class Resolucion:
    """`item` resuelto, o candidatos para repreguntar. Nunca las dos cosas."""

    item: dict[str, Any] | None = None
    candidatos: list[dict[str, Any]] = field(default_factory=list)
    ambiguo: bool = False

    @property
    def ok(self) -> bool:
        return self.item is not None


def resolver(
    texto: str,
    items: Sequence[dict[str, Any]],
    *,
    campo: str = "nombre",
    corte: float = CORTE,
) -> Resolucion:
    """Elige el item cuyo `campo` mejor matchea `texto`.

    Orden: igualdad exacta normalizada → contención (una es prefijo/substring de
    la otra) → similitud difflib. Un empate técnico devuelve `ambiguo=True` con
    los candidatos, para preguntar.
    """
    if not items:
        return Resolucion()
    consulta = normalizar(texto)
    if not consulta:
        return Resolucion(candidatos=list(items[:5]))

    nombres = [normalizar(str(i.get(campo, ""))) for i in items]

    exactos = [items[n] for n, valor in enumerate(nombres) if valor == consulta]
    if len(exactos) == 1:
        return Resolucion(item=exactos[0])
    if len(exactos) > 1:
        return Resolucion(candidatos=exactos, ambiguo=True)

    contiene = [
        items[n]
        for n, valor in enumerate(nombres)
        if valor and (consulta in valor or valor in consulta)
    ]
    if len(contiene) == 1:
        return Resolucion(item=contiene[0])
    if len(contiene) > 1:
        # Desempate barato: el que arranca igual gana ("consulta" vs "consulta de control").
        arrancan = [i for i in contiene if normalizar(str(i.get(campo, ""))).startswith(consulta)]
        if len(arrancan) == 1:
            return Resolucion(item=arrancan[0])
        return Resolucion(candidatos=contiene, ambiguo=True)

    # Por palabras, antes que la similitud: cada palabra del cliente (sin la "s"
    # del plural) tiene que ser el comienzo de una palabra del plato. Con difflib a
    # secas, "muzza grande" empataba con "Fugazzeta grande" porque "grande" pesaba
    # más que "muzza" (producción, 15/10).
    # Las palabras que comparten varios platos ("grande", "empanada", "de") no
    # distinguen nada: con ellas "coca grande" resolvía a "Napolitana grande"
    # (producción, 15/10). Se compara con las que quedan; si el cliente sólo dijo
    # palabras comunes ("empanada"), se usan todas y sale ambiguo.
    comunes = _palabras_comunes(nombres)
    todas = [_singular(p) for p in consulta.split()]
    palabras = [p for p in todas if p not in comunes] or todas
    por_palabras = [
        items[n]
        for n, valor in enumerate(nombres)
        if valor and all(any(t.startswith(p) for t in valor.split()) for p in palabras)
    ]
    if len(por_palabras) == 1:
        return Resolucion(item=por_palabras[0])
    if len(por_palabras) > 1:
        return Resolucion(candidatos=por_palabras, ambiguo=True)

    distintiva = " ".join(palabras)
    puntajes = sorted(
        (
            (difflib.SequenceMatcher(None, distintiva, _sin_comunes(valor, comunes)).ratio(), n)
            for n, valor in enumerate(nombres)
            if valor
        ),
        reverse=True,
    )
    if not puntajes or puntajes[0][0] < corte:
        return Resolucion(candidatos=[items[n] for _, n in puntajes[:3]])

    mejor, indice = puntajes[0]
    if len(puntajes) > 1 and mejor - puntajes[1][0] < EMPATE:
        empatados = [items[n] for ratio, n in puntajes[:3] if mejor - ratio < EMPATE]
        return Resolucion(candidatos=empatados, ambiguo=True)
    return Resolucion(item=items[indice])
