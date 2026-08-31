# Track AM-10045: E2E Test Suites Spawn a Real Worktree-Scoped Sync Worker Instead of an Isolated One

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Type**: dev
**Track Kind**: bug
**Workspace**: main
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Live incident (2026-08-30): 25+ duplicate `laneconductor.sync.mjs` processes accumulated over ~28 minutes, driving load average to 17-20 on a 16-core machine and memory usage to 39/46GB. Root cause:…

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

`__dirname` is wherever the test FILE physically sits. When these E2E suites run from inside
a worktree (any lane action's own quality-gate/parity verification does exactly this, and
Phase 2 explicitly ran the full suite twice for its before/after parity diff), `ROOT` resolves
to that worktree's path — so the test spawns **that worktree's own live sync.mjs script**, not
a script instance genuinely isolated from the real system. `cwd: TMP` and mock-CLI env vars
are set, but per Phase 2's finding this does not fully prevent the spawned process from
reaching the real Collector API in at least some conditions — exact isolation gap not yet
pinned down (candidate: TMP setup missing a file the worker falls back from, or a hardcoded
default reached when expected mock config isn't found).

**Compounding factor**: even where isolation nominally works, `worker.kill('SIGTERM')` calls
are placed in `try/finally` in at least `local-fs-e2e.test.mjs` (good), but tonight's SIGTERM
pass on the leaked processes required a follow-up SIGKILL — several ignored SIGTERM entirely,
suggesting the worker's own signal handling (or event-loop state, e.g. mid chokidar
watch/DB-pool activity) does not always shut down promptly, worsening any test failure that
skips cleanup.

**Also observed**: the primary-checkout worker's own single-instance guard is not robust —
`conductor/.sync.pid` pointed at a dead PID and nothing detected/reset that before duplicates
kept accumulating (~1 new worker every 1-2 minutes over the incident window).

## Solution (to be refined at planning)

- Make E2E test worker spawns provably isolated regardless of which directory the test file
  executes from: resolve the worker script via an explicit, test-owned path (e.g. always the
  primary checkout, injected via env var / repo-root detection independent of `__dirname`),
  or run the spawned worker inside a container/namespace that cannot reach the real DB/API
  even if config resolution goes wrong.
- Add a hard safety net independent of the above: the spawned test worker's `.laneconductor.json`
  (or equivalent env) should point somewhere that provably 404s/refuses if it ever reaches the
  real Collector, rather than silently succeeding against production.
- Fix `lc worker start`'s (or whatever calls it) single-instance check to detect a dead PID in
  `.sync.pid` and either refuse-with-clear-error or clean up and proceed — not silently allow
  N more instances to stack up.
- Investigate SIGTERM non-responsiveness: add a bounded SIGTERM→SIGKILL escalation to whatever
  script/harness manages test worker teardown, so a slow shutdown can't leave a live process.
- Regression test: run the E2E suite from within a worktree checkout (simulate today's
  incident directly) and assert exactly one worker process exists during and after the run,
  and that it never reaches the real Collector port.

## Related Tracks

- [[AM-10039-cloud-workers-claude-cloud]] — Phase 2's own run first found and documented this
  leak (correctly out of its scope); its dispatcher-only mode (Phase 6) will be even more
  exposed to a broken single-instance guard, since there's no human watching `htop`.
- [[AM-10044-running-state-stuck-in-queue-display]] — same incident window, different symptom
  (display staleness vs. process leak); may share root cause in the sync/heartbeat subsystem,
  confirm or separate during planning.

## Phases

- [ ] Phase 1: Reproduce the leak deliberately (run E2E suite from a worktree checkout) and pin the exact isolation-escape mechanism
- [ ] Phase 2: Fix worker-script resolution to be worktree-independent + add a real-API safety net
- [ ] Phase 3: Harden single-instance guard (dead-PID detection) + bounded shutdown escalation + regression test
