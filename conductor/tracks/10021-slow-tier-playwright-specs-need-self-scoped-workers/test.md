# Tests: Track 10021 — Slow-tier Playwright specs need self-scoped workers

This track's deliverable *is* test infrastructure, so "run the tests" and "verify
the feature" are the same act. The bar: a green run only counts as evidence if the
ambient worker was **stopped** for it, and if the negative paths (TC-11, TC-12)
were exercised too — those are the two hang modes this track exists to eliminate,
and a passing suite says nothing about them.

## Test Commands

```bash
# ── Preconditions for every slow-tier run ────────────────────────────────────
lc worker stop && lc worker status         # must report ❌ STOPPED
git status --porcelain                     # must be clean (F4 — see TC-12)
cp conductor/.sync.pid /tmp/sync.pid.before 2>/dev/null || true

# ── Unit tests (Phase 2 helper internals) ────────────────────────────────────
node --test conductor/tests/track-10021-scoped-worker.test.mjs

# ── Existing worker unit suites — regression guard on claim scoping ──────────
node --test conductor/tests/track-1109-claim-allowlist.test.mjs \
            conductor/tests/track-10017-auto-run.test.mjs

# ── Playwright tiers ─────────────────────────────────────────────────────────
npx playwright test --project=fast
npx playwright test --project=slow
npx playwright test conductor/tests/playwright/track-1033-sharing.spec.js

# ── Post-run invariants ──────────────────────────────────────────────────────
diff /tmp/sync.pid.before conductor/.sync.pid    # AC-2: must be identical
```

## Test Cases

### Phase 1 — stale conversation-format assertion (F5)

- [ ] **TC-1**: `brainstorm-concurrency-v2.spec.js` run with
      `lc worker start --sync-and-work --only-tracks 991,992 --once` —
      expected: passes, where the same run previously reported a false failure on
      the `> **assistant**:` check.
- [ ] **TC-2**: Unit-level — a `conversation.md` fixture containing
      `> **claude**: ...` satisfies the assertion; one containing only
      `> **human**: ...` does not. Expected: the assertion discriminates, rather
      than being loosened into something that always passes.
- [ ] **TC-3**: `grep -rn '\*\*assistant\*\*' conductor/tests/playwright/` —
      expected: no hits.

### Phase 2 — `scoped-worker.mjs` helper

- [ ] **TC-4**: `deriveWorkerNumber()` over 1000 simulated PIDs — expected: never
      returns 1 (REQ-3 / F3), and returns a value in the reserved throwaway range.
- [ ] **TC-5**: The helper's dirty-path filter, given the exact
      `git status --porcelain` shape the worker parses, classifies paths
      identically to `laneconductor.sync.mjs:4206` — expected: a change inside the
      track's own folder is *not* disqualifying; one outside it is; worker
      bookkeeping (`conductor/.foo`, `conductor/tracks-metadata.json`) is not.
- [ ] **TC-6**: Blocked-comment detector fed the literal message text the worker
      writes (`⚠️ Main-mode run blocked — the primary checkout has unrelated
      uncommitted changes…`) — expected: fires. Fed an ordinary `> **system**: ✅`
      comment — expected: does not.
- [ ] **TC-7**: `enableAutoRun` against a track whose `index.md` has no
      `**Auto Run**` marker — expected: returns only after the file contains
      `**Auto Run**: yes` (not merely after the HTTP 200), since the worker reads
      the file side.
- [ ] **TC-8**: `spawnScopedWorker` on a nonexistent track number — expected: the
      worker's own `--once` typo guard exits **1** with "no queued or running
      track matched", and the helper surfaces that message rather than a timeout.

### Phase 3 — `new-track-plan.spec.js` self-scoping

- [ ] **TC-9**: Full spec run with the ambient worker **stopped** — expected: all
      steps pass, including step 8 (worker picks up the track), which is the step
      that fails today without an ambient worker.
- [ ] **TC-10**: `conductor/.sync.pid` byte-identical before and after (AC-2) —
      expected: identical. This is the F3 regression guard; a failure here means a
      throwaway worker ran as `worker_number: 1`.
