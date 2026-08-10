# Track 1095: /laneconductor plan doesn't reliably populate test.md

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: New — reported, not yet investigated
**Type**: dev
**Summary**: Every "planning complete" track checked (1087, 1089, 1091, 1092) has test.md still as the generic "(Test cases to be added)" stub — the plan command's own instruction to populate it isn't taking…

## Problem

`/laneconductor plan`'s SKILL.md instructions say to create `test.md` with
Test Commands, Test Cases per phase, and an Acceptance Criteria checklist
during scaffold, and to update it with new cases on every re-plan. In
practice, every track checked so far — 1087 (Live Session Transcript
Panel), 1089 (Remote Worker Provisioning), 1091 (Manager Worker & New
Project Flow), 1092 (Deploy Config UI) — has test.md sitting at the bare
template stub:

```markdown
# Tests

(Test cases to be added)
```

despite each having a fully fleshed-out spec.md and plan.md (multiple
phases, detailed requirements). This means `/laneconductor implement`'s
TDD Protocol (test.md drives implementation order) has nothing to work
from for any of these tracks, and the gap was only caught by manual
inspection while working on 1087 — not by any existing check.

**Not yet root-caused** — open questions before a fix can be written:
- Is `/laneconductor plan` actually being invoked for these tracks and
  silently not following its own test.md instruction? Or are these tracks
  skipping the full plan flow entirely (e.g. `newTrack`'s quick stub
  scaffold, with spec.md/plan.md hand-authored afterward without a formal
  `/laneconductor plan` pass)?
- Does this correlate with anything about how these specific tracks were
  created (brainstorm-first vs. direct plan, human-authored vs.
  agent-authored spec/plan)?

## Proposed direction (needs investigation first, not a guessed fix)

1. `/laneconductor plan` should reliably populate test.md with real
   per-phase test cases, not leave the stub — investigate why it doesn't
   before changing the instruction (a stronger sentence may not be
   sufficient if the actual failure mode is "plan never ran").
2. `/laneconductor implement` should self-heal: if test.md is still
   missing or at the stub when implement starts, generate it from
   plan.md's phases first, rather than silently proceeding without TDD
   guidance.

## Depends on

None known yet — may turn out to be related to track 1047's TDD Protocol
addition to `/laneconductor implement` (`.claude/skills/laneconductor/SKILL.md`)
or to how `/laneconductor newTrack` vs. a full `/laneconductor plan` pass
scaffold test.md differently.
