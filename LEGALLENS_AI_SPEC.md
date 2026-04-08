# LegalLens AI — Complete Technical Specification

> **Purpose**: This document is the single source of truth for building LegalLens AI, a multi-agent legal document analysis platform for the RNSIT Agentic AI hackathon (Problem Statement 3). Feed this entire document to Claude Code to scaffold and build the project.

---

## 1. Project Overview

**LegalLens AI** is an agentic system that takes any legal document (rental agreements, employment contracts, NDAs, terms of service, freelance contracts) and autonomously analyzes it using five specialized AI agents orchestrated in a dependency graph. The output is a comprehensive, interactive risk analysis with plain-English explanations, benchmark comparisons, and an actionable negotiation playbook.

### What Makes This "Agentic"
- **Autonomous decision-making**: The system decides how to segment clauses, what risk patterns to flag, and what final verdict to give — without human intervention between steps.
- **Multi-agent collaboration**: Five agents with distinct roles pass structured outputs to each other via a DAG (Directed Acyclic Graph) orchestrator.
- **Self-directed analysis depth**: The Risk Analyzer agent autonomously decides whether a clause needs shallow or deep analysis based on the Classifier's output.

---

## 2. System Architecture

### 2.1 High-Level Flow

```
User uploads PDF/Image/Text
        │
        ▼
┌─────────────────────┐
│  INGESTION LAYER    │
│  PDF Parse → OCR    │
│  → Clause Segment   │
└────────┬────────────┘
         │
         ▼  List of {clause_id, text, page_num, section_title}
┌─────────────────────────────────────────────────┐
│              AGENT ORCHESTRATOR (DAG)            │
│                                                 │
│  ┌──────────────┐    ┌──────────────────┐       │
│  │  Classifier  │    │   Simplifier     │       │
│  │  Agent       │    │   Agent          │       │
│  └──────┬───────┘    └──────┬───────────┘       │
│         │                   │                   │
│    (parallel)          (parallel)                │
│         │                   │                   │
│         ▼                   │                   │
│  ┌──────────────┐    ┌──────────────────┐       │
│  │  Risk        │    │   Benchmark      │       │
│  │  Analyzer    │◄───│   Agent          │       │
│  └──────┬───────┘    └──────┬───────────┘       │
│         │                   │                   │
│         ▼                   ▼                   │
│  ┌──────────────────────────────────────┐       │
│  │         Advisor Agent                │       │
│  │  (synthesizes all agent outputs)     │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│  OUTPUT LAYER       │
│  - Risk Heatmap     │
│  - Clause Cards     │
│  - Chat (RAG)       │
│  - Negotiation PDF  │
└─────────────────────┘
```

### 2.2 Agent Dependency Graph (DAG)

| Agent | Depends On | Runs In Parallel With |
|-------|-----------|----------------------|
| Clause Classifier | Ingestion output | Simplifier |
| Plain Language Simplifier | Ingestion output | Classifier |
| Risk Analyzer | Classifier output | Benchmark (after classifier) |
| Benchmark Agent | Classifier output | Risk Analyzer (after classifier) |
| Advisor Agent | ALL four agents above | Nothing (final) |

**Execution order**: 
1. Wave 1: Classifier + Simplifier (parallel)
2. Wave 2: Risk Analyzer + Benchmark (parallel, both need Classifier)
3. Wave 3: Advisor (needs all)

This parallelism cuts total latency by ~40% compared to sequential execution.

---

## 3. Backend Architecture

### 3.1 Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| API Server | **FastAPI** (Python 3.11+) | Async support, auto-docs, fast |
| PDF Parsing | **PyMuPDF (fitz)** | Best Python PDF lib, extracts text with position data |
| OCR Fallback | **pytesseract** + **Pillow** | For scanned documents |
| LLM | **Anthropic Claude API** (claude-sonnet-4-20250514) | All agent calls |
| Embeddings | **sentence-transformers** (all-MiniLM-L6-v2) | For RAG vector search |
| Vector Store | **ChromaDB** (in-memory) | Lightweight, no infra needed |
| PDF Report Gen | **fpdf2** | Generate negotiation playbook PDF |
| Async Orchestration | **asyncio.gather** | Parallel agent execution |

### 3.2 Project Structure

