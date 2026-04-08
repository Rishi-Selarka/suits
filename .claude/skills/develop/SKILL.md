---
name: develop
description: Execute full development workflow. Orchestrates brainstorming, strategizing, planning, checklist creation, auditing, implementation, and testing.
argument-hint: "[feature description] or brainstorm|strategize|plan|checklist|audit|resolve|implement|fix"
---

# Develop Workflow

Orchestrates the development workflow adapted for Suits AI (Python/FastAPI multi-agent backend). See supporting files: `workflow.md` for workflow rules, `orchestration.md` for agent orchestration.

## Pre-Injected Context

### Current Branch
!`git branch --show-current`

### Current Project State
!`ls suits/backend/ 2>/dev/null || echo "Backend not yet scaffolded"`

### Active Tasks
!`cat .claude/plans/*.md 2>/dev/null | head -50 || echo "No active plans"`

## Supporting Files

- `workflow.md` — Full workflow rules, phase gates, interaction patterns, commit points
- `orchestration.md` — Agent orchestration rules, context passing, model config reference
- `prompts/brainstormer.md` — Step 0 prompt template
- `prompts/strategist.md` — Step 1 prompt template
- `prompts/planner.md` — Step 2 prompt template

Use prompt templates when constructing agent prompts. Replace `{{PLACEHOLDERS}}` with actual values.

## Usage

```
/develop [feature description]
```

## The Workflow

```
STEP 0 (OPTIONAL): BRAINSTORM — high-level creative exploration

PHASE 1: PLANNING (Steps 1-5)
  1. STRATEGIZE -> 2. PLAN -> 3. PLAN REVIEW -> 4. CHECKLIST -> 5. CHECKLIST REVIEW

PHASE 2: IMPLEMENTATION (Steps 6-7)
  6. IMPLEMENT -> 7. FIX

PHASE 3: VERIFICATION (Step 8)
  8. TEST & VERIFY
```

## Approval Modes

1. **Phase-by-phase (DEFAULT)** — Pause between phases. Multi-round questions still asked within Steps 0, 1, 2; audit decisions asked in Steps 3, 5.
2. **Step-by-step** — Approve each step individually. Multi-round questions still asked.
3. **Auto-approve everything** — No pauses, no questions. Step 0 skipped, Steps 1-2 single-phase. Step 5 uses audit recommendations.

**Key**: Only auto-approve-everything skips multi-round questions.

## Phase Gates

- **After Step 0** (if run): "Brainstorming complete. Ready to strategize?"
- **After Step 5**: "Ready to start implementation?"
- **After Step 7**: "Implementation complete. Ready for verification?"
- **After Step 8**: "Workflow complete. Ready to commit?"

## Partial Workflow

```bash
/develop brainstorm [topic]     # Step 0 (optional high-level)
/develop strategize [topic]     # Step 1
/develop plan [topic]           # Steps 1-2
/develop checklist [plan]       # Step 4
/develop audit                  # Step 3 (plan) or Step 5 (checklist)
/develop resolve [audit]        # Step 3b (plan) or Step 5b (checklist)
/develop implement [checklist]  # Steps 6-7
/develop fix                    # Step 7 only
```

## Orchestration Prompts

#### At Workflow Start
```
Ready to start workflow for: [feature]
Step 0 (Brainstorm) is optional — do you want to brainstorm high-level first?
Phases: [BRAINSTORM ->] PLANNING (1-5) -> IMPLEMENTATION (6-7) -> VERIFICATION (8)
Choose: 1. Phase-by-phase  2. Step-by-step  3. Auto-approve everything
```

#### At Phase Checkpoints
```
[PHASE_NAME] Phase complete (Steps [X-Y])
Summary: [Key accomplishments]
Continue to next phase? [Yes / Review first / Pause]
```

## Emergency Controls

`/pause` `/skip [N]` `/back [N]` `/current` `/abort`
