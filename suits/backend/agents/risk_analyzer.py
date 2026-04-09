"""Risk Analyzer Agent -- Indian-context legal risk scoring and pattern detection.

Default model: openai/gpt-4o via OpenRouter (deep reasoning capability).
Fallback model: anthropic/claude-3.5-sonnet via OpenRouter.
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import RISK_ANALYZER_SYSTEM_PROMPT

VALID_RISK_LEVELS = {"GREEN", "YELLOW", "RED"}


class RiskAnalyzerAgent(BaseAgent):
    """Scores each clause on risk severity and flags dangerous patterns."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "risk_analyzer",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return RISK_ANALYZER_SYSTEM_PROMPT

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
            "Analyze the risk of each clause below. "
            "Return a JSON array with one object per clause.\n",
            "=== CLAUSES ===",
            json.dumps(formatted_clauses, indent=2),
        ]

        if classifications:
            parts.append("\n=== CLAUSE CLASSIFICATIONS (from Classifier Agent) ===")
            parts.append(json.dumps(classifications, indent=2))

        return "\n".join(parts)

    def validate_response(self, data: Any) -> list[dict[str, Any]]:
        """Ensure each item has clause_id, risk_score (int 1-10), and risk_level."""
        if not isinstance(data, list):
            raise AgentValidationError(
                f"RiskAnalyzer expected a list, got {type(data).__name__}"
            )

        validated: list[dict[str, Any]] = []
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                raise AgentValidationError(
                    f"RiskAnalyzer item {i} is not a dict: {type(item).__name__}"
                )
            if "clause_id" not in item:
                raise AgentValidationError(
                    f"RiskAnalyzer item {i} missing 'clause_id'"
                )

            # risk_score: must be int 1-10
            if "risk_score" not in item:
                raise AgentValidationError(
                    f"RiskAnalyzer item {i} (clause_id={item.get('clause_id')}) "
                    "missing 'risk_score'"
                )
            try:
                score = int(item["risk_score"])
            except (ValueError, TypeError) as exc:
                raise AgentValidationError(
                    f"RiskAnalyzer item {i} (clause_id={item.get('clause_id')}) "
                    f"risk_score is not an integer: {item['risk_score']!r}"
                ) from exc
            clamped = max(1, min(10, score))
            if score != clamped:
                self.logger.warning(
                    f"Risk score {score} for clause_id={item.get('clause_id')} "
                    f"clamped to {clamped}",
                    extra={"agent": self.agent_name, "status": "warning"},
                )
            item["risk_score"] = clamped

            # risk_level: must be GREEN/YELLOW/RED
            if "risk_level" not in item:
                raise AgentValidationError(
                    f"RiskAnalyzer item {i} (clause_id={item.get('clause_id')}) "
                    "missing 'risk_level'"
                )
            level = item["risk_level"].upper().strip()
            if level not in VALID_RISK_LEVELS:
                # Infer from score
                if item["risk_score"] <= 3:
                    level = "GREEN"
                elif item["risk_score"] <= 6:
                    level = "YELLOW"
                else:
                    level = "RED"
                self.logger.warning(
                    f"Invalid risk_level '{item['risk_level']}' for clause_id={item['clause_id']}, "
                    f"inferred as {level}",
                    extra={"agent": self.agent_name, "status": "warning"},
                )
            item["risk_level"] = level

            # Default optional fields
            item.setdefault("perspective", "")
            item.setdefault("flags", [])
            item.setdefault("reasoning", "")
            item.setdefault("specific_concern", None)
            item.setdefault("suggested_modification", None)
            item.setdefault("india_specific_note", None)

            # Ensure flags is a list of strings
            if not isinstance(item["flags"], list):
                item["flags"] = []

            validated.append(item)

        return validated
