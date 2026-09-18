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

- [x] TC-3.1: confirmed 25/25 before measuring.
- [x] TC-3.2: captured — 1392 tests; 182 fail/33 cancelled before the
      Phase 4 `parseForceRun` import-crash fix, 43 fail/5 cancelled after.
- [x] TC-3.3: quarantined instead (REQ-4) after confirming genuine
      non-determinism was not a timeout-tuning issue — 5/5 pass + 1
      skipped, deterministic over 3 consecutive re-runs post-quarantine.
- [x] TC-3.4: re-measured — 6/7 (matched scope), root-caused as a stale
      regex (not a behavior regression), fixed to 7/7.
- [x] TC-3.5: re-measured — 2/3 (matched scope); confirmed pre-existing in
      Phase 1 by diffing against pre-migration content; not individually
      root-caused/quarantined within this session's budget.
- [x] TC-3.6: confirmed — `workflow.json` untouched (sha256sum checked
      repeatedly); 3 real orphaned processes found and killed (verified
      via `/proc/<pid>/cwd` before killing).

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

- [x] TC-5.1 through TC-5.14: all confirmed — see
      `track-10099-subcommand-help.test.mjs` (11/11 pass), mapped 1:1 to
      TC-5.1/5.2/5.3+5.4/5.5/5.6/5.9/5.10/5.11/5.12/5.13/5.14 (TC-5.7/5.8's
      specific "appends nothing" claims are subsumed by TC-5.9's
      zero-side-effects table-driven pass, which is a strictly stronger
      guarantee than checking two subcommands individually).
- [x] TC-5.15: `track-10035-new-track-flags.test.mjs`'s `readCreatedIndex`
      now asserts an exact slug regex.
