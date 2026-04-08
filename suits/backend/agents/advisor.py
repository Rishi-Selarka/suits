"""Advisor Agent -- synthesizes all agent outputs into a final advisory report.

Default model: claude-sonnet-4-6-20260217 via Anthropic direct (best synthesizer).
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import ADVISOR_SYSTEM_PROMPT

VALID_RISK_LEVELS = {"LOW_RISK", "MODERATE_RISK", "HIGH_RISK", "CRITICAL_RISK"}
VALID_VERDICTS = {"SIGN", "NEGOTIATE", "WALK_AWAY"}


class AdvisorAgent(BaseAgent):
    """Synthesizes outputs from all specialist agents into a final advisory report."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "advisor",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return ADVISOR_SYSTEM_PROMPT

    def build_user_message(self, **kwargs: Any) -> str:
        """Build the user message from all agent outputs.

        Parameters
        ----------
        clauses : list[dict | Clause]
            Source clauses.
        classifications : list[dict] | None
            Classifier output.
        simplifications : list[dict] | None
            Simplifier output.
        risks : list[dict] | None
            Risk Analyzer output.
        benchmarks : list[dict] | None
            Benchmark Agent output.
        """
        clauses = kwargs["clauses"]
        classifications = kwargs.get("classifications")
        simplifications = kwargs.get("simplifications")
        risks = kwargs.get("risks")
        benchmarks = kwargs.get("benchmarks")

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
            "Synthesize the following agent outputs into a final advisory report. "
            "Return a single JSON object.\n",
            "=== ORIGINAL CLAUSES ===",
            json.dumps(formatted_clauses, indent=2),
        ]

        if classifications:
            parts.append("\n=== CLAUSE CLASSIFICATIONS ===")
            parts.append(json.dumps(classifications, indent=2))
        else:
            parts.append("\n=== CLAUSE CLASSIFICATIONS ===")
            parts.append("(Classifier agent did not produce output)")

        if simplifications:
            parts.append("\n=== PLAIN LANGUAGE SIMPLIFICATIONS ===")
            parts.append(json.dumps(simplifications, indent=2))
        else:
            parts.append("\n=== PLAIN LANGUAGE SIMPLIFICATIONS ===")
            parts.append("(Simplifier agent did not produce output)")

        if risks:
            parts.append("\n=== RISK ANALYSIS ===")
            parts.append(json.dumps(risks, indent=2))
        else:
            parts.append("\n=== RISK ANALYSIS ===")
            parts.append("(Risk Analyzer agent did not produce output)")

        if benchmarks:
            parts.append("\n=== BENCHMARK COMPARISONS ===")
            parts.append(json.dumps(benchmarks, indent=2))
        else:
            parts.append("\n=== BENCHMARK COMPARISONS ===")
            parts.append("(Benchmark agent did not produce output)")

        return "\n".join(parts)

    def validate_response(self, data: Any) -> dict[str, Any]:
        """Ensure the response is a dict with at least overall_risk_assessment."""
        if not isinstance(data, dict):
            raise AgentValidationError(
                f"Advisor expected a dict, got {type(data).__name__}"
            )

        # overall_risk_assessment is required
        if "overall_risk_assessment" not in data:
            raise AgentValidationError(
                "Advisor response missing 'overall_risk_assessment'"
            )

        ora = data["overall_risk_assessment"]
        if not isinstance(ora, dict):
            raise AgentValidationError(
                f"overall_risk_assessment should be a dict, got {type(ora).__name__}"
            )

        # Validate score
        if "score" in ora:
            try:
                ora["score"] = float(ora["score"])
            except (ValueError, TypeError):
                ora["score"] = 5.0

        # Validate level
        if "level" in ora:
            level = ora["level"].upper().strip()
            if level not in VALID_RISK_LEVELS:
                # Infer from score
                score = ora.get("score", 5.0)
                if score <= 3:
                    level = "LOW_RISK"
                elif score <= 5:
                    level = "MODERATE_RISK"
                elif score <= 7:
                    level = "HIGH_RISK"
                else:
                    level = "CRITICAL_RISK"
            ora["level"] = level

        # Validate verdict
        if "verdict" in ora:
            verdict = ora["verdict"].upper().strip()
            if verdict not in VALID_VERDICTS:
                verdict = "NEGOTIATE"  # safe default
            ora["verdict"] = verdict

        # Default optional top-level fields
        data.setdefault("document_summary", {})
        data.setdefault("critical_issues", [])
        data.setdefault("positive_aspects", [])
        data.setdefault("missing_clauses", [])
        data.setdefault("negotiation_priority_order", [])
        data.setdefault("executive_summary", "")

        # Ensure document_summary has required fields
        ds = data["document_summary"]
        ds.setdefault("document_type", "")
        ds.setdefault("parties", [])
        ds.setdefault("effective_date", None)
        ds.setdefault("duration", None)
        ds.setdefault("total_clauses_analyzed", 0)
        ds.setdefault("key_financial_terms", None)

        # Ensure critical_issues are ordered by priority
        if isinstance(data["critical_issues"], list):
            for idx, issue in enumerate(data["critical_issues"]):
                if isinstance(issue, dict):
                    issue.setdefault("priority", idx + 1)
                    issue.setdefault("clause_id", 0)
                    issue.setdefault("issue_title", "")
                    issue.setdefault("issue_description", "")
                    issue.setdefault("impact", "")
                    issue.setdefault("recommended_action", "")
                    issue.setdefault("suggested_counter_language", "")

        return data
