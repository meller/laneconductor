# Tests: Track AM-10099 — Release readiness hardening gate

## Test Commands

```bash
# ── Vitest (mocked: UI + server routes) ────────────────────────────────
cd ui && npx vitest run                      # full suite
cd ui && npx vitest run --reporter=basic     # per-file summary
cd ui && npx vitest run server/tests/auth.test.mjs      # single file

# ── node:test (real processes / filesystem) ────────────────────────────
node --test conductor/tests/                             # full suite
node --test conductor/tests/local-api-e2e.test.mjs       # helper-isolated
node --test conductor/tests/track-10099-subcommand-help.test.mjs

# ── Isolation audit (Phase 1's own gate) ───────────────────────────────
node conductor/tests/helpers/audit-sandbox-isolation.mjs   # expect 25/25 protected
```

> ⚠️ **Before Phase 1 lands, do not run the worker-spawning `node:test`
> files from inside a worktree.** `worker-mode.test.mjs` and
> `track-1086-session-worker.test.mjs` are two of the 25 unprotected
> files; running them here redirects a real worker into the **primary
> checkout** and can overwrite the shared `conductor/workflow.json`.
> `local-api-e2e.test.mjs` is safe (it already uses the helper).

> ⚠️ **A worktree has no `ui/node_modules`.** Until Phase 2 Task 2,
> `npx vitest run` there fails with
> `Cannot find package '@vitejs/plugin-react'` before running any test —
> that is the environment, not a regression.

### Standing hygiene checks (run after every suite)

```bash
ps aux | grep laneconductor.sync.mjs | grep -v grep      # expect only the standing worker
for p in $(pgrep -f laneconductor.sync.mjs); do echo "$p $(readlink /proc/$p/cwd)"; done
git -C /home/meller/Code/laneconductor diff --stat conductor/workflow.json   # expect empty
```

## Measured Baseline (2026-09-17, before any fix)

Cite these; they are the "fails today" reference for every TC below.

| Suite | Result |
|---|---|
| vitest files | `15 failed | 120 passed (135)` |
| vitest cases | `39 failed | 911 passed (950)` |
| vitest collection errors | 2 files, **46 cases never executed** |
| `local-api-e2e` run 1 | `# pass 4  # fail 2` |
| `local-api-e2e` run 2 | `# pass 3  # fail 3` (non-deterministic) |
| isolation audit | **0 / 25 protected** |
| `worker-staleness` log hits | **0** in a 3.9 G log |

## Test Cases

### Phase 1 — Test isolation (item a)

- [x] TC-1.1: Isolation audit reports 0/25 protected before the phase —
      expected: the audit itself is a valid failing gate. Confirmed.
- [x] TC-1.2: Audit reports 25/25 protected after — expected: no file
      reaches a real worker/CLI spawn from an unprotected sandbox.
      Confirmed (required broadening the audit's own `protected` check —
      see plan.md Phase 1 Task 7).
- [x] TC-1.3: For each migrated file, `resolvePrimaryRepoRoot(sandbox)
      === sandbox` — expected: nothing to chdir out of. Confirmed directly
      in the new regression test; true by construction for every other
      migrated file (same git-init pattern).
- [x] TC-1.4: Regression (AC-3) — worker spawned with a sandbox under a
      linked worktree does **not** chdir into the primary checkout;
      expected: fails if the Phase 1 fix is reverted. New
      `track-10099-sandbox-isolation-regression.test.mjs` TC-A passes;
      manually reverted its git-init calls and confirmed it fails with
      the same escape signature as `track-10045-worktree-isolation.test.mjs`'s
      TC-1 canary, then restored.
- [x] TC-1.5: `sha256sum` of the primary checkout's
      `conductor/workflow.json` identical before/after driving the suite
      from `.worktrees/10099`, and the file still has 5 lanes (AC-2).
      Confirmed (`d7b144ec…9e4` unchanged across all Phase 1 test runs).
- [x] TC-1.6: Every migrated file's pre-existing assertions still present
      and passing — expected: isolation change only, no test-logic change.
      Confirmed by diff review (only import lines + TMP path + git-init
      insertions changed, no assertion touched) and by spot-running two
      files against their pre-migration content in place.