```
legallens/
├── backend/
│   ├── main.py                    # FastAPI app, CORS, routes
│   ├── config.py                  # API keys, model config
│   ├── requirements.txt
│   │
│   ├── ingestion/
│   │   ├── __init__.py
│   │   ├── pdf_parser.py          # PyMuPDF text extraction + OCR fallback
│   │   └── clause_segmenter.py    # LLM-based clause boundary detection
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── orchestrator.py        # DAG runner with parallel execution
│   │   ├── base_agent.py          # Abstract base class for all agents
│   │   ├── classifier.py          # Clause Classifier Agent
│   │   ├── simplifier.py          # Plain Language Agent
│   │   ├── risk_analyzer.py       # Risk Analyzer Agent
│   │   ├── benchmark.py           # Benchmark Comparison Agent
│   │   └── advisor.py             # Final Advisor Agent
│   │
│   ├── rag/
│   │   ├── __init__.py
│   │   ├── chunker.py             # Smart document chunking
│   │   ├── embeddings.py          # Sentence-transformer embeddings
│   │   └── retriever.py           # Cosine similarity search
│   │
│   ├── reports/
│   │   ├── __init__.py
│   │   └── negotiation_brief.py   # PDF report generator
│   │
│   └── prompts/
│       ├── __init__.py
│       └── templates.py           # All agent system prompts (centralized)
│
├── frontend/                      # React app (vibecoded separately)
│   └── (see Section 7 for navigation/features spec)
│
├── sample_docs/                   # Pre-loaded demo documents
│   ├── rental_agreement.pdf
│   ├── employment_contract.pdf
│   ├── nda_agreement.pdf
│   └── freelance_contract.pdf
│
├── .env                           # ANTHROPIC_API_KEY
├── README.md
└── docker-compose.yml             # Optional containerization
```

### 3.3 API Endpoints

```python
# main.py — FastAPI routes

POST /api/upload
  - Accepts: multipart/form-data (PDF, image, or text file)
  - Returns: { document_id, filename, page_count, status: "processing" }

POST /api/analyze/{document_id}
  - Triggers the full agent pipeline
  - Returns: SSE (Server-Sent Events) stream with real-time agent progress
    - { agent: "classifier", status: "running" }
    - { agent: "classifier", status: "complete", data: {...} }
    - { agent: "simplifier", status: "running" }
    - ... continues for each agent ...
    - { agent: "advisor", status: "complete", data: { verdict, ... } }

GET /api/results/{document_id}
  - Returns: Complete analysis JSON (all agent outputs merged)

POST /api/chat/{document_id}
  - Accepts: { message: "Can the landlord increase rent?" }
  - Returns: { answer, source_clauses: [{clause_id, text, page}] }

GET /api/report/{document_id}
  - Returns: Generated PDF negotiation brief (binary)

POST /api/compare
  - Accepts: Two document_ids
  - Returns: Clause-by-clause diff with risk delta
```

### 3.4 SSE Streaming for Real-Time Progress

Use Server-Sent Events so the frontend can show which agent is running, complete, etc. This is critical for the demo — judges see agents activating one by one.

```python
# In main.py
from sse_starlette.sse import EventSourceResponse

@app.post("/api/analyze/{document_id}")
async def analyze(document_id: str):
    async def event_generator():
        async for event in orchestrator.run(document_id):
            yield {
                "event": "agent_update",
                "data": json.dumps(event)
            }
    return EventSourceResponse(event_generator())
```

---

## 4. Agent Specifications

### 4.1 Base Agent Class

```python
# agents/base_agent.py
from abc import ABC, abstractmethod
from anthropic import AsyncAnthropic
import json

class BaseAgent(ABC):
    def __init__(self, client: AsyncAnthropic, model: str = "claude-sonnet-4-20250514"):
        self.client = client
        self.model = model
    
    @abstractmethod
    def system_prompt(self) -> str:
        pass
    
    @abstractmethod
    def build_user_message(self, **kwargs) -> str:
        pass
    
    async def run(self, **kwargs) -> dict:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=self.system_prompt(),
            messages=[{"role": "user", "content": self.build_user_message(**kwargs)}]
        )
        return self.parse_response(response.content[0].text)
    
    def parse_response(self, text: str) -> dict:
        # Extract JSON from response, handle markdown fences
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(cleaned)
```

### 4.2 Clause Segmenter (Pre-Agent, Part of Ingestion)

This is NOT an agent — it's a preprocessing step that uses Claude to intelligently segment the document into clauses.

**Input**: Raw text extracted from PDF  
**Output**: List of clause objects

