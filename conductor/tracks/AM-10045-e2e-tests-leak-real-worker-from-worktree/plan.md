# Track AM-10045: E2E Tests Leak a Real Worker When Run From a Worktree

Root cause is confirmed and empirically verified (see `spec.md`). The work below is the fix,
sequenced so the safety net lands *before* the mechanical sweep — that way the sweep has an
automated way to prove each migrated file is actually isolated, rather than being 51 files of
hope.

**Run order note**: Phases 1–5 all run in the primary checkout (`**Workspace**: main`). This is
deliberate and stated in `conversation.md` — the bug is specifically about worktree execution,
so fixing it from inside a worktree would risk reproducing the exact failure mode against a
live system.

---

## Phase 1: Lock in the reproduction as a failing test

**Problem**: The mechanism is understood but only proven by a resolver probe. Before changing
anything, the *observable leak* needs to be a test that fails today, so the fix has something
to turn green (TDD, per `conductor/workflow.md`).

**Solution**: A test that creates a real throwaway linked worktree, spawns one worker the way
the suites do today, and asserts the worker's serving root is the sandbox. It must fail now.

- [x] Task 1.1: Add `conductor/tests/track-10045-worktree-isolation.test.mjs`
    - [x] Create a real throwaway worktree via `git worktree add` — **design refinement made
          during implementation**: the worktree is added to a disposable *fake primary* repo
          (`mkdtemp` + `git init`, its own commit), never a worktree of the real laneconductor
          checkout. `resolvePrimaryRepoRoot()` resolves purely from git plumbing relative to a
          given directory, so this reproduces the exact mechanism without ever touching the
          real repo.
    - [x] Create the today-shaped sandbox (`<worktree>/.test-tmp-*`, plain dir, not a repo)
    - [x] Spawn the worker with `LC_SKIP_WORKER_LOCK=1` — **design refinement**: instead of a
          "refusing collector port" (REQ-4's literal wording), both the fake primary and fake
          worktree carry a `mode: local-fs, collectors: []` config, so even a full chdir-escape
          into the fake primary and a real config read lands somewhere with zero network
          surface at all, not merely a port that refuses. Strictly stronger than what REQ-4
          asked for; satisfies it by construction rather than by a refusing listener.
    - [x] Parse the worker's own startup provenance line (`[LaneConductor] Serving from …`,
          `sync.mjs:175-186`) — asserts it names the sandbox
    - [x] Bounded SIGTERM→SIGKILL teardown (confirms death via `kill(pid, 0)` polling, not just
          that a signal was sent), plus `git worktree remove --force` + directory cleanup
- [x] Task 1.2: Ran it — **confirmed failing**, exactly as expected. See Phase 1 findings below.
- [x] Task 1.3: Added as TC-2 in the same file — primary-checkout path passes today, pinning
      the asymmetry from `spec.md`.

**Impact**: The leak is now a red test (`TC-1`). Nothing in production changed — verified via
`git status --porcelain`: the only new file is the test itself, and no leftover temp
directories or worker processes survived the run (checked via `ls /tmp` and `ps aux`).

### Phase 1 findings (2026-08-31)

Ran `node --test conductor/tests/track-10045-worktree-isolation.test.mjs`: **2 pass, 1 fail**,
exactly the expected TDD-red shape.

- **TC-3** (pure resolver, no spawn): PASS. Confirms `resolvePrimaryRepoRoot()` behaves
  identically against the throwaway fake-primary/worktree pair as it does against the real repo
  (already verified during planning) — a worktree sandbox resolves to the fake primary, a
  primary sandbox resolves to itself.
- **TC-2** (spawn from fake-primary sandbox): PASS. Serving root == the sandbox. Isolation
  holds when launched from the primary, matching today's real-repo behavior.
- **TC-1** (spawn from fake-worktree sandbox): **FAIL, as required**. Actual output:
  ```
  actual:   '/tmp/lc10045-fakeprimary-XlldGW'
  expected: '/tmp/lc10045-fakewt-XUHUHB/.test-tmp-tc1'
  ```
  The worker launched from the worktree sandbox reported the **fake primary** as its serving
  root — it chdir'd there before reading any config, reproducing spec.md's root cause exactly,
  end to end, in an isolated throwaway environment. This is the leak, caught live rather than
  reasoned about.

---

## Phase 2: Safety net — `LC_ASSERT_SERVING_ROOT` (REQ-3, REQ-4)

