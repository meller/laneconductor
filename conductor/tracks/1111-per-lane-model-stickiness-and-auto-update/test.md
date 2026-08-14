# Tests: Track 1111 — Per-lane model stickiness, correct reset, and auto-update

## Test Commands
```bash
# This track's own tests (Phase 3)
node --test conductor/tests/track-1111-model-precedence.test.mjs

# Regression surface — anything touching buildCliArgs / lane dispatch / chat dispatch
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs
node --test conductor/tests/track-1087-worker-chat-dispatch.test.mjs
node --test conductor/tests/track-1086-session-worker.test.mjs
```

## Test Cases

### Phase 1: Per-lane model, live validation
- [ ] TC-1: With `primary_model` set on all 5 lanes of this project's
      `workflow.json`, a real dispatch to each lane shows that lane's
      configured model in the actual `--model` flag / transcript — not
      inferred, observed
- [ ] TC-2: Across all 4 automated lanes, `chosenCli`/the provider stays
      identical — no provider switch mid-track (REQ-3)
- [ ] TC-2b: The Phase 1 Task 5 guard actually fires — a `workflow.json`
      lane config containing `primary_cli` produces a warning/rejection
      (not silent acceptance), proving REQ-3 is enforced somewhere beyond
      "nobody happened to write it," since `buildCliArgs` would otherwise
      honor `laneConfig.primary_cli` if present

### Phase 2: Chat dispatch model resolution
- [ ] TC-3: A `track_chat` dispatch against a track currently in a lane
      with a configured `primary_model` uses that model (once Phase 2's
      decision is implemented)
- [ ] TC-4: A `worker_adhoc_chat` dispatch (no track) uses the project
      default regardless of any lane configuration — unaffected by this
      track's changes, confirmed by test not just left alone by omission

### Phase 3: Precedence — manual override vs. lane model
- [ ] TC-5: Lane HAS a configured `primary_model` + a manual per-worker
      override is active (via 1096's `set_model`) → the lane's model
      wins for an automated dispatch (REQ-2)
- [ ] TC-6: Lane has NO configured `primary_model` + a manual override is
      active → the manual override is used (correct fallback, not a
      silent no-op)

### Phase 4: Cross-project audit
- [ ] TC-7: Every actively-used project's `workflow.json` (per Phase 4's
      enumeration) has `primary_model` set on every lane it automates,
      OR is recorded as an intentional skip with a stated reason

### Phase 5: Staleness detection
- [ ] TC-8: A `workflow.json` entry naming a model absent from that
      worker's current `available_models` for the same provider produces
      the decided notification (log line / UI badge) — verified by
      triggering the condition, not by reading the comparison code

### Phase 6 (conditional): Auto-update
- [ ] TC-9: A project that has NOT opted in is never auto-updated, even
      when a staleness condition is detected (default-off verified)
- [ ] TC-10: A project that HAS opted in gets a same-tier version bump
      only — cross-tier substitution (opus↔sonnet) never happens, and the
      change is present in `workflow.json`'s git history

## Acceptance Criteria
- [ ] All test cases above pass
- [ ] No regressions in `local-fs-e2e.test.mjs`, `local-api-e2e.test.mjs`,
      `track-1087-worker-chat-dispatch.test.mjs`,
      `track-1086-session-worker.test.mjs`
- [ ] Every REQ in spec.md has a corresponding verified test case or
      manual observation recorded in this track's conversation
