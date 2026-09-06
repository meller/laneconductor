# Track TU-10066: local-api-e2e on_success/on_failure subtests time out

Root cause is established (see `spec.md`) — no further bisection is needed. The
intake's suggestion to add logging around the dispatch path and bisect git
history was carried out during planning and is now closed: both failures are
fixture defects, the worker's transition logic is correct, and the behaviour is
unchanged since the initial commit.

Phases are ordered so the cheapest, highest-confidence fix lands first and each
later phase is verified against a suite that is already greener than before.

## Phase 1: Give every subtest a clean tracks directory

**Problem**: The five `local-api` subtests share one sandbox, and
`setupProject()` resets only the mock collector's state — never the sandbox's
`conductor/tracks/` directory. Tracks 101/102/103 from the `parallelism` subtest
are still queued and still claimable when `on_success` starts, and at
`parallel_limit: 1` they consume the entire 20s deadline before track 201 is
reached.

**Solution**: Make `setupProject()` remove and recreate
`<sandbox>/conductor/tracks` so each subtest begins from an empty tracks
directory, matching the isolation the `remote-api` block already gets for free
by having its own sandbox.

- [x] Task 1.1: In `conductor/tests/local-api-e2e.test.mjs`, have `setupProject()`
      `rmSync(join(sandbox, 'conductor/tracks'), { recursive: true, force: true })`
      before the existing `mkdirSync`, and import `rmSync` alongside the existing
      `node:fs` imports.
- [x] Task 1.2: Add a comment at that call explaining why — the collector `_reset`
      alone is not isolation, because the worker claims from the filesystem, not
      from collector state.
- [x] Task 1.3: Confirm no subtest depends on a track surviving from an earlier
      subtest. Read all five `local-api` subtests and check each creates every
      track it asserts on. Confirmed: each subtest creates its own track numbers
      (101-103, 201, 301, 401, 601) and none reference another subtest's tracks.
- [x] Task 1.4: Run `node --test conductor/tests/local-api-e2e.test.mjs` and record
      the real output. `on_success` now passes (5.6s in-suite, down from 20.4s
      timeout). `parallelism` still passes. `on_failure` still fails at 20.4s
      exactly as expected — Phase 2 owns it.

**Impact**: `on_success` stops competing with three stale tracks. Every subtest
becomes order-independent, which is what makes the per-subtest acceptance
criterion in `spec.md` achievable.

## Phase 2: Make the on_failure subtest test what its name claims

**Problem**: The subtest asserts `lane_action_status === 'failure'` while its own
fixture sets `'quality-gate': { on_failure: 'review' }`. A transition that moves
lane always yields `queue`; `failure` is only produced by an in-lane transition.
The track reaches `failure` only after cascading into `implement`, six-plus lane
actions later — so the subtest is both slow and mis-named, and would keep passing
if quality-gate's retry handling broke entirely.

**Solution**: Point the subtest at the behaviour it names. Give it a
quality-gate `on_failure` that stays in lane, and assert the lane as well as the
status.

- [x] Task 2.1: In the `on_failure` subtest, override the fixture's
      `lanes['quality-gate'].on_failure` to `'quality-gate'` before creating track
      301, following the same in-subtest workflow override the `custom transition`
      subtest already uses.
- [x] Task 2.2: Assert both `final.lane_status === 'quality-gate'` and
      `final.lane_action_status === 'failure'`, so a regression that reroutes the
      track through other lanes fails rather than passing slowly.
- [x] Task 2.3: Update the subtest's name and the file's header comment block to
      describe the assertion accurately.
- [x] Task 2.4: Run the suite and record real output. Subtest now passes in
      11.2s (down from 20.4s timeout) — reaches `failure` in quality-gate after
      two lane actions instead of six. Also verified discrimination: reverting
      the override back to `on_failure: 'review'` makes the subtest fail again
      (poll timeout), proving the new assertion actually distinguishes the
      correct in-lane behaviour from the old cascade-through-implement path.

**Impact**: The subtest becomes a genuine regression test for quality-gate retry
exhaustion, and stops being deadline-marginal for a reason unrelated to what it
covers.

## Phase 3: Make the auto-launch interval overridable for tests

**Problem**: `conductor/laneconductor.sync.mjs:8938` hardcodes the auto-launch
loop at `5000`ms. Every lane action therefore costs a 5s tick, which is why
multi-step assertions in this suite land within a second of their deadlines. Every
other timing loop in the file already takes a test-only env override.

**Solution**: Add `LC_AUTO_LAUNCH_INTERVAL_MS` on the exact convention the
neighbouring loops use, defaulting to `5000`, and have the isolated-worker test
helper set a fast value.

- [ ] Task 3.1: Change the auto-launch `setInterval` delay to
      `Number(process.env.LC_AUTO_LAUNCH_INTERVAL_MS) || 5000`, with a comment
      matching the style of the `LC_RECONCILE_INTERVAL_MS` and
      `LC_DOC_SYNC_INTERVAL_MS` sites.
- [ ] Task 3.2: In `conductor/tests/helpers/isolated-worker.mjs`, default
      `LC_AUTO_LAUNCH_INTERVAL_MS` to a fast value (500ms) in
      `startIsolatedWorker`'s env defaults, placed so a caller's own `env` still
      wins — the helper already documents that precedence.
- [ ] Task 3.3: Verify production default is untouched: start the worker with the
      variable unset and confirm from its log timestamps that it still claims on a
      5s cadence.
- [ ] Task 3.4: Run every suite that routes through `startIsolatedWorker` —
      `local-api-e2e`, `local-fs-e2e`, and the other worker-spawning suites — and
      record real pass/fail output for each. A faster loop changes timing for all
      of them, so this is the phase most likely to surface an unrelated latent
      race.

**Impact**: Removes the amplifier behind every marginal timeout in this suite and
cuts the file's ~84s runtime substantially. Production behaviour is unchanged
when the variable is unset.

## Phase 4: Verify and harden

**Problem**: A suite that passes once may still be deadline-marginal. The whole
point of this track is that these subtests were passing-by-luck away from
failing-by-default.

**Solution**: Prove repeatability and order-independence, then leave margin.

- [ ] Task 4.1: Run the full file three consecutive times; record all three
      results and the durations.
- [ ] Task 4.2: Run each of the six subtests alone via `--test-name-pattern`;
      record each result. Every one must pass in isolation.
- [ ] Task 4.3: Record the per-subtest durations and confirm each finishes with
      substantial headroom under its poll deadline. If any subtest is still within
      about half its deadline, raise that deadline as margin — never as the fix.
- [ ] Task 4.4: Update `conductor/tests/local-api-e2e.test.mjs`'s header comment
      to record why the sandbox is reset per subtest and why the auto-launch
      override exists, so the next person does not reintroduce the shared-state
      shape.

**Impact**: The suite becomes a reliable signal instead of two permanently red
subtests that everyone learns to ignore.
