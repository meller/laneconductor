# Tests: Track TU-10066 — local-api-e2e on_success/on_failure subtests time out

This track's deliverable *is* a test suite, so the test cases below are largely
assertions about the suite's own behaviour. Every one is a command that must be
run and whose real output must be read — not reasoned about.

## Test Commands

```bash
# The suite this track exists to fix
node --test conductor/tests/local-api-e2e.test.mjs

# A single subtest in isolation (proves order-independence)
node --test --test-name-pattern='on_success: implement' conductor/tests/local-api-e2e.test.mjs
node --test --test-name-pattern='on_failure: quality-gate' conductor/tests/local-api-e2e.test.mjs

# Regression check on the other suites that spawn the real worker
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/
```

## Test Cases

### Phase 1: sandbox isolation between subtests

- [ ] TC-1: Run the full file. `on_success: implement → review` passes —
      expected: PASS, and its duration drops from ~20.4s to roughly the ~5.6s it
      takes when run alone today.
- [ ] TC-2: Run `on_success` alone via `--test-name-pattern`, then run the full
      file. Expected: identical verdict both ways. A subtest whose result depends
      on what ran before it is still leaking state.
- [ ] TC-3: Add a temporary assertion (or a one-off diagnostic run) confirming
      the sandbox's `conductor/tracks/` holds exactly the tracks the current
      subtest created — expected: 1 entry for `on_success`, not 4. Remove the
      diagnostic before committing.
- [ ] TC-4: `parallelism: only 1 track per lane at a time` still passes —
      expected: PASS. It is the subtest whose leftovers caused the problem, so
      confirm resetting the directory did not break its own three-track setup.

### Phase 2: on_failure asserts quality-gate retry exhaustion

- [ ] TC-5: `on_failure: quality-gate exhausts retries` passes with the in-lane
      `on_failure` override — expected: PASS, with `lane_status` observed as
      `quality-gate`, not `review` or `implement`.
- [ ] TC-6: Assert the lane explicitly, then temporarily revert the fixture to
      `on_failure: 'review'` and re-run — expected: FAIL. This proves the new
      assertion actually discriminates, rather than passing for the old
      cascade-through-implement reason.
- [ ] TC-7: The subtest completes in roughly two lane actions' worth of time, not
      six — expected: duration well under 10s with Phase 3's interval override in
      effect.

### Phase 3: LC_AUTO_LAUNCH_INTERVAL_MS

- [ ] TC-8: With `LC_AUTO_LAUNCH_INTERVAL_MS` unset, start the worker and read
      its log timestamps — expected: consecutive auto-launch claims about 5s
      apart, unchanged from today.
- [ ] TC-9: With `LC_AUTO_LAUNCH_INTERVAL_MS=500`, same observation — expected:
      claims roughly 500ms apart, proving the override is read.
- [ ] TC-10: `node --test conductor/tests/local-fs-e2e.test.mjs` — expected: same
      verdict as before this track's changes. Capture the baseline before Phase 3
      so the comparison is real.
- [ ] TC-11: `node --test conductor/tests/` full sweep — expected: no suite that
      passed before now fails. A faster auto-launch loop changes timing for every
      worker-spawning suite, so this is the phase's real gate.
- [ ] TC-12: An invalid value (`LC_AUTO_LAUNCH_INTERVAL_MS=abc`) falls back to
      5000 rather than scheduling at `NaN` — expected: worker starts and claims
      normally. The `Number(...) || 5000` form gives this for free; confirm it
      rather than assuming.

### Phase 4: repeatability

- [ ] TC-13: Three consecutive full-file runs — expected: 6 passed, 0 failed,
      all three times.
- [ ] TC-14: All six subtests each run alone via `--test-name-pattern` —
      expected: each PASSes.
- [ ] TC-15: Record each subtest's duration against its poll deadline —
      expected: every subtest finishes in under half its deadline. Anything
      tighter gets its deadline raised as margin, and the reason noted in the
      file's header comment.

## Regression Guards

- [ ] TC-16: `git diff conductor/laneconductor.sync.mjs` contains only the
      `LC_AUTO_LAUNCH_INTERVAL_MS` change — expected: no edit to
      `resolveTransition()` or any on_success/on_failure dispatch code. Per REQ-5
      that logic is correct and must not be touched.
- [ ] TC-17: No subtest was fixed by raising its poll timeout alone — expected:
      any deadline that did change is accompanied by an isolation or interval fix
      and a comment saying so.

## Acceptance Criteria

- [ ] All 6 subtests in `conductor/tests/local-api-e2e.test.mjs` pass, three runs
      in a row
- [ ] Every subtest passes when run alone
- [ ] Full-file runtime is substantially below the current ~84s
- [ ] `conductor/tests/local-fs-e2e.test.mjs` and the wider suite show no new
      failures
- [ ] Worker claim cadence is unchanged when `LC_AUTO_LAUNCH_INTERVAL_MS` is unset
