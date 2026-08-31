# Spec: E2E Test Suites Spawn a Real, Production-Scoped Sync Worker When Run From a Worktree

## Problem Statement

Running the `node:test` E2E suites from inside a linked git worktree causes each spawned
"test" worker to **chdir into the real primary checkout** and become a full production
worker — reading the real `.laneconductor.json`, the real `conductor/tracks/`, the real
`workflow.json`, syncing to the real Collector on `localhost:8091`, claiming real queued
tracks, and spawning real `claude` agent processes.

Live incident 2026-08-30: 26 such processes accumulated over ~28 minutes, driving load
average to 17–20 on a 16-core machine and memory to 39/46GB. Recovery required killing all
26 (SIGTERM, then SIGKILL for the non-responsive ones).

## Root Cause — Confirmed

Two independent facts combine into the leak.

**1. The sandbox is a plain, non-git directory *inside* the checkout.** Every worker-spawning
suite uses the same shape:

```js
const ROOT = join(__dirname, '../..');           // wherever the test FILE physically sits
const TMP  = join(ROOT, '.test-tmp-<suite>');    // sandbox, inside ROOT, not a git repo
spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], { cwd: TMP, ... });
```

**2. Track 10019's cwd normalization (`REQ-1`) then redirects that sandbox to production.**
At startup (`conductor/laneconductor.sync.mjs:158`) the worker runs
`resolvePrimaryCwdDecision({ cwd: process.cwd(), ... })`, which calls
`resolvePrimaryRepoRoot()` (`conductor/services/worktree-merge.mjs:54`):

```js
const gitDir       = git(['rev-parse', '--git-dir'], fromDir);
const gitCommonDir = git(['rev-parse', '--git-common-dir'], fromDir);
if (gitDir === gitCommonDir) return fromDir;   // already primary
return dirname(gitCommonDir);                  // → the PRIMARY checkout
```

For a sandbox inside a **linked worktree**, `--git-dir` is `<primary>/.git/worktrees/<name>`
while `--git-common-dir` is `<primary>/.git`. They differ, so the resolver returns the
**primary checkout**, `shouldChdir` is true, and the worker calls
`process.chdir('/home/meller/Code/laneconductor')` before reading any config.

Verified directly against this repo (resolver only, no worker spawned):

| Sandbox location | `resolvePrimaryRepoRoot()` returns | `shouldChdir` |
|---|---|---|
| `<primary>/.test-tmp-probe` | `<primary>/.test-tmp-probe` | **false** — isolation holds |
| `<worktree>/.test-tmp-probe` | `/home/meller/Code/laneconductor` | **true** — escapes to production |

This asymmetry is the entire bug: **the suites are isolated when run from the primary
checkout and silently non-isolated when run from a worktree.** Every lane action's own
verification step runs from a worktree, and track 10039's Phase 2 deliberately ran the full
suite twice for a before/after parity diff — matching the ~1-new-worker-per-1-2-minutes rate
and the 26-process total.

`cwd: TMP` and the mock-CLI env vars do not help: the chdir happens at startup, before
config is read, so the sandbox `.laneconductor.json` is never loaded at all.

**Blast radius**: 51 of the test files spawn a real worker this way. 47 of them do not set
`LC_SKIP_CWD_NORMALIZATION`. The `.worktrees/` list on this machine still contains 5 of the
6 worktrees named as leak sources in the incident report.

### Why the existing guards did not stop it

- **In-process worker lock** (`sync.mjs:198`, `acquireWorkerLock`) is the guard that *should*
  have caught this — a worktree-spawned worker resolves the *same* lock path as the real
  worker and would refuse to start. It was defeated because **11 spawn sites across 8 suites
  explicitly set `LC_SKIP_WORKER_LOCK=1`** (local-api-e2e, 1091-create-project,
  1091-manager ×2, 1111-model-precedence, 1119-phase3-track-generation,
  1119-phase6-e2e-autorun ×2, 1119-wizard-dispatch, AM-1121-marketing ×2). Each of those is
  a lock-bypassing process that lands in production.
- **`--manager` workers use a different lock** (`~/.laneconductor/manager.lock-target`), so
  manager-spawning suites never collide with the project worker's lock at all.
- **`.sync.pid` is irrelevant here.** Test-spawned workers never write a pidfile, so the
  pidfile guard is not in the path.

### Correction to the filed hypothesis

`index.md` proposed that `lc worker start`'s single-instance check fails to detect a dead PID
in `.sync.pid`. **That is not the case — it already works.** `getRunningWorkerPid()`
(`bin/lc.mjs:193`) reads the pidfile, validates via `isLiveLaneConductorPid()` (liveness
*plus* a `/proc/<pid>/cmdline` cross-check against PID reuse), and on a dead PID **unlinks the
stale pidfile and returns null** so startup proceeds cleanly. No work is needed there. The
duplicates did not arrive through `lc worker start` at all; they were spawned directly by
tests, bypassing the pidfile entirely.

### SIGTERM non-responsiveness — real, but bounded

`sync.mjs:7694`:
```js
process.on('SIGTERM', async () => { await removeWorker(); process.exit(0); });
```
`removeWorker()` loops over collectors awaiting `del(...)`, which carries a **10 000 ms**
per-collector timeout (`sync.mjs:686`). So shutdown is not an infinite hang, but it is
`N × 10s` with **no aggregate deadline and no watchdog exit** — enough that an operator sending
SIGTERM reasonably concludes it was ignored and escalates to SIGKILL. A leaked worker whose
collector is unreachable is exactly the worst case.

## Requirements

