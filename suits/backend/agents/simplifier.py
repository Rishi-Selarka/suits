"""Plain Language Simplifier Agent -- rewrites legal clauses for a 16-year-old.

Default model: claude-sonnet-4-6-20260217 via Anthropic direct (best at natural language).
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import SIMPLIFIER_SYSTEM_PROMPT


class SimplifierAgent(BaseAgent):
    """Rewrites each clause in plain English with jargon replacement and hidden-risk warnings."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "simplifier",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return SIMPLIFIER_SYSTEM_PROMPT

    def build_user_message(self, **kwargs: Any) -> str:
        """Build the user message from a list of clauses.

        Parameters
        ----------
        clauses : list[dict | Clause]
            Each clause must have clause_id, title, and text.
        """
        clauses = kwargs["clauses"]
        formatted: list[dict[str, Any]] = []
        for c in clauses:
            if isinstance(c, dict):
                formatted.append({
                    "clause_id": c["clause_id"],
                    "title": c.get("title", ""),
                    "text": c.get("text", ""),
                })
            else:
                formatted.append({
                    "clause_id": c.clause_id,
                    "title": c.title,
                    "text": c.text,
                })
        return (
            "Simplify the following legal clauses into plain English. "
            "Return a JSON array with one object per clause.\n\n"
            f"{json.dumps(formatted, indent=2)}"
        )

    def validate_response(self, data: Any) -> list[dict[str, Any]]:
        """Ensure each item has clause_id and simplified_text."""
        if not isinstance(data, list):
            raise AgentValidationError(
                f"Simplifier expected a list, got {type(data).__name__}"
            )

        validated: list[dict[str, Any]] = []
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                raise AgentValidationError(
                    f"Simplifier item {i} is not a dict: {type(item).__name__}"
                )
            if "clause_id" not in item:
                raise AgentValidationError(
                    f"Simplifier item {i} missing 'clause_id'"
                )
            if "simplified_text" not in item or not item["simplified_text"]:
                raise AgentValidationError(
                    f"Simplifier item {i} (clause_id={item.get('clause_id')}) "
                    "missing or empty 'simplified_text'"
                )

            # Compute lengths if missing
            if "original_length" not in item:
                item["original_length"] = 0
            if "simplified_length" not in item:
                item["simplified_length"] = len(item["simplified_text"].split())

            # Default empty lists/nulls
            if "jargon_replaced" not in item:
                item["jargon_replaced"] = []
            if "hidden_implications" not in item:
                item["hidden_implications"] = None

            validated.append(item)

        return validated