**Problem**: REQ-1's fix addresses the one escape mechanism we found. A second, different
escape would again be silent. The incident's real cost was not the bug — it was that the bug
was invisible until the machine was at load 20.

**Solution**: An opt-in startup assertion in the worker. No-op when the env var is unset, so
production is untouched (AC-5).

- [x] Task 2.1: Added immediately after the provenance block (`sync.mjs`, post-chdir): if
      `LC_ASSERT_SERVING_ROOT` is set and `checkServingRoot()` reports a mismatch, prints an
      error naming expected + actual and `process.exit(9)` — before the worker lock, chokidar,
      or any collector call.
    - [x] Distinctive exit code 9, asserted directly in TC-5.
- [x] Task 2.2: `conductor/services/assert-serving-root.mjs`'s `checkServingRoot()` — pure,
      `realpath`-normalized, unit-tested (TC-7: exact match, trailing slash, symlink, mismatch)
      without spawning anything.
- [x] Task 2.3: TC-6 confirms AC-5 directly — var unset, no assertion-related output at all.

**Impact**: Any future isolation escape, by any mechanism, fails instantly and legibly.

### Phase 2 findings (2026-08-31)

Ran `node --test conductor/tests/track-10045-assert-serving-root.test.mjs`: **7/7 pass.**

- TC-7 (4 pure unit cases) — pass, no process spawned.
- TC-6 (unset) — pass, zero assertion-related output (AC-5).
- TC-4 (set, matches) — pass, worker starts normally.
- TC-5 (set, mismatches) — pass, **exit 9 in ~100ms**, well before worker-lock/chokidar/collector
  setup — confirmed by the absence of any `watching` log line in captured output.

**Caught and fixed a real leak in my own test harness during development**: an early version of
the `runToExit()` helper didn't kill the worker process on its internal timeout. Running TC-5
before the guard existed (deliberately, to confirm red-then-green) left one real
`laneconductor.sync.mjs` process running for ~80s before I noticed via `ps aux` and killed it —
exactly the failure mode this whole track exists to prevent, caught live in the track's own
test suite. Fixed by guaranteeing `killAndConfirmDead()` runs in a `finally` regardless of how
the wait resolves.

**Regression check**: re-ran `primary-root-normalization.test.mjs` (5/5 pass, unaffected) and
`local-fs-e2e.test.mjs` (5/7 pass, 2 pre-existing `poll timeout` failures). Verified the 2
failures are unrelated to this change by stashing `sync.mjs`'s diff and re-running against the
unmodified file — identical 2 failures reproduced on the baseline, confirming pre-existing
flakiness rather than a regression introduced here.

---

## Phase 3: Shared spawn helper — one place to get this right (REQ-1, REQ-5, REQ-6, REQ-10)

**Problem**: 51 files hand-roll the same spawn, each free to get isolation subtly wrong. The
existing `LC_SKIP_CWD_NORMALIZATION` opt-out is set by only 4 of them — an opt-out nobody
remembers is not a fix.

**Solution**: `conductor/tests/helpers/isolated-worker.mjs`, the single sanctioned way to get a
sandbox and a worker. Sandbox lives **outside** the repo and is its own git repo, closing the
root cause on two independent axes (see `spec.md` → Solution).

- [x] Task 3.1: `makeSandbox(name)` → `mkdtemp` under `os.tmpdir()`, then `git init`, returning
      the path. Never inside the repo working tree (REQ-10 — also stops `.test-tmp-*` dirtying
      the checkout and blocking main-mode lane actions)