- [x] TC-1.7: No orphaned `laneconductor.sync.mjs` after the run.
      Confirmed after every test run in this phase.

### Phase 2 — Vitest baseline (item b part 1)

- [x] TC-2.1: `api-routes.test.mjs` runs **36** cases (was 0) — confirmed.
- [x] TC-2.2: `bug-to-test.test.mjs` runs **10** cases (was 0) — confirmed.
- [x] TC-2.3: No file reports a collection/unhandled error — 135/135
      collected, confirmed.
- [x] TC-2.4: `npx vitest run` → `0 failed`, **996** cases run (AC-4) —
      950 + 46 recovered, additive as expected.
- [x] TC-2.5: `track-1102-f5-ui-dispatch` — investigated via git history
      (commit `02fedf74`) rather than guessing; the "does NOT dispatch"
      assertion was itself stale (superseded by a deliberate, already
      live-incident-justified fix, already locked in by
      `track-10047-dispatch-explicit-action.test.mjs`). Updated to match
      current, intentional, already-covered behavior — not a silent skip.
- [x] TC-2.6: `track-1102-f15-lane-reset-dispatch` — same investigation,
      same resolution, both describe blocks.
- [x] TC-2.7: `auth.test.mjs` — root cause found (`_adminAuth` referenced
      but never declared — a `ReferenceError` silently caught,
      `AUTH_ENABLED` forced back to `false`). This WAS the real
      security-relevant bug the warning anticipated: remote-api auth could
      never actually turn on. Fixed in `auth.mjs`, not the test. 14/14 pass.
- [x] TC-2.8: `track-1116-model-override.test.mjs` — the route, the DB
      column, and the `syncTrackToFile` export were genuinely missing
      (track 1116 marked done without shipping its UI/API code). Built for
      real: migration, route, marker logic, export. 7/7 pass.
- [x] TC-2.9: N/A — zero cases were quarantined this phase; every failure
      was a real fix or a verified, documented fixture-drift correction.
- [x] TC-2.10: `npx vitest run` completes from inside `.worktrees/10099`
      (AC-6) — confirmed, after adding the `ui/node_modules` symlink to
      `createWorktree()`.
- [x] TC-2.11: No assertion was deleted or weakened — every changed
      assertion either now checks something MORE specific (e.g. the exact
      SQL string instead of the whole call-args array) or was corrected to
      match verified-current, intentional behavior with full history
      recorded in comments.

### Phase 3 — node:test baseline (item b part 2)

- [ ] TC-3.1: Phase 1 gate honoured — audit shows 25/25 before any
      node:test run; expected: refuse to measure otherwise.
- [ ] TC-3.2: Full `node --test conductor/tests/` baseline captured with
      per-file pass/fail; expected: a number that does not exist today.
- [ ] TC-3.3: `local-api-e2e.test.mjs` 6/6 on **5 consecutive runs**
      (AC-7); expected: one green run is explicitly insufficient given the
      measured 4/2→3/3 flake.
- [ ] TC-3.4: `worker-mode.test.mjs` re-measured post-Phase-1 (scope said
      1/7); expected: re-derive, don't assume.
- [ ] TC-3.5: `track-1086-session-worker.test.mjs` re-measured (scope said
      1/3).
- [ ] TC-3.6: `workflow.json` untouched and no orphan workers (REQ-15).

### Phase 4 — `lc worker run` (item c)

- [x] TC-4.1: confirmed — `lc worker run 10094 --worker-number 900094`
      now logs `scoped to track(s) 10094` only.
- [ ] TC-4.2: not separately re-verified this pass — `--worker-number`
      parsing itself (`resolveWorkerNumber`) was untouched by this fix;
      pre-existing coverage unaffected.
- [x] TC-4.3/TC-4.4: covered at the unit/static-analysis layer in
      `track-10093-worker-identity-cap.test.mjs` (the exemption predicate
      and its `&&`, not `||`); a full real-worker end-to-end (both
      conditions at once, live) deferred to Phase 10.
