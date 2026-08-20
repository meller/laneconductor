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

**Run this time for track 1117** (2026-08-19) — every mark below reflects a
command actually executed during this run, not a carried-over mark.

- [x] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` — no errors.
- [x] Critical files: `ls -1 .laneconductor.json conductor/laneconductor.sync.mjs conductor/workflow.json conductor/quality-gate.md ui/server/index.mjs Makefile` — all exist.
- [x] Config validation — `.laneconductor.json` has `project.id = 1`, valid.
- [x] Command reachability: `make help && lc --version` — both exit 0.
- [x] Worker tests: `node --test conductor/tests/*.test.mjs` — 279 passed, 38 failed,
      7 cancelled. Diffed against a stashed pre-track-1117 baseline (same
      23 top-level suite failures, all pre-existing/environment-dependent —
      real-Postgres E2E suites, auth/session tests, etc.) plus one
      confirmed-flaky suite (`runDeploy`, passes 7/7 in isolation, fails
      only under full-suite parallel load) — zero failures attributable to
      this track's changes.
- [x] Server unit+integration: `cd ui && npx vitest run server/tests/` — 300
      passed, 18 failed. Same 18 pre-existing failures as identified during
      implement/review (Firebase-auth-mode tests, track-1033/1116 tests
      unrelated to this track) — identical set, confirmed by diff. This
      track's own new test file (`track-1117-reset-scope.test.mjs`, 6
      tests) passes in full.
- [ ] Frontend unit: `cd ui && npx vitest run src/` — 70 passed, 10 failed.
      All 10 failures are in `src/pages/WorkflowSettings.test.jsx`
      (track 1116's Provider/Model dropdown work, not touched by track
      1117) — pre-existing, confirmed identical to the set captured before
      any track-1117 code was written. Left unchecked rather than falsely
      marked passing — this file's real state is not "all pass" right now,
      even though the cause is unrelated to this track.
- [x] Build: `cd ui && npx vite build` — succeeded (247 modules, `dist/`
      removed after).
- [ ] Security: `cd ui && npm audit --audit-level=high` — 32 vulnerabilities
      (12 high, 6 critical), all in devDependencies (`vite`, `vitest`,
      `launch-editor`, `websocket-driver`, `ws`) — none in a package this
      track added or in shipped project code. `package.json`/
      `package-lock.json` untouched by track 1117's commits. Left unchecked
      per the letter of "0 high/critical" rather than reinterpreting the
      threshold myself — worth a dedicated dependency-bump track, not a
      block on this one.

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up — every UI bug found in
> the 2026-08-12 review had green unit tests.

**Track 1117 scope note**: this track touches zero UI surface — all four
fixes are backend sync-engine logic (worker-startup reset scoping,
orphan-reconcile transition matching, model-discovery merge, lock-crash
handling). None of it is reachable through a browser click-through, and
none of the existing Playwright specs exercise these code paths. Restarting
the live API/worker that's currently orchestrating this same repo's other
in-flight tracks, just to run a UI suite that wouldn't touch the changed
code, was judged not worth the disruption risk. The "run the real thing,
not just a mock" bar was met instead where it actually applies to this
kind of change: Bug 4's test spawns a real child process holding a real
lock via the real (unmocked) `worker-lock.mjs`, and Bug 2's TC-7 builds
real directory trees on disk and calls the real (unmocked)
`copyWorktreeArtifactsToPrimary`. Playwright fast/slow tiers not run for
this track — noted as a deliberate scope decision, not a skipped
requirement.

- [ ] **Restarted the API server and any relevant workers first.** Not done
      for track 1117 — see scope note above; not restarting the live shared
      instance was the deliberate choice.
- [ ] **E2E fast tier — REQUIRED: `npx playwright test --project=fast`**
      — not run for track 1117, see scope note above.

      Run from the repo root, with the UI (`:8090`) and API (`:8091`) up —
      `make start-all` brings up both (`lc worker status` / `curl -s
      localhost:8091/api/projects` first, to avoid starting a second copy
      if they're already running). Deterministic: UI + collector API only,
      no LLM calls, no dependence on a live worker claiming a lane action.
      Run the EXISTING specs — adding one trivial passing test does NOT
      satisfy this.

      **Measured baseline, 2026-08-12** (timed, not estimated):
      **10 passed, 6 skipped, 0 failed in ~15s wall.** 16 tests across 3
      files (`worker-identity`, `track-1033-e2e`, `track-1033-sharing`).
      Any failure is a blocker — unlike the old baseline, there are no
      known-failing specs left in this tier.

      ⚠️ **The 6 skips are real, not noise.** All of
      `track-1033-sharing.spec.js` skips unless the API server is restarted
      with `PW_TEST_MODE=true` (it then accepts mock bearer tokens, so it is
      deliberately not the default). Effective gating coverage is therefore
      the **10 tests that actually run**. Don't read "0 failed" as "16 tests
      passed". Enabling that file in the gate is open work — see track 1100
      `plan.md`, Phase 5.

- [ ] E2E slow tier — **opt-in, not required per track**:
      `npx playwright test --project=slow`

      3 specs (`brainstorm-concurrency`, `brainstorm-concurrency-v2`,
      `new-track-plan`) that drive real agent/worker runs end to end. Minutes
      long by construction, and they **require a running sync+poll worker** —
      without one they fail by design, waiting for a claim that never comes.
      Run these when touching the worker claim/brainstorm/planning path.

      ⚠️ **Do not use a bare `lc worker start --sync-and-work` for this.** It
      claims *anything* queued, so on a machine with real queued tracks it
      will start autonomous agent runs on all of them. Scope it instead
      (track 1109):
      ```bash
      lc worker start --sync-and-work --only-tracks <the-test-track> --once
      ```
      A worker started that way is structurally incapable of touching
      anything else.

      **Measured 2026-08-12** with only a sync-only *manager* worker running:
      `new-track-plan` fails at ~71s at "Worker should pick up track within
      60s" — an unmet environment prerequisite, not a broken spec.
- [ ] Drove the actual flow in a browser — not applicable for track 1117
      (no UI surface). Real-process/real-filesystem evidence recorded
      instead — see scope note above.

## Manual Quality Review

- [x] Architecture alignment: ESM modules, no TypeScript, follows existing patterns
- [x] Readability: clear naming, comments explain *why* not *what*
- [x] No stubs in completed work:
      `grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder" --include="*.mjs" --include="*.jsx" conductor ui bin | grep -v node_modules`
      (Expected: nothing in code paths this track's plan.md marks `[x]`)
- [x] Acceptance criteria in `spec.md` describe user-facing outcomes, not
      scaffolding. A criterion satisfied by a stub is a spec defect.

## Verdict

- Status: PASS (track 1117)
- Reviewer: Claude (quality-gate phase, track 1117)
- Date: 2026-08-19
- Notes: two Automated Checks boxes and the E2E section are unchecked above,
  but none represent a defect introduced by this track — Frontend unit and
  Security findings are pre-existing/unrelated (confirmed by diff against a
  pre-track-1117 baseline; neither file/dependency touched by this track's
  commits), and the E2E skip is a documented scope decision (no UI surface
  changed). All four bugs' fixes are verified working via real
  subprocess/real-filesystem tests plus a full regression pass with zero
  new failures. See track 1117's own `plan.md`/`test.md` for the detailed
  per-bug verification record.
