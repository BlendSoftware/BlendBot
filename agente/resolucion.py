"""Traducir lo que escribe un paciente a la entidad real del catálogo.

El modelo nunca manda IDs: manda "limpiesa", "arreglo de caries" o "la dra
gomez". Acá se resuelve contra lo que el core devolvió. Si hay empate real se
devuelven los candidatos para que el agente PREGUNTE en vez de adivinar: elegir
mal una práctica es peor que repreguntar.
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

    puntajes = sorted(
        (
            (difflib.SequenceMatcher(None, consulta, valor).ratio(), n)
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
