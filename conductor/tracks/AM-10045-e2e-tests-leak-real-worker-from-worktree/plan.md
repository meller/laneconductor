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

- [ ] Task 1.1: Add `conductor/tests/track-10045-worktree-isolation.test.mjs`
    - [ ] Create a real throwaway worktree via `git worktree add --detach` into `os.tmpdir()`
    - [ ] Create the today-shaped sandbox (`<worktree>/.test-tmp-*`, plain dir, not a repo)
    - [ ] Spawn the worker with `LC_SKIP_WORKER_LOCK=1` and a **refusing** collector port, so
          the reproduction can never touch the real Collector even while it is still broken
    - [ ] Parse the worker's own startup provenance line (`[LaneConductor] Serving from …`,
          `sync.mjs:175-186`) — assert it names the sandbox
    - [ ] Bounded SIGTERM→SIGKILL teardown in `finally`, plus `git worktree remove --force`
- [ ] Task 1.2: Run it, confirm it **fails**, and record the actual observed provenance line
      (expected: `⚠️  Serving from /home/meller/Code/laneconductor — this is NOT the primary
      checkout`, i.e. the real primary) in this file under Phase 1 findings
- [ ] Task 1.3: Add a companion assertion that the *primary-checkout* path already passes
      today, pinning the asymmetry described in `spec.md`

**Impact**: The leak becomes a red test. Nothing in production changes.

---

## Phase 2: Safety net — `LC_ASSERT_SERVING_ROOT` (REQ-3, REQ-4)

**Problem**: REQ-1's fix addresses the one escape mechanism we found. A second, different
escape would again be silent. The incident's real cost was not the bug — it was that the bug
was invisible until the machine was at load 20.

**Solution**: An opt-in startup assertion in the worker. No-op when the env var is unset, so
production is untouched (AC-5).

- [ ] Task 2.1: In `conductor/laneconductor.sync.mjs`, immediately after the existing
      provenance block (~line 186, so it sees the post-chdir serving root):
    - [ ] If `process.env.LC_ASSERT_SERVING_ROOT` is set and does not match `process.cwd()`
          (both `realpath`-normalised), print a loud error naming **expected** and **actual**,
          and `process.exit(9)` before any sync work, chokidar watcher, or collector call
    - [ ] Use a distinctive exit code so a test can assert the reason, not just "non-zero"
- [ ] Task 2.2: Unit-test the comparison as a pure helper so the match logic (trailing slash,
      symlink, `realpath`) is covered without spawning a process
- [ ] Task 2.3: Confirm AC-5 — with the var unset, no new branch is taken

**Impact**: Any future isolation escape, by any mechanism, fails instantly and legibly.

---

## Phase 3: Shared spawn helper — one place to get this right (REQ-1, REQ-5, REQ-6, REQ-10)

**Problem**: 51 files hand-roll the same spawn, each free to get isolation subtly wrong. The
existing `LC_SKIP_CWD_NORMALIZATION` opt-out is set by only 4 of them — an opt-out nobody
remembers is not a fix.

**Solution**: `conductor/tests/helpers/isolated-worker.mjs`, the single sanctioned way to get a
sandbox and a worker. Sandbox lives **outside** the repo and is its own git repo, closing the
root cause on two independent axes (see `spec.md` → Solution).

- [ ] Task 3.1: `makeSandbox(name)` → `mkdtemp` under `os.tmpdir()`, then `git init`, returning
      the path. Never inside the repo working tree (REQ-10 — also stops `.test-tmp-*` dirtying
      the checkout and blocking main-mode lane actions)
- [ ] Task 3.2: `startIsolatedWorker({ sandbox, args, env })`
    - [ ] Resolve the worker script from an **explicit repo root**, not `__dirname` — take it
          from `LC_TEST_REPO_ROOT` if set, else `git rev-parse --show-toplevel` normalised
          through `resolvePrimaryRepoRoot`, so the script path is deliberate rather than
          incidental to where the test file sits
    - [ ] Always set `LC_ASSERT_SERVING_ROOT` to the sandbox (Phase 2's net, on by default for
          every test worker)
    - [ ] Point collectors at a **refusing** port by default (REQ-4), overridable by suites
          that pass a real mock-collector port
    - [ ] Capture stdout/stderr and expose a `waitForServingRoot()` so suites assert isolation
          rather than assuming it
- [ ] Task 3.3: `stopWorker(worker, { termMs = 3000 })` — bounded SIGTERM → SIGKILL escalation
      that **confirms death** (`kill(pid, 0)` polling) before resolving (REQ-6, AC-7)
- [ ] Task 3.4: `cleanupSandbox(sandbox)` — idempotent, safe to call twice
- [ ] Task 3.5: Direct tests for the helper itself, including the escalation path against a
      deliberately SIGTERM-ignoring child

**Impact**: Isolation becomes a property of the helper, not of each author's diligence.

---

## Phase 4: Bounded worker shutdown (REQ-7, AC-8)

**Problem**: `sync.mjs:7694`'s SIGTERM handler awaits `removeWorker()`, which is `N` collectors
× a 10 000 ms `del()` timeout with no aggregate deadline and no watchdog. With an unreachable
collector this reads as "SIGTERM ignored" — which is what happened during the incident
recovery.

**Solution**: Give shutdown a hard ceiling and a force-exit watchdog.

- [ ] Task 4.1: Wrap de-registration in an overall deadline (~2s) via `Promise.race`, so total
      shutdown time is bounded regardless of collector count
- [ ] Task 4.2: Arm an `unref()`'d watchdog timer that force-exits if the handler has not
      exited by the deadline — exit must not depend on the network settling
- [ ] Task 4.3: Apply identically to SIGTERM and SIGINT (both currently share the shape)
- [ ] Task 4.4: Test with a collector that accepts the connection then never responds, and
      assert exit within the deadline (this is the case a closed port does *not* exercise)

**Impact**: A worker can always be stopped promptly, which is what made incident recovery
require SIGKILL.

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