- [ ] TC-4.5: unaffected by this change — not re-verified.
- [x] TC-4.6: satisfied by construction — `splitPositionalArgs` excludes
      everything from the first flag-like token onward, not just
      `--worker-number` specifically; TC-4.6 in the new test file confirms
      with a second track before the flag.

### Phase 5 — argv parsing and `--help` (item g)

- [ ] TC-5.1 (D1/AC-14): `lc new --help` exits 0, prints `new` usage,
      creates no folder and no `file_sync_queue.md` entry.
- [ ] TC-5.2: `lc new -h` identical to TC-5.1.
- [ ] TC-5.3 (D2/AC-15): `lc new "My Title" "My desc" --merge-mode pr` →
      title exactly `My Title`, desc exactly `My desc`, slug ends
      `-my-title`, `**Merge Mode**: pr`.
- [ ] TC-5.4 (D3/AC-15): that command prints **no** "unquoted words"
      warning.
- [ ] TC-5.5: `--workspace main` and `--auto-run no` behave like TC-5.3 —
      markers applied, title/desc intact.
- [ ] TC-5.6 (AC-17): `lc reportaBug --help` creates no track.
- [ ] TC-5.7 (AC-17): `lc comment <NNN> --help` appends nothing to
      `conversation.md`.
- [ ] TC-5.8 (AC-17): `lc updateTrack <NNN> --help` appends nothing to
      `plan.md` and leaves the lane unchanged.
- [ ] TC-5.9 (AC-16): table-driven over all **40** dispatch branches —
      exit 0 and non-empty, subcommand-specific help. Expected: spot
      checks do not satisfy this.
- [ ] TC-5.10 (AC-10 of the recovered spec): `lc help new` prints the same
      text as `lc new --help`.
- [ ] TC-5.11 (AC-18): `lc comment <NNN> -- --help` appends the literal
      `--help`.
- [ ] TC-5.12 (AC-19): a flag-like title is rejected, non-zero exit,
      nothing created.
- [ ] TC-5.13: Regression — quoted `"T" "D"`, bracket `[T] [D]`, the
      unquoted-phrase fallback (with its warning), and `--type` placed
      anywhere all behave as today.
- [ ] TC-5.14: Unknown subcommand + `--help` → top-level help (REQ-9).
- [ ] TC-5.15: `track-10035-new-track-flags.test.mjs` asserts the exact
      folder slug, not `includes(...)`; expected: it would have caught D2.
- [ ] TC-5.16: This track's new test file uses `makeSandbox()`, not
      `join(ROOT, '.test-tmp-*')` — it must not become a 26th unprotected
      file.

### Phase 6 — Auto Run gate (item d)

- [x] TC-6.1 (AC-9): covered at the `isTrackClaimable` unit level
      (`explicitlyRequested: true` + `autoRun: false` → claimable);
      full CLI-level "log shows it claimed" deferred to Phase 10.
- [x] TC-6.2 (AC-10) / TC-6.3 (REQ-7): `REQ-7 regression` test —
      `onlyTracks` set + `explicitlyRequested: false` (the standing-worker
      shape) still returns not-claimable for `Auto Run: no`.
- [x] TC-6.4: pre-existing `waitingForReply` bypass untouched — covered by
      TC-3 (already in the file before this phase).
- [x] TC-6.5: confirmed structurally — `worker_dispatch` is processed by
      `checkDispatchInbox`, never calls `isTrackClaimable` at all.
- [x] TC-6.6 (AC-11): SKILL.md's text was already correct; verified
      against the code by writing the tests above against the actual
      predicate, not just reading the doc.

### Phase 7 — Marker ownership (item e)

- [ ] TC-7.1 (AC-12): DB `{auto_run: true, author: '', created_by_email: ''}`
      pulled onto a file holding `**Auto Run**: no`, `**Author**: AM`,
      `**Created By**: …` → all three unchanged; `# H1`, `Problem`, `Type`
      intact. Expected today: `Auto Run` flips to `yes`.
- [ ] TC-7.2 (AC-13): changed `lane_status`/`progress_percent` **do**
      update `**Lane**`/`**Progress**` — guards against a writer that
      syncs nothing.
- [ ] TC-7.3: A null/empty DB column never blanks a populated marker, for
      every author-owned marker (table-driven).