- **REQ-1** — A spawned test worker MUST resolve to its own sandbox as serving root,
  independent of which directory the test file physically sits in (primary checkout, linked
  worktree, or a copy elsewhere). Fixed structurally, not by asking each suite to remember an
  opt-out env var.
- **REQ-2** — Production cwd-normalization semantics (track 10019 REQ-1) MUST be preserved
  unchanged. The fix must not weaken the guarantee that a real worker launched from a worktree
  still corrects itself to the primary checkout.
- **REQ-3** — A hard safety net, independent of REQ-1, MUST turn any future isolation escape
  into a loud, immediate test failure rather than a silent production write. Opt-in via env
  var so it is a no-op for real deployments.
- **REQ-4** — A test worker MUST NOT be able to reach the real Collector (`localhost:8091`)
  even if config resolution goes wrong.
- **REQ-5** — Every worker spawn in the test suite MUST go through one shared helper, so this
  class of bug has exactly one place to be fixed and cannot be reintroduced by copy-paste.
- **REQ-6** — Test worker teardown MUST use a bounded `SIGTERM → SIGKILL` escalation, so a
  slow or hung shutdown can never leave a live process behind, including on test failure.
- **REQ-7** — The worker's own SIGTERM/SIGINT shutdown MUST complete within a bounded overall
  deadline, with a watchdog that force-exits if de-registration does not settle.
- **REQ-8** — A regression test MUST reproduce the original incident directly: run a worker
  spawn from inside a real linked worktree and assert isolation held.
- **REQ-9** — A guard MUST prevent new `spawn(... join(ROOT, 'conductor/laneconductor.sync.mjs'))`
  call sites from being added outside the shared helper.
- **REQ-10** — Test sandboxes MUST NOT be created inside the repository working tree. Besides
  being the mechanism of this bug, `.test-tmp-*` directories inside the checkout dirty it, and
  a dirty checkout blocks `**Workspace**: main` lane actions — this track's own plan run was
  blocked twice for exactly that reason.

## Solution

Move test sandboxes **outside** the repository (`os.tmpdir()`), and `git init` each one. This
addresses the root cause on two independent axes:

- Outside any git repo → `resolvePrimaryRepoRoot()` throws → `resolvePrimaryCwdDecision`
  catches and returns `shouldChdir: false` (REQ-1a's existing degrade-safely path). No chdir.
- `git init`'d → even if the temp dir were somehow inside a repo, `--git-dir` equals
  `--git-common-dir`, so the resolver returns the sandbox itself. No chdir.

Neither axis touches production code paths, satisfying REQ-2.

On top of that, an opt-in assertion inside the worker (`LC_ASSERT_SERVING_ROOT`) makes any
residual escape fail loudly and instantly (REQ-3), and a refusing collector port closes REQ-4.

## Acceptance Criteria

- [ ] AC-1: Running the E2E suites from inside a real linked worktree spawns workers whose
      serving root is their own sandbox — asserted from the worker's own startup provenance
      line, not inferred.
- [ ] AC-2: During and after a full suite run started from a worktree, no `laneconductor.sync.mjs`
      process exists other than ones the test itself spawned and accounted for; the count
      returns to the pre-run baseline when the run finishes.
- [ ] AC-3: No test-spawned worker ever issues a request to the real Collector port (8091),
      confirmed by a listener that records and rejects any contact.
- [ ] AC-4: With `LC_ASSERT_SERVING_ROOT` set to a path the worker does not end up serving,
      the worker exits non-zero with a message naming both the expected and actual root, and
      performs no sync work.
- [ ] AC-5: With `LC_ASSERT_SERVING_ROOT` unset, worker behaviour is byte-identical to today
      (production is unaffected).
- [ ] AC-6: A worker launched for real from inside a worktree still corrects itself to the
      primary checkout — track 10019's REQ-1 behaviour is intact and covered by its existing test.
- [ ] AC-7: Killing a test worker whose collector is unreachable completes within the helper's
      escalation window, with the process confirmed dead (not merely signalled) before the
      test returns.
- [ ] AC-8: A worker sent SIGTERM with an unreachable collector exits within the bounded
      shutdown deadline instead of taking `N × 10s`.
- [ ] AC-9: All 51 worker-spawning test files route through the shared helper; a repo-wide
      grep for a direct `laneconductor.sync.mjs` spawn outside the helper returns nothing.
- [ ] AC-10: The guard from REQ-9 fails when a direct spawn is reintroduced (verified by
      adding one temporarily, observing the failure, and removing it).
- [ ] AC-11: `git status --porcelain` is clean after a full suite run — no `.test-tmp-*`
      directories are left in the working tree.
- [ ] AC-12: The full existing suite passes from the primary checkout with no behavioural
      regressions attributable to the migration.

## Out of Scope

- Track AM-10044's display-staleness symptom. Same incident window, but the root cause here is
  fully explained without it; they are separate defects.
- Containerising/namespacing the spawned worker. Considered as an alternative isolation
  mechanism; unnecessary once the sandbox is outside the repo and the assertion guard exists,
  and it would add a hard dependency to a suite that is currently zero-dep.
- Removing `LC_SKIP_GIT_LOCK` / `LC_SKIP_WORKER_LOCK` opt-outs. Once sandboxes are genuinely
  isolated these become mostly unnecessary, but auditing all 11 sites is its own effort and
  is not required to close this bug.
- The `_duplicate-10045-*` and `_duplicate-10040-*` quarantine folders present in the working
  tree. Unrelated to this defect (track 10040's duplicate-dir scan owns that behaviour).
