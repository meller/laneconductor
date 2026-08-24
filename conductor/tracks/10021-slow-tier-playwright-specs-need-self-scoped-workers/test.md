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
- [ ] **TC-11** *(negative — hang mode 1, F1+F2)*: Same spec, but with the
      `enableAutoRun` call removed/skipped — expected: fails within ~30s with a
      message naming `auto_run`. A 300s timeout is a **fail** for this case, since
      the whole point is that the hang became a diagnostic.
- [ ] **TC-12** *(negative — hang mode 2, F4)*: Same spec with a deliberately
      dirty primary checkout (`touch conductor/scratch-dirty.md`) — expected:
      fails within ~30s naming the dirty path. Clean up the file afterwards.
- [ ] **TC-13**: Directory and DB residue (AC-3) — capture
      `ls conductor/tracks/` and the track-number set from
      `GET /api/projects/1/tracks` before and after — expected: both unchanged.

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

- [ ] All unit tests pass (`node --test` suites above)
- [ ] Slow tier passes with **no ambient worker** — AC-1 / TC-24
- [ ] Ambient worker's `conductor/.sync.pid` unchanged by a run — AC-2 / TC-10
- [ ] No leaked track directories or DB rows — AC-3 / TC-13, TC-17
- [ ] Both hang modes fail fast with a naming diagnostic — AC-4/AC-5 / TC-11, TC-12
- [ ] `track-1033-sharing.spec.js`: 6 passed, 0 skipped — AC-7 / TC-18
- [ ] Shared `:8091` server serving and unchanged throughout — AC-7 / TC-19
- [ ] Test server fully torn down — AC-8 / TC-21
- [ ] Fast tier: no regression — AC-9 / TC-25
- [ ] Negative tests TC-16 and TC-22 confirm the assertions can actually fail