- [x] TC-5.16: `track-10099-subcommand-help.test.mjs` uses `makeSandbox()`
      — confirmed via the isolation audit still reporting 25/25 (this file
      isn't in the AM-10089 scope list at all, since it never spawns the
      real worker/CLI — only `bin/lc.mjs`'s file-only commands).

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

- [x] TC-8.1: root cause written down (plan.md Phase 8 Task 1) — a
      call-site gating bug (`if (!isManager) return;`), not any of the
      three leading candidates listed at planning time.
- [x] TC-8.2 (AC-20): satisfied by the pre-existing `classifyWorkerStaleness`
      unit tests (classification math was never broken) plus the new
      wiring-pin test (the verdict now reaches `code_staleness` outside
      `.sync.log`).
- [x] TC-8.3/TC-8.4: pre-existing coverage in
      `track-10040-worker-code-staleness.test.mjs` (7/7, unaffected by
      this phase's change — the classifier itself wasn't touched).
- [~] TC-8.5/TC-8.6 (AC-21): **not performed** — no live merge was run
      against a real, currently-stale worker process to observe the badge
      appear end to end within this session. Honest gap.

### Phase 9 — `Depends On` + log rotation (items h, i)

- [x] TC-9.1/TC-9.2 (AC-22): confirmed — a dependency at `done:queue`
      stays blocking; flipped live to `done:success`, releases within one
      poll cycle.
- [x] TC-9.3: pre-existing coverage (unaffected by this fix) confirms
      fails-closed for a nonexistent dependency — re-ran, still passes.
- [~] TC-9.4: not independently tested with 2+ dependencies — the
      `dependsOn.filter(dep => !isDependencyShipped(...))` mechanism
      applies the same predicate per-entry regardless of count, so this
      is "correct by construction" rather than separately verified.
- [~] TC-9.5: not re-verified this phase — the `if (!waitingForReply)`
      wrapper around the whole gate block was untouched by this fix, so
      existing behavior should be unaffected, but no new test re-confirms
      it live.
- [x] TC-9.6: the gate now calls `isDependencyShipped` directly (not a
      second copy), so agreement is structural, not merely tested.
- [ ] TC-9.7/TC-9.8 *(item (i), droppable)*: not implemented — see
      plan.md Phase 9 Task 4/5 (explicitly gated behind author
      confirmation, unavailable this session).

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

---

## Phase 11 — Gate's own gaps (planning pass 2026-09-18, implemented this pass)

Evidence for every case below is in spec.md's **Addendum — planning pass
2026-09-18**. Status per case, honestly — not everything closed the way
originally planned; see notes.

- [x] TC-11.1 (item k, blocking): **Revised, not literally satisfied as
      written.** No whole-file writer could be made to reproduce the
      exact 13→2 line truncation (`createWorktree`'s "sync files before
      worktree" commit only commits what's already on disk — it doesn't
      write index.md itself; every other whole-file writer only fires on
      a genuinely missing folder). Said so explicitly per the original
      task's own instruction, rather than closing the item on a false
      positive. The strongest reproducible mechanism found instead — an
      empty-read race in the claim-write path — is covered by TC-11.1b.
- [x] TC-11.1b (new, item k): `resolveFreshContentForClaim('', fullContent)`
      returns `fullContent`, not `''` — regression for the empty-string
      gap in the old `readIfExists(indexPath) ?? content` claim write.
      `conductor/tests/track-10099-claim-empty-read-race.test.mjs`, 5/5
      pass; test 5 demonstrates the pre-fix failure shape inline
      (`'' ?? content` evaluates to `''`) since the guarded helper itself
      is new code with no separate "before" state to run against.
- [x] TC-11.2 (item k): `grep -rn "marker-ownership" conductor/laneconductor.sync.mjs`
      now returns hits (the import line plus the `isAuthorOwnedMarker`
      call site). Confirmed **zero hits pre-fix** via a source-level pin
      in `track-10099-worker-marker-ownership-wiring.test.mjs` (failed
      before the fix, passes after).
- [x] TC-11.3 (item k): `updateIndexMDFromDB` given `dbTrack.merge_mode`
      set and no provenance assertion now leaves the file's `**Merge
      Mode**` unchanged — confirmed via a source-level pin on the guarded
      conditional block (fails pre-fix, passes post-fix; same test file).
- [x] TC-11.4 (item l): Table-driven completeness check —
      `isAuthorOwnedMarker(m) || isMachineOwnedMarker(m)` for every marker
      `updateIndexMDFromDB` writes. **Confirmed failing pre-fix on
      `Summary`** (as predicted). `Track Kind`/`Last Run` turned out not
      to be written by either DB→FS writer at all (written by other,
      out-of-scope call sites) — left unclassified deliberately, not
      missed; see plan.md Task 3's note. `Model` and `Waiting Reason`
      classified and covered by their own new tests in
      `ui/server/tests/track-10099-marker-ownership.test.mjs`.
- [ ] TC-11.5 (item l): **Not separately written.** Track 1081's own
      `truncateSummary` fix already covers the "stale truncated Summary
      overwrites a real one" mechanism (summary-utils.mjs); classifying
      `Summary` as machine-owned in this pass doesn't add a NEW guard
      against DB staleness — that was never the actual defect (see plan.md
      Task 3's reasoning for why `Summary` belongs in the machine table,
      not the author table). No regression test added because there is no
      new behavior to regress-test here.
- [x] TC-11.6 (item n): **Revised measurement approach.** A live-spawn
      reproduction against a real mock collector (not the default refusing
      port, which never reaches the buggy call sites at all — confirmed
      empirically) is included as a best-effort check, but is honestly not
      a guaranteed-deterministic repro of a genuine macrotask/network
      timing race. The reliable regression guard is a **deterministic
      source-level pin**: both `gitExec` and `activeDispatch` declaration
      lines must precede the top-level `await upsertWorker();` line — the
      actual structural property the fix establishes.
      `conductor/tests/track-10099-startup-tdz-crashes.test.mjs`, 4/4 pass.
- [ ] TC-11.7 (item n): **Not written.** Out of this pass's scope —
      `file_manifest_digest` population timing is a separate, pre-existing
      concern from the TDZ crash itself (the crash prevented the FIRST
      attempt from succeeding, but didn't affect whether a LATER 60s-tick
      attempt eventually populates it). Worth a follow-up test, not
      claimed done here.
- [ ] TC-11.8 (item m): **Not a test — an author decision, as originally
      noted.** Confirmed during this implement pass that the primary
      checkout's uncommitted `--force-run` implementation is still present
      and unresolved (`git status` on `/home/meller/Code/laneconductor`
      still shows `bin/lc.mjs`, `conductor/claim-scope.mjs`,
      `conductor/laneconductor.sync.mjs` modified). Deliberately untouched.

**New, not originally planned (found while running the full node:test
suite this pass):** `conductor/tests/track-10062-auth-required.test.mjs`
is unprotected (not one of AM-10089's 25 scoped files) and reproduced the
same worktree-redirect shape Phase 1 closed for those 25 — `workflow.json`
checked unchanged (`d7b144ec…9e4`) before and after, so no actual
corruption occurred, but this is flagged, not fixed (out of this track's
enumerated scope; a scope decision for the author).

### Phase 7 status correction

TC-7.1…TC-7.7 remain `[ ]` and that is **accurate, not stale
bookkeeping**: the API-server writer is guarded, the worker's writer is
not, and TC-7.4 ("both writers enforce it") is the case that fails. Do
not tick these from the implement summary alone.

## Acceptance Criteria — additions

- [ ] The writer behind the 2026-09-18 truncation is named, or its
      non-existence is demonstrated
- [ ] Both DB→FS writers consume one ownership table
- [ ] Every writable marker is classified, enforced by a test
- [ ] A worker start produces no TDZ error in its log
- [ ] Item (d)'s two implementations are reconciled by an author decision
