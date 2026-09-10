# Track AM-10087: Blocked-turn park override discards a lane action's own already-resolved verdict

## Phase 1: `**Verdict**` marker — schema + parsing helper

**Problem**: Nothing today distinguishes a lane action's own semantic PASS/FAIL verdict from the
CLI process's exit code (`isSuccess`). Need a small, pure, testable building block before wiring
it into the exit handler.
**Solution**: New `conductor/services/verdict.mjs`, mirroring the existing
`conductor/services/waiting-state.mjs` shape.

- [ ] Add `parseVerdict(content)` — case-insensitive `**Verdict**:\s*(pass|fail)` regex match;
      returns `'pass' | 'fail' | null`. Empty/unrecognized/absent value is `null`, never guessed
      (mirror `parseWaitingReason`'s "empty marker is null, not empty string" behavior).
- [ ] Add `writeVerdict(content, verdict)` / `clearVerdict(content)` — same in-place-update /
      append / remove shape as `writeWaitingReason` / `clearWaitingReason`, used by the skill
      claim step (Phase 2) to clear a stale marker, and available for any future writer.

**Impact**: No behavior change yet — pure helper, unused by the running worker until Phase 3.

## Phase 2: Skill instructions — review/quality-gate write `**Verdict**` on every terminal outcome

**Problem**: The verdict needs to reach `index.md` deterministically, written by the same skill
steps that already compute PASS/FAIL and already write the Lane/Lane Status transition.
**Solution**: Update `.claude/skills/laneconductor/SKILL.md` (this project's canonical copy at
`~/Code/laneconductor/.claude/skills/laneconductor/SKILL.md`, propagated via symlink).

- [ ] `/laneconductor review` step 3/4: write `**Verdict**: pass` or `**Verdict**: fail` to
      `index.md` in the same edit as the existing PASS→`on_success` / FAIL→`on_failure` Lane
      write (step 4).
- [ ] `/laneconductor quality-gate` step 5: same, at the same point the PASS/FAIL Lane transition
      is written (excluding the KPI-miss early-exit path in step 1, which is a different terminal
      outcome with no code-review verdict to report — leave `**Verdict**` unwritten there).
- [ ] `/laneconductor review` step 0 and `/laneconductor quality-gate` step 0 (claim): clear any
      pre-existing `**Verdict**` marker via `clearVerdict` when claiming, so a run that gets
      short-circuited before reaching its own transition step never leaves a stale value for a
      later run's exit handler to misread.
- [ ] Add `**Verdict**` to the "Filesystem-as-API Interface" marker table in SKILL.md, describing
      it exactly as in spec.md's Data Model Changes section.

**Impact**: `index.md` on review/quality-gate tracks now carries an explicit, durable
PASS/FAIL value, still with no change to worker behavior — Phase 3 is what makes the worker
consult it.

## Phase 3: Sync worker — don't park over an already-resolved, mechanically-routable verdict

**Problem**: The `isBlockedTurn` park override at `conductor/laneconductor.sync.mjs` (~line 6494)
unconditionally parks on any harness-level `blocked` annotation, discarding whatever the action
itself already resolved.
**Solution**: Read the new marker where `agentWaitingReason` is already read, and give the park
override an escape hatch when a resolved, routable verdict exists.

- [ ] In the existing `isSuccess`-guarded worktree-`index.md` read block (lines 6261-6270 today),
      also compute `agentVerdict = parseVerdict(rawIndexContent)` alongside `agentWaitingReason`.
- [ ] Before the `isBlockedTurn` park override (~line 6494): if `!endedMidWork && !abortedByUser
      && isBlockedTurn && agentVerdict` is `'pass'` or `'fail'`, look up
      `currentLaneConfig.on_success` (for `pass`) or `currentLaneConfig.on_failure` (for `fail`).
      If that resolves to a real transition value, run it through the same `resolveTransition`
      call already used for a normal outcome, set `targetLane`/`nextActionStatus` from that
      result, and skip the `isParked` assignment entirely for this run (no `**Waiting Reason**`
      written; any pre-existing one is cleared the same way any non-parked outcome already
      clears it).
- [ ] If `agentVerdict` is present but the selected direction has no real
      `on_success`/`on_failure` target in `workflow.json` for this lane: fall back to today's
      park behavior unchanged — never guess a transition.
- [ ] If `isBlockedTurn` is true and `agentVerdict` is absent/null: unchanged — still parks with
      a `**Waiting Reason**` exactly as today (preserves genuine open questions).
- [ ] When the override-of-the-override fires, append a `conversation.md` comment (see
      spec.md REQ-7) documenting it, e.g.: `> **system**: ℹ️ Turn ended with a 'blocked'
      self-assessment, but the action already resolved **Verdict**: fail — routing to
      implement:queue per workflow.json instead of parking.` Also log it at the same point the
      existing `isBlockedTurn` detection logs today.

**Impact**: A review/quality-gate action whose own verdict is already resolved and routable can
no longer get silently stuck behind an unrelated harness self-assessment. Genuinely open
questions (no verdict marker) are unaffected.

## Phase 4: Tests

**Problem**: Both the new pure helper and the exit-handler wiring need coverage, plus a
regression guard proving the AM-1018 shape is actually fixed and the existing park behavior for
genuine open questions is untouched.
**Solution**: Follow the existing two-tier pattern seen in `track-10055-waiting-any-lane.test.mjs`
(pure unit tests) + a real-worker spawn test (`track-10055-waiting-resume.test.mjs`'s pattern).

- [ ] `conductor/tests/track-10087-verdict-marker.test.mjs` (`node:test`, no spawn): unit tests
      for `parseVerdict`/`writeVerdict`/`clearVerdict` — pass, fail, absent, empty, malformed,
      case-insensitivity, in-place update vs. append vs. removal, doesn't disturb other markers.
- [ ] `conductor/tests/mock-cli.mjs`: add `MOCK_CLI_WRITE_VERDICT=<pass|fail>` (writes
      `**Verdict**` alongside the existing `MOCK_CLI_WRITE_LANE_STATUS`/
      `MOCK_CLI_WRITE_LANE_STATUS_ON` machinery already used to simulate an agent's own
      self-transition write).
- [ ] `conductor/tests/track-10087-blocked-verdict-override.test.mjs` (`node:test`, spawns a real
      worker, modeled on `track-10055-waiting-resume.test.mjs`):
      - TC-1: reproduces AM-1018 — `MOCK_CLI_EMIT_BLOCKED_SUMMARY` set AND
        `MOCK_CLI_WRITE_VERDICT=fail` + `MOCK_CLI_WRITE_LANE_STATUS=queue` (targeting
        `review.on_failure`'s lane) on a `review` dispatch. Assert the track lands at
        `implement:queue`, not `review:waiting`, and no `**Waiting Reason**` is present.
      - TC-2: `MOCK_CLI_EMIT_BLOCKED_SUMMARY` set, no `MOCK_CLI_WRITE_VERDICT` — asserts the
        track still parks at `<lane>:waiting` with a `**Waiting Reason**` (regression guard for
        genuine open questions).
      - TC-3: `MOCK_CLI_EMIT_BLOCKED_SUMMARY` + `MOCK_CLI_WRITE_VERDICT=pass` where the lane's
        `on_success` isn't defined in the test's `workflow.json` fixture — asserts fallback to
        parking, not a guessed transition.
- [ ] Run `track-10055-waiting-any-lane.test.mjs` and any other existing blocked-turn/park tests
      to confirm no regression.

## Test Commands

```bash
node --test conductor/tests/track-10087-verdict-marker.test.mjs
node --test conductor/tests/track-10087-blocked-verdict-override.test.mjs
node --test conductor/tests/track-10055-waiting-any-lane.test.mjs
```
