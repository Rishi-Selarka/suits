"""Curated what-if scenario templates per document type.

The frontend renders these as one-tap chips so the user doesn't need to think
of a hypothetical from scratch. Each template is keyed by `document_types` —
substrings matched case-insensitively against the advisor's
`document_summary.document_type` (e.g. "rental", "employment", "nda").

Add scenarios here rather than in the agent — they're data, not behaviour.
"""

from __future__ import annotations

from models import ScenarioTemplate

_ALL_TEMPLATES: list[ScenarioTemplate] = [
    # ── Rental / Lease ────────────────────────────────────────────────
    ScenarioTemplate(
        id="rental_late_rent_30",
        document_types=["rental", "lease", "leave-and-license", "rent"],
        title="I pay rent 30 days late",
        prompt=(
            "What happens if I am 30 days late on a single month's rent payment "
            "under this contract? Walk through the late-fee calculation, when "
            "the landlord can serve a notice, and whether this triggers any "
            "termination or forfeiture provisions."
        ),
        icon="clock",
        severity_hint="UNFAVORABLE",
    ),
    ScenarioTemplate(
        id="rental_terminate_early",
        document_types=["rental", "lease", "leave-and-license"],
        title="I want to vacate after 6 months",
        prompt=(
            "I want to terminate this rental and move out after only 6 months. "
            "What lock-in period, notice period, and penalty does the contract "
            "impose on me, and what is my realistic out-of-pocket cost?"
        ),
        icon="door-open",
        severity_hint="UNFAVORABLE",
    ),
    ScenarioTemplate(
        id="rental_deposit_not_returned",
        document_types=["rental", "lease", "leave-and-license"],
        title="Landlord refuses to return my deposit",
        prompt=(
            "My tenancy has ended and I have vacated the property in good "
            "condition, but the landlord is refusing to return my security "
            "deposit. What does this contract say about deposit return, what "
            "deductions are permitted, and what is my legal recourse?"
        ),
        icon="banknote",
        severity_hint="UNFAVORABLE",
    ),
    ScenarioTemplate(
        id="rental_property_damage",
        document_types=["rental", "lease", "leave-and-license"],
        title="The property is damaged in a flood",
        prompt=(
            "A natural event (flood / fire) has rendered the property partially "
            "uninhabitable mid-tenancy. Who is responsible for repairs, can I "
            "withhold rent, and does the force-majeure or maintenance clause "
            "give me a right to terminate?"
        ),
        icon="cloud-rain",
        severity_hint="NEUTRAL",
    ),
    ScenarioTemplate(
        id="rental_rent_hike",
        document_types=["rental", "lease", "leave-and-license"],
        title="Landlord wants to hike rent at renewal",
        prompt=(
            "On renewal the landlord wants to raise rent by 20%. Does the "
            "contract cap the escalation, what notice am I owed, and what "
            "happens if I refuse — am I forced to vacate or can I challenge "
            "the hike?"
        ),
        icon="trending-up",
        severity_hint="NEUTRAL",
    ),

    # ── Employment ────────────────────────────────────────────────────
    ScenarioTemplate(
        id="employ_fired_no_notice",
        document_types=["employment", "employee", "service agreement"],
        title="I am fired without notice",
        prompt=(
            "My employer has terminated me with immediate effect and no notice. "
            "Walk through what notice or pay-in-lieu I am owed under this "
            "contract, what the F&F obligations are, and whether the "
            "termination grounds asserted are actually permitted."
        ),
        icon="user-x",
        severity_hint="UNFAVORABLE",
    ),
    ScenarioTemplate(
        id="employ_join_competitor",
        document_types=["employment", "employee"],
        title="I want to join a direct competitor",
        prompt=(
            "I want to leave and join a direct competitor. What does the "
            "non-compete / non-solicitation clause restrict, for how long and "
            "in what geography, and is it actually enforceable in India under "
            "Section 27 of the Indian Contract Act?"
        ),
        icon="swords",
        severity_hint="NEUTRAL",
    ),
    ScenarioTemplate(
        id="employ_unpaid_overtime",
        document_types=["employment", "employee"],
        title="I am asked to work unpaid overtime",
        prompt=(
            "My manager is forcing me to consistently work 12-hour days without "
            "extra pay. What does the working-hours / overtime clause say, "
            "what is required by the Shops & Establishments Act, and what is "
            "my recourse if I refuse?"
        ),
        icon="alarm-clock",
        severity_hint="NEUTRAL",
    ),
    ScenarioTemplate(
        id="employ_resign_early",
        document_types=["employment", "employee"],
        title="I resign before my notice period",
        prompt=(
            "I want to resign and join a new role before serving the full "
            "notice period. What buy-out / recovery clause applies, and is "
            "the company allowed to withhold my relieving letter or salary?"
        ),
        icon="log-out",
        severity_hint="NEUTRAL",
    ),

    # ── NDA / Confidentiality ─────────────────────────────────────────
    ScenarioTemplate(
        id="nda_accidental_disclosure",
        document_types=["nda", "non-disclosure", "confidential"],
        title="I accidentally share confidential info",
        prompt=(
            "An employee on my team accidentally shares confidential "
            "information from the disclosing party with a third party in an "
            "email. What are my liability and remediation obligations, and "
            "what damages might I owe?"
        ),
        icon="alert-triangle",
        severity_hint="UNFAVORABLE",
    ),
    ScenarioTemplate(
        id="nda_use_idea_elsewhere",
        document_types=["nda", "non-disclosure", "confidential"],
        title="I want to use the disclosed idea elsewhere",
        prompt=(
            "After our discussions ended, I want to build a similar product "
            "using ideas adjacent to what was disclosed. What does this NDA "
            "actually restrict — specific information vs. general know-how — "
            "and how long does the restriction last?"
        ),
        icon="lightbulb",
        severity_hint="NEUTRAL",
    ),

    # ── Service / Freelance / Consulting ──────────────────────────────
    ScenarioTemplate(
        id="service_client_stops_paying",
        document_types=["service", "consulting", "freelance", "contractor", "saas"],
        title="The client stops paying invoices",
        prompt=(
            "The client has stopped paying my invoices for 60 days. What does "
            "the payment clause say about late payment, can I suspend "
            "deliverables, and what is my recourse to recover the dues "
            "(jurisdiction, arbitration, conciliation)?"
        ),
        icon="receipt",
        severity_hint="UNFAVORABLE",
    ),
    ScenarioTemplate(
        id="service_scope_creep",
        document_types=["service", "consulting", "freelance", "contractor"],
        title="The client demands extra work outside scope",
        prompt=(
            "The client is asking for substantial additional work beyond the "
            "agreed scope without revising the fee. What does the change-order "
            "clause say, am I obligated to perform, and how do I push back "
            "without breaching?"
        ),
        icon="layers",
        severity_hint="NEUTRAL",
    ),

    # ── Generic fallbacks (always available) ──────────────────────────
    ScenarioTemplate(
        id="generic_dispute",
        document_types=["*"],
        title="A dispute reaches arbitration / court",
        prompt=(
            "A genuine dispute arises between the parties. Walk through the "
            "dispute-resolution clause: governing law, seat of arbitration, "
            "court jurisdiction, and what each side bears in costs and time."
        ),
        icon="gavel",
        severity_hint="NEUTRAL",
    ),
    ScenarioTemplate(
        id="generic_force_majeure",
        document_types=["*"],
        title="A force majeure event hits performance",
        prompt=(
            "A force-majeure-style event (pandemic, lockdown, regulatory ban, "
            "act of god) makes performance impossible for 90+ days. Does this "
            "contract allow suspension or termination, and what financial "
            "obligations survive?"
        ),
        icon="zap",
        severity_hint="NEUTRAL",
    ),
]


def templates_for_document_type(document_type: str) -> list[ScenarioTemplate]:
    """Return curated templates whose `document_types` match the detected type.

    Matching is case-insensitive substring containment in either direction —
    e.g. "Residential Rental Agreement" matches "rental" or "lease".
    Generic templates (document_types includes "*") are always appended last.
    """
    needle = (document_type or "").lower().strip()
    matched: list[ScenarioTemplate] = []
    generic: list[ScenarioTemplate] = []
    for tpl in _ALL_TEMPLATES:
        if "*" in tpl.document_types:
            generic.append(tpl)
            continue
        for tag in tpl.document_types:
            tag_l = tag.lower()
            if not needle:
                continue
            if tag_l in needle or needle in tag_l:
                matched.append(tpl)
                break
    return matched + generic
