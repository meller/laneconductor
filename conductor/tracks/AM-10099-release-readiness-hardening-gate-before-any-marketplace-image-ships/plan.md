# Track AM-10099: Release readiness — hardening gate before any marketplace image ships

Ten phases. TDD throughout: each phase writes its failing test first,
confirms it fails **for the right reason**, then implements.

**Phase ordering is a requirement, not a preference** (spec REQ-2). Phase 1
must land before Phase 3 measures any `node --test` baseline, because
measuring an unisolated worker-spawning suite from a worktree is itself the
corruption vector this track exists to close. Phases 4–9 are mutually
independent and may be reordered or parallelised; Phase 10 is the gate and
runs last.

## Audit Findings (recorded during planning — do not re-derive)

Verified this session; cite these instead of re-measuring:

- **25/25** AM-10089 files unprotected (0 helper imports, 0 `git init`,
  0 `mkdtempSync`). Every 10089 commit touched only its own `index.md`.
- **vitest**: `15 failed | 120 passed (135)` files, `39 failed | 911
  passed (950)` cases. Two files fail at *collection*
  (`api-routes.test.mjs` 36 cases, `bug-to-test.test.mjs` 10 cases → 46
  never run) because their `child_process` mock lacks `execFile`, which
  `ui/server/index.mjs:3` imports.
- **A worktree has no `ui/node_modules`** → vitest cannot start there at
  all (`Cannot find package '@vitejs/plugin-react'`).
- **`local-api-e2e.test.mjs` is non-deterministic**: consecutive runs at
  one commit gave `4 pass/2 fail` then `3 pass/3 fail`.
- **(c1)** `bin/lc.mjs` `worker run`: `subArgs.filter(a => !a.startsWith('--'))`
  keeps flag values.
- **(c2)** base-worker cap gated only on `!getIsLocalFs() && !isManager`;
  no claim-scoped exemption; `lc worker run` uses `worker_number` 1 = base.
- **(d)** `conductor/claim-scope.mjs`: `if (!autoRun && !waitingForReply) return false;`
  runs even when `onlyTracks` is set.
- **(e)** Writer is the API server's `syncTrackToFile`
  (`updates.auto_run !== undefined` branch), **not** the worker's
  `updateIndexMDFromDB` (which never emits `Auto Run`). DB row 10099:
  `auto_run=t`, `author`/`created_by_email` **empty**, `created_at
  2026-09-13 20:31:48` (between the junk `--help` track at 20:24 and the
  roadmap commit at 20:33:51).
- **(f)** `worktree-merge.mjs` has no restart step.
  `worker-code-staleness.mjs` exists and is wired into the worker, but
  `grep -c worker-staleness conductor/.sync.log` = **0** — it has never
  fired.
- **(g)** `bin/lc.mjs` `typeIdx` slice unchanged; line ~648 is the sole
  `--help` handler; **40** `command === …` dispatch branches.
- **(h)** worker gate `!== 'done'` vs `dependency-resume.mjs`'s
  `lane === 'done' && laneActionStatus === 'success'`.
- **(i)** `conductor/.sync.log` **3.9 G**, `ui/.api.log` **1.1 G**, no
  rotation logic anywhere.

---

## Phase 1: Redo AM-10089 for real — test isolation (item a)

**Problem**: All 25 files remain live vectors for redirecting a spawned
worker into the primary checkout, where it rewrites shared
`conductor/workflow.json` and track files. AM-10089 claimed this done and
changed nothing.
**Solution**: Migrate to `helpers/isolated-worker.mjs` where it fits;
otherwise `mkdtempSync` under `os.tmpdir()` + real `git init -q`. Then a
regression test that fails if the protection is removed.

- [x] Task 1: Add an audit script (`conductor/tests/helpers/audit-sandbox-isolation.mjs`
      or a test) that reports, per file, whether a real worker/CLI spawn is
      reachable from an unprotected sandbox. Confirm it reports **25
      unprotected** today — this is Phase 1's own failing gate.
      **Done**: measured 0/25, matching the Audit Findings above exactly.