- [x] Task 3.2: `startIsolatedWorker({ sandbox, args, env, collectorPort })`
    - [x] Resolve the worker script from an **explicit repo root**, not `__dirname` — takes it
          from `LC_TEST_REPO_ROOT` if set, else `git rev-parse --show-toplevel` (relative to the
          helper's own file location) normalised through `resolvePrimaryRepoRoot`, so the script
          path is deliberate rather than incidental to where the calling test file sits
    - [x] Always sets `LC_ASSERT_SERVING_ROOT` to the sandbox (Phase 2's net, on by default for
          every test worker)
    - [x] Points collectors at a **refusing** port by default (REQ-4, via an ephemeral server
          opened then immediately closed), overridable by passing `collectorPort` for suites
          that need a real mock-collector
    - [x] Captures stdout/stderr and exposes `waitForServingRoot()` so suites assert isolation
          rather than assuming it
- [x] Task 3.3: `stopWorker(worker, { termMs = 3000, killMs = 2000 })` — bounded SIGTERM →
      SIGKILL escalation that **confirms death** (`kill(pid, 0)` polling) before resolving
      (REQ-6, AC-7). See Phase 3 findings below for a real bug this caught in itself.
- [x] Task 3.4: `cleanupSandbox(sandbox)` — idempotent, safe to call twice
- [x] Task 3.5: Direct tests in `conductor/tests/track-10045-isolated-worker-helper.test.mjs`
      (TC-8–TC-12), including the escalation path against a deliberately SIGTERM-ignoring child

**Impact**: A single, tested, correct place to get an isolated sandbox + worker exists. Not yet
wired into any of the 51 existing suites — that migration is Phase 5's job, sequenced after this
helper (and Phase 4's shutdown bound) are proven correct on their own.

### Phase 3 findings (2026-08-31)

Ran `node --test conductor/tests/track-10045-isolated-worker-helper.test.mjs`: initially **6/7
pass, 1 fail** — TC-10 (SIGTERM-ignoring child) failed with "Missing expected exception: process
must actually be dead."

**Root cause, found and fixed**: `stopWorker()`'s SIGKILL branch fired the signal and returned
immediately, without confirming it took effect. SIGKILL is asynchronous too — the OS needs a
moment to actually reap the process — so a caller's very next liveness check (exactly what
TC-10's assertion does) could still observe the process as alive. Fixed by adding a second
bounded confirmation loop after SIGKILL, mirroring the one already used after SIGTERM.

**This same latent bug existed in Phase 1's and Phase 2's own `killAndConfirmDead()` helpers**
(copy-pasted before this shared helper existed) — neither had a test strict enough to catch it,
since neither did an immediate synchronous liveness check right after teardown. Backported the
same fix to both for correctness and consistency; re-ran both suites to confirm no regression
(Phase 1: 2/3 pass, TC-1 correctly still red — unrelated to this fix, still pending the Phase 5
migration; Phase 2: 7/7 pass).

Re-ran after the fix: **7/7 pass.** No leaked processes in any run (`ps aux` checked after each).

**Impact**: Isolation becomes a property of the helper, not of each author's diligence.

---

## Phase 4: Bounded worker shutdown (REQ-7, AC-8)

**Problem**: `sync.mjs:7694`'s SIGTERM handler awaits `removeWorker()`, which is `N` collectors
× a 10 000 ms `del()` timeout with no aggregate deadline and no watchdog. With an unreachable
collector this reads as "SIGTERM ignored" — which is what happened during the incident
recovery.

**Solution**: Give shutdown a hard ceiling and a force-exit watchdog.

- [x] Task 4.1: `removeWorker()` wrapped in `Promise.race([removeWorker(), sleep(SHUTDOWN_DEADLINE_MS)])`
      — `SHUTDOWN_DEADLINE_MS` defaults to 2000ms, overridable via `LC_SHUTDOWN_DEADLINE_MS`
- [x] Task 4.2: `unref()`'d watchdog `setTimeout` force-exits at the same deadline if shutdown
      hasn't otherwise completed — never keeps the process alive on its own
- [x] Task 4.3: SIGTERM and SIGINT both call the same `shutdown(signal)` function
- [x] Task 4.4: `track-10045-bounded-shutdown.test.mjs` TC-13 (hanging collector) + TC-14 (two
      hanging collectors, proving the bound is aggregate not per-collector) + TC-15 (reachable
      collector, no regression) + TC-16 (SIGINT parity)

**Impact**: A worker can always be stopped promptly, which is what made incident recovery
require SIGKILL.

### Phase 4 findings (2026-08-31)

Ran `node --test conductor/tests/track-10045-bounded-shutdown.test.mjs`: **4/4 pass.**

- TC-13 (hanging collector, `LC_SHUTDOWN_DEADLINE_MS=500`) — exits in ~450ms, well under
  `del()`'s 10s timeout.
- TC-14 (two hanging collectors) — exits in ~440ms too, not ~900ms or 2×500ms — confirms the
  deadline is a single aggregate ceiling, not applied per collector.
- TC-15 (a genuinely reachable collector) — de-registration is confirmed to actually still
  happen: the mock server's own request handler observed a real `DELETE` call before the
  process exited. This matters — a bounded deadline that accidentally skipped real
  de-registration entirely would also "pass" a naive version of this test; asserting the
  server-side observation rules that out.
- TC-16 (SIGINT) — identical bounded behavior to SIGTERM.

**Lost and recovered mid-phase**: the `sync.mjs` edit for this phase was made, left as an
uncommitted working-tree change while Phase 4's tests were being developed and debugged, and
was silently reverted by a concurrent `chore(track-10039): sync files before worktree` /
`Track 10045: success (exit: 0)` operation elsewhere in this actively-shared repo before it
could be committed — confirmed via `git log`/`git show HEAD:conductor/laneconductor.sync.mjs`
showing the old two-line handlers with no trace of `SHUTDOWN_DEADLINE_MS`. Reapplied verbatim
and committed immediately this time (no gap between editing and committing), per the lesson
already learned once this session with the doc-only edits: **uncommitted changes in this repo
are not safe from concurrent activity, however briefly they sit.**

Separately, developing this phase's own tests surfaced two unrelated real findings, both
already resolved: (1) the shared helper's default sandbox `mode` briefly caused
`removeWorker()`'s `getIsLocalFs()` short-circuit to make TC-13/14/16 pass trivially without
exercising any network code at all — caught via TC-15's explicit `deleteReceived` check failing,
fixed by confirming (and where needed, forcing) `mode: 'local-api'`; (2) `conductor/tests/helpers/isolated-worker.mjs` itself was being actively rewritten by a concurrent session with a
different (also reasonable) API shape mid-development — resolved by re-reading the live file
immediately before finalizing this phase's test file rather than trusting an earlier snapshot.

---

## Phase 5: Migrate all spawn sites + prevent regression (REQ-5, REQ-9, AC-9..AC-12)

**Problem**: The fix is worthless while 51 files still spawn their own way. This is the bulk of
the work and is mechanical — deliberately sequenced last, after Phases 2–3 give an automated
way to verify each migration.

**Solution**: Sweep every site onto the helper, then make the old shape impossible to add back.

- [ ] Task 5.1: Migrate the two suites named in the incident first — `local-fs-e2e.test.mjs`,
      `local-api-e2e.test.mjs` — and get them fully green before touching the rest
- [ ] Task 5.2: Migrate the 11 `LC_SKIP_WORKER_LOCK=1` spawn sites next (highest risk: these
      bypass the one guard that would otherwise have stopped the leak). Re-evaluate whether
      each still needs the opt-out once its sandbox is genuinely isolated; leave it in place
      where removal is not clearly safe, and note which
- [ ] Task 5.3: Migrate the remaining sites, running each file after conversion
- [ ] Task 5.4: Add a guard test asserting no `spawn`/`execFile` of `laneconductor.sync.mjs`
      exists under `conductor/tests/` outside the helper (source-scan, same pattern as the
      existing `track-10044-dispatch-cwd-resolution.test.mjs` source assertions)
- [ ] Task 5.5: Verify AC-10 by temporarily reintroducing a direct spawn, observing the guard
      fail, then removing it
- [ ] Task 5.6: Full-suite run **from a linked worktree** with a `ps`-based watcher recording
      the `laneconductor.sync.mjs` process count before / during / after (AC-2), plus a
      listener on 8091 that records any contact (AC-3)
- [ ] Task 5.7: Full-suite run from the primary checkout to confirm no regressions (AC-12), and
      `git status --porcelain` clean afterwards (AC-11)

**Impact**: The class of bug is closed, not just the two instances that were noticed.

---

## Notes / Findings

- **The `index.md` dead-PID hypothesis is wrong and no work is planned for it.**
  `getRunningWorkerPid()` (`bin/lc.mjs:193`) already detects a dead PID, cross-checks
  `/proc/<pid>/cmdline` against PID reuse, unlinks the stale pidfile, and proceeds. The
  duplicates never went through `lc worker start` — tests spawn the worker directly and write
  no pidfile at all, so the pidfile guard was never in the path. Recorded in `spec.md`.
- The guard that *should* have caught this is the in-process `acquireWorkerLock`
  (`sync.mjs:198`); it was defeated by 11 explicit `LC_SKIP_WORKER_LOCK=1` spawn sites, plus
  `--manager` workers using a separate lock file entirely. Phase 5 Task 5.2 targets these first.
- 5 of the 6 worktrees named as leak sources in the incident report still exist in
  `.worktrees/` on this machine.
