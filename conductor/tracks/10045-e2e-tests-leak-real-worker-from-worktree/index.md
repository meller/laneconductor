# Track AM-10045: E2E Test Suites Spawn a Real Worktree-Scoped Sync Worker Instead of an Isolated One

**Lane**: implement
**Lane Status**: running
**Progress**: 0%
**Waiting for reply**: yes
**Last Run**: claude/claude-opus-5 (primary)
**Phase**: Planned — Phase 1 still blocked on dirty checkout (3rd check, same open decision)
**Type**: dev
**Track Kind**: bug
**Workspace**: main
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Root cause confirmed: test sandboxes are plain non-git dirs inside the checkout, so from a worktree the worker's cwd normalization resolves them to the PRIMARY checkout and chdirs there before…

## Problem

Killed 26 processes to recover the machine. All were recent (5-28 min old), all
`laneconductor.sync.mjs` — 18+ duplicate `--sync-only`/`--manager` copies running from the
**primary checkout** (the pidfile-tracked canonical PID was already dead, so nothing enforced
"at most one"), plus 6 running from inside specific track worktrees
(`.worktrees/10026`, `.worktrees/10038`, `.worktrees/10040`, `.worktrees/1100`,
`.worktrees/1114`, `.worktrees/9998`) with no `--sync-only`/mock markers — indistinguishable
from real production workers.

**Confirmed mechanism** (also independently self-reported by track 10039's Phase 2 run, which
found "running the E2E suites from a worktree causes them to leak into the real, currently-
running Collector API on port 8091 instead of an isolated mock" and correctly left it out of
scope):

```js
// conductor/tests/local-fs-e2e.test.mjs and local-api-e2e.test.mjs
const ROOT = join(__dirname, '../..');
const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], { cwd: TMP, ... });
```

**The isolation gap is now pinned down and verified empirically** (planning, 2026-08-31 — see
`spec.md` for the full analysis). It is not the script path — it is the *sandbox* path:

`TMP = join(ROOT, '.test-tmp-<suite>')` is a plain, **non-git** directory inside the checkout.
The worker starts, and track 10019's cwd normalization (`sync.mjs:158`) calls
`resolvePrimaryRepoRoot(TMP)`. For a sandbox inside a **linked worktree**, `--git-dir`
(`<primary>/.git/worktrees/<n>`) differs from `--git-common-dir` (`<primary>/.git`), so the
resolver returns the **primary checkout** and the worker calls
`process.chdir('/home/meller/Code/laneconductor')` — *before any config is read*. The sandbox
`.laneconductor.json` is therefore never loaded at all; the worker reads the real config, the
real `conductor/tracks/`, syncs to the real Collector on 8091, claims real queued tracks, and
spawns real `claude` agents. Verified directly against this repo:

| Sandbox location | resolver returns | chdir? |
|---|---|---|
| `<primary>/.test-tmp-probe` | itself | **no** — isolation holds |
| `<worktree>/.test-tmp-probe` | `/home/meller/Code/laneconductor` | **yes** — escapes to production |

That asymmetry is the whole bug: the suites are isolated from the primary checkout and
silently non-isolated from a worktree. **51 test files** spawn a worker this way; 47 do not set
the `LC_SKIP_CWD_NORMALIZATION` opt-out.

The guard that should have caught this — the in-process `acquireWorkerLock` (`sync.mjs:198`),
which resolves the *same* lock path as the real worker — was defeated by **11 spawn sites
across 8 suites explicitly setting `LC_SKIP_WORKER_LOCK=1`**, plus `--manager` workers using a
separate lock file entirely.

**SIGTERM non-responsiveness — confirmed, and bounded**: `sync.mjs:7694` is
`process.on('SIGTERM', async () => { await removeWorker(); process.exit(0); })`.
`removeWorker()` loops over collectors awaiting `del(...)`, which carries a **10 000 ms**
per-collector timeout. So shutdown is not an infinite hang, but it is `N × 10s` with **no
aggregate deadline and no watchdog exit** — long enough that an operator reasonably concludes
SIGTERM was ignored and escalates to SIGKILL, which is exactly what happened during recovery.

**Correction to the filed hypothesis — no work needed on the pidfile guard.** The report
proposed that `lc worker start`'s single-instance check fails to detect a dead PID in
`.sync.pid`. It does not: `getRunningWorkerPid()` (`bin/lc.mjs:193`) already validates via
`isLiveLaneConductorPid()` (liveness *plus* a `/proc/<pid>/cmdline` cross-check against PID
reuse) and, on a dead PID, unlinks the stale pidfile and proceeds cleanly. The duplicates never
went through `lc worker start` at all — tests spawn the worker directly and write no pidfile,
so that guard was never in the path.

## Solution

Move test sandboxes **outside** the repository (`os.tmpdir()`) and `git init` each one. This
closes the root cause on two independent axes without touching production semantics: outside
any repo the resolver throws and `resolvePrimaryCwdDecision` degrades to "leave cwd alone";
`git init`'d, `--git-dir` equals `--git-common-dir` so the resolver returns the sandbox itself.

- Route all 51 spawn sites through one shared helper (`conductor/tests/helpers/isolated-worker.mjs`)
  that owns sandbox creation, explicit worker-script resolution, and teardown — so isolation is
  a property of the helper, not of each author's diligence.
- Add an opt-in `LC_ASSERT_SERVING_ROOT` guard inside the worker: if its post-normalization cwd
  is not the expected root, exit non-zero *before* any sync work. No-op when unset, so
  production is unaffected. This turns **any** future escape mechanism into an instant, loud
  test failure — the incident's real cost was invisibility, not the bug itself.
- Default every test worker's collector to a port that provably refuses, so production is
  unreachable even if config resolution goes wrong.
- Bound the worker's own SIGTERM/SIGINT shutdown with an aggregate deadline plus a force-exit
  watchdog; give the test helper a bounded SIGTERM→SIGKILL escalation that confirms death.
- Regression test: reproduce the incident directly from a real linked worktree, asserting
  serving root, process count returning to baseline, and zero contact with port 8091.

## Related Tracks

- [[AM-10039-cloud-workers-claude-cloud]] — Phase 2's own run first found and documented this
  leak (correctly out of its scope), and its two full-suite parity runs from a worktree are the
  most likely direct trigger of the incident. Its dispatcher-only mode (Phase 6) will be even
  more exposed, since there's no human watching `htop`.
- [[AM-10044-running-state-stuck-in-queue-display]] — same incident window, different symptom
  (display staleness vs. process leak). **Separated at planning**: this track's root cause is
  fully explained without it, so they are treated as independent defects (see spec.md → Out of
  Scope). Note that 26 rogue workers writing to the same tracks is a plausible *aggravator* of
  10044's symptom, so re-check 10044 after this lands.

## Phases

- [ ] Phase 1: Lock in the reproduction as a failing test (real linked worktree, assert serving root)
- [ ] Phase 2: Safety net — opt-in `LC_ASSERT_SERVING_ROOT` guard in the worker
- [ ] Phase 3: Shared spawn helper — sandbox outside the repo, explicit script resolution, bounded teardown
- [ ] Phase 4: Bounded worker shutdown (aggregate SIGTERM/SIGINT deadline + force-exit watchdog)
- [ ] Phase 5: Migrate all 51 spawn sites + source-scan guard preventing regression
