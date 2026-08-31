# Tests: Track AM-10045 — E2E Tests Leak a Real Worker From a Worktree

## Test Commands

```bash
# The track's own regression suite (Phase 1 + Phase 5)
node --test conductor/tests/track-10045-worktree-isolation.test.mjs

# The shared helper's own tests (Phase 3)
node --test conductor/tests/track-10045-isolated-worker-helper.test.mjs

# The two suites named in the incident (Phase 5 Task 5.1)
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs

# Full worker-spawning suite, from the PRIMARY checkout (AC-12)
node --test conductor/tests/*.test.mjs

# Full suite from a linked worktree — the incident reproduction (AC-2, AC-3)
#   run with the process watcher and the 8091 tripwire, see TC-13/TC-14
```

⚠️ **Never run the full suite from a worktree until Phase 5 is complete.** That is the exact
action that caused the incident. Phases 1–4 are verified from the primary checkout, plus the
single-worker worktree reproduction in TC-1 (which pins its collector to a refusing port so it
cannot reach production even while still broken).

## Test Cases

### Phase 1 — Reproduction (`track-10045-worktree-isolation.test.mjs`)

- [x] TC-1: Worker spawned with `cwd` = a plain `.test-tmp-*` dir inside a real linked worktree
      — expected **before fix**: provenance line reports the primary checkout, test FAILS.
      **After fix**: reports the sandbox. **Confirmed FAILING as of 2026-08-31** (implemented
      against a throwaway fake-primary/worktree pair, not the real repo — see plan.md Phase 1
      findings for the actual observed output).
- [x] TC-2: Same spawn with `cwd` = a plain `.test-tmp-*` dir inside the primary checkout —
      expected: provenance reports the sandbox, passing both before and after. Pins the
      asymmetry that makes this bug invisible from the primary checkout. **PASSING.**
- [x] TC-3: `resolvePrimaryRepoRoot()` unit case — sandbox inside a worktree resolves to the
      primary; sandbox inside the primary resolves to itself — expected: documents the exact
      resolver behaviour the bug depends on, without spawning anything. **PASSING.**

### Phase 2 — `LC_ASSERT_SERVING_ROOT` safety net

- [ ] TC-4: Worker started with `LC_ASSERT_SERVING_ROOT` = sandbox, and cwd genuinely the
      sandbox — expected: starts normally, no assertion output.
- [ ] TC-5: Worker started with `LC_ASSERT_SERVING_ROOT` = sandbox but cwd normalises elsewhere
      — expected: exits with code 9, stderr names both expected and actual root, and **no**
      collector request is made and no chokidar watcher is established (AC-4).
- [ ] TC-6: Worker started with `LC_ASSERT_SERVING_ROOT` unset — expected: identical behaviour
      to today; existing suites unaffected (AC-5).
- [ ] TC-7: Path-match helper unit cases — trailing slash, symlinked tmpdir (macOS
      `/var` → `/private/var`), relative vs absolute — expected: `realpath`-normalised compare,
      no false failures.

### Phase 3 — Shared helper (`track-10045-isolated-worker-helper.test.mjs`)

- [ ] TC-8: `makeSandbox()` — expected: path is outside the repo working tree, is a git repo
      (`--git-dir` === `--git-common-dir`), and `git status --porcelain` in the repo stays
      clean (AC-11).
- [ ] TC-9: `startIsolatedWorker()` called from a test file physically inside a worktree —
      expected: serving root is the sandbox (REQ-1), and the resolved script path came from the
      explicit repo root, not `__dirname`.
- [ ] TC-10: `stopWorker()` against a child that ignores SIGTERM — expected: escalates to
      SIGKILL within the window and resolves only once `kill(pid, 0)` confirms death, not merely
      once the signal was sent (AC-7).
- [ ] TC-11: `stopWorker()` against a well-behaved child — expected: exits on SIGTERM, never
      escalates.
- [ ] TC-12: `cleanupSandbox()` called twice — expected: idempotent, no throw.

### Phase 4 — Bounded worker shutdown

- [ ] TC-13: SIGTERM with a collector that **accepts the connection then never responds** —
      expected: process exits within the bounded deadline (~2s), well under the `N × 10s`
      `del()` timeout. This is the case a closed port does not exercise.
- [ ] TC-14: SIGTERM with two unreachable collectors configured — expected: total shutdown time
      still bounded by the aggregate deadline, not 2 × 10s (AC-8).
- [ ] TC-15: SIGTERM with a reachable collector — expected: de-registration still completes
      normally; no regression to the clean-shutdown path.
- [ ] TC-16: SIGINT — expected: identical bounded behaviour to SIGTERM.

### Phase 5 — Migration + regression guard

- [ ] TC-17: Source-scan guard — no `spawn`/`execFile` of `laneconductor.sync.mjs` under
      `conductor/tests/` outside `helpers/isolated-worker.mjs` — expected: zero matches (AC-9).
- [ ] TC-18: Guard negative case — temporarily reintroduce one direct spawn — expected: TC-17
      fails, naming the offending file; remove it and confirm green (AC-10).
- [ ] TC-19: Process-count watcher around a full suite run started **from a worktree** —
      expected: `laneconductor.sync.mjs` count returns to the pre-run baseline, and never
      exceeds baseline + the number of workers the running test itself spawned (AC-2).
- [ ] TC-20: Port-8091 tripwire — a listener bound to the real Collector port for the duration
      of the run, recording every connection — expected: zero contacts from any test worker
      (AC-3).
- [ ] TC-21: Full suite from the primary checkout — expected: all previously-passing tests
      still pass; any newly-failing test is triaged as a genuine regression, not accepted
      (AC-12).
- [ ] TC-22: Track 10019's own cwd-normalization tests
      (`primary-root-normalization.test.mjs`) — expected: still pass unchanged, proving
      production behaviour was preserved (AC-6, REQ-2).
- [ ] TC-23: `git status --porcelain` after a full suite run — expected: empty; no `.test-tmp-*`
      residue in the working tree (AC-11, REQ-10).

## Acceptance Criteria

- [ ] TC-1 fails before the fix and passes after — the leak is genuinely reproduced, not just
      reasoned about
- [ ] All 23 test cases pass
- [ ] AC-1 … AC-12 in `spec.md` each map to at least one passing test case above
- [ ] No regressions in track 10019 (cwd normalization) or track 1110 (worker lock) coverage
- [ ] Verified by *running* the commands and reading real output — per
      `conductor/quality-gate.md`, a written-but-unexecuted test is not verification