```python
# ingestion/clause_segmenter.py

SEGMENTER_PROMPT = """
You are a legal document clause segmenter. Given the raw text of a legal document, 
identify and extract every distinct clause or section.

For each clause, output a JSON array where each element has:
- "clause_id": Sequential integer starting from 1
- "section_number": The section/clause number as written in the document (e.g., "3.1", "IV", "Schedule A") or null if unnumbered
- "title": The clause title/heading if present, otherwise generate a descriptive title
- "text": The full text of the clause (preserve exact wording)
- "page_number": Approximate page number (based on position in text)
- "clause_type_hint": Your best guess at the clause type (e.g., "termination", "payment", "liability", "definitions", "general")

Rules:
- Treat preamble/recitals as a single clause
- Treat each numbered section/subsection as a separate clause
- Definitions sections should be kept as ONE clause (don't split each definition)
- Schedules/annexures are separate clauses
- Signature blocks are NOT clauses — exclude them
- If a clause has sub-clauses (a, b, c), keep them together as one clause

Respond with ONLY a JSON array. No explanation.
"""
```

### 4.3 Agent 1: Clause Classifier

**Purpose**: Categorize each clause into a legal taxonomy.

**Input**: List of clauses from segmenter  
**Output**: Each clause tagged with category + subcategory

```python
CLASSIFIER_SYSTEM_PROMPT = """
You are a legal clause classification specialist. You categorize legal clauses 
into a structured taxonomy.

TAXONOMY (category → subcategories):
1. DEFINITIONS → general_definitions, interpretation_rules
2. TERM_AND_DURATION → commencement, duration, renewal, auto_renewal
3. PAYMENT → rent, fees, deposit, penalties, late_payment, escalation
4. OBLIGATIONS → tenant_obligations, landlord_obligations, employer_obligations, employee_obligations, mutual_obligations
5. TERMINATION → termination_for_cause, termination_for_convenience, notice_period, early_termination_penalty
6. LIABILITY → limitation_of_liability, indemnification, warranty_disclaimer, consequential_damages
7. CONFIDENTIALITY → nda_scope, exceptions, duration_of_confidentiality, return_of_materials
8. INTELLECTUAL_PROPERTY → ip_ownership, ip_assignment, license_grant, work_for_hire
9. DISPUTE_RESOLUTION → governing_law, jurisdiction, arbitration, mediation
10. NON_COMPETE → non_compete_scope, non_solicitation, geographic_restriction, time_restriction
11. FORCE_MAJEURE → definition, obligations_during, termination_right
12. INSURANCE → required_coverage, proof_of_insurance
13. COMPLIANCE → regulatory, reporting, audit_rights
14. MISCELLANEOUS → entire_agreement, amendment, waiver, severability, notices, assignment
15. REPRESENTATIONS → representations_and_warranties, conditions_precedent
16. DATA_PRIVACY → data_collection, data_processing, data_retention, breach_notification

For each clause, output JSON:
{
  "clause_id": <int>,
  "category": "<CATEGORY>",
  "subcategory": "<subcategory>",
  "confidence": <float 0-1>,
  "secondary_category": "<CATEGORY or null>"  // if clause spans two categories
}

Respond with ONLY a JSON array.
"""
```

### 4.4 Agent 2: Plain Language Simplifier

**Purpose**: Rewrite each clause in simple English that a non-lawyer can understand.

```python
SIMPLIFIER_SYSTEM_PROMPT = """
You are a legal-to-plain-English translator. Your job is to rewrite legal clauses 
so that a 16-year-old with no legal background can fully understand them.

Rules:
- Use short sentences (max 20 words each)
- Replace ALL legal jargon: "indemnify" → "pay for any losses", "notwithstanding" → "regardless of", "hereinafter" → drop it, "whereas" → drop it, "force majeure" → "events outside anyone's control (like natural disasters)"
- Use "you" and "they" instead of "the Tenant" / "the Landlord" (specify who "they" is on first use)
- Explain what the clause MEANS for the reader practically, not just what it says
- If a clause contains a hidden risk or trap, add a ⚠️ note at the end
- Keep the simplified version roughly the same length or shorter than the original
- Preserve ALL specific numbers, dates, amounts, percentages — never generalize these

For each clause, output JSON:
{
  "clause_id": <int>,
  "original_length": <word count>,
  "simplified_text": "<plain English version>",
  "simplified_length": <word count>,
  "jargon_replaced": ["list of legal terms you replaced"],
  "hidden_implications": "<what this clause really means for the reader, if not obvious>" or null
}

Respond with ONLY a JSON array.
"""
```

### 4.5 Agent 3: Risk Analyzer

**Purpose**: Score each clause on risk severity, flag specific dangerous patterns.

**Depends on**: Classifier output (uses category to apply domain-specific risk heuristics)

