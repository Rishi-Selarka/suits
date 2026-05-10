"""Pydantic models for Suits AI."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Ingestion ────────────────────────────────────────────────────────────────

class Clause(BaseModel):
    clause_id: int
    section_number: str | None = None
    title: str
    text: str
    page_number: int = 1
    clause_type_hint: str | None = None


class DocumentMetadata(BaseModel):
    document_id: str
    filename: str
    sha256: str
    page_count: int = 0
    clause_count: int = 0
    file_size_bytes: int = 0
    content_type: str = ""
    status: Literal["uploaded", "processing", "complete", "error"] = "uploaded"
    # Internal: where the bytes live. For Supabase backend this is the storage
    # bucket path (`<user_id>/<doc_id>_<filename>`). For the local fallback
    # this is the absolute path on disk. Empty for unsaved metadata.
    storage_path: str = ""
    # ISO-8601 timestamp of when the upload row was first created. Populated
    # by both backends (Supabase reads `created_at`, local reads file mtime).
    # Empty for newly-built metadata that hasn't been written yet.
    uploaded_at: str = ""


# ── Agent outputs ────────────────────────────────────────────────────────────

class ClassificationResult(BaseModel):
    clause_id: int
    category: str
    subcategory: str
    confidence: float = Field(default=1.0, ge=0, le=1)
    secondary_category: str | None = None


class SimplificationResult(BaseModel):
    clause_id: int
    original_length: int = 0
    simplified_text: str
    simplified_length: int = 0
    jargon_replaced: list[str] = Field(default_factory=list)
    hidden_implications: str | None = None


class RiskResult(BaseModel):
    clause_id: int
    risk_score: int = Field(ge=1, le=10)
    risk_level: Literal["GREEN", "YELLOW", "RED"]
    perspective: str = ""
    flags: list[str] = Field(default_factory=list)
    reasoning: str = ""
    specific_concern: str | None = None
    suggested_modification: str | None = None
    india_specific_note: str | None = None


class BenchmarkResult(BaseModel):
    clause_id: int
    document_type_detected: str = ""
    deviation_level: Literal["STANDARD", "MODERATE_DEVIATION", "SIGNIFICANT_DEVIATION", "AGGRESSIVE"]
    benchmark_comparison: str = ""
    industry_norm: str = ""
    is_missing_standard_protection: bool = False
    missing_protection_detail: str | None = None


class CriticalIssue(BaseModel):
    priority: int
    clause_id: int
    issue_title: str
    issue_description: str
    impact: str
    recommended_action: str
    suggested_counter_language: str = ""


class PositiveAspect(BaseModel):
    clause_id: int
    description: str


class MissingClause(BaseModel):
    clause_type: str
    why_important: str
    suggested_language: str = ""


class DocumentSummary(BaseModel):
    document_type: str = ""
    parties: list[str] = Field(default_factory=list)
    effective_date: str | None = None
    duration: str | None = None
    total_clauses_analyzed: int = 0
    key_financial_terms: str | None = None


class OverallRiskAssessment(BaseModel):
    score: float = Field(ge=0, le=10)
    level: Literal["LOW_RISK", "MODERATE_RISK", "HIGH_RISK", "CRITICAL_RISK"]
    verdict: Literal["SIGN", "NEGOTIATE", "WALK_AWAY"]
    verdict_reasoning: str = ""


class VerificationNotes(BaseModel):
    factual_corrections: list[str] = Field(default_factory=list)
    cross_clause_interactions: list[str] = Field(default_factory=list)
    hallucinations_caught: list[str] = Field(default_factory=list)
    completeness_additions: list[str] = Field(default_factory=list)
    confidence_score: float = 0.0


class AdvisoryReport(BaseModel):
    document_summary: DocumentSummary = Field(default_factory=DocumentSummary)
    overall_risk_assessment: OverallRiskAssessment | None = None
    critical_issues: list[CriticalIssue] = Field(default_factory=list)
    positive_aspects: list[PositiveAspect] = Field(default_factory=list)
    missing_clauses: list[MissingClause] = Field(default_factory=list)
    negotiation_priority_order: list[str] = Field(default_factory=list)
    executive_summary: str = ""
    verification_notes: VerificationNotes | None = None


# ── Analysis result (full pipeline output) ───────────────────────────────────

class AgentTiming(BaseModel):
    agent: str
    timing_ms: int = 0
    model_used: str = ""
    status: Literal["success", "failed", "skipped"] = "success"


class AnalysisResult(BaseModel):
    document_id: str
    clauses: list[Clause] = Field(default_factory=list)
    classifications: list[ClassificationResult] = Field(default_factory=list)
    simplifications: list[SimplificationResult] = Field(default_factory=list)
    risks: list[RiskResult] = Field(default_factory=list)
    benchmarks: list[BenchmarkResult] = Field(default_factory=list)
    advisory: AdvisoryReport | None = None
    agent_timings: list[AgentTiming] = Field(default_factory=list)
    total_analysis_time_ms: int = 0
    cache_hit: bool = False


# ── API request / response models ────────────────────────────────────────────

class UploadResponse(BaseModel):
    document_id: str
    filename: str
    page_count: int = 0
    status: Literal["processing", "cached"] = "processing"


class ChatRequest(BaseModel):
    message: str = Field(max_length=50000)
    conversation_id: str | None = None


class ChatResponse(BaseModel):
    answer: str
    source_clauses: list[dict[str, Any]] = Field(default_factory=list)


class CompareRequest(BaseModel):
    document_id_1: str
    document_id_2: str


class SSEEvent(BaseModel):
    agent: str
    status: Literal["running", "complete", "error", "cached", "skipped"]
    data: dict[str, Any] | None = None
    timing_ms: int | None = None
    model_used: str | None = None
    error: str | None = None


class LLMResponse(BaseModel):
    """Unified response from LLM calls."""
    text: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0


# ── User / onboarding models ───────────────────────────────────────────────

class OnboardingRequest(BaseModel):
    name: str
    email: str | None = None
    role: Literal["individual", "lawyer", "business", "student"] = "individual"
    organization: str = ""
    use_case: str = ""
    jurisdiction: str = "India"


class UserResponse(BaseModel):
    id: str
    name: str
    email: str | None = None
    role: str
    organization: str
    use_case: str
    jurisdiction: str
    plan: str
    documents_used: int
    quota: dict[str, Any] | None = None


class QuotaResponse(BaseModel):
    allowed: bool
    used: int
    limit: int
    plan: str
    remaining: int


class UserUpdateRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    role: Literal["individual", "lawyer", "business", "student"] | None = None
    organization: str | None = None
    use_case: str | None = None
    jurisdiction: str | None = None


class NegotiateRequest(BaseModel):
    message: str = Field(max_length=50000)
    document_id: str | None = None
    rounds: int = Field(default=3, ge=1, le=5)


class PaymentCreateRequest(BaseModel):
    plan: Literal["starter", "pro", "unlimited"]


class PaymentVerifyRequest(BaseModel):
    payment_id: str
    razorpay_payment_id: str
    razorpay_signature: str = ""


# ── Scenario Simulator (What-If Engine) ────────────────────────────────────

ScenarioSeverity = Literal["FAVORABLE", "NEUTRAL", "UNFAVORABLE", "CRITICAL"]
DisputeProbability = Literal["LOW", "MEDIUM", "HIGH"]
FinancialPerspective = Literal["OUT_OF_POCKET", "RECOVERABLE", "MIXED", "NONE"]
MitigationPhase = Literal["BEFORE", "DURING", "AFTER"]
Urgency = Literal["LOW", "MEDIUM", "HIGH"]


class ScenarioFinancialImpact(BaseModel):
    amount_range_inr: str = "unclear from contract"
    calculation_basis: str = ""
    user_perspective: FinancialPerspective = "NONE"


class ScenarioTimelineStep(BaseModel):
    step: int = Field(ge=1)
    when: str
    event: str
    triggered_clause_ids: list[int] = Field(default_factory=list)
    consequence: str = ""


class ScenarioTriggeredClause(BaseModel):
    clause_id: int
    title: str = ""
    why_relevant: str = ""
    key_quote: str = ""


class ScenarioMitigationStep(BaseModel):
    phase: MitigationPhase = "BEFORE"
    action: str
    rationale: str = ""
    urgency: Urgency = "MEDIUM"


class ScenarioLegalCitation(BaseModel):
    law: str
    section: str = ""
    relevance: str = ""


class ScenarioReport(BaseModel):
    """The structured output of one scenario simulation run."""

    scenario_id: str
    document_id: str
    user_query: str
    template_id: str | None = None
    scenario_summary: str = ""
    headline_outcome: str = ""
    outcome_severity: ScenarioSeverity = "NEUTRAL"
    dispute_probability: DisputeProbability = "LOW"
    dispute_probability_reasoning: str = ""
    estimated_financial_impact: ScenarioFinancialImpact = Field(
        default_factory=ScenarioFinancialImpact
    )
    timeline: list[ScenarioTimelineStep] = Field(default_factory=list)
    triggered_clauses: list[ScenarioTriggeredClause] = Field(default_factory=list)
    mitigation_steps: list[ScenarioMitigationStep] = Field(default_factory=list)
    legal_citations: list[ScenarioLegalCitation] = Field(default_factory=list)
    best_case: str = ""
    worst_case: str = ""
    user_leverage: str = ""
    model_used: str = ""
    timing_ms: int = 0
    created_at: str = ""


class ScenarioTemplate(BaseModel):
    """A pre-built what-if scenario surfaced to the user as a one-tap prompt."""

    id: str
    document_types: list[str] = Field(default_factory=list)
    title: str
    prompt: str
    icon: str | None = None
    severity_hint: ScenarioSeverity = "NEUTRAL"


class ScenarioSimulateRequest(BaseModel):
    document_id: str
    query: str = Field(min_length=4, max_length=2000)
    template_id: str | None = None


class ScenarioListResponse(BaseModel):
    document_id: str
    scenarios: list[ScenarioReport] = Field(default_factory=list)


class ScenarioTemplatesResponse(BaseModel):
    document_id: str
    detected_document_type: str = ""
    templates: list[ScenarioTemplate] = Field(default_factory=list)


# ── Documents listing ─────────────────────────────────────────────────────

class DocumentListItem(BaseModel):
    """Public list-shape returned by GET /api/documents — strips internal fields."""

    document_id: str
    filename: str
    page_count: int = 0
    clause_count: int = 0
    status: Literal["uploaded", "processing", "complete", "error"] = "uploaded"
    analyzed: bool = False
    uploaded_at: str = ""


# ── Download history ──────────────────────────────────────────────────────

class DownloadHistoryItem(BaseModel):
    id: str
    document_id: str
    filename: str = ""
    export_type: str
    export_label: str = ""
    created_at: str = ""


class DownloadCreate(BaseModel):
    document_id: str
    filename: str = ""
    export_type: str = Field(min_length=1, max_length=64)
    export_label: str = ""
