"""Verifier Agent -- critiques and refines the Advisor's advisory report.

Implements a generate-then-critique-then-refine pattern.  Checks factual accuracy,
cross-clause interactions, hallucinations, completeness, and India-specific issues.

Default model: claude-sonnet-4-6-20260217 via Anthropic direct (same model for consistency).
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import VERIFIER_SYSTEM_PROMPT


class VerifierAgent(BaseAgent):
    """Critiques the Advisor output, catches hallucinations, and refines the report."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "verifier",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return VERIFIER_SYSTEM_PROMPT

    def build_user_message(self, **kwargs: Any) -> str:
        """Build the user message from clauses, advisor output, and supporting data.

        Parameters
        ----------
        clauses : list[dict | Clause]
            Source clauses (the ground truth).
        advisor_output : dict
            The Advisor agent's advisory report to verify.
        risks : list[dict] | None
            Risk Analyzer output (for completeness checking).
        benchmarks : list[dict] | None
            Benchmark Agent output (for completeness checking).
        """
        clauses = kwargs["clauses"]
        advisor_output = kwargs["advisor_output"]
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
            "Verify and refine the following advisory report. "
            "Return a single JSON object (refined report + verification_notes).\n",
            "=== ORIGINAL CLAUSES (ground truth) ===",
            json.dumps(formatted_clauses, indent=2),
            "\n=== DRAFT ADVISORY REPORT (from Advisor Agent) ===",
            json.dumps(advisor_output, indent=2),
        ]

        if risks:
            parts.append("\n=== RISK ANALYSIS (for completeness check) ===")
            parts.append(json.dumps(risks, indent=2))

        if benchmarks:
            parts.append("\n=== BENCHMARK COMPARISONS (for completeness check) ===")
            parts.append(json.dumps(benchmarks, indent=2))

        return "\n".join(parts)

    def validate_response(self, data: Any) -> dict[str, Any]:
        """Ensure the response is a dict with verification_notes."""
        if not isinstance(data, dict):
            raise AgentValidationError(
                f"Verifier expected a dict, got {type(data).__name__}"
            )

        # verification_notes is the key addition from the verifier
        if "verification_notes" not in data:
            raise AgentValidationError(
                "Verifier response missing 'verification_notes'"
            )

        vn = data["verification_notes"]
        if not isinstance(vn, dict):
            raise AgentValidationError(
                f"verification_notes should be a dict, got {type(vn).__name__}"
            )

        # Ensure all verification sub-fields exist with defaults
        vn.setdefault("factual_corrections", [])
        vn.setdefault("cross_clause_interactions", [])
        vn.setdefault("hallucinations_caught", [])
        vn.setdefault("completeness_additions", [])

        # confidence_score: float 0-1
        if "confidence_score" in vn:
            try:
                vn["confidence_score"] = max(0.0, min(1.0, float(vn["confidence_score"])))
            except (ValueError, TypeError):
                vn["confidence_score"] = 0.5
        else:
            vn["confidence_score"] = 0.5

        # The verifier output should also contain the refined advisory fields.
        # Ensure core advisory structure is present (carried from advisor or refined).
        data.setdefault("overall_risk_assessment", {})
        data.setdefault("document_summary", {})
        data.setdefault("critical_issues", [])
        data.setdefault("positive_aspects", [])
        data.setdefault("missing_clauses", [])
        data.setdefault("negotiation_priority_order", [])
        data.setdefault("executive_summary", "")

        return data
