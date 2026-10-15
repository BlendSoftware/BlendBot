"""Configuración del proceso MCP.

Una sesión MCP = una conversación de WhatsApp. El gateway lanza el proceso con
`CLIENTE_TELEFONO` seteado al número del cliente que escribió y con el
`AGENTE_TOKEN` del negocio dueño de ese `phone_number_id`.

Por eso la identidad NUNCA es argumento de tool: el negocio sale del token y el
cliente del entorno. Que el modelo no pueda pasar un `negocio_id` es lo que
impide que un tenant lea a otro.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    core_url: str = Field(default="http://localhost:8080", description="Base del core Go")
    agente_token: str = Field(description="Token del negocio, formato cop_<random>")
    cliente_telefono: str = Field(description="Número de WhatsApp del cliente de esta sesión")
    timeout_s: float = Field(default=15.0, description="Techo de cada request al core")
    vertical: str = Field(default="gastronomia", description="Qué SKILL.md carga el gateway")
    borradores_dir: str = Field(
        default="",
        description=(
            "Directorio donde persistir el borrador y el hold entre procesos MCP "
            "(uno por negocio+cliente, por archivo). Vacío = sólo en memoria, "
            "como antes: lo setea el gateway, no hace falta en desarrollo."
        ),
    )

    @field_validator("core_url")
    @classmethod
    def _sin_barra_final(cls, v: str) -> str:
        return v.strip().rstrip("/")

    @field_validator("agente_token")
    @classmethod
    def _token_de_agente(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("cop_"):
            raise ValueError(
                "AGENTE_TOKEN tiene que ser un token de agente (empieza con 'cop_'). "
                "Un JWT de panel no sirve acá: el agente se autentica como negocio."
            )
        return v

    @field_validator("cliente_telefono")
    @classmethod
    def _telefono_limpio(cls, v: str) -> str:
        v = "".join(c for c in v.strip() if c.isdigit() or c == "+")
        if not v:
            raise ValueError("CLIENTE_TELEFONO vacío: el gateway tiene que inyectarlo.")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
