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
from prompts.templates import INJECTION_DEFENSE

logger = get_logger("base_agent")


# ── Exceptions ───────────────────────────────────────────────────────────────


class AgentParseError(Exception):
    """Raised when agent output cannot be parsed as JSON."""


class AgentValidationError(Exception):
    """Raised when parsed output fails schema validation."""


class AgentExecutionError(Exception):
    """Raised when the agent run fails for any other reason."""


def _extract_balanced_json(text: str) -> str | None:
    """Return the outermost balanced JSON object/array in ``text``, or None.

    The earlier regex fallback (``r"(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\})"``)
    was non-greedy and tried ``[`` first, so prose followed by an object
    containing an array would yield the inner array — wrong type, fed
    silently to ``validate_response``. This scanner counts nesting depth
    while honouring string quoting so a brace inside ``"a {b}"`` doesn't
    pop the stack early.
    """
    n = len(text)
    # Find the first opener — `{` or `[` — whichever comes first.
    start = -1
    opener = ""
    for i, ch in enumerate(text):
        if ch == "{" or ch == "[":
            start = i
            opener = ch
            break
    if start == -1:
        return None
    closer = "}" if opener == "{" else "]"

    depth = 0
    in_string = False
    escape = False
    for i in range(start, n):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[start: i + 1]
    return None


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
                INJECTION_DEFENSE + "\n\n" + self.system_prompt(),
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
        4. Brace-counting fallback: scan for the LARGEST balanced JSON
           document starting from the first `{` or `[`. This matters
           because a non-greedy regex will return the first nested array
           when the outer payload is an object that contains arrays —
           e.g. ``Sure, here:\n{"foo": [1,2]}`` would parse to ``[1,2]``
           and silently feed the wrong type to ``validate_response``.
        """
        cleaned = text.strip()

        # Strip markdown code fences (handle ```json, ```JSON, ``` etc.)
        fence_match = re.match(r"^```\w*\s*\n?", cleaned)
        if fence_match:
            cleaned = cleaned[fence_match.end():]
            # Remove closing fence — may be on its own line or trailing
            cleaned = re.sub(r"\n?```\s*$", "", cleaned)
            cleaned = cleaned.strip()

        # Direct parse
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Balanced-document fallback. Walks the first `{` or `[`, counts
        # nesting depth (string-aware so braces inside strings don't
        # confuse it), and returns the substring up to the matching
        # closer. Whichever opener appears first wins — that's the
        # outermost JSON value.
        extracted = _extract_balanced_json(cleaned)
        if extracted is not None:
            try:
                return json.loads(extracted)
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