```python
RISK_ANALYZER_SYSTEM_PROMPT = """
You are a legal risk analysis specialist. You evaluate clauses for risk to the 
WEAKER party (tenant, employee, freelancer, user — whoever is signing, not drafting).

RISK SCORING (1-10):
- 1-3 (GREEN): Standard, fair, balanced clause
- 4-6 (YELLOW): Slightly one-sided but common; worth noting
- 7-10 (RED): Dangerous, one-sided, unusual, or potentially exploitative

RISK PATTERNS TO DETECT (flag ALL that apply):
- ONE_SIDED_INDEMNITY: Only one party indemnifies the other
- UNLIMITED_LIABILITY: No cap on liability/damages
- UNILATERAL_TERMINATION: Only one party can terminate
- SILENT_AUTO_RENEWAL: Contract auto-renews without explicit notice mechanism
- BROAD_IP_ASSIGNMENT: All IP created during employment assigned, even unrelated work
- NON_COMPETE_OVERREACH: Geographic or time scope is unreasonably broad
- PENALTY_CLAUSE: Disproportionate penalties for breach
- WAIVER_OF_RIGHTS: Clause asks signer to waive statutory/legal rights
- VAGUE_OBLIGATIONS: Obligations described in vague terms ("reasonable", "as needed") favoring drafter
- UNILATERAL_AMENDMENT: One party can change terms without consent
- EXCESSIVE_NOTICE_PERIOD: Notice period is unusually long (>90 days for employment, >60 for rental)
- HIDDEN_FEES: Additional costs buried in clause language
- JURISDICTION_DISADVANTAGE: Dispute resolution in a location/manner disadvantageous to signer
- DATA_OVERREACH: Excessive data collection/retention rights
- SURVIVAL_CLAUSE_OVERREACH: Obligations survive termination for unreasonable duration

For each clause, output JSON:
{
  "clause_id": <int>,
  "risk_score": <int 1-10>,
  "risk_level": "GREEN" | "YELLOW" | "RED",
  "flags": ["PATTERN_NAME", ...],
  "reasoning": "<2-3 sentence explanation of why this score>",
  "specific_concern": "<the exact phrase or provision that causes concern>" or null,
  "suggested_modification": "<what the signer should ask to change>" or null
}

IMPORTANT: Be genuinely analytical, not alarmist. Standard boilerplate should score 1-3.
Only flag truly concerning patterns.

Respond with ONLY a JSON array.
"""
```

### 4.6 Agent 4: Benchmark Agent

**Purpose**: Compare each clause against "fair standard" baselines for the document type.

**Depends on**: Classifier output (to know what type of document this is)

```python
BENCHMARK_SYSTEM_PROMPT = """
You are a legal benchmarking specialist. You compare contract clauses against 
established fair-standard baselines.

You have deep knowledge of standard terms across:
- Indian residential rental agreements (governed by state Rent Control Acts, typical 11-month lease structures)
- Indian commercial rental/lease agreements
- Indian employment contracts (governed by Indian labour law, Shops & Establishments Act)
- Freelancer/independent contractor agreements
- Non-Disclosure Agreements (mutual vs. one-way)
- Software/SaaS Terms of Service
- Standard consulting agreements

For each clause, compare against what is TYPICAL and FAIR in that document type:

DEVIATION LEVELS:
- STANDARD: This clause is normal and commonly seen
- MODERATE_DEVIATION: Slightly unusual but not necessarily unfair
- SIGNIFICANT_DEVIATION: Notably different from standard practice; worth discussing
- AGGRESSIVE: Strongly favors the drafting party; unusual in fair contracts

For each clause, output JSON:
{
  "clause_id": <int>,
  "document_type_detected": "<type of legal document>",
  "deviation_level": "STANDARD" | "MODERATE_DEVIATION" | "SIGNIFICANT_DEVIATION" | "AGGRESSIVE",
  "benchmark_comparison": "<what is standard vs. what this clause says>",
  "industry_norm": "<what a typical fair clause looks like for this provision>",
  "is_missing_standard_protection": <boolean>,
  "missing_protection_detail": "<what standard protection is absent>" or null
}

Respond with ONLY a JSON array.
"""
```

### 4.7 Agent 5: Advisor Agent

**Purpose**: Synthesize all agent outputs into a final actionable recommendation.

**Depends on**: ALL other agents

