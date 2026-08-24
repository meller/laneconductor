# Tests: Track 992 — Brainstorm → Plan Loop Canary

## Test Commands

```bash
# Run this track's canary
LC_SKIP_GIT_LOCK=1 node --test conductor/tests/brainstorm-loop-canary.test.mjs

# Run alongside the other worker E2E suites
LC_SKIP_GIT_LOCK=1 node --test conductor/tests/
```

## Test Cases

### Phase 1: Harness scaffold and clean reset
- [ ] TC-1.1: Reset before a run — expected: `conversation.md` holds exactly one
      `> **human**` turn and zero agent turns
- [ ] TC-1.2: Reset clears `.conv-cursor` — expected: absent, or `0`
- [ ] TC-1.3: Two consecutive runs — expected: identical starting state; run 2 is
      unaffected by run 1's conversation

### Phase 2: Full loop cycle (REQ-1)
- [ ] TC-2.1: Brainstorm trigger — expected: a `> **system**: Brainstorm requested.`
      turn is appended
- [ ] TC-2.2: Waiting flag — expected: `**Waiting for reply**: yes` in `index.md`
- [ ] TC-2.3: Scripted human answer consumed — expected: `.conv-cursor` advances past
      the answer's byte offset
- [ ] TC-2.4: Answer acted upon — expected: next run does NOT re-ask the same
      question verbatim
- [ ] TC-2.5: Terminal lane — expected: `**Lane**: plan`, `**Lane Status**: success`
      (`lanes.plan.on_success`)
- [ ] TC-2.6: Artifacts populated — expected: `spec.md`, `plan.md`, `test.md` all
      non-stub; `test.md` does not contain `(Test cases to be added)`
- [ ] TC-2.7: Waiting flag cleared — expected: `**Waiting for reply**: no` at
      terminal state

### Phase 3: Self-pollution detector (REQ-2)
- [ ] TC-3.1: Healthy cycle — expected: PASS; agent turns grow only alongside a human
      turn
- [ ] TC-3.2: Polluted cycle (negative) — inject an agent closing response into
      `conversation.md` with no new human turn — expected: FAIL
- [ ] TC-3.3: Failure message — expected: names the human:agent ratio and byte growth
- [ ] TC-3.4: Regression guard on the observed signature — 1 human turn against 6
      agent turns, 968b → 8041b — expected: FAIL

### Phase 4: Divergence detector (REQ-3)
- [ ] TC-4.1: Settled cycle — expected: main and worktree agree on `conversation.md`
      bytes, `index.md` marker set, and `test.md` existence
- [ ] TC-4.2: Skewed `conversation.md` (negative) — expected: FAIL naming
      `conversation.md` and the drift direction
- [ ] TC-4.3: Skewed `index.md` markers (negative) — e.g. `**Last Run**` on one side
      only — expected: FAIL naming `index.md`
- [ ] TC-4.4: `test.md` on one side only (negative) — expected: FAIL naming `test.md`
- [ ] TC-4.5: No stale-docs warning — expected: no `⚠️ Docs may be stale` turn emitted
      during a healthy cycle

### Phase 5: Termination bound (REQ-4)
- [ ] TC-5.1: Healthy loop — expected: terminates within the cycle bound, verdict PASS
- [ ] TC-5.2: Unanswered question (negative) — withhold the scripted answer —
      expected: FAIL on the cycle bound, reporting cycles run with no human turn
- [ ] TC-5.3: No false success — expected: canary never exits 0 while the track sits
      `Waiting for reply: yes` with no bounded exit
- [ ] TC-5.4: Wall-clock bound — expected: FAIL, not hang
- [ ] TC-5.5: Verdict line — expected: one pass/fail line readable without logs

### Phase 6: Suite integration
- [ ] TC-6.1: Runs standalone via `node --test` — expected: exit 0 when healthy
- [ ] TC-6.2: `LC_SKIP_GIT_LOCK=1` honored — expected: no worktree/lock creation
- [ ] TC-6.3: No cross-test interference — expected: other suites unaffected

## Acceptance Criteria

- [ ] All test cases above pass
- [ ] Every negative case fails for its stated reason, not incidentally — each
      negative test asserts on the failure message, not merely on non-zero exit
- [ ] No regressions in `conductor/tests/local-fs-e2e.test.mjs` or
      `conductor/tests/local-api-e2e.test.mjs`
- [ ] The canary leaves track 992 in a clean, reset state on exit
