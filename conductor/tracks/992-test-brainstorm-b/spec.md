# Spec: Brainstorm → Plan Loop Canary

## Problem Statement

The brainstorm → plan loop is how a human's freeform request becomes a
`spec.md`/`plan.md`/`test.md` triple. Nothing verifies that loop end to end, so
regressions in it are discovered only when a real track quietly stalls — the loop
keeps reporting `exit 0` while making no actual progress.

This is not hypothetical. Both defects below were observed on this very track on
2026-08-20, across four consecutive `/laneconductor brainstorm 992` invocations that
each exited 0:

1. **Conversation self-pollution.** Each agent run's closing response is appended
   back into `conversation.md` as a `> **claude**:` turn, then re-read as context by
   the next run. The file grew 968b → 8041b, ending at **1 human turn against 6
   agent-authored turns**. The loop consumed its own output as input, at increasing
   token cost, with no new information entering the system.

2. **Worktree/main divergence.** `conductor/tracks/992-*/` and
   `.worktrees/992/conductor/tracks/992-*/` repeatedly drifted apart — differing in
   `conversation.md` size, in `index.md` markers (`Lane Status: running` vs
   `success`; a `**Last Run**` marker present on one side only), and in whether
   `test.md` existed at all. Drift recurred *within a single session cycle* after
   being manually reconciled. When the stale side is the smaller one, the sync
   worker's "suspiciously smaller" guard rejects it and emits `⚠️ Docs may be stale`
   into the conversation — the warning already present at the top of this thread.

Neither defect fails anything today. A canary that exits 0 while the loop is stuck
is worse than no canary, because it converts a visible stall into a silent one.

## Solution

A canary track that drives the real brainstorm → plan loop and asserts on its
**observable side effects**, failing loudly on either defect above.

## Open Items — Human Review Required

- **OPEN-1**: This spec was written under the stated assumption that 992 is a canary
  (see the `⚠️ Brainstorm closed on a STATED ASSUMPTION` comment in
  `conversation.md`). The originating question was never answered by a human. If 992
  is instead a real feature, this spec is wrong in its entirety and should be
  discarded, not amended.

## Requirements

- **REQ-1**: Drive the loop end to end — trigger a brainstorm, supply a scripted
  human answer, and confirm the run produces a populated `spec.md`, `plan.md`, and
  `test.md`, and lands the track in `lanes.plan.on_success` (`plan:success`).
- **REQ-2**: Fail when `conversation.md` gains agent-authored turns across a cycle
  without gaining a human turn — the self-pollution signature. Assert on the
  human:agent turn ratio and on file growth between cycles.
- **REQ-3**: Fail when the main and worktree copies of the track disagree after a
  cycle settles, on any of: `conversation.md` bytes, `index.md` marker set, or the
  existence of `test.md`.
- **REQ-4**: Terminate on its own. Bound the run by cycle count and wall-clock, and
  report a definite pass/fail rather than looping while a question sits unanswered.
- **REQ-5**: Reset cleanly to a known state between runs so consecutive canary runs
  do not inherit the previous run's conversation.

## Acceptance Criteria

Each criterion is something an operator can observe. None is satisfied by a stub.

- [ ] An operator runs one command and gets a pass/fail verdict for the loop without
      reading worker logs or inspecting track files by hand.
- [ ] With the loop healthy, the canary passes and the track reaches `plan:success`
      carrying a real `spec.md`, `plan.md`, and `test.md` (no `(Test cases to be
      added)` stub left behind).
- [ ] With self-pollution reintroduced, the canary **fails** and names
      `conversation.md` turn ratio as the cause.
- [ ] With the worktree copy deliberately skewed, the canary **fails** and names the
      specific diverging file.
- [ ] A scripted human answer placed in `conversation.md` is consumed — `.conv-cursor`
      advances past it and the next run acts on its content rather than re-asking.
- [ ] The canary always terminates and never leaves the track `Waiting for reply: yes`
      with no bounded exit.

## Out of Scope (deferred — must NOT be treated as satisfiable here)

- Fixing the two defects. This track detects them; the fixes are their own tracks.
- Canary coverage of `implement`, `review`, or `quality-gate`. Brainstorm → plan only.
