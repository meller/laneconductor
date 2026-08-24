# Spec: Test Normal Plan A

## Problem Statement

LaneConductor's `plan` lane has no end-to-end canary for the **normal path** —
a track that goes straight through `/laneconductor plan` without a brainstorm
dialogue first. Track 992 ("Brainstorm B") covers the brainstorm path; nothing
covers this one. When the plan lane regresses (the worker fails to claim the
track, the plan run leaves `test.md` at its generic stub, or the transition
ignores `workflow.json` and parks the card in the wrong Kanban column), the
breakage is only discovered when a real track fails mid-flight.

## Solution

A minimal always-runnable canary track whose plan lane produces complete
planning artifacts, and whose implement phase performs one small, externally
verifiable action — so every downstream lane (`implement` → `review` →
`quality-gate`) has real work to act on rather than an empty track.

## Requirements

- **REQ-1**: The track carries the three planning artifacts a real track needs —
  `spec.md`, `plan.md`, and a `test.md` with concrete, runnable test cases (not
  the `(Test cases to be added)` stub).
- **REQ-2**: While the plan run is in flight, the track is visibly claimed:
  `**Lane**: plan` and `**Lane Status**: running` in `index.md`, so the Kanban
  board shows it running in the `plan` column and the worker does not
  double-launch it.
- **REQ-3**: On completion, the lane is set from `conductor/workflow.json`'s
  `lanes.plan.on_success` (currently `plan:success`) — read at runtime, never
  hardcoded — and a `✅` completion comment is appended to `conversation.md` in
  the `> **system**: ...` sync format.
- **REQ-4**: The implement phase writes a marker file with known content, giving
  review and quality-gate something real to verify.
- **REQ-5**: The canary uses no network, no database, and no project-specific
  tooling, so it runs identically in `local-fs`, `local-api`, and `remote-api`
  modes.

## Open Items (for human review — not resolved by this track)

- **OPEN-1: the plan lane reports 100% progress on a track with nothing built.**
  Observed on this track's second plan run: the worker forces
  `**Progress**: 100%` on any successful lane-action exit
  (`conductor/laneconductor.sync.mjs:4494-4499`), carving out only conversation
  runs and blocked turns — not the `plan` lane. So track 991 sat at
  `plan / success / 100%` with all three phases unimplemented and no
  `canary-a.txt` on disk.

  On the Kanban board that reads as a finished track. Whether that's intended
  (progress = "this lane's action completed") or a defect (progress = "the track
  is done") is a product call, not one the plan lane should make — and fixing it
  means editing worker code, which is outside this lane's boundary. `test.md`
  TC-3.3 currently pins the *observed* behavior so the canary stays green, and
  TC-3.6 fails loudly if the carve-out list changes. Retarget both if this is
  resolved.

## Acceptance Criteria

- [ ] A developer opening the board sees track 991 in the `plan` column marked
      running while the plan run is in progress, and in `plan` / `success`
      afterwards.
- [ ] After the plan run, track 991's folder contains `spec.md`, `plan.md`,
      `test.md`, and `conversation.md`, with `test.md` naming at least one real
      test case per phase in `plan.md`.
- [ ] After the implement run, the file
      `conductor/tracks/991-test-normal-plan-a/canary-a.txt` exists and reads
      exactly `Normal Plan A OK`.
- [ ] The Conversation tab for track 991 shows the plan-completion comment
      (it reached `track_comments`, i.e. it was written in the parseable
      `> **system**:` format).
- [ ] Every command listed in `test.md` passes when run from the repo root.

## API Contracts / Data Models

None — this track adds no schema, endpoint, or config surface. It only reads
`conductor/workflow.json` and writes files inside its own track folder.
