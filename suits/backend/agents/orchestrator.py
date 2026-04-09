"""DAG Orchestrator -- executes the 6-agent pipeline in parallel waves.

Wave 1: Classifier + Simplifier (parallel)
Wave 2: Risk Analyzer + Benchmark (parallel, both need Classifier)
Wave 3: Advisor (needs all four) -> Verifier (critiques Advisor)

Classifier failure = pipeline failure.
Simplifier failure = non-blocking.
Partial results are preserved from succeeded agents.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncGenerator

from agents.advisor import AdvisorAgent
from agents.base_agent import AgentExecutionError, AgentParseError, AgentValidationError
from agents.benchmark import BenchmarkAgent
from agents.classifier import ClassifierAgent
from agents.risk_analyzer import RiskAnalyzerAgent
from agents.simplifier import SimplifierAgent
from agents.verifier import VerifierAgent
from config import Settings
from llm_client import LLMClient
from logging_config import get_logger
from models import (
    AdvisoryReport,
    AgentTiming,
    AnalysisResult,
    BenchmarkResult,
    ClassificationResult,
    CriticalIssue,
    DocumentSummary,
    MissingClause,
    OverallRiskAssessment,
    PositiveAspect,
    RiskResult,
    SimplificationResult,
    VerificationNotes,
)
from storage import Storage

logger = get_logger("orchestrator")


class AgentOrchestrator:
    """Executes the multi-agent pipeline as a DAG with parallel waves."""

    def __init__(
        self,
        llm_client: LLMClient,
        settings: Settings,
        storage: Storage,
    ) -> None:
        self.llm_client = llm_client
        self.settings = settings
        self.storage = storage

        # Instantiate all agents with their configured models
        self.classifier = ClassifierAgent(
            llm_client, settings.agent_models.classifier, "classifier"
        )
        self.simplifier = SimplifierAgent(
            llm_client, settings.agent_models.simplifier, "simplifier"
        )
        self.risk_analyzer = RiskAnalyzerAgent(
            llm_client, settings.agent_models.risk_analyzer, "risk_analyzer"
        )
        self.benchmark = BenchmarkAgent(
            llm_client, settings.agent_models.benchmark, "benchmark"
        )
        self.advisor = AdvisorAgent(
            llm_client, settings.agent_models.advisor, "advisor"
        )
        self.verifier = VerifierAgent(
            llm_client, settings.agent_models.verifier, "verifier"
        )

    # ── Main pipeline ────────────────────────────────────────────────────

    async def run(
        self,
        document_id: str,
        clauses: list[Any],
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Run the full agent pipeline, yielding SSE-compatible event dicts.

        Parameters
        ----------
        document_id : str
            The document being analyzed.
        clauses : list
            Clauses extracted by the ingestion layer (list of Clause or dicts).

        Yields
        ------
        dict
            SSE event dicts with keys: agent, status, data?, timing_ms?, model_used?, error?
        """
        pipeline_start = time.perf_counter()
        agent_timings: list[AgentTiming] = []

        # ── Cache check ──────────────────────────────────────────────────
        cached = self.storage.get_result(document_id)
        if cached and cached.classifications:
            logger.info(
                "Cache hit for document",
                extra={"agent": "orchestrator", "status": "cached"},
            )
            yield self._make_event("pipeline", "cached", data=cached.model_dump())
            return

        # Convert Clause models to dicts for JSON serialization in prompts
        clause_dicts = self._clauses_to_dicts(clauses)

        # ── Wave 1: Classifier + Simplifier (parallel) ──────────────────
        yield self._make_event("classifier", "running")
        yield self._make_event("simplifier", "running")

        classifier_result, simplifier_result = await asyncio.gather(
            self._run_agent(self.classifier, clauses=clause_dicts),
            self._run_agent(self.simplifier, clauses=clause_dicts),
            return_exceptions=True,
        )

        classifier_ok = not isinstance(classifier_result, BaseException)
        simplifier_ok = not isinstance(simplifier_result, BaseException)

        yield self._make_event_from_result("classifier", classifier_result)
        yield self._make_event_from_result("simplifier", simplifier_result)

        agent_timings.append(self._make_timing("classifier", classifier_result))
        agent_timings.append(self._make_timing("simplifier", simplifier_result))

        # Classifier failure = pipeline failure
        if not classifier_ok:
            error_msg = str(classifier_result)
            logger.error(
                f"Classifier failed, aborting pipeline: {error_msg}",
                extra={"agent": "orchestrator", "status": "failed"},
            )
            yield self._make_event(
                "pipeline", "error", error="Classifier failed — cannot proceed"
            )
            return

        classifications = classifier_result["data"]
        simplifications = simplifier_result["data"] if simplifier_ok else None

        # ── Wave 2: Risk Analyzer + Benchmark (parallel) ────────────────
        yield self._make_event("risk_analyzer", "running")
        yield self._make_event("benchmark", "running")

        risk_result, benchmark_result = await asyncio.gather(
            self._run_agent(
                self.risk_analyzer,
                clauses=clause_dicts,
                classifications=classifications,
            ),
            self._run_agent(
                self.benchmark,
                clauses=clause_dicts,
                classifications=classifications,
            ),
            return_exceptions=True,
        )

        risk_ok = not isinstance(risk_result, BaseException)
        benchmark_ok = not isinstance(benchmark_result, BaseException)

        yield self._make_event_from_result("risk_analyzer", risk_result)
        yield self._make_event_from_result("benchmark", benchmark_result)

        agent_timings.append(self._make_timing("risk_analyzer", risk_result))
        agent_timings.append(self._make_timing("benchmark", benchmark_result))

        risks = risk_result["data"] if risk_ok else None
        benchmarks = benchmark_result["data"] if benchmark_ok else None

        # ── Wave 3: Advisor (needs all four) ─────────────────────────────
        yield self._make_event("advisor", "running")

        try:
            advisor_result = await self._run_agent(
                self.advisor,
                clauses=clause_dicts,
                classifications=classifications,
                simplifications=simplifications,
                risks=risks,
                benchmarks=benchmarks,
            )
        except Exception as exc:
            advisor_result = exc

        advisor_ok = not isinstance(advisor_result, BaseException)
        yield self._make_event_from_result("advisor", advisor_result)
        agent_timings.append(self._make_timing("advisor", advisor_result))

        # ── Wave 3b: Verifier (critiques Advisor) ────────────────────────
        final_advisory_data: dict[str, Any] | None = None
        verifier_result: dict[str, Any] | BaseException | None = None

        if advisor_ok:
            yield self._make_event("verifier", "running")

            try:
                verifier_result = await self._run_agent(
                    self.verifier,
                    clauses=clause_dicts,
                    advisor_output=advisor_result["data"],
                    risks=risks,
                    benchmarks=benchmarks,
                )
            except Exception as exc:
                verifier_result = exc

            verifier_ok = not isinstance(verifier_result, BaseException)
            yield self._make_event_from_result("verifier", verifier_result)
            agent_timings.append(self._make_timing("verifier", verifier_result))

            # Use verified result; fall back to advisor if verifier fails
            if verifier_ok:
                final_advisory_data = verifier_result["data"]
            else:
                final_advisory_data = advisor_result["data"]
        else:
            agent_timings.append(
                AgentTiming(agent="verifier", status="skipped")
            )
            yield self._make_event("verifier", "error", error="Skipped — Advisor failed")

        # ── Assemble & save AnalysisResult ───────────────────────────────
        total_ms = int((time.perf_counter() - pipeline_start) * 1000)

        analysis = self._assemble_result(
            document_id=document_id,
            clauses=clauses,
            classifications=classifications,
            simplifications=simplifications,
            risks=risks,
            benchmarks=benchmarks,
            advisory_data=final_advisory_data,
            agent_timings=agent_timings,
            total_ms=total_ms,
        )

        try:
            self.storage.save_result(analysis)
            self.storage.update_status(document_id, "complete")
        except Exception as exc:
            logger.error(
                f"Failed to save analysis result: {exc}",
                extra={"agent": "orchestrator", "status": "error"},
            )

        yield self._make_event(
            "pipeline",
            "complete",
            data={"analysis_time_ms": total_ms},
        )

    # ── Helpers ──────────────────────────────────────────────────────────

    AGENT_TIMEOUT = 180  # seconds per individual agent

    async def _run_agent(
        self, agent: Any, **kwargs: Any
    ) -> dict[str, Any]:
        """Wrap agent.run() to catch and log exceptions.

        Returns the agent result dict on success or re-raises on failure.
        """
        try:
            return await asyncio.wait_for(
                agent.run(**kwargs), timeout=self.AGENT_TIMEOUT
            )
        except asyncio.TimeoutError:
            logger.error(
                f"Agent {agent.agent_name} timed out after {self.AGENT_TIMEOUT}s",
                extra={"agent": agent.agent_name, "status": "failed"},
            )
            raise AgentExecutionError(
                f"{agent.agent_name}: timed out after {self.AGENT_TIMEOUT}s"
            )
        except (AgentParseError, AgentValidationError, AgentExecutionError) as exc:
            logger.error(
                f"Agent {agent.agent_name} failed: {exc}",
                extra={"agent": agent.agent_name, "status": "failed"},
            )
            raise
        except Exception as exc:
            logger.error(
                f"Agent {agent.agent_name} unexpected error: {exc}",
                extra={"agent": agent.agent_name, "status": "failed"},
            )
            raise AgentExecutionError(
                f"{agent.agent_name}: unexpected error: {exc}"
            ) from exc

    @staticmethod
    def _make_event(
        agent: str,
        status: str,
        *,
        data: Any = None,
        timing_ms: int | None = None,
        model_used: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        """Create an SSE-compatible event dict."""
        event: dict[str, Any] = {"agent": agent, "status": status}
        if data is not None:
            event["data"] = data
        if timing_ms is not None:
            event["timing_ms"] = timing_ms
        if model_used is not None:
            event["model_used"] = model_used
        if error is not None:
            event["error"] = error
        return event

    @staticmethod
    def _make_event_from_result(
        agent_name: str,
        result: dict[str, Any] | BaseException,
    ) -> dict[str, Any]:
        """Convert an agent result (or exception) into an SSE event."""
        if isinstance(result, BaseException):
            return {
                "agent": agent_name,
                "status": "error",
                "error": str(result),
            }
        return {
            "agent": agent_name,
            "status": "complete",
            "data": result.get("data"),
            "timing_ms": result.get("timing_ms"),
            "model_used": result.get("model_used"),
        }

    @staticmethod
    def _make_timing(
        agent_name: str,
        result: dict[str, Any] | BaseException,
    ) -> AgentTiming:
        """Create an AgentTiming record from an agent result."""
        if isinstance(result, BaseException):
            return AgentTiming(agent=agent_name, status="failed")
        return AgentTiming(
            agent=agent_name,
            timing_ms=result.get("timing_ms", 0),
            model_used=result.get("model_used", ""),
            status="success",
        )

    @staticmethod
    def _clauses_to_dicts(clauses: list[Any]) -> list[dict[str, Any]]:
        """Convert Clause models (or dicts) to plain dicts for JSON serialization."""
        result: list[dict[str, Any]] = []
        for c in clauses:
            if isinstance(c, dict):
                result.append(c)
            else:
                # Pydantic model
                result.append(c.model_dump() if hasattr(c, "model_dump") else c.__dict__)
        return result

    @staticmethod
    def _assemble_result(
        *,
        document_id: str,
        clauses: list[Any],
        classifications: list[dict[str, Any]] | None,
        simplifications: list[dict[str, Any]] | None,
        risks: list[dict[str, Any]] | None,
        benchmarks: list[dict[str, Any]] | None,
        advisory_data: dict[str, Any] | None,
        agent_timings: list[AgentTiming],
        total_ms: int,
    ) -> AnalysisResult:
        """Build the final AnalysisResult from all agent outputs."""
        from models import Clause as ClauseModel

        # Convert clauses to Clause models if needed
        clause_models = []
        for c in clauses:
            if isinstance(c, ClauseModel):
                clause_models.append(c)
            elif isinstance(c, dict):
                clause_models.append(ClauseModel(**c))
            else:
                clause_models.append(c)

        # Convert raw dicts to Pydantic models, skipping invalid items
        classification_models = _safe_parse_list(
            classifications, ClassificationResult
        )
        simplification_models = _safe_parse_list(
            simplifications, SimplificationResult
        )
        risk_models = _safe_parse_list(risks, RiskResult)
        benchmark_models = _safe_parse_list(benchmarks, BenchmarkResult)

        # Build advisory report model
        advisory: AdvisoryReport | None = None
        if advisory_data and isinstance(advisory_data, dict):
            try:
                advisory = _build_advisory(advisory_data)
            except Exception as exc:
                logger.warning(
                    f"Failed to parse advisory into model: {exc}",
                    extra={"agent": "orchestrator", "status": "warning"},
                )

        return AnalysisResult(
            document_id=document_id,
            clauses=clause_models,
            classifications=classification_models,
            simplifications=simplification_models,
            risks=risk_models,
            benchmarks=benchmark_models,
            advisory=advisory,
            agent_timings=agent_timings,
            total_analysis_time_ms=total_ms,
        )


# ── Module-level helpers (not methods, to keep the class clean) ──────────────


def _safe_parse_list(
    items: list[dict[str, Any]] | None,
    model_class: type,
) -> list[Any]:
    """Parse a list of dicts into Pydantic models, skipping invalid items."""
    if not items:
        return []
    result = []
    for item in items:
        try:
            # Remove internal hallucination warning keys before parsing
            clean = {k: v for k, v in item.items() if not k.startswith("_")}
            result.append(model_class(**clean))
        except Exception as exc:
            # Skip items that don't fit the model rather than failing
            logger.warning(
                f"Dropped malformed item: {exc}",
                extra={"agent": "orchestrator", "status": "warning"},
            )
            continue
    return result


def _build_advisory(data: dict[str, Any]) -> AdvisoryReport:
    """Build an AdvisoryReport from the raw dict, handling nested models."""
    ds = data.get("document_summary", {})
    doc_summary = DocumentSummary(**ds) if isinstance(ds, dict) else DocumentSummary()

    ora_data = data.get("overall_risk_assessment", {})
    ora = (
        OverallRiskAssessment(**ora_data)
        if isinstance(ora_data, dict) and ora_data
        else None
    )

    critical = [
        CriticalIssue(**{k: v for k, v in ci.items() if not k.startswith("_")})
        for ci in data.get("critical_issues", [])
        if isinstance(ci, dict)
    ]
    positives = [
        PositiveAspect(**{k: v for k, v in pa.items() if not k.startswith("_")})
        for pa in data.get("positive_aspects", [])
        if isinstance(pa, dict)
    ]
    missing = [
        MissingClause(**{k: v for k, v in mc.items() if not k.startswith("_")})
        for mc in data.get("missing_clauses", [])
        if isinstance(mc, dict)
    ]

    vn_data = data.get("verification_notes")
    verification = (
        VerificationNotes(**vn_data) if isinstance(vn_data, dict) else None
    )

    return AdvisoryReport(
        document_summary=doc_summary,
        overall_risk_assessment=ora,
        critical_issues=critical,
        positive_aspects=positives,
        missing_clauses=missing,
        negotiation_priority_order=data.get("negotiation_priority_order", []),
        executive_summary=data.get("executive_summary", ""),
        verification_notes=verification,
    )
