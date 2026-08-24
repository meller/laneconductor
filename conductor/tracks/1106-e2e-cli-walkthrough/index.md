# Track 1106: End-to-end walkthrough — CLI (lc)

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: Not started — opened 2026-08-12
**Type**: dev
**Summary**: Run the complete "nothing → a track planned" path purely through the lc CLI in a terminal. Sibling of 1104 (UI) and 1105 (skill); all three must reach the same end state.

## Problem

The CLI is the scripting/power-user surface and the one the other two lean
on (the UI shells out to `make lc-*`; the skill defers to `lc` when
present). It has the widest command surface (~40 commands) and no recent
end-to-end pass as a *user* — individual commands are tested, the journey
is not. It is also where interface drift shows first: `lc --help` already
describes several behaviours differently than the code (e.g. track 1089
found `--projects-dir` silently ignored by the worker unless it goes
through `lc`).

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

## CLI-specific path

`lc setup` → `lc worker start` → `lc new "…" "…"` → `lc plan <id> --run`
→ `lc status` / `lc show <id>` / `lc logs <id>` → `lc comment` →
`lc move` … and the failure-path commands (`lc rerun`, `lc worker status`)
when something breaks.

Also in scope, briefly: `lc build` / `lc builds` and `lc deploy` — **walk
up to but not including a real deploy**, same rule as 1104.

## Phases
- [ ] Phase 1: Walk the path in a clean scratch project; record each command's observed output vs. what `--help` promises
- [ ] Phase 2: File/fix findings (link to 1102 where overlapping); help-text drift counts as a finding, not cosmetics
- [ ] Phase 3: Note gaps vs. the reference outcome — especially observability (item 7: can a CLI user actually watch a run?) and failure visibility (item 8)
- [ ] Phase 4: Wiki guide for the CLI path (track 1103 Phase 5)
- [ ] Phase 5: Regression protection — the CLI path is the most automatable of the three; script it against the mock-CLI/mock-collector harness as a node:test integration test

## Meta: this track is itself driven through the CLI

Dogfooding rule (added 2026-08-12): every lane action on THIS track —
planning it, implementing it, commenting on it, checking its status — must
be performed through lc commands in a terminal (lc plan --run, lc comment, lc logs), never through a side channel. If the CLI
cannot perform one of those operations, that inability is itself a finding
for this track (and likely for track 1103's design). LaneConductor builds
itself with itself here: the walkthrough's own execution is the first run
of the walkthrough.

The wiki guide (Phase 4) is then written **from the recording of that
run** — real commands, real screens, real outputs, including the rough
edges that survived. A guide transcribed from an actual session cannot
describe steps that don't work; one written from memory can and will.

## Depends on
[1103](../1103-e2e-onboarding-experience/index.md), [1102](../1102-e2e-session-findings/index.md). Sibling: [1104](../1104-e2e-ui-walkthrough/index.md), [1105](../1105-e2e-skill-walkthrough/index.md).
