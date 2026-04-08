# Development Workflow

## Core Principle

**Plan before you code. Verify after you code.**

## The Workflow

```
0. BRAINSTORM (optional)
      |
1. STRATEGIZE  ->  2. PLAN  ->  3. PLAN REVIEW  ->  4. CHECKLIST  ->  5. CHECKLIST REVIEW
                                                                            |
                                                      8. VERIFY  <-  7. FIX  <-  6. IMPLEMENT
```

### Phases

```
Step 0 (Optional): BRAINSTORM — high-level creative exploration
Phase 1: STRATEGIZE -> PLAN -> PLAN REVIEW -> CHECKLIST -> CHECKLIST REVIEW  (Steps 1-5)
Phase 2: IMPLEMENT -> FIX                                                     (Steps 6-7)
Phase 3: VERIFY                                                                (Step 8)
```

**Step 0** is optional — skipped for well-defined features, recommended for novel/complex problems. Always skipped in auto-approve mode.

## Workflow Control

### Approval Modes

| Mode | Checkpoints | Use Case |
|------|-------------|----------|
| **Phase-by-phase (default)** | After Steps 5, 7, 8 | Multi-round questions still asked within Steps 0, 1, 2 |
| **Auto-approve everything** | None | Step 0 skipped, Steps 1-2 single-phase, no pauses |
| **Step-by-step** | After each step | Multi-round questions still asked |

### User Controls

| What to Say | What Happens |
|-------------|--------------|
| "Pause" / "Stop" | Pause at current step |
| "Continue" / "Resume" | Resume from pause |
| "Skip to step [N]" | Jump to step N |
| "Status" | Show current progress |

### Orchestration Rules

1. Run phases automatically — don't ask permission for each step within a phase
2. Brief notifications per step — don't wait for approval
3. Pause at phase ends — simple "Continue?" question
4. Create tasks via TaskCreate at workflow start for progress tracking
5. Mark tasks `in_progress` / `completed` as each step runs
6. **Multi-round questions are NOT approval gates** — always present brainstormer/strategist/planner questions to the user via `AskUserQuestion`
7. **Checklist sync at every checkpoint**: At every phase gate, read the checklist and mark completed items `[x]`

## Interaction Patterns

### Implementation Loop (Steps 6 & 7)

Steps 6 and 7 operate as a fused loop. The orchestrator drives this loop per checklist phase.

#### Per-Phase Loop

```
For each checklist phase:
  1. Implement the phase items (create/edit files)
  2. If Python errors -> fix imports, syntax, types
  3. If server won't start -> fix configuration
  4. If endpoint tests fail -> fix logic
  5. Update checklist [x] for completed items
  6. Repeat for next phase
```

### Multi-Round Agent Protocol (Steps 0, 1 & 2)

Brainstormer (Step 0), strategist (Step 1), and planner (Step 2) all follow this identical pattern:

**Normal Mode (Multi-Round via Resume)**:
1. Launch agent -> returns analysis + questions
2. Main conversation presents questions to user via `AskUserQuestion`, then resumes agent with answers
3. Agent signals completion — orchestrator reads signal and acts:
   - **"[Step] in progress — questions pending"** -> present questions, resume agent
   - **"[Step] complete"** -> proceed to next step
4. **Do NOT independently decide if another round is needed** — trust the agent's signal

**Auto-Approve-Everything**: Agent does everything in one go (no questions).

**Shared rules for multi-round agents**:
- Questions go in the **REPLY** (not in separate files)
- Each question includes: description, options with pros/cons, recommendation
- Batch multiple questions per round

### Audit + Resolve Protocol (Steps 3 & 5)

Both Step 3 (Plan Review) and Step 5 (Checklist Review) follow the same pattern:

1. **Auditor agent** writes audit report with issues and solution options per issue
2. Main conversation presents CRITICAL/HIGH to user, asks about MEDIUM/LOW
3. **Resolver agent** receives decisions, updates the target document

**Shared auditor rules**:
- Each issue MUST have 2+ solution options with pros/cons
- Severity levels: CRITICAL > HIGH > MEDIUM > LOW

**Shared resolver rules**:
- Narrow scope: apply decisions only, don't re-analyze
- Mark changes with `[Audit]` annotations

## Phase 2 Exit Gate (MANDATORY before Phase 3)

Before pausing for user confirmation after Steps 6-7:
1. **Server starts** — `uvicorn main:app` runs without import/syntax errors
2. **Core endpoints respond** — /api/health returns 200
3. **Checklist** fully updated with `[x]` on all completed items

If any gate fails: loop back into Step 7 before presenting the checkpoint.

## Key Rules

1. **Plan first** — don't start coding until the checklist is reviewed
2. **Build incrementally** — implement one phase at a time, verify each phase works
3. **Fix before moving on** — don't proceed to next phase with broken code
4. **Test at each checkpoint** — verify the server starts and endpoints work

## Committing

Workflow does **NOT auto-commit**. Stage only workflow-scoped files.

### Commit Points

| After | What | Prefix |
|-------|------|--------|
| Step 0 (BRAINSTORM) | Brainstorm notes | `plan:` |
| Step 2 (PLAN) — before audit | Strategy + spec | `plan:` |
| Step 5 (CHECKLIST REVIEW) | Checklist + audit results | `track:` |
| Each Phase in Step 6-7 | Source code for that phase | `feat:`/`fix:` |
| Step 8 (VERIFY) | Any final fixes | `fix:` |
