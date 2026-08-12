# Track 1105: End-to-end walkthrough — skill (/laneconductor in an AI editor)

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: Not started — opened 2026-08-12
**Type**: dev
**Summary**: Run the complete "nothing → a track planned" path purely through the /laneconductor skill commands, as an AI-editor user would (including Skill-Only mode with no lc CLI and no DB). Sibling of 1104 (UI) and 1106 (CLI); all three must reach the same end state.

## Problem

The skill is the primary interface for AI-editor users, and the only one
with a **Skill-Only mode** (no CLI, no Postgres — filesystem only, the
README's Windows/minimalist path). Nobody has walked either variant end to
end as a user recently; the skill's commands are exercised piecemeal by
worker automation, which is not the same thing. Skill-Only mode in
particular is advertised but essentially unverified.

## The reference outcome (identical for all three interfaces)

Every interface must be able to reach this same end state from nothing.
Where an interface *cannot*, that is a finding to record, not a step to
quietly skip.

1. A project exists and is registered (`projects` row, `repo_path` set).
2. It is a git repo with at least one commit (lane actions need
   `git worktree add … HEAD` — see track 1102 F7).
3. Its context files exist: `product.md`, `tech-stack.md`, `workflow.md`,
   `product-guidelines.md`, `design-language.md`, `deployment-stack.md`,
   `kpis.md`, `user-stories.md`, `quality-gate.md`.
4. A worker is running for it, and the interface makes clear *which
   machine* it is on and whether it is manual or automatic.
5. A track can be created, and its 5 files are scaffolded
   (`index`, `spec`, `plan`, `test`, `conversation`) with a real
   populated `test.md`.
6. A lane action (plan) can be **triggered from this interface** and
   actually runs to completion — the track reaches `plan/success`.
7. The run is observable from this interface while it happens, and its
   output is readable afterwards.
8. Failures are visible: if the action fails, this interface says so with
   a usable reason (no silent `claimed`/`running` limbo — track 1102 F8).

## Skill-specific path

Two variants, both required:

**A. Full-stack** (lc + DB present): `/laneconductor setup` →
`setup scaffold` → `new` → `plan --run` (or dispatch) → `status` /
`show` → `comment` / `brainstorm` on the track.

**B. Skill-Only mode** (no lc, no DB — the minimalist path):
same flow driven purely through conductor/ files. Expected friction:
several outcome items (worker, registration, live observation) have no
meaning here — the walkthrough must record what the *equivalent* is
(e.g. the AI itself is the "worker") or record that the mode cannot
reach that item.

## Phases
- [ ] Phase 1: Variant A in a clean scratch project, each command's observed result recorded
- [ ] Phase 2: Variant B likewise — this is the one most likely to have rotted; treat its claims in SKILL.md as hypotheses, not facts
- [ ] Phase 3: File/fix findings (link to 1102 where overlapping); explicitly reconcile any SKILL.md text that promised something the walkthrough disproved
- [ ] Phase 4: Wiki guide for the skill path, both variants (track 1103 Phase 5)
- [ ] Phase 5: Regression protection — extend the existing worker/mock-CLI test suites to cover the skill-driven sequence where automatable; document which parts remain manual-only and why

## Depends on
[1103](../1103-e2e-onboarding-experience/index.md), [1102](../1102-e2e-session-findings/index.md). Sibling: [1104](../1104-e2e-ui-walkthrough/index.md), [1106](../1106-e2e-cli-walkthrough/index.md).
