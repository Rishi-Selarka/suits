# Workflow Orchestration Rules

Rules specific to the `/develop` workflow orchestrator. See `workflow.md` for the full workflow.

## Orchestration Sequence

- ALWAYS launch independent agents in parallel
- For the workflow sequence, see `workflow.md`
- See `workflow.md` for multi-round agent pattern (Steps 0, 1 & 2) and audit + resolve pattern (Steps 3 & 5)

## Context Passing to Implementation Agents

When invoking implementation agents after planning, include in the prompt:
- **Files to create/modify** (file paths from the plan)
- **Checklist phase** being implemented (so agent understands scope)
- **Spec reference** (path to the plan spec for requirements context)
- **Error/test output** if fixing issues (so agent doesn't re-discover from scratch)

This prevents the agent from wasting context on rediscovering what was just decided in planning.

## Model Config

Agent model assignments for the workflow:

**General tiers**:
- **Opus**: Creative/reasoning-heavy work — brainstormer (Step 0), strategist (Step 1), auditors (Steps 3a, 5a)
- **Sonnet**: Structural/implementation work — planner (Step 2), resolvers (Steps 3b, 5b), implementation (Step 6-7)
- **Haiku**: Mechanical/transcription work — session logging, commit messages

## Phase Sequencing

```
Step 0 (Optional): BRAINSTORM
    |
Phase 1: STRATEGIZE -> PLAN -> PLAN REVIEW -> CHECKLIST -> CHECKLIST REVIEW
    |
Phase 2: IMPLEMENT -> FIX (loop until tests pass)
    |
Phase 3: TEST & VERIFY -> COMMIT
```

## Interaction Patterns

### Implementation Loop (Steps 6 & 7)

Steps 6 and 7 operate as a fused loop, not a linear sequence. The orchestrator drives this loop per checklist phase.

#### Per-Phase Loop

```
For each checklist phase:
  1. Implement the phase items
  2. If build errors -> fix build errors
  3. If test failures -> fix test failures
  4. Verify the phase works (run server, test endpoint)
  5. Update checklist [x] for completed items
  6. Repeat for next phase
```

### Multi-Round Agent Protocol (Steps 0, 1 & 2)

Brainstormer (Step 0), strategist (Step 1), and planner (Step 2) all follow this pattern:

**Normal Mode (Multi-Round)**:
1. Launch agent -> returns analysis + questions
2. Present questions to user via `AskUserQuestion`, resume with answers
3. Agent signals completion -> proceed to next step

**Auto-Approve-Everything**: Agent does everything in one go (no questions).

### Audit + Resolve Protocol (Steps 3 & 5)

1. **Auditor agent** writes audit report with issues and solution options
2. Present CRITICAL/HIGH to user, ask about MEDIUM/LOW
3. **Resolver agent** receives decisions, updates the target document

## Committing

### Commit Points

| After | What | Prefix |
|-------|------|--------|
| Step 2 (PLAN) | Strategy + spec | `plan:` |
| Step 5 (CHECKLIST REVIEW) | Checklist + audit results | `track:` |
| Each Phase in Step 6-7 | Source code for that phase | `feat:`/`fix:` |
| Step 8 (VERIFY) | Any final fixes | `fix:` |

### Commit Behavior by Approval Mode

| Mode | Behavior |
|------|----------|
| **Phase-by-phase** | Prompt `/commit` at phase boundaries |
| **Step-by-step** | Prompt `/commit` after every commit point |
| **Auto-approve** | Run `/commit` automatically at every commit point |
