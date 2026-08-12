# Track 1103: End-to-end onboarding experience (UI and skill), and the wiki walkthroughs

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: Not started — opened 2026-08-12
**Type**: dev
**Summary**: Define and make coherent the whole "I have nothing → I have a project doing work" experience, for both the UI path and the skill/CLI path. Track 1102 collects the individual bugs; this track owns the design questions underneath them and the eventual user-facing walkthroughs.

## Problem

Track 1102 found the create-project → track → plan path broken at several
independent points. Fixing each in isolation misses that **nobody has
decided what this experience is supposed to be.** The bugs are symptoms of
unanswered design questions:

1. **What are the required steps?** Create a project… then create a worker?
   Is a project without a worker a valid state, or a half-finished one?
2. **Does the UI say a project has no worker attached?** Today it doesn't.
   A project with no worker looks identical to a working one until you
   queue something and nothing happens.
3. **Which machine(s) is a project connected to?** A project can exist on
   several machines, each with its own worker. Nothing surfaces this. It
   matters much more in **remote** mode (the app is not on your machine)
   than local, where "the project" and "this computer" happen to coincide —
   and that difference is currently invisible in the UI.
4. **When does git get initialised, and by whom?** Track 1102's F7 fix put
   it in the manager's `create-project` handler. Is that right, or should
   the project's own sync worker do it on first start, or `lc setup`?
   Different answers imply different failure modes.
5. **Does git init need user approval?** Almost certainly yes for a
   non-empty directory — `git add -A` with no `.gitignore` can commit
   `node_modules`, `.env`, secrets. 1102's fix therefore refuses and
   explains rather than guessing, but "refuse" is a stopgap, not a designed
   answer. The designed answer probably involves asking.
6. **Worker mode naming** (1102 F6): `sync-only` / `sync+poll` describe the
   mechanism. Users are choosing **manual** vs **automatic**. The current
   names caused a misdiagnosis during this very session.

## Solution (to be designed, not assumed)

- Write down the intended happy path for both entry points, as a sequence
  of states with a defined "what the user sees" at each:
  - **UI path**: New Project wizard → … → a track doing work.
  - **Skill/CLI path**: `lc setup` / `/laneconductor setup` → … → same.
- Identify every state where the system is not yet usable (no worker, no
  git, no collector) and make the UI say so plainly, with the action that
  resolves it.
- Decide the machine/connection model and surface it: which machines this
  project has workers on, which of them is this UI talking to.
- Then, from that written flow, produce the **wiki walkthroughs** — one for
  the UI path, one for the skill path. These should be derived from the
  designed flow, not written separately from it, or they will drift.

## Phases
- [ ] Phase 1: Write the intended UI happy path as explicit states + what the user sees at each; mark which states are currently unrepresented
- [ ] Phase 2: Same for the skill/CLI path; note where the two diverge and whether that divergence is intended
- [ ] Phase 3: Decide the open questions above (worker required?, git init owner + approval, machine/connection model, mode naming) — decisions recorded here with reasoning
- [ ] Phase 4: Implement the UI affordances the design calls for (project-needs-a-worker state, machine/connection display, mode labels)
- [ ] Phase 5: Wiki walkthroughs for both paths, derived from Phases 1-2, with the real commands/screens
- [ ] Phase 6: An E2E spec (track 1100's fast tier) that walks the documented UI path, so the walkthrough can't silently rot

## Depends on
[1102](../1102-e2e-session-findings/index.md) — the concrete bugs; this track is the design behind them. [1100](../1100-fix-playwright-e2e-suite/index.md) — Phase 6 needs a working E2E tier to live in. [1091](../1091-manager-worker-and-new-project-flow/index.md), [1084](../1084-worker-identity-and-assignment/index.md) — the create-project and worker-mode mechanisms being described.

## Notes

Deliberately opened as a **design** track rather than folding these into
1102. 1102 is "here are broken things, fix them"; several of its fixes are
stopgaps precisely because the intended behaviour was never specified.
Answering these questions first is what stops the next walkthrough finding
the same class of gap again.
