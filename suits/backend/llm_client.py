"""Multi-provider LLM client for Suits AI.

All calls go through OpenRouter (OpenAI-compatible API).
Provides retry, fallback, and structured response handling.
"""

from __future__ import annotations

import asyncio
import time

import openai

from config import ModelConfig, Settings
from logging_config import get_logger
from models import LLMResponse

logger = get_logger("llm_client")

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class LLMClient:
    """Unified async LLM client — all calls routed through OpenRouter."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: openai.AsyncOpenAI | None = None

    @property
    def client(self) -> openai.AsyncOpenAI:
        if self._client is None:
            self._client = openai.AsyncOpenAI(
                api_key=self.settings.openrouter_api_key,
                base_url=OPENROUTER_BASE_URL,
            )
        return self._client

    # ── Core call ────────────────────────────────────────────────────────

    async def call(
        self,
        config: ModelConfig,
        system_prompt: str,
        user_message: str,
        *,
        override_model_id: str | None = None,
    ) -> LLMResponse:
        """Make a single LLM call via OpenRouter."""
        model_id = override_model_id or config.model_id
        start = time.perf_counter()

        response = await self.client.chat.completions.create(
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
        latency = int((time.perf_counter() - start) * 1000)

        resp = LLMResponse(
            text=text or "",
            model=response.model or model_id,
            tokens_in=usage.prompt_tokens if usage else 0,
            tokens_out=usage.completion_tokens if usage else 0,
            latency_ms=latency,
        )

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
                )
            except Exception as fallback_exc:
                logger.error(
                    f"Fallback also failed: {fallback_exc}",
                    extra={"model": config.fallback_model_id, "status": "failed"},
                )

        raise last_exc or RuntimeError("LLM call failed with no exception captured")

    # ── Cleanup ──────────────────────────────────────────────────────────

    async def close(self) -> None:
        if self._client:
            await self._client.close()
