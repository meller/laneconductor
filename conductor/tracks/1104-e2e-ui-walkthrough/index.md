# Track 1104: End-to-end walkthrough — UI (browser)

**Lane**: implement
**Lane Status**: running
**Progress**: 60%
**Last Run**: mock (primary)
**Phase**: Phase 4 — write up the wiki UI guide (blocked: track 1103 hasn't established the wiki location yet); Phase 5 blocked on track 1100's fast tier being green
**Type**: dev
**Summary**: Phases 1-3 complete: real-browser walkthrough recorded (`session-log.md`), findings cross-referenced into 1102 (F5/F7 re-confirmed fixed; new F9 filed — a successful plan run inside a worktree never…

## Problem

A partial version of this walkthrough (2026-08-12, track 1102) broke at
several independent points — a project that wasn't a git repo, a plan
button that never dispatched, failures that surfaced nowhere. Those were
found by accident while verifying something else. This track makes the
walkthrough a deliberate, repeatable exercise for the **UI specifically**.

The UI is the interface most likely to hide problems: it can show a
plausible-looking board while nothing behind it works, which is exactly
what happened.

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

## UI-specific path

- New Project wizard (`+ Project`)
- Project selector
- `+ Track` modal
- The track card's lane-action controls
- Activity panel (live run) and the track detail drawer (transcript,
  conversation)
- Inbox
- CI/CD tab and deploy wizard — **walk it, stop before actually deploying**

## Phases
- [x] Phase 1: Walk the path in a real browser against a clean project; record each step's observed result (not intended result)
- [x] Phase 2: File/fix what breaks — link findings to track 1102 where they overlap rather than duplicating
- [x] Phase 3: Note every state the UI fails to represent (no worker, no git, action failed, which machine) → feeds track 1103's design
- [ ] Phase 4: Write the walkthrough up as the wiki's UI guide (track 1103 Phase 5) — **blocked**: 1103 hasn't reached Phase 5 / established a wiki location yet; `session-log.md` in this track is ready as direct transcription input when it does
- [ ] Phase 5: Encode it as a Playwright spec in track 1100's **fast tier** so it can't rot — **blocked**: 1100 is back at `implement/queue` after a failed review (fixture visibility not reset, slow tier not green), so its fast tier isn't confirmed usable yet

## Meta: this track is itself driven through the UI

Dogfooding rule (added 2026-08-12): every lane action on THIS track —
planning it, implementing it, commenting on it, checking its status — must
be performed through the LaneConductor web UI (trigger lane actions from the board, answer via the Conversation tab, watch via Activity), never through a side channel. If the UI
cannot perform one of those operations, that inability is itself a finding
for this track (and likely for track 1103's design). LaneConductor builds
itself with itself here: the walkthrough's own execution is the first run
of the walkthrough.

The wiki guide (Phase 4) is then written **from the recording of that
run** — real commands, real screens, real outputs, including the rough
edges that survived. A guide transcribed from an actual session cannot
describe steps that don't work; one written from memory can and will.

## Depends on
[1103](../1103-e2e-onboarding-experience/index.md) (the design this validates), [1102](../1102-e2e-session-findings/index.md) (known bugs on this path), [1100](../1100-fix-playwright-e2e-suite/index.md) (Phase 5 needs the fast tier).