```python
ADVISOR_SYSTEM_PROMPT = """
You are a senior legal advisor synthesizing a complete contract analysis. 
You have received outputs from four specialist agents:
1. Clause classifications
2. Plain language simplifications
3. Risk analysis with scores and flags
4. Benchmark comparisons against fair standards

Your job is to produce a FINAL ADVISORY REPORT.

Output JSON with this structure:
{
  "document_summary": {
    "document_type": "<detected type>",
    "parties": ["Party A name/role", "Party B name/role"],
    "effective_date": "<if found>" or null,
    "duration": "<if found>" or null,
    "total_clauses_analyzed": <int>,
    "key_financial_terms": "<rent amount, salary, fees, etc.>" or null
  },
  
  "overall_risk_assessment": {
    "score": <float 1-10, weighted average>,
    "level": "LOW_RISK" | "MODERATE_RISK" | "HIGH_RISK" | "CRITICAL_RISK",
    "verdict": "SIGN" | "NEGOTIATE" | "WALK_AWAY",
    "verdict_reasoning": "<3-4 sentence explanation>"
  },
  
  "critical_issues": [
    {
      "priority": <int, 1 = most urgent>,
      "clause_id": <int>,
      "issue_title": "<short title>",
      "issue_description": "<what's wrong>",
      "impact": "<what could happen to the signer>",
      "recommended_action": "<specific ask for negotiation>",
      "suggested_counter_language": "<actual replacement clause text>"
    }
  ],
  
  "positive_aspects": [
    {
      "clause_id": <int>,
      "description": "<what's good about this clause>"
    }
  ],
  
  "missing_clauses": [
    {
      "clause_type": "<what's missing>",
      "why_important": "<why the signer should ask for this>",
      "suggested_language": "<proposed clause text>"
    }
  ],
  
  "negotiation_priority_order": [
    "<Issue 1 — must negotiate>",
    "<Issue 2 — should negotiate>",
    "<Issue 3 — nice to have>"
  ],
  
  "executive_summary": "<A 4-5 sentence summary a non-lawyer can read to understand the full picture>"
}

Be balanced. Not every contract is dangerous. If it's fair, say so.
Only recommend WALK_AWAY for genuinely exploitative contracts.
"""
```

### 4.8 Orchestrator Implementation

```python
# agents/orchestrator.py
import asyncio
from typing import AsyncGenerator

class AgentOrchestrator:
    def __init__(self, client):
        self.classifier = ClassifierAgent(client)
        self.simplifier = SimplifierAgent(client)
        self.risk_analyzer = RiskAnalyzerAgent(client)
        self.benchmark = BenchmarkAgent(client)
        self.advisor = AdvisorAgent(client)
    
    async def run(self, clauses: list) -> AsyncGenerator[dict, None]:
        # Wave 1: Classifier + Simplifier (parallel)
        yield {"agent": "classifier", "status": "running"}
        yield {"agent": "simplifier", "status": "running"}
        
        classifier_result, simplifier_result = await asyncio.gather(
            self.classifier.run(clauses=clauses),
            self.simplifier.run(clauses=clauses)
        )
        
        yield {"agent": "classifier", "status": "complete", "data": classifier_result}
        yield {"agent": "simplifier", "status": "complete", "data": simplifier_result}
        
        # Wave 2: Risk Analyzer + Benchmark (parallel, need classifier)
        yield {"agent": "risk_analyzer", "status": "running"}
        yield {"agent": "benchmark", "status": "running"}
        
        risk_result, benchmark_result = await asyncio.gather(
            self.risk_analyzer.run(clauses=clauses, classifications=classifier_result),
            self.benchmark.run(clauses=clauses, classifications=classifier_result)
        )
        
        yield {"agent": "risk_analyzer", "status": "complete", "data": risk_result}
        yield {"agent": "benchmark", "status": "complete", "data": benchmark_result}
        
        # Wave 3: Advisor (needs everything)
        yield {"agent": "advisor", "status": "running"}
        
        advisor_result = await self.advisor.run(
            clauses=clauses,
            classifications=classifier_result,
            simplifications=simplifier_result,
            risks=risk_result,
            benchmarks=benchmark_result
        )
        
        yield {"agent": "advisor", "status": "complete", "data": advisor_result}
```

---

## 5. RAG System for Document Chat

### 5.1 Architecture

```
User Question
      │
      ▼
[Embed Question] ──→ Query Vector
      │
      ▼
[Cosine Similarity Search] ──→ Top 5 relevant chunks
      │
      ▼
[Claude with Context] ──→ Grounded Answer + Clause References
```

### 5.2 Implementation

