"""Suits AI — Configuration via pydantic-settings."""

from __future__ import annotations

import json
import os
import warnings
from typing import Annotated, Literal

from pydantic import BaseModel, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class ModelConfig(BaseModel):
    """Per-agent model configuration (all via OpenRouter)."""

    model_id: str = "anthropic/claude-sonnet-4-5"
    max_tokens: int = 4096
    temperature: float = 0.1
    fallback_model_id: str | None = None


class AgentModelsConfig(BaseModel):
    """Model configuration for each agent."""

    segmenter: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    classifier: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    simplifier: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    risk_analyzer: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    benchmark: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    advisor: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    verifier: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    rag_chat: ModelConfig = ModelConfig(model_id="anthropic/claude-sonnet-4-5")
    general_chat: ModelConfig = ModelConfig(
        model_id="openai/gpt-4o-mini", temperature=0.3
    )
    negotiator_agent1: ModelConfig = ModelConfig(
        model_id="google/gemini-2.0-flash-001", temperature=0.7, max_tokens=2048
    )
    negotiator_agent2: ModelConfig = ModelConfig(
        model_id="openai/gpt-4o-mini", temperature=0.7, max_tokens=2048
    )


class Settings(BaseSettings):
    """Application settings loaded from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    # API key (all LLM calls go through OpenRouter)
    openrouter_api_key: str = ""

    # Agent model configs (overridable via env)
    agent_models: AgentModelsConfig = AgentModelsConfig()

    # Storage paths (relative to suits/)
    upload_dir: str = os.path.join(os.path.dirname(__file__), "..", "data", "uploads")
    results_dir: str = os.path.join(os.path.dirname(__file__), "..", "data", "results")
    metadata_dir: str = os.path.join(
        os.path.dirname(__file__), "..", "data", "metadata"
    )

    # Retry / resilience
    max_retries: int = 3
    retry_base_delay: float = 1.0

    # Upload limits
    max_file_size_mb: int = 20

    # Logging
    log_level: str = "INFO"

    # RAG embedding model loads ~150-200 MB into memory at startup. On a
    # 512 MB Render free instance that's enough to OOM-kill the worker
    # before uvicorn finishes binding the port. Set ENABLE_RAG=false to
    # skip the load — `chat_with_document` will fall back to a simpler
    # clause-as-context path that still works without retrieval.
    enable_rag: bool = True

    # CORS — accept either a JSON array (`["a","b"]`) or a comma-separated
    # string (`a,b,c`) to survive PaaS dashboards (Render, Railway, …) that
    # silently strip JSON brackets/quotes from env var values. NoDecode
    # disables pydantic-settings' eager JSON-parse for this field so our
    # validator below sees the raw string.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: object) -> object:
        if value is None:
            return ["http://localhost:3000", "http://localhost:5173"]
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return ["http://localhost:3000", "http://localhost:5173"]
            # JSON array form first.
            if stripped.startswith("["):
                try:
                    parsed = json.loads(stripped)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed]
                except json.JSONDecodeError:
                    pass  # fall through to CSV
            # Comma-separated fallback.
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    # ── Supabase (optional — when unset, auth is skipped and the app uses
    #    the local file-based storage + SQLite path exactly as before) ──
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_storage_bucket: str = "documents"

    @property
    def auth_enabled(self) -> bool:
        """True when Supabase JWT verification should run on protected endpoints.

        Auth is enabled if EITHER:
          • SUPABASE_JWT_SECRET is set (legacy HS256 verification), OR
          • SUPABASE_URL is set (asymmetric ES256/RS256 via JWKS).
        Newer Supabase projects sign with asymmetric keys and don't require
        the legacy secret at all.
        """
        return bool(self.supabase_jwt_secret or self.supabase_url)

    @property
    def supabase_configured(self) -> bool:
        """True when both URL and service-role key are set (backend can call Supabase)."""
        return bool(self.supabase_url and self.supabase_service_role_key)

    @model_validator(mode="after")
    def _check_api_key(self) -> "Settings":
        if not self.openrouter_api_key:
            warnings.warn(
                "openrouter_api_key is empty — all LLM calls will fail. "
                "Set OPENROUTER_API_KEY in your .env file.",
                stacklevel=2,
            )
        return self


from functools import lru_cache


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()  # type: ignore[call-arg]