- [ ] TC-7.4: Both writers enforce it — the worker's `updateIndexMDFromDB`
      **and** the API server's `syncTrackToFile`; expected: one shared
      ownership table, asserted from both call sites.
- [ ] TC-7.5: Full-regeneration path preserves author-owned markers even
      when every corresponding DB column is empty (the AM-10093 R4 path).
- [ ] TC-7.6 (AC-25): in-situ — track 10099's `index.md` stays
      `**Auto Run**: no` and its DB row stays `f` across a full sync
      cycle.
- [ ] TC-7.7: Track 1081's summary-marker case still passes (adjacent
      guard not regressed).

### Phase 8 — Post-merge staleness (item f)

- [ ] TC-8.1: Root cause of the never-firing detector is written down and
      demonstrated — expected: a reproducible reason, not a guess.
- [ ] TC-8.2 (AC-20): a worker whose `code_sha` predates a commit touching
      `conductor/services/**` classifies `critical` **and** the verdict
      appears outside `.sync.log`.
- [ ] TC-8.3: A current worker is **not** flagged (no false positives).
- [ ] TC-8.4: A commit touching only unrelated files (e.g. `landing/`)
      does not classify `critical`.
- [ ] TC-8.5 (AC-21): after a real done-lane merge, either new pids serve
      post-merge code or the warning fired; a merge doing neither fails.
- [ ] TC-8.6: Processes restarted **before** verification — expected: no
      false pass from a stale process (this repo's recurring false-verdict
      cause).

### Phase 9 — `Depends On` + log rotation (items h, i)

- [ ] TC-9.1 (AC-22): track with `**Depends On**: N` stays queued while N
      is `done:queue`. Expected today: it launches — the failing state.
- [ ] TC-9.2 (AC-22): it auto-launches once N reaches `done:success`.
- [ ] TC-9.3: `Depends On` naming a nonexistent track stays blocked
      (fails closed).
- [ ] TC-9.4: Multiple dependencies — all must be `done:success`.
- [ ] TC-9.5: `waiting_for_reply` still bypasses the dependency gate.
- [ ] TC-9.6: The tightened gate and `dependency-resume.mjs` agree,
      asserted against one shared predicate.
- [ ] TC-9.7 *(item (i), droppable)* (AC-23): sustained real output keeps
      the log directory under the configured cap.
- [ ] TC-9.8 *(item (i))*: rotation preserves the most recent output —
      a bounded log is still useful for debugging.

### Phase 10 — The gate

- [ ] TC-10.1 (AC-24): every `conductor/quality-gate.md` command run, with
      real output recorded; pre-ticked boxes ignored.
- [ ] TC-10.2: Full vitest + full node:test green from inside a worktree.
- [ ] TC-10.3 (AC-2): `workflow.json` sha identical before/after.
- [ ] TC-10.4: Stub scan clean in every code path this plan marks `[x]`.
- [ ] TC-10.5: AC-1…AC-25 each annotated with the evidence satisfying it;
      any unevidenced AC blocks `done`.
- [ ] TC-10.6: Deferred items still unchecked and not presented as done —
      AM-10098's REQ-2, and any `local-api-e2e` quarantine.

## Acceptance Criteria

- [ ] `cd ui && npx vitest run` → 0 failed, 135/135 files collected, ≥ 996
      cases run
- [ ] Isolation audit → 25/25 protected (from 0/25)
- [ ] `local-api-e2e` deterministic over 5 runs, or quarantined with a
      documented reason
- [ ] `lc worker run <track> --worker-number N` parses one track, runs
      alongside the standing worker, honours an explicit `Auto Run: no`
- [ ] Open-queue auto-launch still refuses `Auto Run: no` (no widening)
- [ ] `lc <sub> --help` safe and useful across all 40 branches; `lc new`
      never folds a flag into a title
- [ ] Author-owned markers survive every DB→FS write; machine-owned ones
      still sync
- [ ] A merge either restarts the worker/API or warns visibly
- [ ] `Depends On` means `done:success`
- [ ] Primary checkout's `workflow.json` intact; no orphaned workers
- [ ] No pre-existing assertion deleted or weakened to reach green
- [ ] No regressions in related features