```python
# rag/chunker.py
def chunk_clauses(clauses: list, max_chunk_size: int = 500) -> list:
    """
    Each clause becomes a chunk. If a clause is too long, 
    split on sentence boundaries while preserving clause_id metadata.
    """
    chunks = []
    for clause in clauses:
        text = clause["text"]
        if len(text.split()) <= max_chunk_size:
            chunks.append({
                "chunk_id": f"clause_{clause['clause_id']}",
                "text": text,
                "clause_id": clause["clause_id"],
                "title": clause.get("title", ""),
                "page": clause.get("page_number", 0)
            })
        else:
            # Split long clauses on sentence boundaries
            sentences = text.split(". ")
            current_chunk = []
            for sent in sentences:
                current_chunk.append(sent)
                if len(" ".join(current_chunk).split()) >= max_chunk_size:
                    chunks.append({
                        "chunk_id": f"clause_{clause['clause_id']}_part_{len(chunks)}",
                        "text": ". ".join(current_chunk) + ".",
                        "clause_id": clause["clause_id"],
                        "title": clause.get("title", ""),
                        "page": clause.get("page_number", 0)
                    })
                    current_chunk = []
            if current_chunk:
                chunks.append({
                    "chunk_id": f"clause_{clause['clause_id']}_part_{len(chunks)}",
                    "text": ". ".join(current_chunk) + ".",
                    "clause_id": clause["clause_id"],
                    "title": clause.get("title", ""),
                    "page": clause.get("page_number", 0)
                })
    return chunks

# rag/retriever.py
RAG_SYSTEM_PROMPT = """
You are a legal document Q&A assistant. Answer the user's question based ONLY 
on the provided document clauses. 

Rules:
- Always cite which clause(s) your answer comes from: "According to Clause 5 (Termination)..."
- If the answer isn't in the document, say "This document doesn't address that topic."
- Use simple language, not legalese
- If the question is about rights, also mention any relevant obligations
- If there's ambiguity in the clause, flag it: "This clause is ambiguous and could be interpreted as..."
"""
```

---

## 6. Data Sources & Sample Documents

### 6.1 Where to Get Example Legal Documents

| Source | URL | What's Available | License |
|--------|-----|-----------------|---------|
| **Indian Kanoon** | https://indiankanoon.org | Court judgments, legal texts | Public domain |
| **LawRato Templates** | https://lawrato.com/legal-documents | Indian rental, employment, NDA templates | Free templates available |
| **LegalDesk** | https://legaldesk.com | Indian rental agreement templates | Free previews |
| **Rocket Lawyer (India)** | https://www.rocketlawyer.com/in | Various contract templates | Free with signup |
| **ContractStore** | https://www.contractstore.com | Sample contracts (international) | Some free samples |
| **SEC EDGAR** | https://www.sec.gov/cgi-bin/browse-edgar | Real corporate contracts in 10-K filings | Public domain |
| **SAFT/SAFE templates** | YCombinator website | Startup investment agreements | Open source |
| **GitHub "awesome-legal"** | https://github.com/topics/legal-documents | Community-contributed templates | Various open licenses |

### 6.2 Recommended Demo Documents

For the hackathon demo, prepare these specific documents:

1. **Indian 11-month residential rental agreement** — Most relatable. Find a real template from LegalDesk or draft one with common problematic clauses (unilateral rent increase, no-pet clause, broad damage liability, lock-in period).

2. **Indian employment contract** — Include non-compete, IP assignment, notice period, and variable pay clauses. Source from HR template sites or create a realistic one.

3. **Freelancer/Contractor NDA** — One-sided NDA that only restricts the freelancer. Good for showing benchmark deviations.

4. **SaaS Terms of Service** — Copy from a real (small) SaaS company's public ToS page. Shows data privacy analysis capability.

### 6.3 Creating Synthetic Demo Documents

If you can't find a good real document, create synthetic ones with deliberately planted issues:

```python
# Script to generate a sample rental agreement with known issues
# Include these clauses for demo impact:

DEMO_CLAUSES = {
    "good_clause": "The monthly rent shall be Rs. 25,000, payable on or before the 5th of each month.",
    
    "yellow_clause": "The Lessor may increase the rent by up to 10% annually upon providing 30 days written notice.",
    
    "red_clause_1": "The Lessee shall indemnify and hold harmless the Lessor against ALL claims, damages, losses, costs, and expenses of whatever nature arising from the Lessee's use of the premises, INCLUDING those arising from the Lessor's own negligence.",
    
    "red_clause_2": "The Lessor reserves the right to enter the premises at any time without prior notice for inspection, repairs, or any other purpose deemed necessary by the Lessor.",
    
    "red_clause_3": "Upon termination, any improvements or fixtures installed by the Lessee shall become the property of the Lessor without compensation.",
    
    "missing_standard": "No clause about security deposit return timeline (standard is 30-60 days)"
}
```

### 6.4 APIs and External Services

| Service | Purpose | Access |
|---------|---------|--------|
| **Anthropic Claude API** | All LLM agent calls | API key from console.anthropic.com |
| **Tesseract OCR** | Scanned document fallback | `apt-get install tesseract-ocr` (free, open source) |
| **sentence-transformers** | Embedding generation for RAG | `pip install sentence-transformers` (free, runs locally) |
| **ChromaDB** | Vector storage for RAG | `pip install chromadb` (free, in-memory) |