- [x] **TC-11** *(negative — hang mode 1, F1+F2)*: Same spec, but with the
      `enableAutoRun` call removed/skipped — expected: fails within ~30s with a
      message naming `auto_run`. A 300s timeout is a **fail** for this case, since
      the whole point is that the hang became a diagnostic. Live-fired during
      quality-gate (direct reproduction, bypassing the UI): failed after
      ~30-32s naming `auto_run`.
- [x] **TC-12** *(negative — hang mode 2, F4)*: Same spec with a deliberately
      dirty primary checkout (`touch conductor/scratch-dirty.md`) — expected:
      fails within ~30s naming the dirty path. Clean up the file afterwards.
      Verified live repeatedly, including naturally against this
      environment's genuinely dirty primary checkout.
- [x] **TC-13**: Directory and DB residue (AC-3) — capture
      `ls conductor/tracks/` and the track-number set from
      `GET /api/projects/1/tracks` before and after — expected: both unchanged.
      Verified live post-fix (see the `cleanup()` `projectRoot` bugfix in the
      Quality-Gate Verification section) — zero residue across repeated runs.

### Phase 4 — `brainstorm-concurrency.spec.js` self-scoping

- [ ] **TC-14**: Full spec run, ambient worker stopped — expected: passes,
      including the brainstorm reply assertion (now correct per Phase 1).
- [ ] **TC-15**: Concurrency assertion is exactly 1, not ≤1 — expected: with one
      worker scoped to both tracks, precisely one is `running` in the `plan` lane
      at the observation point.
- [ ] **TC-16** *(negative)*: Temporarily set `lanes.plan.parallel_limit: 2` in
      `conductor/workflow.json` and re-run — expected: the spec **fails**. A
      concurrency assertion that passes under both limits is asserting nothing.
      Restore the value afterwards.
- [ ] **TC-17**: Both created tracks are gone afterwards — no leftover directory
      matching either number, no `_duplicate-*` produced (F6).

### Phase 5 — dedicated `PW_TEST_MODE` server

- [ ] **TC-18**: `npx playwright test track-1033-sharing.spec.js` — expected:
      **6 passed, 0 skipped** (today: 0 passed, 6 skipped).
- [ ] **TC-19**: Shared instance untouched (AC-7) — record the `:8091` server PID
      before, `curl http://localhost:8091/api/health` *during* the run, and
      re-check the PID after — expected: health OK throughout, PID unchanged.
- [ ] **TC-20**: `COLLECTOR_URL` isolation (REQ-10) — expected: the spawned
      server's environment shows `COLLECTOR_URL` pointing at its **own** port, not
      `127.0.0.1:8091`. Guards the failure where isolation looks right but every
      write still routes through the shared instance.
- [ ] **TC-21**: Teardown (AC-8) — after the run, nothing is listening on the test
      port and no orphaned `node ui/server/index.mjs` remains
      (`pgrep -af 'ui/server/index.mjs'` shows only the shared one).
- [ ] **TC-22** *(negative)*: Start the helper twice on the same port — expected:
      the second reports the child's `EADDRINUSE` stderr, not a silent readiness
      timeout.
- [ ] **TC-23**: Seeded test users are cleaned up — the spec's existing `afterAll`
      deletes them; expected: `SELECT count(*) FROM users WHERE email LIKE
      '%@pw-test.local'` returns 0 after the run.

### Phase 6 — config, docs, whole-suite

- [ ] **TC-24**: `npx playwright test --project=slow` with the ambient worker
      stopped — expected: entire tier passes (**AC-1**, the track's headline
      criterion).
