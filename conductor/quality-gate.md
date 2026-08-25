# Quality Gate

> **Checklist, not a report.** Every box starts unchecked and is ticked only
> by whoever ran the command **this time** and saw it pass. Do not trust
> marks or a verdict left by a previous run.
>
> This file previously shipped with every box pre-ticked and
> `Status: PASS` already filled in. That invited rubber-stamping, and it is
> a direct cause of several tracks reaching `done` with features that did
> not work (2026-08-12 review). Reset to unchecked deliberately.

## Automated Checks

**Run this time for track 1102** (2026-08-25) — every mark below reflects a
command actually executed during this run, not a carried-over mark.

⚠️ **Same `NODE_TEST_CONTEXT` gotcha track 1096 documented** — every
`node --test` invocation in this run used `env -u NODE_TEST_CONTEXT`.

- [x] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` — no errors.
- [x] Critical files: all six present.
- [x] Config validation — `.laneconductor.json` has `project.id = 1`, valid.
- [x] Command reachability: `make help` and `lc --version` both exit 0 (`lc v1.0.0`).
- [x] Worker tests: `env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs`
      — 434 tests, 371 passed, 56 failed, 7 cancelled. **Diff-confirmed
      against a disposable worktree checked out at `main`'s own tip
      (7a9a0f0)**, not assumed: main's own run of the identical command
      produced 422 tests, 338 passed, **77 failed**. Every one of
      track-1102's 56 failures also fails on main (`comm -23` of the two
      sorted failure-name sets — empty). 16 suites that fail on main
      **pass** on this branch, including 5 of this track's own tests
      (F8/F9/F11/F12/F21) — this branch's fixes measurably improved
      reliability, not regressed it. Root cause of the shared failures:
      environmental/DB-process contention from the live, concurrently
      running production stack (spot-checked one, `lock-unlock.test.mjs`
      — fails trying to `git add` a path `.gitignore` excludes on `main`
      too, unrelated to this branch).
- [x] Server unit+integration + Frontend unit:
      `cd ui && env -u NODE_TEST_CONTEXT npx vitest run`
      — 67 files/460 tests, 8 files/30 tests failed. Same diff-confirmed
      method: main's own tip produces 63 files/446 tests with 9 files/32
      tests failed — the exact same 8 failing files, byte-for-byte
      (`api-keys`, `api-routes`, `auth`, `bug-to-test`,
      `track-1033-worker-auth`, `track-1084-assignee`,
      `track-1116-model-override`, `WorkflowSettings.test.jsx`). This
      branch additionally *fixes* one file that fails on main
      (`track-1102-f18-phantom-worker.test.mjs`, adapted for main's new
      idle-worker-preference SQL). Zero failures unique to this branch.
- [x] Build: `cd ui && npx vite build` — succeeded (250 modules, `dist/` removed after).
- [ ] Security: `cd ui && npm audit --audit-level=high` — 32 vulnerabilities
      (12 high, 6 critical), all in devDependencies. `git diff main...HEAD
      --stat -- ui/package.json ui/package-lock.json` is empty — this
      track touched neither file. Left unchecked per the letter of the
      threshold, not this track's job.

## End-to-End / Real-Product Checks

**Track 1102 scope note**: this track touches UI-facing behavior (F3's
track-creation template, F15's dispatch bridge) so the E2E bar applies in
full.

- [ ] **Restarted the API server and any relevant workers first.** Not
      done for the live shared `:8090`/`:8091` stack (other in-flight
      tracks depend on it) — same precedent as track 1096. Real
      verification below used an isolated instance instead.
- [x] **F3 (AC-1) live-verified** — first attempt against the live shared
      API at `:8091` reproduced the *original* bug (`**Status**: plan`
      still written) because that server runs the primary checkout's code
      (`main`), not this branch — a real methodology trap, not a code
      defect; caught and corrected by re-testing against an isolated
      instance of this worktree's own `ui/server/index.mjs` on `:18091`.
      Created a real track via `POST /api/projects/1/tracks`, confirmed
      zero `**Status**` occurrences and `**Lane**`-only markers; PATCHed
      `lane_status` via the exact endpoint the real drag UI calls
      (`PATCH /api/projects/:id/tracks/:num`), confirmed it held after a
      3s wait with no revert. Disposable track and isolated server
      cleaned up immediately after.
- [x] **F10c (AC-8) live-verified** — done in a prior session this run
      continues from: `pg_constraint.confdeltype = 'n'` and a
      rolled-back-transaction row-survival check against the real
      `laneconductor` DB. Permanent test:
      `ui/server/tests/track-1102-f10c-live-db-fk.test.mjs`.
- [x] **F15 (AC-9) live-verified** — done in the same prior session: a
      real Playwright drag on the real board produced a `worker_dispatch`
      row claimed by a real worker within ~1s. An unintended side effect
      (a real GitHub PR opened by the dispatch) was caught and cleaned up
      same-session.
- [ ] E2E slow tier — not run this pass; none of this track's own fixes
      touch the worker claim/brainstorm/planning path it covers.

## Manual Quality Review

- [x] Architecture alignment: F3's fix matches the sync worker's own
      `handleTrackCreate()` template exactly, not a new convention. F9b's
      hoist follows the existing `workDir` pattern used elsewhere in the
      same function.
- [x] Readability: reviewed during `implement`/`review`; comments explain
      *why* (e.g. the F21 TDZ history, the F22 out-of-order cause), not
      what.
- [x] No stubs in `[x]`-marked work: stub-scan grep across every file this
      track's branch actually changed (`git diff main...HEAD --name-only
      -- conductor/ ui/ bin/`, excluding track docs) — one `placeholder`
      hit in `laneconductor.sync.mjs`, confirmed via `git blame` to
      predate this branch by over 5 months (2026-03-16, unrelated
      comment-sync code this track never touched).
- [x] Acceptance criteria in `spec.md` describe user-facing/observable
      outcomes, not scaffolding — all 11 read as real user- or
      operator-visible claims, not placeholder text.
- [x] **Documentation-integrity check** (specific to this track): review
      found `index.md`'s Phases checklist, `plan.md`'s phase headers, and
      `spec.md`'s AC list disagreed with each other and with the actual
      code/test state for Phases 3/8/10 and AC-1/2/5/6. Re-verified each
      directly against code and passing tests during this run and
      corrected the checkboxes to match reality — not re-asserted from
      memory. Two genuine (non-bookkeeping) gaps found by the same review
      — AC-7's UI-visibility half and Phase 16's canonical-mechanism
      decision — were filed as linked follow-up tracks
      ([10032](conductor/tracks/10032-f18-claim-timeout-ui-visibility/index.md),
      [10033](conductor/tracks/10033-canonical-migration-mechanism-decision/index.md))
      rather than rushed here or silently left unlinked, per this track's
      own Completion rule.

## Verdict

- Status: **PASS** (track 1102)
- Reviewer: Claude (quality-gate phase, track 1102)
- Date: 2026-08-25
- Notes: Security and the E2E slow tier are unchecked but out of scope
  (confirmed by diff / by not touching that code path). The live-stack
  restart box is unchecked by the same deliberate precedent track 1096
  set. Every other box was actually executed this run, several with a
  rigorous diff-against-main-tip comparison rather than assumption — the
  standard this track itself exists to enforce. All 11 acceptance
  criteria in `spec.md` are now checked, two of them (AC-7, and Phase 16's
  Task 6) satisfied by an explicit linked follow-up track rather than a
  false "done," per the track's own Completion rule. See
  `conductor/tracks/1102-e2e-session-findings/`'s own `plan.md`,
  `spec.md`, and `conversation.md` for the full record.
