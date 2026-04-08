"""Benchmark Comparison Agent -- compares clauses against fair-standard baselines.

Default model: openai/gpt-4o via OpenRouter (broad legal knowledge).
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import BENCHMARK_SYSTEM_PROMPT

VALID_DEVIATION_LEVELS = {
    "STANDARD",
    "MODERATE_DEVIATION",
    "SIGNIFICANT_DEVIATION",
    "AGGRESSIVE",
}


class BenchmarkAgent(BaseAgent):
    """Compares each clause against industry-standard fair baselines."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "benchmark",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return BENCHMARK_SYSTEM_PROMPT

    def build_user_message(self, **kwargs: Any) -> str:
        """Build the user message from clauses and classifier output.

        Parameters
        ----------
        clauses : list[dict | Clause]
            Source clauses.
        classifications : list[dict]
            Output from the Classifier agent.
        """
        clauses = kwargs["clauses"]
        classifications = kwargs.get("classifications", [])

        formatted_clauses: list[dict[str, Any]] = []
        for c in clauses:
            if isinstance(c, dict):
                formatted_clauses.append({
                    "clause_id": c["clause_id"],
                    "title": c.get("title", ""),
                    "text": c.get("text", ""),
                })
            else:
                formatted_clauses.append({
                    "clause_id": c.clause_id,
                    "title": c.title,
                    "text": c.text,
                })

        parts = [
            "Compare the following clauses against fair-standard benchmarks. "
            "Return a JSON array with one object per clause.\n",
            "=== CLAUSES ===",
            json.dumps(formatted_clauses, indent=2),
        ]

        if classifications:
            parts.append("\n=== CLAUSE CLASSIFICATIONS (from Classifier Agent) ===")
            parts.append(json.dumps(classifications, indent=2))

        return "\n".join(parts)

    def validate_response(self, data: Any) -> list[dict[str, Any]]:
        """Ensure each item has clause_id and deviation_level."""
        if not isinstance(data, list):
            raise AgentValidationError(
                f"Benchmark expected a list, got {type(data).__name__}"
            )

        validated: list[dict[str, Any]] = []
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                raise AgentValidationError(
                    f"Benchmark item {i} is not a dict: {type(item).__name__}"
                )
            if "clause_id" not in item:
                raise AgentValidationError(
                    f"Benchmark item {i} missing 'clause_id'"
                )
            if "deviation_level" not in item:
                raise AgentValidationError(
                    f"Benchmark item {i} (clause_id={item.get('clause_id')}) "
                    "missing 'deviation_level'"
                )

            # Normalize deviation_level
            level = item["deviation_level"].upper().strip()
            if level not in VALID_DEVIATION_LEVELS:
                self.logger.warning(
                    f"Unknown deviation_level '{item['deviation_level']}' for "
                    f"clause_id={item['clause_id']}, defaulting to STANDARD",
                    extra={"agent": self.agent_name, "status": "warning"},
                )
                level = "STANDARD"
            item["deviation_level"] = level

            # Default optional fields
            item.setdefault("document_type_detected", "")
            item.setdefault("benchmark_comparison", "")
            item.setdefault("industry_norm", "")
            item.setdefault("is_missing_standard_protection", False)
            item.setdefault("missing_protection_detail", None)

            validated.append(item)

        return validated