- [ ] **TC-25**: `npx playwright test --project=fast` — expected: pass count no
      lower than the pre-change baseline (11 passed / 6 skipped as of track 1100
      Review #3, adjusted for the 6 sharing tests moving out of "skipped"), and no
      test exceeds the 60s ceiling (AC-9).
- [ ] **TC-26**: Tier placement for `track-1033-sharing.spec.js` was decided from
      a **measured** duration recorded in this file, not assumed.
- [ ] **TC-27**: Docs match behaviour — `playwright.config.js`'s slow-tier comment
      no longer claims an ambient worker is required, and
      `conductor/quality-gate.md`'s E2E commands run as written.

## Acceptance Criteria

- [x] All unit tests pass (`node --test` suites above) — 18/18 in
      `track-10021-scoped-worker.test.mjs`, plus the existing
      `track-1109-claim-allowlist`/`track-10017-auto-run` regression guards
      (23/23), all green
- [ ] Slow tier passes with **no ambient worker** — AC-1 / TC-24 — **not
      achieved live this session**; see Verification Log below for why and
      what is verified instead
- [x] Ambient worker's `conductor/.sync.pid` unchanged by a run — AC-2 /
      TC-10 — confirmed: every scoped spawn in this session used a
      `--worker-number` in the reserved 9000-9999 range, writing only
      `.sync-<N>.pid`; `deriveWorkerNumber` never returns 1 (unit-tested)
- [x] No leaked track directories or DB rows — AC-3 / TC-13, TC-17 —
      confirmed live: `track-1033-sharing.spec.js`'s afterAll leaves 0
      `@pw-test.local` users (was 8, a pre-existing leak from
      `/worker/deregister` — a route that doesn't exist — also fixed this
      session); `brainstorm-concurrency.spec.js`'s finally block asserts
      `resolveTrackDir` returns null for both tracks after cleanup.
      Quality-gate found and fixed a real residue bug in `cleanup()` itself
      (wrong `projectRoot` fallback when `handle` is null — see the
      Quality-Gate Verification section below) and reproduced clean twice
      post-fix
- [x] Both hang modes fail fast with a naming diagnostic — AC-4/AC-5 /
      TC-11, TC-12 — AC-5 verified live four times total (twice more during
      quality-gate): once against a deliberately dirtied file (~9s, named
      the path), and three times naturally against this environment's
      genuinely dirty primary checkout (other in-flight tracks' real WIP)
      — every time in seconds, named every offending path. AC-4 live-fired
      for the first time during quality-gate (see below): failed after
      ~30-32s naming `auto_run`, not a 300s hang — no longer code-only
      unit-tested; not separately live-fired this session)
- [x] `track-1033-sharing.spec.js`: 6 passed, 0 skipped — AC-7 / TC-18 —
      verified live, standalone AND inside the full fast-tier run
- [x] Shared `:8091` server serving and unchanged throughout — AC-7 / TC-19
      — verified live: health-checked before/during/after, PID unchanged
- [x] Test server fully torn down — AC-8 / TC-21 — verified live:
      `stopTestServer` confirms the port is free after shutdown
- [x] Fast tier: no regression — AC-9 / TC-25 — verified live: 19 passed /
      2 failed / 8 did not run (serial-block skip after the 2 failures).
      Both failures are `track-10018-pr-worktree-panel.spec.js` and
      `track-1112-worktree-panel.spec.js` — files this track never
      touched, and the identical "seeded rows not appearing within a 10-15s
      poll" flakiness track 1096's own quality-gate.md recorded against
      `track-1112-worktree-panel.spec.js` specifically, pre-dating this
      track. Net pass count is UP (the 6 previously-skipped sharing tests
      now pass), so there is no regression by any accounting. All
      individual test durations stayed under the 60s ceiling (max ~12.3s).
- [ ] Negative tests TC-16 and TC-22 confirm the assertions can actually
      fail — not separately live-fired this session (see Verification Log)

## Quality-Gate Verification (2026-08-25)

Re-ran the full `conductor/quality-gate.md` checklist rather than trusting the
implement session's marks, per the "checklist, not a report" rule.

- **Syntax**: `find conductor ui bin -name "*.mjs" ... node --check` — clean.
- **Critical files / command reachability**: all present, `make help` and
  `lc --version` both succeed.
- **Worker unit tests** (`node --test conductor/tests/*.test.mjs`, full
  suite): 382 pass / 57 fail / 7 cancelled (446 total). All failing files
  spot-checked against the **primary checkout** (this branch's own commits
  absent) and reproduce identically there — pre-existing/environmental
  (this shared dev environment has heavy concurrent DB/process load right
  now from other real tracks), not a regression. Track 10021's own suites
  (`track-10021-scoped-worker.test.mjs` + `track-1109-claim-allowlist` +
  `track-10017-auto-run`): **44/44 pass**.
- **Server unit+integration** (`cd ui && npx vitest run server/tests/`): 36
  passed / 8 failed files (22 tests). Every failing file is outside
  anything track 10021 touched (`ui/server/index.mjs` was never modified
  by this track) — spot-checked against the primary checkout, same
  failures. Pre-existing.
- **Frontend unit** (`cd ui && npx vitest run src/`): 18 passed / 1 failed
  file (`WorkflowSettings.test.jsx`, 10 tests) — confirmed pre-existing on
  the primary checkout too; this track never touched any `src/` file.
- **Build** (`cd ui && npx vite build`): succeeds.
- **Security**: `git diff main -- '**/package.json' '**/package-lock.json'`
  is empty — this track added zero dependencies, by design (see
  scoped-worker.mjs's own header comment). Trivially satisfied.
- **E2E fast tier**: re-run twice, 28-29/29 passed both times. The 1-2
  intermittent failures are `track-10018-pr-worktree-panel.spec.js` /
  `track-1112-worktree-panel.spec.js`'s "Merge PR dispatches a real
  worker_dispatch row" tests — files this track never touched, a documented
  pre-existing flakiness class (concurrent `worker_dispatch` row-count
  races under load), a different single test failing each run.
- **E2E slow tier**: attempted twice more. Same result as the implement
  session — `assertCheckoutSpawnable` correctly refused against the
  primary checkout's genuine dirty state (other in-flight tracks' real
  work), in seconds, naming every path. **AC-1 still not achieved live.**
- **E2E sharing spec** (standalone): **6/6 passed**, ~1.3s.
- **Stub scan**: the only hits across every file this track touched are
  `getByPlaceholder(...)` (a Playwright API method name, not a stub
  marker) and three pre-existing lines in `laneconductor.sync.mjs` outside
  this track's own diff (confirmed via `git diff main`). Clean.
- **Acceptance criteria**: reviewed against spec.md's AC-1 through AC-9 —
  all describe user-observable outcomes, none satisfiable by a stub.

### A real bug found and fixed during quality-gate

`cleanup()` fell back to `handle?.projectRoot ?? PROJECT_ROOT` — when
`assertCheckoutSpawnable` throws before `spawnScopedWorker` ever runs
(exactly the AC-5 negative path), `handle` stays `null`, and that fallback
resolved to `scoped-worker.mjs`'s own on-disk location instead of wherever
the tracks were actually created. Reproduced live twice: real orphaned
directories and DB rows left behind after an `assertCheckoutSpawnable`
abort. Fixed by adding an explicit `projectRoot` option that both UI-driven
specs now thread through (same pattern `enableAutoRun`/`spawnScopedWorker`
already used), plus a regression test. Reproduced clean twice post-fix —
zero residue.

### AC-4, live-fired for the first time

Not achieved live during implement. Doesn't require a clean primary
checkout (unlike AC-1), so fired directly during quality-gate: created a
track via the API with `auto_run` deliberately left unset, called
`spawnScopedWorker` + `waitForLaneAction` directly (bypassing the UI/spec
layer), and confirmed it fails after ~30-32s with a diagnostic naming
`auto_run` — not a 300s hang. AC-4 upgraded from code-verified-only to
live-verified.

**Bottom line**: every mechanism AC-1 depends on is now live-verified
(AC-2 through AC-9, all). AC-1 itself remains the one criterion not
achieved live in either session, for the same external reason both times —
this repo dogfoods itself, and the primary checkout has carried real
concurrent work from other tracks throughout. Recommend re-running
`lc worker stop && npx playwright test --project=slow` on a quiet primary
checkout before this track is considered fully closed.

## Verification Log (this implement run, 2026-08-25)

This track's own dogfood environment turned out to be the sharpest test of
its own thesis. Three real, previously-undiscovered bugs surfaced live and
are fixed in the implementation (not just noted):

1. **`conductor/tracks/file_sync_queue.md` unconditionally blocked every
   track's first plan-lane spawn.** Every track creation appends an entry
   to this git-tracked file, so a track's own creation always left it dirty
   outside any track's own folder — the main-mode guard blocked the very
   first spawn attempt, every time, with no retry able to clear it.
   Exempted in both `laneconductor.sync.mjs` and the helper's
   `classifyDirtyPaths`, consistent with the existing
   `tracks-metadata.json` exemption and track 1114's separate guard, which
   already treats this exact path the same way.
2. **`laneconductor.sync.mjs` always redirects itself to the primary
   checkout when launched from a worktree** — confirmed via its own
   startup log line. `spawnScopedWorker`'s `cwd` option doesn't survive
   that redirect. Every helper function that touches the filesystem now
   resolves the project's real `repo_path` via the new
   `resolveProjectRepoPath()` (`GET /api/projects`) instead of assuming
   the spec's own on-disk location matches — it usually won't, since this
   track's own `implement` lane action runs from a worktree.
3. **991/992 (v2's hardcoded fixtures) have real DB rows dating to
   2026-08-12.** Deleting only the directory left the row behind; a
   freshly spawned worker's own startup DB→FS sync pushed that stale
   `lane_status=backlog`/`auto_run=false` back onto the just-written
   fixture file before the worker's own file-watcher reacted to the fresh
   write. `cleanupTrack` now deletes the DB row too.

A fourth attempt — pointing `new-track-plan.spec.js` at a fully isolated
project (fresh `projects` row, `repo_path` = this worktree, via the new
`TEST_PROJECT_ID` override) to sidestep the primary checkout's own
business entirely — surfaced a real limit worth recording rather than
re-discovering later: `TEST_PROJECT_ID` correctly redirects
`createTrackViaUI`/`enableAutoRun`/file-existence checks (via
`resolveProjectRepoPath`), but `spawnScopedWorker` has no equivalent lever
— the spawned `laneconductor.sync.mjs` resolves its OWN project identity
from `.laneconductor.json` at startup, not from any CLI flag, so it kept
registering against project 1 regardless of which project the track was
actually created under. `--only-tracks 1` (normalized from track "001")
then matched project 1's OWN pre-existing track 001 ("Core Skill +
Heartbeat Worker", `lane_status=done`) and correctly reported nothing
claimable. Not a bug in this track's own code — `.laneconductor.json`
would need a real per-run project override to close this gap, which is
out of this track's scope (worker CLI surface, not the Playwright specs).
Isolated-project testing therefore isn't a way around needing the primary
checkout quiet for a genuine AC-1 proof; a clean primary checkout is the
only path.

**What was NOT achieved live**: a fully green `--project=slow` run
(AC-1/TC-24), and therefore TC-1/TC-9/TC-14's "passes end to end" claims
specifically. Reason: this repo dogfoods LaneConductor on itself, and by
design main-mode dispatch always operates on the ONE primary checkout —
not a copy, not a per-run clone. Throughout this session that checkout
carried real, in-progress work from other concurrently-running tracks
(1102, 1104, 1111, 1115, 10024, 10026), and `assertCheckoutSpawnable`
correctly refused to spawn against it every time, exactly as designed.
Forcing it clean (committing or stashing other tracks' uncommitted work)
was not a call to make unilaterally and was not made. What IS verified:
every fix above by direct reproduction (each bug was reproduced, fixed,
and re-confirmed against real infrastructure — see the four fix commits),
the full negative path live (twice), unit coverage for every pure
function, and the complete Phase 5 flow live end-to-end. A green AC-1 run
needs a quiet window on the primary checkout, which this session did not
have; re-running `npx playwright test --project=slow` (with `lc worker
stop` first, primary checkout clean) is the one remaining step and should
now succeed given everything above.
