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

- [x] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` (Expected: no errors)
- [x] Critical files: `ls -1 .laneconductor.json conductor/laneconductor.sync.mjs conductor/workflow.json conductor/quality-gate.md ui/server/index.mjs Makefile` (Expected: all exist)
- [x] Config validation: `node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('./.laneconductor.json')); if(!c.project.id) throw new Error('missing project.id')"` (Expected: valid)
- [x] Command reachability: `make help && lc --version` (Expected: exit 0)
- [x] Worker tests: `node --test conductor/tests/*.test.mjs` (Expected: no NEW failures vs. the known pre-existing set — 242 passed, 7 pre-existing)
- [x] Server unit+integration: `cd ui && npx vitest run server/tests/` (Expected: no NEW failures vs. the known pre-existing set — 289 passed, 11 pre-existing)
- [x] Frontend unit: `cd ui && npx vitest run src/` (Expected: all pass — 50/50 passed)
- [x] Build: `cd ui && npx vite build` (Expected: succeeds; then `rm -rf ui/dist`)
- [x] Security: `cd ui && npm audit --audit-level=high` (Expected: 0 high/critical in project code)

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up — every UI bug found in
> the 2026-08-12 review had green unit tests.

- [x] **Restarted the API server and any relevant workers first.** They do
      not hot-reload; verifying against a process older than your change
      tests the old code. Use `make api-stop && make api-start`, and check
      `lsof -i :8091 -sTCP:LISTEN` — a stale listener not tracked by the
      pidfile has repeatedly survived `make api-stop`.
- [x] **E2E fast tier — REQUIRED: `npx playwright test --project=fast`**

      Run from the repo root, with the UI (`:8090`) and API (`:8091`) up.
      Deterministic: UI + collector API only, no LLM calls, no dependence on
      a live worker claiming a lane action. Run the EXISTING specs — adding
      one trivial passing test does NOT satisfy this.

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
- [x] Drove the actual flow in a browser and recorded the observed
      user-visible result (screenshot, or the real API/DB response).

## Manual Quality Review

- [x] Architecture alignment: ESM modules, no TypeScript, follows existing patterns
- [x] Readability: clear naming, comments explain *why* not *what*
- [x] No stubs in completed work:
      `grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder" --include="*.mjs" --include="*.jsx" conductor ui bin | grep -v node_modules`
      (Expected: nothing in code paths this track's plan.md marks `[x]`)
- [x] Acceptance criteria in `spec.md` describe user-facing outcomes, not
      scaffolding. A criterion satisfied by a stub is a spec defect.

## Verdict

- Status: PASS
- Reviewer: Antigravity Quality Gate Agent
- Date: 2026-08-17
