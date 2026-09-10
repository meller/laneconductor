# Spec: Blocked-turn park override discards a lane action's own already-resolved verdict

## Problem Statement

`conductor/laneconductor.sync.mjs`'s post-turn exit handler forces ANY turn whose LAST
`post_turn_summary` event has `status_category: 'blocked'` into `<lane>:waiting` (see the
`isBlockedTurn` override around line 6494), with no check for whether the lane action itself
already produced a definitive, mechanically-routable outcome per `workflow.json`'s own
`on_success`/`on_failure` table.

Confirmed live: `livingwork`'s AM-1018 `review` action delivered a complete FAIL verdict in its
closing response and — per the `/laneconductor review` skill's own step 4 — already wrote
`**Lane**: implement` / `**Lane Status**: queue` to `index.md` as its own last action (the
correct, workflow.json-sanctioned FAIL transition, `review.on_failure: implement:queue`). But
the same turn's Claude Code harness separately emitted a `post_turn_summary` with
`status_category: 'blocked'` (`needs_action: "decide: fix before merge or defer to Phase 7?"`) —
a question whose answer was already fixed by workflow policy (there is no "defer" transition;
FAIL always returns to `implement`). The `isBlockedTurn` override saw only the harness-level
annotation, ignored the review's own already-written transition, and forced the track back to
`review:waiting` with the lane left unchanged and — worse — no `**Waiting Reason**` written at
all (the code's own comments, Track 10055 REQ-3/REQ-14, call a reasonless park "the protocol
being ignored, not a normal outcome"; nothing currently catches or surfaces that). The track sat
stuck indefinitely despite `**Auto Run**: yes`, because a parked track is invisible to the
auto-launch queue scan. Manually corrected via `PATCH /api/projects/:id/tracks/:num
{lane_status:'implement'}`.

Root cause: `isSuccess` is just `code === 0` — the CLI process's exit status, unrelated to the
lane action's semantic verdict — so nothing in the exit handler can distinguish "genuinely
unresolved open question" (e.g. "should I apply this destructive migration?") from "harness
tagged this turn 'blocked' even though the action itself already resolved and routed its own
outcome."

## Decision: structured `**Verdict**` marker (not closing-text parsing)

Two designs were open for this track: parse the verdict out of the action's own closing
response text, or have the review/quality-gate skill instructions write a structured,
unambiguous marker the sync worker checks deterministically. **Chosen: the marker.** Parsing
closing text is wording-dependent and silently breaks the moment phrasing drifts; a marker
follows the same pattern already established and trusted elsewhere in this file for exactly this
purpose (`**Merge Mode**`, `**Waiting Reason**`, `**PR URL**` — see `conductor/workflow.md`'s
marker table) and is checked deterministically, the same way `agentReportedWaiting` already
trusts the agent's own last-written `**Lane Status**: waiting` as authoritative. It also gives
the verdict a durable, inspectable value beyond just this one routing decision (visible on the
card, greppable, usable by future tooling) rather than a value that only ever existed transiently
inside the override's own logic.

## Requirements

- REQ-1: A new `**Verdict**: pass|fail` marker, written by the `/laneconductor review` and
  `/laneconductor quality-gate` skill steps to `index.md` on every terminal PASS/FAIL outcome, in
  the same write as the existing Lane/Lane Status transition those steps already perform. Any
  pre-existing `**Verdict**` marker is cleared at claim time (step 0) so a short-circuited run
  never leaves a stale value behind for a later run's exit handler to misread.
- REQ-2: A pure, unit-tested `parseVerdict(content)` helper (new
  `conductor/services/verdict.mjs`, mirroring `waiting-state.mjs`'s `parseWaitingReason`) —
  case-insensitive, returns `'pass' | 'fail' | null`; an absent, empty, or unrecognized value is
  `null`, never guessed.
- REQ-3: The exit handler reads `agentVerdict` from the worktree's `index.md` in the same
  `isSuccess`-guarded block that already reads `agentWaitingReason` (lines 6261-6270).
- REQ-4: The `isBlockedTurn` park override (line 6494) must NOT fire when `agentVerdict` is
  present (`'pass'` or `'fail'`) AND `workflowConfig`'s current lane config defines a real target
  for the direction that verdict selects (`on_success` for `pass`, `on_failure` for `fail`). In
  that case, route to that target exactly as a normal (non-blocked) outcome would — via the same
  `resolveTransition` call already used elsewhere in this function — and do NOT enter the
  `isParked` branch (no `**Waiting Reason**` written; any pre-existing one is cleared, same as
  any other non-parked outcome).
- REQ-5: If `agentVerdict` is present but the corresponding `on_success`/`on_failure` isn't
  defined in `workflow.json` for the current lane (misconfigured project), fall back to today's
  park behavior — never guess a transition.
- REQ-6: A blocked turn with NO `**Verdict**` marker at all is unaffected — still parks at
  `<lane>:waiting` with a `**Waiting Reason**`, exactly as today. This preserves genuine open
  questions (e.g. "should I apply this destructive migration?" from `implement`).
- REQ-7: When REQ-4's override-of-the-override fires, append a comment to `conversation.md`
  making the suppressed park visible — this was explicitly not surfaced anywhere before (the
  track's own complaint), and a silent bypass of a park would be just as bad as a silent
  incorrect park.

## Acceptance Criteria

- [x] A review/quality-gate action that produces a complete PASS/FAIL verdict AND whose turn
      separately triggers the harness's `blocked` `post_turn_summary` annotation lands the track
      at the `workflow.json`-defined `on_success`/`on_failure` lane (e.g. `implement:queue` on a
      FAIL), not parked at `<lane>:waiting`. Reproduces the AM-1018 shape exactly.
- [x] A blocked turn with no `**Verdict**` marker still parks at `<lane>:waiting` with a
      `**Waiting Reason**` — unchanged from current behavior.
- [x] A `**Verdict**` marker whose selected direction has no `on_success`/`on_failure` lane
      defined in `workflow.json` falls back to parking — never guesses.
- [x] The override firing is visible: a comment documenting it is appended to
      `conversation.md`, not silent.
- [x] `parseVerdict` unit tests pass; the new spawn test reproducing AM-1018 passes; existing
      blocked-turn/park tests (`track-10055-waiting-any-lane.test.mjs` and any other tests that
      cover `isBlockedTurn`/park behavior) continue to pass unmodified.

## API Contracts / Data Model Changes

New `index.md` marker (documented in `conductor/workflow.md`'s Filesystem-as-API marker table
during implement):

| Marker | Written by | Read by | Purpose |
|--------|-----------|---------|---------|
| `**Verdict**: pass\|fail` | `/laneconductor review`, `/laneconductor quality-gate` (on every terminal outcome) | sync worker's exit handler (`isBlockedTurn` override) | Track 10087: the lane action's own semantic PASS/FAIL, independent of the CLI process's exit code — lets the exit handler distinguish "already resolved, mechanically routable" from "genuinely open question" when a turn also carries a harness-level `blocked` annotation. |
