"""Multi-provider LLM client for Suits AI.

Routes calls to Anthropic (direct) or OpenRouter (OpenAI-compatible).
Provides retry, fallback, and structured response handling.
"""

from __future__ import annotations

import asyncio
import time
from typing import Literal

import anthropic
import openai

from config import ModelConfig, Settings
from logging_config import get_logger
from models import LLMResponse

logger = get_logger("llm_client")

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class LLMClient:
    """Unified async LLM client supporting Anthropic + OpenRouter."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._anthropic: anthropic.AsyncAnthropic | None = None
        self._openrouter: openai.AsyncOpenAI | None = None

    # ── Lazy client init ─────────────────────────────────────────────────

    @property
    def anthropic_client(self) -> anthropic.AsyncAnthropic:
        if self._anthropic is None:
            self._anthropic = anthropic.AsyncAnthropic(
                api_key=self.settings.anthropic_api_key
            )
        return self._anthropic

    @property
    def openrouter_client(self) -> openai.AsyncOpenAI:
        if self._openrouter is None:
            self._openrouter = openai.AsyncOpenAI(
                api_key=self.settings.openrouter_api_key,
                base_url=OPENROUTER_BASE_URL,
            )
        return self._openrouter

    # ── Core call ────────────────────────────────────────────────────────

    async def call(
        self,
        config: ModelConfig,
        system_prompt: str,
        user_message: str,
        *,
        override_model_id: str | None = None,
        override_provider: Literal["anthropic", "openrouter"] | None = None,
    ) -> LLMResponse:
        """Make a single LLM call routed by provider."""
        provider = override_provider or config.provider
        model_id = override_model_id or config.model_id
        start = time.perf_counter()

        if provider == "anthropic":
            resp = await self._call_anthropic(model_id, system_prompt, user_message, config)
        else:
            resp = await self._call_openrouter(model_id, system_prompt, user_message, config)

        latency = int((time.perf_counter() - start) * 1000)
        resp.latency_ms = latency

        logger.info(
            "LLM call complete",
            extra={
                "model": resp.model,
                "tokens_in": resp.tokens_in,
                "tokens_out": resp.tokens_out,
                "latency_ms": latency,
                "status": "success",
            },
        )
        return resp

    # ── Retry wrapper ────────────────────────────────────────────────────

    async def call_with_retry(
        self,
        config: ModelConfig,
        system_prompt: str,
        user_message: str,
    ) -> LLMResponse:
        """Call with exponential backoff for transient errors, then try fallback."""
        last_exc: Exception | None = None

        for attempt in range(self.settings.max_retries):
            try:
                return await self.call(config, system_prompt, user_message)
            except (
                anthropic.RateLimitError,
                anthropic.InternalServerError,
                openai.RateLimitError,
                openai.InternalServerError,
            ) as exc:
                last_exc = exc
                delay = self.settings.retry_base_delay * (2 ** attempt)
                logger.warning(
                    f"Transient error (attempt {attempt + 1}/{self.settings.max_retries}), "
                    f"retrying in {delay:.1f}s",
                    extra={
                        "model": config.model_id,
                        "retries": attempt + 1,
                        "status": "retry",
                    },
                )
                await asyncio.sleep(delay)
            except Exception as exc:
                # Non-transient — don't retry
                last_exc = exc
                break

        # Try fallback model if configured
        if config.fallback_model_id:
            logger.info(
                f"Primary model failed, trying fallback: {config.fallback_model_id}",
                extra={"model": config.fallback_model_id, "status": "fallback"},
            )
            try:
                return await self.call(
                    config,
                    system_prompt,
                    user_message,
                    override_model_id=config.fallback_model_id,
                    override_provider="openrouter",
                )
            except Exception as fallback_exc:
                logger.error(
                    f"Fallback also failed: {fallback_exc}",
                    extra={"model": config.fallback_model_id, "status": "failed"},
                )

        raise last_exc or RuntimeError("LLM call failed with no exception captured")

    # ── Provider implementations ─────────────────────────────────────────

    async def _call_anthropic(
        self,
        model_id: str,
        system_prompt: str,
        user_message: str,
        config: ModelConfig,
    ) -> LLMResponse:
        response = await self.anthropic_client.messages.create(
            model=model_id,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        text = response.content[0].text if response.content else ""
        return LLMResponse(
            text=text,
            model=response.model,
            tokens_in=response.usage.input_tokens,
            tokens_out=response.usage.output_tokens,
        )

    async def _call_openrouter(
        self,
        model_id: str,
        system_prompt: str,
        user_message: str,
        config: ModelConfig,
    ) -> LLMResponse:
        response = await self.openrouter_client.chat.completions.create(
            model=model_id,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        choice = response.choices[0] if response.choices else None
        text = choice.message.content if choice and choice.message else ""
        usage = response.usage
        return LLMResponse(
            text=text or "",
            model=response.model or model_id,
            tokens_in=usage.prompt_tokens if usage else 0,
            tokens_out=usage.completion_tokens if usage else 0,
        )

    # ── Cleanup ──────────────────────────────────────────────────────────

    async def close(self) -> None:
        if self._anthropic:
            await self._anthropic.close()
        if self._openrouter:
            await self._openrouter.close()