- [x] Task 2/3: Applied the **minimum fix** (Task 3's language) uniformly
      across all 25 files rather than a per-file Task-2-vs-Task-3 split —
      every file's original `.test-tmp-*` directory, previously computed
      as `join(ROOT, '.test-tmp-…')` (inside the repo), now lives under
      `os.tmpdir()` and is `git init -q` + `git config user.email/user.name`'d
      before any real spawn. This was the safer uniform choice: the 25
      files are NOT uniformly "straightforward single-TMP" — several
      (`track-10047-bounded-resume` has 5 per-test-case TMPs,
      `track-1091-orphan-worker-reaping` has 2 inline TMPs,
      `worker-mode.test.mjs` has 4 `testDir`s,
      `track-AM-1121-marketing-tracks` has TMP+TMP2) have bespoke
      multi-sandbox orchestration the helper's single-sandbox
      `startIsolatedWorker()` shape doesn't model. Three files
      (`track-10017-auto-run-phase7-e2e`, `track-10035-direct-merge-e2e`,
      `track-10035-pr-flow-e2e`) already `git clone` their `LOCAL` working
      tree from a fixture `ORIGIN` bare repo — only their `BASE` parent
      needed relocating outside the repo, no additional git-init. Every
      existing assertion/fixture preserved verbatim (REQ-5) — confirmed by
      spot-running 3 migrated files unchanged (see Task 6/7 below).
- [x] Task 4: The 5 `--manager`-only files
      (`track-10049-e2e-real-launch`, `track-1089-provision-worker-dispatch`,
      `track-1091-manager-worker`, `track-1119-wizard-dispatch`,
      `track-AM-1121-marketing-tracks`) all had their sandbox paths
      relocated outside the repo for hygiene/consistency; documented in
      the audit script (`MANAGER_ONLY_FILES`) as structurally immune to
      the live vector (every spawn uses `--manager`, which gates every
      `resolvePrimaryRepoRoot()` call site the escape depends on).
      `track-1119-phase6-e2e-autorun` is the one file with BOTH a
      `--manager` spawn AND a real non-manager `projectWorker` spawn — its
      `TARGET_DIR` is deliberately left un-git-init'd by the fixture
      itself (see inline comment at its `mkdirSync(TARGET_DIR, …)` site):
      the `create-project` dispatch, awaited synchronously before
      `projectWorker` ever spawns, is what production code (`isRepo`
      branch in `laneconductor.sync.mjs`) git-inits it as, and pre-seeding
      a `.git` here would make that branch a no-op and silently stop
      testing it. Recorded in the audit script as `PRODUCTION_GIT_INIT_FILES`
      per spec AC option (c).
- [x] Task 5: Not extended — no concrete file needed a capability the
      minimum-fix pattern (relocate + git init) didn't already cover.
- [x] Task 6: New regression test
      `conductor/tests/track-10099-sandbox-isolation-regression.test.mjs`
      (TC-A, AC-3): builds a disposable fake-primary + linked fake-worktree
      (mirroring `track-10045-worktree-isolation.test.mjs`'s own
      infrastructure, deliberately not the real repo), places a
      `git init`'d sandbox INSIDE the linked worktree, spawns the real
      worker with that sandbox as cwd, and asserts both
      `resolvePrimaryRepoRoot(sandbox) === sandbox` and the worker's own
      "Serving from" provenance line names the sandbox, not the fake
      primary. Passes today. Manually reverted the git-init calls to
      confirm it fails with the exact same "escape reproduced" message
      `track-10045-worktree-isolation.test.mjs`'s permanent-red TC-1
      canary already demonstrates for an unprotected sandbox in the same
      position — then restored the fix.
- [x] Task 7: Re-ran the audit → **25/25 protected** (after fixing the
      audit script's own `protected` predicate — it originally required
      `mkdtempSync` specifically, which the minimum-fix's fixed-name
      `tmpdir()`-rooted paths don't use; broadened to accept any
      `tmpdir()`-rooted path that's also git-init'd, which is the actual
      property that matters). `sha256sum` of the primary checkout's
      `conductor/workflow.json` identical before and after driving 3
      spot-run migrated suites plus the new regression test from this
      worktree (`d7b144ec…9e4` both times); still the real 5-lane config.
- [x] Task 8: `ps aux | grep laneconductor.sync.mjs` — clean after every
      run in this phase; only this track's own scoped worker
      (`--only-tracks 10099 --force-run 10099 --once`) ever present.

**Verification notes**: spot-ran `track-1086-session-worker.test.mjs`
(2/3 pass — matches the documented baseline flake exactly, not a
regression) and `track-1091-manager-worker.test.mjs` (0/1 pass on a real
pre-existing bug — `/project/ensure` called for a manager worker, which
must never happen; confirmed pre-existing, unrelated to this phase, by
temporarily running the pre-migration file in place and observing the
identical failure before restoring the migrated version). Both are Phase
3's node:test-baseline territory to catalog and triage, not Phase 1
regressions — Phase 1's own job (isolation only, REQ-5) is confirmed
intact by both.

**Impact**: The suite stops being able to corrupt the checkout it runs in,
which is what makes Phase 3 safe to attempt at all.

## Phase 2: Green the vitest baseline (item b, part 1)

**Problem**: 39 failing cases plus 46 that never execute — 85 cases of
missing signal — and the suite cannot even start inside a worktree.
**Solution**: Fix the collection errors first (they are hiding the most
coverage for the least work), then triage each file to *real bug* vs
*fixture drift*, then make the suite runnable from a worktree.

- [x] Task 1: Added `execFile`/`spawnSync` to both mock factories. 36 and
      10 cases now execute (36+10=46 recovered exactly as predicted).
- [x] Task 2: Symlinked `ui/node_modules` into new worktrees from
      `createWorktree()`, right after the existing config-files copy step
      — see the dedicated commit for the full trade-off writeup (npm
      install per worktree vs a full copy vs this). Verified: `npx vitest
      run` completes from inside `.worktrees/10099` (this very worktree,
      full 135/135 green run, done AFTER adding the symlink code — the
      irony that this worktree already had a node_modules from an earlier
      session doesn't invalidate the fix, which is for every OTHER,
      future worktree).
- [x] Task 3: Triage table — every row resolved, no TBDs remaining:

| File | Failing | Classification | Reason / disposition |
|---|---|---|---|
| `src/pages/WorkflowSettings.test.jsx` | 10 | **real gap — feature never shipped** | Track 1116's own plan.md is 100% `[x]`/"COMPLETE/REVIEWED/QUALITY PASSED" but the Provider+Model picker code was never actually committed — same false-done pattern as AM-10089. Built it for real (`LanePanel` in `WorkflowSettings.jsx`, wired to the already-existing `getDefaultProviderModel()`/`providers.mjs`), not a test edit. |
| `server/tests/auth.test.mjs` | 9 | **real bug — security-relevant** | `server/auth.mjs` referenced `_adminAuth` without ever declaring it; the resulting `ReferenceError` was silently caught by `loadAuthConfig`'s own try/catch and `AUTH_ENABLED` reset to `false` — every real remote-api deployment with Firebase configured could never actually turn auth on. Fixed with a one-line `let _adminAuth;` declaration. |
| `server/tests/track-1116-model-override.test.mjs` | 7 | **real gap — feature never shipped** | Same pattern as WorkflowSettings: the route, the DB column, and `syncTrackToFile`'s export all genuinely didn't exist, even though the worker already read the `**Model**` marker and the UI already called the route. Implemented the migration, route, marker write/remove logic, and export. |
| `server/tests/track-1084-assignee.test.mjs` | 2 | fixture drift | Track 10018's worktree cross-reference (`fetchWorktreeRows`) now runs unconditionally inside `GET /api/projects/:id/tracks` — both tests' mock sequences (and one call-count assertion) predated that. |
| `server/tests/track-1102-f15-lane-reset-dispatch.test.mjs` | 2 | **investigated, NOT a regression — test was stale** | Git-archaeology (commit `02fedf74`) shows the `!hasPoller` gate these tests asserted was deliberately removed after a live incident (tracks 10039/10045 silently never ran). That commit's own new regression test (`track-10047-dispatch-explicit-action.test.mjs`) already locks in the corrected behavior and was passing throughout. Updated both stale tests to match, with full history in comments — not a code revert (REQ-4 satisfied via "escalate the finding," documented rather than silently either direction). |
| `src/components/ChatView.wizard.test.jsx` | 2 | fixture drift | A manager-worker chat target unconditionally POSTs `/api/meta-project/ensure` on mount — legitimate, unrelated to gap-driven wizard/dispatch logic. Excluded from the "no POST" filter. |
| `server/tests/api-keys.test.mjs` | 1 | fixture drift | `/worker/register`'s INSERT mocked with `{rows: []}`; the real handler destructures `rows: [{ id }]`, throwing on the missing `rows[0]` before the test's own assertions ran. |
| `server/tests/track-1033-worker-auth.test.mjs` | 1 | fixture drift | Same class as api-keys, plus a stale extra mocked call (a "git_remote lookup" the handler doesn't make) that shifted the INSERT's response one call too late. |
| `server/tests/track-10037-worker-last-track.test.mjs` | 1 | fixture drift | `ORDER BY` column became table-qualified (`ts.last_used_at`) — same behavior, stale regex. |
| `server/tests/track-1102-f5-ui-dispatch.test.mjs` | 1 | **investigated, NOT a regression** | Same finding and fix as f15 above. |
| `server/tests/track-1119-app-url.test.mjs` | 1 | fixture drift | Query gained a second argument (a meta-project exclusion, unrelated to `app_url`) — `toHaveBeenCalledWith` checked the full args array instead of the SQL string alone. |
| `src/components/ChatView.queued.test.jsx` | 1 | fixture drift | `formatLiveAction()` deliberately capitalizes the leading letter for a natural-reading sentence ("Implement right now…") — case-sensitive assertion, made case-insensitive. |
| `src/components/NewProjectModal.test.jsx` | 1 | fixture drift | Default create mode is now `'chat'` (a newer flow added after this test was written), not `'quick'` — the test now selects Quick create explicitly; the thing it actually verifies (legacy payload shape) is unchanged. |
| `server/tests/api-routes.test.mjs` | 36 unrun | env (Task 1) | Fixed. Also needed a `pool.connect()` mock (POST /tracks now uses a transactional client) and `existsSync`/Dirent-shaped `readdirSync` fixtures for `resolveTrackFolderFs`, both unreachable while collection was broken. |
| `server/tests/bug-to-test.test.mjs` | 10 unrun | env (Task 1) | Fixed. Same Dirent-shape gap in its own `setupMocks` helper, only reachable once `existsSync` was true (TC-4). |

- [x] Task 4: Fixed the *real bug*/*real gap* rows for real (auth.mjs,
      model-override, WorkflowSettings) — no stubs, verified end to end
      against the actual route/component/marker logic, not just made the
      assertion pass. The two `track-1102` dispatch rows were investigated
      to their root cause (git history) before touching anything, per this
      task's own instruction — confirmed NOT a live regression.
- [x] Task 5: No file was quarantined — every failure was either a real
      fix or a documented, verified fixture-drift correction. Zero
      `it.skip`/`describe.skip` added this phase.
- [x] Task 6: `cd ui && npx vitest run` → **`Test Files 135 passed (135)` /
      `Tests 996 passed (996)`**, `0 failed` (AC-4 exactly met — 950 + 46
      recovered = 996).

**Impact**: The suite becomes trustworthy enough to gate a release on. Two
real production bugs fixed along the way (remote-api auth silently
disabled; per-track model override entirely unimplemented despite being
documented as shipped) — exactly the kind of finding this whole track
exists to surface.

## Phase 3: `node --test` baseline (item b, part 2) — REQUIRES Phase 1

**Problem**: The node:test flakies named in scope
(`local-api-e2e` 3/6, `track-1086-session-worker` 1/3, `worker-mode` 1/7)
cannot be measured safely today: `worker-mode.test.mjs` and
`track-1086-session-worker.test.mjs` are both among Phase 1's unprotected
25, so running them from a worktree is the corruption vector.
**Solution**: Only after Phase 1, measure the whole node:test suite, then
triage under the same rules as Phase 2.

- [ ] Task 1: Gate check — re-run Phase 1 Task 7's audit and refuse to
      proceed unless 25/25 are protected. Record the confirmation.
- [ ] Task 2: Measure the full `node --test conductor/tests/` baseline.
      Capture pass/fail per file; this number does not exist yet.
- [ ] Task 3: Run `local-api-e2e.test.mjs` **5 times** and record each
      result — non-determinism is already proven (4/2 then 3/3), so a
      single green run is not evidence. Diagnose the race (mock-collector
      startup, port binding, or worker-registration timing are the
      candidates) and fix it, or quarantine per REQ-4 (AC-7).
- [ ] Task 4: Same treatment for `track-1086-session-worker` and
      `worker-mode`, which Phase 1 will have just rewritten — re-measure
      rather than assuming the scope's original counts still hold.
- [ ] Task 5: Triage every remaining node:test failure into the Phase 2
      table format, extended here.
- [ ] Task 6: Confirm the primary checkout's `workflow.json` is untouched
      and no orphan workers remain (REQ-15).

**Impact**: Both halves of the test suite have a known, defended state.

## Phase 4: `lc worker run` — flag parsing and cap exemption (item c)

**Problem**: Two independent defects make the command SKILL.md calls
"normally what you want" unusable: the `--worker-number` value is read as
a second track number, and the base-worker cap refuses the run whenever
the ordinary worker is alive.
**Solution**: One shared argv helper (also used by Phase 5), plus a
claim-scoped exemption in the cap.

- [ ] Task 1: Failing test — `lc worker run 10094 --worker-number 900094`
      logs `scoped to track(s) 10094` only. Confirm it fails today with
      `10094, 900094`.
- [ ] Task 2: Failing test — with a live base worker registered,
      `lc worker run <track>` starts instead of exiting 1 on the identity
      cap. Confirm the current refusal message first.
- [ ] Task 3: Replace `subArgs.filter(a => !a.startsWith('--'))` with the
      shared `splitPositionalArgs()` helper introduced in Phase 5 (flag
      names **and** their values excluded, `--` honoured). If Phase 5
      hasn't landed, add the helper here and let Phase 5 consume it —
      whichever lands first owns it, and it must not be duplicated.
- [ ] Task 4: Exempt claim-scoped runs from the cap: thread the
      `onlyTracks`-set condition into the `findLiveBaseIdentities` /
      `decideWorkerIdentityCap` block, alongside the existing
      `getIsLocalFs()`/`isManager` exemptions, with a comment explaining
      why a bounded `--once` run is not an accumulating poll loop (which
      is the harm AM-10093 added the cap to prevent).
- [ ] Task 5: Confirm the cap still refuses a second **unscoped** base
      worker — the AM-10093 guarantee must survive (regression test).
- [ ] Task 6: Verify AC-8 end to end against a real track, with the
      ordinary worker running.

**Impact**: Scoped single-track runs work alongside the standing worker.

## Phase 5: `lc` argv parsing and per-subcommand `--help` (item g)

**Problem**: Only `--type` bounds `lc new`'s positional slice, so
documented flags corrupt the title, slug and description; and `--help` is
handled only at `args[0]`, so 39 of 40 subcommands write it as data — the
bug that created a junk track over this very folder.
**Solution**: Adopt wholesale the spec and plan recovered from
`git show 4a1d31ec` (author-sanctioned in `conversation.md`), which
confirmed D1/D2/D3 against the real CLI.

- [ ] Task 1: New `conductor/tests/track-10099-subcommand-help.test.mjs`,
      modelled on `track-10035-new-track-flags.test.mjs`'s throwaway
      `local-fs` harness — created via Phase 1's `makeSandbox()`, not
      `join(ROOT, '.test-tmp-*')`, so this track does not add a 26th
      unprotected file.
- [ ] Task 2: Failing test D1 — `lc new --help` / `-h` exits 0, prints
      usage, creates no folder and no `file_sync_queue.md` entry (AC-14).
- [ ] Task 3: Failing test D2 — `lc new "My Title" "My desc" --merge-mode pr`
      gives title exactly `My Title`, desc exactly `My desc`, slug ending
      `-my-title`, `**Merge Mode**: pr` (AC-15).
- [ ] Task 4: Failing test D3 — no "unquoted words" warning for correctly
      quoted input plus a flag (AC-15).
- [ ] Task 5: Failing tests for the other free-text subcommands:
      `reportaBug` creates nothing; `comment NNN --help` appends nothing;
      `updateTrack NNN --help` appends nothing and does not move the lane
      (AC-17).
- [ ] Task 6: Add `splitPositionalArgs(args)` → `{ positional, flags }`,
      cutting at the first `/^--?[a-z]/i` token and honouring `--` as an
      explicit terminator. Replace the `typeIdx` slice; correct the false
      comment above it.
- [ ] Task 7: Confirm the `>2 raw args` unquoted-phrase heuristic now
      counts only genuine positionals (REQ-10 / AC-15).
- [ ] Task 8: Add a `SUBCOMMAND_HELP` map seeded from the one-liners
      already in the top-level help text, so the two cannot drift; cover
      all 40 branches including aliases (`report-bug`/`reportaBug`,
      `update-track`/`updateTrack`, `feature-request`/`featureRequest`,
      `delete`/`remove`, `verify`/`quality-gate`,
      `enable-target`/`disable-target`).
- [ ] Task 9: Intercept `--help`/`-h` in any post-command position before
      dispatch, exiting 0 with no side effects. Unknown subcommand +
      `--help` → top-level help. Accept `lc help <sub>` as an alias
      (REQ-9).
- [ ] Task 10: Table-driven test over the full dispatch list (AC-16) —
      exit 0 and non-empty, subcommand-specific output for every branch.
- [ ] Task 11: `--` escape hatch test (AC-18), and reject flag-like titles
      (AC-19).
- [ ] Task 12: Strengthen `track-10035-new-track-flags.test.mjs` to assert
      the **exact** title and slug instead of
      `d.includes('direct-auto-track')` — the substring assertion is why
      D2 shipped green (REQ-14; note it in this file).

**Impact**: `lc <anything> --help` becomes safe and useful; the class of
bug that produced a junk `--help` track cannot recur.

## Phase 6: Auto Run gate — make code and doc agree (item d)

**Problem**: SKILL.md says `lc worker run` and `worker_dispatch` bypass
the `**Auto Run**` gate; `isTrackClaimable` applies it unconditionally, so
a named run on an `Auto Run: no` track silently claims nothing and reports
"no queued or running track matched" — indistinguishable from a typo.
**Solution**: Make the doc true (spec REQ-6): distinguish *explicitly
named* from *auto-picked from the open queue*, without widening
`--only-tracks`.

- [ ] Task 1: Failing test — a track with `**Auto Run**: no` is claimed by
      an explicitly-named run and **not** by open-queue auto-launch
      (AC-9 + AC-10 as one pair, so neither can be satisfied alone).
- [ ] Task 2: Add an explicit intent parameter to `isTrackClaimable`
      (e.g. `explicitlyRequested`) rather than overloading `onlyTracks` —
      `--only-tracks` must keep narrowing-only semantics (REQ-7). Document
      the three tiers at the call site: auto-pick (gated), `--only-tracks`
      (narrowed, still gated), explicit run/dispatch (ungated).
- [ ] Task 3: Thread the flag from `lc worker run`'s invocation path;
      confirm `worker_dispatch` already bypasses or make it consistent.
- [ ] Task 4: Regression — `lc worker start --sync-and-work --only-tracks N`
      on an `Auto Run: no` track still claims nothing (this is the
      documented behaviour and must not change).
- [ ] Task 5: Update SKILL.md only where it is genuinely imprecise; the
      substance stays, since the code is what moves (AC-11).

**Impact**: A human naming a track gets a run; the unattended queue stays
conservative.

## Phase 7: Marker ownership in DB→FS writes (item e)

**Problem**: DB→FS writers treat every column as authoritative. The API
server's `syncTrackToFile` overwrote this track's author-committed
`**Auto Run**: no` with the DB's `yes`, and the same row's empty
`author`/`created_by_email` mean a full regeneration would blank real
markers (as seen on AM-10098).
**Solution**: An explicit ownership split, applied to **both** writers.

- [ ] Task 1: Failing test (AC-12) — DB row `{auto_run: true, author: '',
      created_by_email: ''}` pulled onto an `index.md` holding
      `**Auto Run**: no`, `**Author**: AM`, `**Created By**: …` leaves all
      three unchanged, with `# H1`, `Problem`, `Type` intact.
- [ ] Task 2: Failing test (AC-13) — machine-owned markers still sync:
      a changed `lane_status`/`progress_percent` does update `**Lane**`
      and `**Progress**`. Guards against over-correcting into a writer
      that syncs nothing.
- [ ] Task 3: Introduce one shared ownership table (author-owned: `H1`,
      `Problem`, `Type`, `Author`, `Created By`, `Auto Run`, `Merge Mode`,
      `Depends On`; machine-owned: `Lane`, `Lane Status`, `Progress`,
      `Phase`) in a single module consumed by both
      `updateIndexMDFromDB` and `syncTrackToFile`, so the two cannot
      drift. Cross-reference `conductor/services/track-doc-digest.mjs`,
      which already enumerates stable markers, and reuse it if it fits
      rather than adding a parallel list.
- [ ] Task 4: Never let a null/empty DB column blank a populated marker,
      independent of ownership (REQ-8).
- [ ] Task 5: Note the relationship to track 1081 (summary-marker
      corruption) and AM-10093's R4 path; if this makes either's guard
      redundant, say so rather than leaving two overlapping mechanisms
      unexplained.
- [ ] Task 6: Verify in situ on the original specimen (AC-25): this
      track's `index.md` stays `**Auto Run**: no` and its DB row stays
      `f` across a full worker sync cycle.
- [ ] Task 7: Investigate whether `auto_run` should be author-owned in the
      DB direction too — i.e. whether track creation's unconditional
      `**Auto Run**: yes` (`ui/server/utils.mjs`) is right, given a
      deleted junk track's default is what poisoned this row. Record the
      finding; fix only if it is this track's to fix.

**Impact**: The lane-state/marker corruption path named in the gate's own
framing is closed, and the specimen that proved it is verified fixed.

## Phase 8: Post-merge staleness — make the existing alarm audible (item f)

**Problem**: Merges never restart the worker/API, so merged fixes keep
"shipping dead" — the proximate cause of (e)'s recurrence. A detector
already exists but has **never fired** in a 3.9 GB log.
**Solution**: Diagnose the silence first, then route the verdict somewhere
human-visible and close the loop. Do not build a second detector.

- [ ] Task 1: Diagnose why `classifyWorkerStaleness` never fires. Leading
      candidates: `code_sha` null at registration, `commitsBehind`/
      `touchedFiles` never populated, or the call site unreachable in
      local-api mode. Write the root cause here before changing anything.
- [ ] Task 2: Failing test — a worker whose `code_sha` predates a commit
      touching `conductor/services/**` is classified `critical` and the
      verdict is surfaced outside `.sync.log` (AC-20).
- [ ] Task 3: Surface it where it is seen: done-lane merge output, a track
      comment, and/or a UI badge. Pick one primary channel and justify it
      — a warning nobody reads is the defect, not the fix.
- [ ] Task 4: Close the loop in the merge action — restart worker/API
      after a successful merge, or emit the Task 3 warning. Decide
      restart-vs-warn explicitly: an automatic restart mid-merge risks
      killing concurrently-running lane actions, so prefer warn + an
      explicit `lc worker restart` affordance unless proven safe.
      Record the decision.
- [ ] Task 5: End-to-end verification (AC-21) against a real merge, with
      the observed result recorded (pids before/after, or the warning
      text). Restart the processes before verifying — this project's own
      quality-gate rules exist because stale processes have produced false
      passes here repeatedly.

**Impact**: A merged fix either takes effect or says loudly that it has
not.

## Phase 9: `Depends On` requires `done:success` (item h) + log rotation (item i)

**Problem (h)**: The auto-launch gate accepts lane `done` alone, so a
dependency sitting at `done:queue` — quality-gated but **not merged** —
releases its dependents. This roadmap chains via `Depends On`, and
`AM-10098` depends on this track.
**Problem (i)**: 5 GB of unrotated logs (3.9 G + 1.1 G) with no rotation
logic; the image this gates is specified as a 16 GB VM.

- [ ] Task 1: Failing test (AC-22) — a track with `**Depends On**: N`
      stays queued while N is `done:queue` and launches once N is
      `done:success`; an unknown dependency stays blocked (fails closed).
- [ ] Task 2: Tighten the gate to `lane === 'done' && lane_action_status
      === 'success'`, reusing `dependency-resume.mjs`'s predicate rather
      than writing a second copy — the two gates disagreeing is the
      actual defect.
- [ ] Task 3: Check for other `=== 'done'` / `!== 'done'` lane
      comparisons that mean "shipped" and are similarly too weak; fix or
      document each.
- [ ] Task 4 *(item (i), droppable — confirm with the author first)*:
      Add size-based rotation for `conductor/.sync*.log` and `ui/.api.log`
      with a sane default cap, applied where `bin/lc.mjs` sets up the
      spawn redirect and/or in `conductor/services/logger.mjs`.
- [ ] Task 5 *(item (i))*: Verify by driving real output past the
      threshold and confirming the directory stays under cap (AC-23).
      Decide whether to truncate the existing 3.9 G/1.1 G files as a
      one-off operational step — call it out, do not do it silently.

**Impact**: Dependency chains mean "shipped"; the appliance does not fill
its own disk.

## Phase 10: The gate itself

**Problem**: The preceding phases are the work; this phase is the
*decision* this track exists to make.
**Solution**: Run the real gate and record a verdict with evidence.

- [ ] Task 1: Run every command in `conductor/quality-gate.md` and record
      actual output (AC-24). Treat its pre-ticked boxes as a checklist to
      execute, not a report to trust.
- [ ] Task 2: Full vitest + full node:test, from inside a worktree, with
      before/after `workflow.json` shas and a clean orphan-process check
      (REQ-15, AC-2, AC-24).
- [ ] Task 3: Walk AC-1…AC-25 and mark each with the evidence that
      satisfies it. Any AC without recorded evidence blocks `done`.
- [ ] Task 4: Stub scan across changed code paths; a hit inside anything
      this plan marks `[x]` is a FAIL.
- [ ] Task 5: Note in `conversation.md` that AM-10089's `done:success` was
      false, so the board's history reflects reality.
- [ ] Task 6: Confirm the two explicitly deferred items are still
      deferred and unchecked — AM-10098's REQ-2 (LAN-reachable
      unauthenticated bind, owned by the standalone track) and any
      `local-api-e2e` quarantine. Per spec Non-Goals, neither may be
      presented as satisfied here, and this track cannot reach 100% while
      claiming flake-freedom it only skipped.

**Impact**: A defensible yes/no on whether a marketplace image may ship.
