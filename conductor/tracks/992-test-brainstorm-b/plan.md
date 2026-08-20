# Track 992: Brainstorm → Plan Loop Canary

All phases are unstarted. Nothing here is implemented yet — this is the plan only.

## Phase 1: Harness scaffold and clean reset

**Problem**: Consecutive canary runs inherit the previous run's `conversation.md`,
so a run's result depends on what ran before it (REQ-5).
**Solution**: A `node:test` harness that resets track 992 to a known fixture state
before each run, following the project's rule that anything spawning real processes
or touching the filesystem uses `node:test`, not Vitest.

- [ ] Create `conductor/tests/brainstorm-loop-canary.test.mjs`
- [ ] Fixture: known-good `index.md`, `spec.md`, `plan.md`, and a `conversation.md`
      holding exactly one human turn
- [ ] Reset helper restores the fixture and clears `.conv-cursor`
- [ ] Assert the reset actually took effect before the run starts

**Impact**: Canary runs become independent of each other.

## Phase 2: Drive one full loop cycle (REQ-1)

**Problem**: Nothing exercises brainstorm → plan end to end.
**Solution**: Run the real loop against the fixture with a scripted human answer.

- [ ] Trigger a brainstorm cycle on track 992
- [ ] Assert a `> **system**: Brainstorm requested.` turn is appended and
      `**Waiting for reply**: yes` is set
- [ ] Append a scripted human answer to `conversation.md`
- [ ] Assert `.conv-cursor` advances past that answer and the next run acts on its
      content instead of re-asking the same question
- [ ] Assert the cycle ends at `lanes.plan.on_success` (`plan:success`) with
      `spec.md`, `plan.md`, and `test.md` all populated — `test.md` must not still
      read `(Test cases to be added)`

**Impact**: A real regression in the loop fails a test instead of stalling a track.

## Phase 3: Self-pollution detector (REQ-2)

**Problem**: Agent closing responses are appended back into `conversation.md` and
re-read as context, growing it without new information (968b → 8041b observed).

- [ ] Count `> **human**` vs `> **claude**`/`> **system**` turns per cycle
- [ ] Record `conversation.md` bytes before and after each cycle
- [ ] FAIL when agent turns grow while human turns do not
- [ ] Failure message names the turn ratio and the byte growth
- [ ] Negative test: reintroduce self-pollution and confirm the canary fails

**Impact**: The defect becomes a red test rather than a slow leak.

## Phase 4: Divergence detector (REQ-3)

**Problem**: Main and worktree copies drift, tripping the sync worker's
"suspiciously smaller" guard and emitting `⚠️ Docs may be stale`.

- [ ] After a cycle settles, compare main vs worktree for `conversation.md` bytes,
      `index.md` marker set, and `test.md` existence
- [ ] FAIL naming the specific diverging file and the direction of drift
- [ ] Assert no `⚠️ Docs may be stale` turn was emitted during the cycle
- [ ] Negative test: skew the worktree copy and confirm the canary fails

**Impact**: Drift is caught at its source instead of being hand-reconciled.

## Phase 5: Termination bound and verdict (REQ-4)

**Problem**: The loop can spin indefinitely while a question sits unanswered — four
invocations on this track did exactly that, each exiting 0.

- [ ] Bound the canary by max cycles and wall-clock
- [ ] FAIL on hitting either bound, reporting how many cycles ran with no human turn
- [ ] Emit a single pass/fail verdict line an operator can read without logs
- [ ] Assert the canary never exits 0 while the track sits `Waiting for reply: yes`
      with no bounded exit

**Impact**: A stuck loop reports failure instead of false success.

## Phase 6: Wire into the test suite

- [ ] Runnable via `node --test conductor/tests/brainstorm-loop-canary.test.mjs`
- [ ] Honors `LC_SKIP_GIT_LOCK=1` like the other worker E2E tests
- [ ] Documented in `conductor/tech-stack.md`'s Testing table

**Impact**: The canary runs where the other worker E2E tests already run.
