"""Suits AI — Configuration via pydantic-settings."""

from __future__ import annotations

import os
from typing import Literal

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelConfig(BaseModel):
    """Per-agent model configuration."""

    provider: Literal["anthropic", "openrouter"] = "openrouter"
    model_id: str = "openai/gpt-4o-mini"
    max_tokens: int = 4096
    temperature: float = 0.1
    fallback_model_id: str | None = None


class AgentModelsConfig(BaseModel):
    """Model configuration for each agent."""

    segmenter: ModelConfig = ModelConfig(
        provider="openrouter", model_id="openai/gpt-4o-mini"
    )
    classifier: ModelConfig = ModelConfig(
        provider="openrouter", model_id="openai/gpt-4o-mini"
    )
    simplifier: ModelConfig = ModelConfig(
        provider="openrouter", model_id="anthropic/claude-sonnet-4-5"
    )
    risk_analyzer: ModelConfig = ModelConfig(
        provider="openrouter",
        model_id="openai/gpt-4o",
        fallback_model_id="anthropic/claude-sonnet-4-5",
    )
    benchmark: ModelConfig = ModelConfig(
        provider="openrouter", model_id="openai/gpt-4o"
    )
    advisor: ModelConfig = ModelConfig(
        provider="openrouter", model_id="anthropic/claude-opus-4-5"
    )
    verifier: ModelConfig = ModelConfig(
        provider="openrouter", model_id="anthropic/claude-opus-4-5"
    )
    rag_chat: ModelConfig = ModelConfig(
        provider="openrouter", model_id="anthropic/claude-sonnet-4-5"
    )


class Settings(BaseSettings):
    """Application settings loaded from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "..", ".env"),
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    # Required API keys
    anthropic_api_key: str = ""
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

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]


def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()  # type: ignore[call-arg]
