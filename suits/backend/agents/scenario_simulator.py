"""Scenario Simulator agent — predictive what-if analysis grounded in clauses.

Given a user hypothetical (free-text or template) and a document's parsed
clauses + prior risk/advisory output, the agent produces a structured
ScenarioReport: outcome, timeline, triggered clauses, financial impact,
mitigation steps, and Indian-law citations.

Default model: anthropic/claude-sonnet-4-5 via OpenRouter (deep reasoning
preferred — the agent has to *trace* a hypothetical through real clauses).
"""

from __future__ import annotations

import json
from typing import Any

from agents.base_agent import AgentValidationError, BaseAgent
from config import ModelConfig
from llm_client import LLMClient
from prompts.templates import SCENARIO_SIMULATOR_SYSTEM_PROMPT

VALID_SEVERITY = {"FAVORABLE", "NEUTRAL", "UNFAVORABLE", "CRITICAL"}
VALID_DISPUTE = {"LOW", "MEDIUM", "HIGH"}
VALID_PERSPECTIVE = {"OUT_OF_POCKET", "RECOVERABLE", "MIXED", "NONE"}
VALID_PHASE = {"BEFORE", "DURING", "AFTER"}
VALID_URGENCY = {"LOW", "MEDIUM", "HIGH"}


class ScenarioSimulatorAgent(BaseAgent):
    """Trace a hypothetical through a parsed contract and predict the outcome."""

    def __init__(
        self,
        llm_client: LLMClient,
        model_config: ModelConfig,
        agent_name: str = "scenario_simulator",
    ) -> None:
        super().__init__(llm_client, model_config, agent_name)

    def system_prompt(self) -> str:
        return SCENARIO_SIMULATOR_SYSTEM_PROMPT

    def build_user_message(self, **kwargs: Any) -> str:
        """Assemble the user message.

        Parameters
        ----------
        clauses : list[dict | Clause]
            All clauses from the analysed document.
        query : str
            The user's hypothetical (e.g. "what if I terminate after 6 months?").
        risks : list[dict] (optional)
            Risk-analyzer output for additional context.
        advisory_summary : str (optional)
            Executive summary from the advisor agent.
        document_type : str (optional)
            Detected document type to bias the answer.
        """
        clauses = kwargs["clauses"]
        query = kwargs["query"]
        risks = kwargs.get("risks") or []
        advisory_summary = (kwargs.get("advisory_summary") or "").strip()
        document_type = (kwargs.get("document_type") or "").strip()

        formatted_clauses: list[dict[str, Any]] = []
        for c in clauses:
            if isinstance(c, dict):
                formatted_clauses.append({
                    "clause_id": c["clause_id"],
                    "title": c.get("title", ""),
                    "text": c.get("text", "")[:1500],
                })
            else:
                formatted_clauses.append({
                    "clause_id": c.clause_id,
                    "title": c.title,
                    "text": (c.text or "")[:1500],
                })

        # Compact risk summary — only RED/YELLOW with their specific concern
        risk_lines: list[str] = []
        for r in risks:
            level = r.get("risk_level") if isinstance(r, dict) else getattr(r, "risk_level", None)
            if level not in {"RED", "YELLOW"}:
                continue
            cid = r.get("clause_id") if isinstance(r, dict) else getattr(r, "clause_id", None)
            score = r.get("risk_score") if isinstance(r, dict) else getattr(r, "risk_score", None)
            concern = (
                r.get("specific_concern") or r.get("reasoning") or ""
                if isinstance(r, dict)
                else getattr(r, "specific_concern", None) or getattr(r, "reasoning", "")
            )
            risk_lines.append(f"  - Clause {cid} [{level} {score}/10]: {concern}")

        parts: list[str] = []

        if document_type:
            parts.append(f"=== DOCUMENT TYPE ===\n{document_type}\n")

        if advisory_summary:
            parts.append(f"=== EXECUTIVE SUMMARY (from prior analysis) ===\n{advisory_summary}\n")

        if risk_lines:
            parts.append("=== KNOWN RISKY CLAUSES (from risk analyzer) ===")
            parts.extend(risk_lines)
            parts.append("")

        parts.append("=== ALL CLAUSES (id, title, text) ===")
        parts.append(json.dumps(formatted_clauses, indent=2))
        parts.append("")

        parts.append("=== USER SCENARIO ===")
        parts.append(query)
        parts.append("")

        parts.append(
            "Trace this scenario through the contract above. Return ONLY the "
            "JSON object specified in the system prompt — no markdown fences, "
            "no extra prose."
        )

        return "\n".join(parts)

    def validate_response(self, data: Any) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise AgentValidationError(
                f"ScenarioSimulator expected a dict, got {type(data).__name__}"
            )

        # Required string fields with defaults if missing
        for key in (
            "scenario_summary", "headline_outcome",
            "dispute_probability_reasoning",
            "best_case", "worst_case", "user_leverage",
        ):
            data.setdefault(key, "")
            if not isinstance(data[key], str):
                data[key] = str(data[key])

        # Severity / probability enums — coerce or default
        sev = str(data.get("outcome_severity", "NEUTRAL")).upper().strip()
        data["outcome_severity"] = sev if sev in VALID_SEVERITY else "NEUTRAL"

        prob = str(data.get("dispute_probability", "LOW")).upper().strip()
        data["dispute_probability"] = prob if prob in VALID_DISPUTE else "LOW"

        # Financial impact
        fi = data.get("estimated_financial_impact") or {}
        if not isinstance(fi, dict):
            fi = {}
        fi.setdefault("amount_range_inr", "unclear from contract")
        fi.setdefault("calculation_basis", "")
        persp = str(fi.get("user_perspective", "NONE")).upper().strip()
        fi["user_perspective"] = persp if persp in VALID_PERSPECTIVE else "NONE"
        data["estimated_financial_impact"] = fi

        # Timeline
        timeline = data.get("timeline") or []
        if not isinstance(timeline, list):
            timeline = []
        cleaned_timeline: list[dict[str, Any]] = []
        for i, step in enumerate(timeline):
            if not isinstance(step, dict):
                continue
            try:
                step_num = int(step.get("step", i + 1))
            except (TypeError, ValueError):
                step_num = i + 1
            cleaned_timeline.append({
                "step": max(1, step_num),
                "when": str(step.get("when", "")),
                "event": str(step.get("event", "")),
                "triggered_clause_ids": [
                    int(x) for x in (step.get("triggered_clause_ids") or [])
                    if isinstance(x, (int, float)) or (isinstance(x, str) and x.lstrip("-").isdigit())
                ],
                "consequence": str(step.get("consequence", "")),
            })
        data["timeline"] = cleaned_timeline

        # Triggered clauses
        triggered = data.get("triggered_clauses") or []
        if not isinstance(triggered, list):
            triggered = []
        cleaned_triggered: list[dict[str, Any]] = []
        for tc in triggered:
            if not isinstance(tc, dict) or "clause_id" not in tc:
                continue
            try:
                cid = int(tc["clause_id"])
            except (TypeError, ValueError):
                continue
            cleaned_triggered.append({
                "clause_id": cid,
                "title": str(tc.get("title", "")),
                "why_relevant": str(tc.get("why_relevant", "")),
                "key_quote": str(tc.get("key_quote", ""))[:600],
            })
        data["triggered_clauses"] = cleaned_triggered

        # Mitigation steps
        mitigation = data.get("mitigation_steps") or []
        if not isinstance(mitigation, list):
            mitigation = []
        cleaned_mitigation: list[dict[str, Any]] = []
        for m in mitigation:
            if not isinstance(m, dict) or "action" not in m:
                continue
            phase = str(m.get("phase", "BEFORE")).upper().strip()
            urg = str(m.get("urgency", "MEDIUM")).upper().strip()
            cleaned_mitigation.append({
                "phase": phase if phase in VALID_PHASE else "BEFORE",
                "action": str(m["action"]),
                "rationale": str(m.get("rationale", "")),
                "urgency": urg if urg in VALID_URGENCY else "MEDIUM",
            })
        data["mitigation_steps"] = cleaned_mitigation

        # Legal citations
        citations = data.get("legal_citations") or []
        if not isinstance(citations, list):
            citations = []
        cleaned_citations: list[dict[str, Any]] = []
        for c in citations:
            if not isinstance(c, dict) or not c.get("law"):
                continue
            cleaned_citations.append({
                "law": str(c.get("law", "")),
                "section": str(c.get("section", "")),
                "relevance": str(c.get("relevance", "")),
            })
        data["legal_citations"] = cleaned_citations

        return data

    def hallucination_guard(self, data: Any, clauses: list[Any]) -> Any:
        """Override the base guard to scrub triggered_clauses + timeline IDs.

        Unlike the per-clause agents, the simulator's output is a single dict.
        We strip references to non-existent clause_ids rather than annotating,
        because the frontend renders clause cards by lookup and would 404.
        """
        valid_ids: set[int] = set()
        for c in clauses:
            if isinstance(c, dict):
                cid = c.get("clause_id")
            else:
                cid = getattr(c, "clause_id", None)
            if cid is not None:
                valid_ids.add(int(cid))

        if not valid_ids or not isinstance(data, dict):
            return data

        # Filter triggered_clauses
        original_triggered = data.get("triggered_clauses", [])
        kept = [
            tc for tc in original_triggered
            if isinstance(tc, dict) and tc.get("clause_id") in valid_ids
        ]
        dropped = len(original_triggered) - len(kept)
        if dropped:
            self.logger.warning(
                f"Dropped {dropped} triggered_clauses with invalid clause_ids",
                extra={"agent": self.agent_name, "status": "hallucination"},
            )
        data["triggered_clauses"] = kept

        # Filter timeline trigger IDs in-place
        for step in data.get("timeline", []):
            if not isinstance(step, dict):
                continue
            ids = step.get("triggered_clause_ids", []) or []
            step["triggered_clause_ids"] = [i for i in ids if i in valid_ids]

        return data
