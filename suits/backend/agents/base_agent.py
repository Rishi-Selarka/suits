"""Abstract base class for all Suits AI agents.

Provides the run/parse/validate lifecycle, hallucination guard, and timing.
Every concrete agent must implement system_prompt(), build_user_message(), and
validate_response().
"""

from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod
from typing import Any

from config import ModelConfig
from llm_client import LLMClient
from logging_config import get_logger

logger = get_logger("base_agent")


# ── Exceptions ───────────────────────────────────────────────────────────────


class AgentParseError(Exception):
    """Raised when agent output cannot be parsed as JSON."""


class AgentValidationError(Exception):
    """Raised when parsed output fails schema validation."""


class AgentExecutionError(Exception):
    """Raised when the agent run fails for any other reason."""


# ── Base Agent ───────────────────────────────────────────────────────────────


class BaseAgent(ABC):
    """Abstract base for every Suits agent.

    Lifecycle (called by ``run``):
        1. ``build_user_message(**kwargs)`` -- assemble the prompt
        2. ``llm_client.call_with_retry(config, system_prompt, user_message)``
        3. ``parse_response(text)`` -- JSON extraction with markdown / regex fallback
        4. ``validate_response(data)`` -- schema checks
        5. ``hallucination_guard(data, clauses)`` -- cross-check clause_ids
    """

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str,
    ) -> None:
        self.llm_client = llm_client
        self.model_config = model_config
        self.agent_name = agent_name
        self.logger = get_logger(f"agent.{agent_name}")

    # ── Abstract methods (must be implemented by every agent) ────────────

    @abstractmethod
    def system_prompt(self) -> str:
        """Return the system prompt for this agent."""

    @abstractmethod
    def build_user_message(self, **kwargs: Any) -> str:
        """Build the user message from the provided keyword arguments."""

    @abstractmethod
    def validate_response(self, data: Any) -> Any:
        """Validate parsed data and return it (possibly transformed).

        Raise ``AgentValidationError`` if the data is malformed.
        """

    # ── Run lifecycle ────────────────────────────────────────────────────

    async def run(self, **kwargs: Any) -> dict[str, Any]:
        """Execute the full agent lifecycle and return results with timing.

        Returns
        -------
        dict with keys: ``data``, ``timing_ms``, ``model_used``.
        """
        start = time.perf_counter()

        try:
            user_message = self.build_user_message(**kwargs)
        except Exception as exc:
            raise AgentExecutionError(
                f"{self.agent_name}: failed to build user message: {exc}"
            ) from exc

        self.logger.info(
            "Agent starting LLM call",
            extra={"agent": self.agent_name, "model": self.model_config.model_id, "status": "running"},
        )

        try:
            response = await self.llm_client.call_with_retry(
                self.model_config,
                self.system_prompt(),
                user_message,
            )
        except Exception as exc:
            raise AgentExecutionError(
                f"{self.agent_name}: LLM call failed: {exc}"
            ) from exc

        try:
            parsed = self.parse_response(response.text)
        except AgentParseError:
            raise
        except Exception as exc:
            raise AgentParseError(
                f"{self.agent_name}: unexpected parse error: {exc}"
            ) from exc

        try:
            validated = self.validate_response(parsed)
        except AgentValidationError:
            raise
        except Exception as exc:
            raise AgentValidationError(
                f"{self.agent_name}: validation error: {exc}"
            ) from exc

        # Hallucination guard: cross-check clause_ids against source clauses
        clauses = kwargs.get("clauses")
        if clauses is not None:
            validated = self.hallucination_guard(validated, clauses)

        elapsed_ms = int((time.perf_counter() - start) * 1000)

        self.logger.info(
            "Agent completed",
            extra={
                "agent": self.agent_name,
                "model": response.model,
                "latency_ms": elapsed_ms,
                "tokens_in": response.tokens_in,
                "tokens_out": response.tokens_out,
                "status": "success",
            },
        )

        return {
            "data": validated,
            "timing_ms": elapsed_ms,
            "model_used": response.model,
        }

    # ── JSON parsing with fallback ───────────────────────────────────────

    def parse_response(self, text: str) -> Any:
        """Parse LLM text output into a Python object (list or dict).

        Strategy:
        1. Strip leading/trailing whitespace.
        2. Strip markdown code fences (```json ... ``` or ``` ... ```).
        3. Try ``json.loads`` directly.
        4. Regex fallback: extract the first JSON array or object.
        """
        cleaned = text.strip()

        # Strip markdown code fences
        if cleaned.startswith("```"):
            # Remove opening fence (possibly with language hint)
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            # Remove closing fence
            if "```" in cleaned:
                cleaned = cleaned.rsplit("```", 1)[0]
            cleaned = cleaned.strip()

        # Direct parse
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Regex fallback: find the first complete JSON array or object
        match = re.search(r"(\[[\s\S]*\]|\{[\s\S]*\})", cleaned)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        raise AgentParseError(
            f"Could not parse JSON from {self.agent_name} response "
            f"(first 200 chars: {text[:200]!r})"
        )

    # ── Hallucination guard ──────────────────────────────────────────────

    def hallucination_guard(self, data: Any, clauses: list[Any]) -> Any:
        """Cross-check agent output clause_ids against source clauses.

        For list outputs, each item with a ``clause_id`` key is verified against
        the set of valid clause_ids from the source document.  Items referencing
        non-existent clause_ids receive a ``_hallucination_warning`` annotation.

        Subclasses may override for agent-specific checks.
        """
        # Build set of valid clause_ids
        valid_ids: set[int] = set()
        for c in clauses:
            if isinstance(c, dict):
                cid = c.get("clause_id")
            else:
                cid = getattr(c, "clause_id", None)
            if cid is not None:
                valid_ids.add(cid)

        if not valid_ids:
            return data

        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "clause_id" in item:
                    if item["clause_id"] not in valid_ids:
                        item["_hallucination_warning"] = (
                            f"clause_id {item['clause_id']} not found in source document"
                        )
                        self.logger.warning(
                            "Hallucination detected: invalid clause_id",
                            extra={
                                "agent": self.agent_name,
                                "clause_id": item["clause_id"],
                                "status": "hallucination",
                            },
                        )
        elif isinstance(data, dict):
            # For dict outputs (advisor, verifier), check nested lists
            for key in ("critical_issues", "positive_aspects"):
                items = data.get(key, [])
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict) and "clause_id" in item:
                            if item["clause_id"] not in valid_ids:
                                item["_hallucination_warning"] = (
                                    f"clause_id {item['clause_id']} not found in source document"
                                )
                                self.logger.warning(
                                    "Hallucination detected: invalid clause_id in advisory",
                                    extra={
                                        "agent": self.agent_name,
                                        "clause_id": item["clause_id"],
                                        "status": "hallucination",
                                    },
                                )

        return data
