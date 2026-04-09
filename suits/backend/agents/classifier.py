"""Clause Classifier Agent -- categorizes clauses into a 16-category legal taxonomy.

Default model: openai/gpt-4o-mini via OpenRouter (fast, accurate for classification).
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import CLASSIFIER_SYSTEM_PROMPT

VALID_CATEGORIES = {
    "DEFINITIONS",
    "TERM_AND_DURATION",
    "PAYMENT",
    "OBLIGATIONS",
    "TERMINATION",
    "LIABILITY",
    "CONFIDENTIALITY",
    "INTELLECTUAL_PROPERTY",
    "DISPUTE_RESOLUTION",
    "NON_COMPETE",
    "FORCE_MAJEURE",
    "INSURANCE",
    "COMPLIANCE",
    "MISCELLANEOUS",
    "REPRESENTATIONS",
    "DATA_PRIVACY",
}


class ClassifierAgent(BaseAgent):
    """Classifies each clause into a legal taxonomy category and subcategory."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "classifier",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return CLASSIFIER_SYSTEM_PROMPT

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
            "Classify the following clauses. "
            "Return a JSON array with one object per clause.\n\n"
            f"{json.dumps(formatted, indent=2)}"
        )

    def validate_response(self, data: Any) -> list[dict[str, Any]]:
        """Ensure each item has clause_id, category, and subcategory."""
        if not isinstance(data, list):
            raise AgentValidationError(
                f"Classifier expected a list, got {type(data).__name__}"
            )

        validated: list[dict[str, Any]] = []
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                raise AgentValidationError(
                    f"Classifier item {i} is not a dict: {type(item).__name__}"
                )
            if "clause_id" not in item:
                raise AgentValidationError(
                    f"Classifier item {i} missing 'clause_id'"
                )
            try:
                item["clause_id"] = int(item["clause_id"])
            except (ValueError, TypeError):
                self.logger.warning(
                    f"Non-numeric clause_id '{item['clause_id']}' in item {i}, keeping as-is",
                    extra={"agent": self.agent_name, "status": "warning"},
                )
            if "category" not in item:
                raise AgentValidationError(
                    f"Classifier item {i} (clause_id={item.get('clause_id')}) "
                    "missing 'category'"
                )
            if "subcategory" not in item:
                raise AgentValidationError(
                    f"Classifier item {i} (clause_id={item.get('clause_id')}) "
                    "missing 'subcategory'"
                )

            # Normalize category to uppercase
            item["category"] = item["category"].upper().strip()

            # Warn on unknown categories but don't reject
            if item["category"] not in VALID_CATEGORIES:
                self.logger.warning(
                    f"Unknown category '{item['category']}' for clause_id={item['clause_id']}, "
                    "defaulting to MISCELLANEOUS",
                    extra={"agent": self.agent_name, "status": "warning"},
                )
                item["category"] = "MISCELLANEOUS"

            # Default confidence if missing
            if "confidence" not in item:
                item["confidence"] = 1.0

            validated.append(item)

        return validated