**No paid APIs needed besides Claude.** Everything else runs locally.

---

## 7. Frontend Specification (Navigation & Features)

> Note: Frontend will be vibecoded. This section defines WHAT to build, not HOW.

### 7.1 Application Navigation

```
┌──────────────────────────────────────────┐
│  LegalLens AI        [Upload] [History]  │  ← Top nav
├──────────────────────────────────────────┤
│                                          │
│  Landing / Upload Page                   │  ← Default view
│  ─────────────────────                   │
│  - Drag & drop zone for PDF              │
│  - "Try a sample" buttons (pre-loaded    │
│    demo docs)                            │
│  - Supported formats: PDF, PNG, JPG, TXT │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  Processing Page (after upload)          │
│  ─────────────────────                   │
│  - Agent pipeline visualization          │
│  - Each agent shows: ⏳ → ✅ as SSE     │
│    events arrive                         │
│  - Progress bar or step indicator        │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  Results Dashboard (main view)           │
│  ─────────────────────                   │
│  - Three-tab or split layout:            │
│    [Overview] [Clauses] [Chat]           │
│                                          │
│  OVERVIEW TAB:                           │
│  - Verdict badge: SIGN/NEGOTIATE/WALK    │
│  - Overall risk score (circular gauge)   │
│  - Risk distribution (pie/donut chart)   │
│  - Executive summary text                │
│  - Critical issues list (priority order) │
│  - Missing clauses warnings              │
│  - "Download Negotiation Brief" button   │
│                                          │
│  CLAUSES TAB:                            │
│  - Scrollable list of all clauses        │
│  - Each clause = expandable card:        │
│    ┌──────────────────────────────┐      │
│    │ 🔴 Clause 7: Indemnification │      │
│    │ Category: LIABILITY          │      │
│    │ Risk Score: 8/10             │      │
│    ├──────────────────────────────┤      │
│    │ [Original] [Simplified] tabs │      │
│    │ ──────────────────────────── │      │
│    │ Risk Flags: ONE_SIDED_INDEM  │      │
│    │ Benchmark: AGGRESSIVE        │      │
│    │ Suggested Fix: "Add mutual   │      │
│    │ indemnification..."          │      │
│    └──────────────────────────────┘      │
│  - Filter by risk level (R/Y/G)         │
│  - Filter by category                    │
│  - Sort by risk score                    │
│                                          │
│  CHAT TAB:                               │
│  - Chat interface for document Q&A       │
│  - Shows source clause references        │
│  - Suggested questions as chips:         │
│    "What are my obligations?"            │
│    "Can they terminate without notice?"  │
│    "What happens if I break this?"       │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  Compare Page (optional, stretch goal)   │
│  ─────────────────────                   │
│  - Side-by-side document comparison      │
│  - Diff highlighting                     │
│  - Risk delta: "New version added 2 red  │
│    clauses, resolved 1"                  │
│                                          │
└──────────────────────────────────────────┘
```

### 7.2 Key UI Components

1. **Risk Heatmap** — A visual representation of the document where each clause is a block colored by risk level. Can be a vertical bar, a grid, or a document-shaped visualization.

2. **Agent Pipeline Visualizer** — During processing, show the 5 agents as nodes in a flow diagram. Animate connections as data flows between them. This is the "wow" moment during demo.

3. **Clause Cards** — Expandable cards with tabs for Original/Simplified text, risk flags as colored badges, benchmark deviation as a label, and suggested modifications in a highlighted box.

4. **Verdict Badge** — Large, prominent display of SIGN (green) / NEGOTIATE (yellow) / WALK AWAY (red) with the overall score.

5. **Chat Panel** — Standard chat UI with message bubbles. Bot responses include clause reference chips that scroll to the relevant clause when clicked.

---

## 8. Negotiation Brief PDF Report

Auto-generated downloadable PDF containing:

```
LEGALLENS AI — NEGOTIATION BRIEF
==================================

Document: [filename]
Analyzed: [date]
Overall Verdict: [SIGN/NEGOTIATE/WALK AWAY]
Risk Score: [X/10]

EXECUTIVE SUMMARY
[4-5 sentence summary from Advisor agent]

CRITICAL ISSUES (Priority Order)
1. [Issue Title]
   Clause: [#] — [Title]
   Risk: [Description]
   Impact: [What could happen]
   Ask For: [Specific negotiation point]
   Suggested Language: "[replacement text]"

2. ...

MISSING PROTECTIONS
- [What's missing + why it matters]

POSITIVE ASPECTS
- [What's fair in this contract]

CLAUSE-BY-CLAUSE ANALYSIS
[Table: Clause | Category | Risk | Deviation | Summary]
```

