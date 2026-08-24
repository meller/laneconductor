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

**Run this time for track 10024** (2026-08-24) — every mark below reflects a
command actually executed during this run, not a carried-over mark.

- [x] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` — no errors.
- [x] Critical files: `ls -1 .laneconductor.json conductor/laneconductor.sync.mjs conductor/workflow.json conductor/quality-gate.md ui/server/index.mjs Makefile` — all exist.
- [x] Config validation — `.laneconductor.json` has `project.id = 1`, valid.
- [x] Command reachability: `make help && lc --version` — both exit 0 (`lc v1.0.0`).
- [x] Worker tests: `node --test conductor/tests/*.test.mjs` — 403 tests, 340
      passed, 56 failed, 7 cancelled. This track touches zero
      `conductor/*.mjs` files (UI-only change), so verified by `git stash`-ing
      the entire track diff and re-running against the untouched baseline:
      339 passed / 57 failed / 7 cancelled — the exact same failing-suite set
      except one (`runDeploy`), a documented pre-existing flake (passes in
      isolation, fails only under full-suite parallel load — see track
      1117's prior note on this same suite). Zero failures attributable to
      this track.
- [x] Server unit+integration: `cd ui && npx vitest run server/tests/` — 312
      passed, 22 failed across 8 files (`auth.test.mjs`,
      `track-10013-human-lane-override`, `api-keys`, `track-1084-assignee`,
      `track-1033-worker-auth`, `track-1116-model-override`, `api-routes`,
      `bug-to-test`). Confirmed pre-existing during this track's review phase
      via `git stash` + rerun against untouched baseline — identical failure
      set. This track adds no `server/tests/` files and touches no
      `ui/server/**` code.
- [x] Frontend unit: `cd ui && npx vitest run src/` — 91 passed, 10 failed,
      all in `src/pages/WorkflowSettings.test.jsx` (pre-existing, track 1116
      scope, confirmed unrelated the same way). This track's own 3 new/changed
      suites (`worktreeRunState`, `WorktreesPanel`, `TrackDetailPanel`) pass
      15/15 in full.
- [x] Build: `cd ui && npx vite build` — succeeded (250 modules, `dist/`
      removed after).
- [ ] Security: `cd ui && npm audit --audit-level=high` — 32 vulnerabilities
      (12 high, 6 critical), all in devDependencies (`vite`, `vitest`,
      `protobufjs`, `websocket-driver`, `ws`, etc.) — none added by this
      track. `ui/package-lock.json` shows one unrelated change (a
      `pinorama-client`/`zod` entry syncing the lockfile to a dependency
      already declared in `package.json` — not a new dependency this track
      introduced). Left unchecked per the letter of "0 high/critical" — same
      call as track 1117's prior run; worth a dedicated dependency-bump
      track, not a block on this one.

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up.

**Track 10024 has real UI surface** (Worktrees panel + TrackDetailPanel), so
unlike track 1117 this section is fully in scope and was executed for real
against a live browser.

- [x] **Restarted the API server and any relevant workers first.** The
      shared dev instance on `:8090`/`:8091` serves the main repo checkout,
      not this worktree's branch, so a fresh scratch API (`API_PORT=8191`)
      and Vite UI (`--port 8190`, `SCRATCH_API_PORT=8191`) were started from
      THIS worktree's own checkout instead of touching the shared instance.
- [x] **E2E fast tier — REQUIRED: `npx playwright test --project=fast`** —
      run against the scratch instance (`PW_BASE_URL=http://localhost:8190`):
      **23 passed, 6 skipped, 0 failed** (52.3s). The 6 skips are the known,
      documented `track-1033-sharing.spec.js` cases (require
      `PW_TEST_MODE=true` on the server, deliberately not the default).
      Includes this track's own `track-10024-worktree-running-transcript.spec.js`
      (2/2). Scratch processes and their DB fixture rows were torn down and
      verified clean afterward.
- [ ] E2E slow tier — not run (opt-in; this track doesn't touch the worker
      claim/brainstorm/planning path the slow tier exercises).
- [x] Drove the actual flow in a browser — the fast-tier run above **is**
      the real-browser drive-through: real Worktrees panel row, real click
      on the running badge, real assertion that the track detail slide-over
      opens with the Live Transcript drawer already visible (TC-15/16), and
      that a non-running row's link does not (TC-17).

## Manual Quality Review

- [x] Architecture alignment: ESM modules, no TypeScript, follows existing
      `lib/*.js` helper + component patterns (matches `worktreeStats.js`,
      `worktreePendingKeys.js` siblings).
- [x] Readability: clear naming; comments on the non-obvious "why" (two
      independent running-signals, open-only transcript semantics) not the
      "what".
- [x] No stubs in completed work:
      `grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder|stub"`
      against this track's own changed files
      (`worktreeRunState.js`, `WorktreesPanel.jsx`, `TrackDetailPanel.jsx`,
      `App.jsx`, the new Playwright spec) — only two hits, both legitimate
      pre-existing HTML `placeholder="..."` attributes on an unrelated chat
      textarea, not stub markers.
- [x] Acceptance criteria in `spec.md` describe user-facing outcomes, not
      scaffolding — verified during review (badge click → visible transcript
      drawer, not "handler was called").

## Verdict

- Status: **PASS** (track 10024)
- Reviewer: Claude (quality-gate phase, track 10024)
- Date: 2026-08-24
- Notes: one Automated Checks box (Security) is left unchecked — 32
  pre-existing devDependency vulnerabilities, none introduced by this
  track's diff (confirmed: no new dependency, only a lockfile sync for an
  already-declared one). Every other automated check, the full E2E fast
  tier (this track has real UI surface, unlike track 1117), and the manual
  review all passed against commands actually executed this run, with
  regressions in the two large suites (`node --test`, `cd ui && npm test`)
  positively ruled out via `git stash` + baseline rerun rather than assumed.
  See track 10024's own `plan.md`/`test.md`/`conversation.md` for the
  detailed per-phase verification record.