---

## 9. Installation & Setup

### 9.1 Backend Setup

```bash
# Clone and setup
cd legallens/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac

# Install dependencies
pip install fastapi uvicorn python-multipart anthropic PyMuPDF pytesseract \
    Pillow chromadb sentence-transformers fpdf2 sse-starlette python-dotenv

# Set API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Install Tesseract (Ubuntu)
sudo apt-get install tesseract-ocr

# Run server
uvicorn main:app --reload --port 8000
```

### 9.2 requirements.txt

```
fastapi>=0.104.0
uvicorn>=0.24.0
python-multipart>=0.0.6
anthropic>=0.39.0
PyMuPDF>=1.23.0
pytesseract>=0.3.10
Pillow>=10.0.0
chromadb>=0.4.0
sentence-transformers>=2.2.0
fpdf2>=2.7.0
sse-starlette>=1.8.0
python-dotenv>=1.0.0
```

---

## 10. Hackathon Demo Script (2 Minutes)

### Setup Before Demo
- Have the server running
- Have a sample Indian rental agreement PDF ready (with known red clauses)
- Have the frontend loaded on the upload page
- Pre-cache one analysis result as fallback in case of API timeout

### The Script

**[0:00 - 0:15] Hook**
"Every year, millions of Indians sign rental agreements they don't fully understand. LegalLens AI reads them so you don't have to."

**[0:15 - 0:30] Upload**
Drag and drop a rental agreement PDF. Show the agent pipeline activating — classifier running, simplifier running, nodes lighting up.

**[0:30 - 1:00] The Reveal**
Results dashboard appears. Point to:
- The verdict badge: "NEGOTIATE — 3 critical issues found"
- The risk heatmap: "See these red blocks? Those are the clauses that could hurt you."
- Click one red clause: show original legalese vs. plain English side by side

**[1:00 - 1:20] Risk Deep Dive**
Click the worst clause (e.g., one-sided indemnification):
- "This clause means if anyone gets hurt on the property — even if it's the landlord's fault — YOU pay. Our system caught this and suggests mutual indemnification instead."
- Show the suggested replacement language.

**[1:20 - 1:40] Chat**
Switch to chat tab. Ask: "Can the landlord enter my apartment without notice?"
Show the grounded answer with clause reference.

**[1:40 - 2:00] Close**
"LegalLens AI doesn't just summarize — it thinks. Five agents collaborate to classify, simplify, assess risk, benchmark against fair standards, and advise. Download the negotiation brief and walk into your next signing prepared."

Click "Download Negotiation Brief" — show the PDF.

---

## 11. Stretch Goals (If Time Permits)

Listed in priority order — do these only after the core pipeline works:

1. **Multi-language support** — Accept documents in Hindi/Kannada, translate to English for analysis, present results in original language
2. **Document comparison** — Upload two versions, show diff with risk delta
3. **Clause amendment mode** — User edits a clause, system re-analyzes just that clause in real-time
4. **Voice Q&A** — Ask questions about the document via voice (Web Speech API)
5. **Export to WhatsApp/Email** — Share the risk summary as a formatted message
6. **Browser extension** — Analyze Terms of Service on any webpage

---

## 12. Error Handling & Edge Cases

- **Empty PDF / Image-only PDF**: Detect low text extraction → trigger OCR pipeline → if OCR also fails, show clear error: "This document couldn't be read. Please upload a clearer scan."
- **Non-legal document**: The Classifier agent should detect this and return a flag. Show: "This doesn't appear to be a legal document. Results may not be accurate."
- **Very long documents (50+ pages)**: Chunk into sections, process in batches of 15-20 clauses per agent call to stay within context limits.
- **API rate limits**: Implement retry with exponential backoff. Cache results by document hash.
- **Partial agent failure**: If one agent fails, still show results from the others. Mark the failed agent's section as "Analysis unavailable — retry?"

---

## 13. What Judges Will Look For vs. What We Deliver

| Judging Criteria | Our Answer |
|-----------------|-----------|
| "Is it agentic?" | 5 specialized agents with a real dependency DAG, parallel execution, autonomous decision-making |
| "Does it work?" | Live demo with real document, real analysis, real results |
| "Is it useful?" | Everyone has signed a contract they didn't understand |
| "Is it technically impressive?" | Multi-agent orchestration, SSE streaming, RAG, async parallel execution |
| "Is the UI good?" | Risk heatmap, agent pipeline animation, clause cards with side-by-side comparison |
| "Can it scale?" | Stateless API, document-level caching, modular agent architecture |