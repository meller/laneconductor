# Quality Gate

> **Checklist, not a report.** Every box starts unchecked and is ticked only
> by whoever ran the command **this time** and saw it pass. Do not trust
> marks or a verdict left by a previous run.
>
> This file previously shipped with every box pre-ticked and
> `Status: PASS` already filled in. That invited rubber-stamping, and it is
> a direct cause of several tracks reaching `done` with features that did
> not work (2026-08-12 review). Reset to unchecked deliberately.
>
> Per-track run details (what actually passed/failed for track NNN, and
> why) belong in that track's own `plan.md`/`conversation.md`, not here —
> this file is the reusable command reference every track's quality-gate
> phase runs, not a log of the last run.

## Automated Checks

- [ ] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` (Expected: no errors)
- [ ] Critical files exist: `ls -1 .laneconductor.json conductor/laneconductor.sync.mjs conductor/workflow.json conductor/quality-gate.md ui/server/index.mjs Makefile`
- [ ] Command reachability: `make help && lc --version`
- [ ] Worker unit tests: `env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs` (Expected: all pass — note `NODE_TEST_CONTEXT=child-v8` in some shells makes `node --test` silently run zero tests while still exiting 0; unset it first)
- [ ] Server unit+integration: `cd ui && env -u NODE_TEST_CONTEXT npx vitest run server/tests/` (Expected: all pass)
- [ ] Frontend unit: `cd ui && env -u NODE_TEST_CONTEXT npx vitest run src/` (Expected: all pass)
- [ ] Build: `cd ui && npx vite build` (Expected: succeeds)
- [ ] Security: `cd ui && npm audit --audit-level=high` (Expected: 0 high/critical in dependencies this track actually touched — diff `package.json`/`package-lock.json` before attributing pre-existing findings elsewhere)

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up — every UI bug found in
> the 2026-08-12 review had green unit tests.

- [ ] Restarted the API server and any relevant workers before verifying —
      they do not hot-reload, and testing against a stale process is a
      false pass.
- [ ] **E2E fast tier**: `npx playwright test --project=fast` (Expected:
      all pass — deterministic, UI + collector API only, no live worker
      dependency)
- [ ] **E2E slow tier**: `lc worker stop && npx playwright test --project=slow`
      (Expected: all pass). Track 10021: these specs bring their OWN
      throwaway worker (`conductor/tests/playwright/helpers/scoped-worker.mjs`),
      scoped to only the track(s) each spec creates — this tier no longer
      requires an ambient `lc worker start --sync-and-work` process and is
      CI-runnable. The one prerequisite is the opposite of the old one: an
      ambient worker, if running, must be **stopped** first — not because
      these specs need it absent to function, but because it would claim
      the tracks before the scoped worker does and re-pollute the
      `parallel_limit:1` concurrency assertion the way an ambient worker
      always used to.
- [ ] **E2E sharing spec**: `npx playwright test conductor/tests/playwright/track-1033-sharing.spec.js`
      (Expected: 6 passed, 0 skipped). Runs against a dedicated
      `PW_TEST_MODE` server on its own port
      (`conductor/tests/playwright/helpers/test-server.mjs`) — the shared
      `:8091` instance is never restarted or otherwise touched.
- [ ] If no E2E suite covers the change: drove the flow manually and
      recorded the observed user-visible result (screenshot, or real
      API/DB response) in the track's own `plan.md`.

## Manual Quality Review

- [ ] Architecture alignment: follows this project's established patterns
- [ ] Readability: clear naming, comments explain *why*
- [ ] No stubs in completed work:
      `grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder" --include="*.mjs" --include="*.jsx" conductor ui bin | grep -v node_modules`
      returns nothing in code paths marked `[x]`
- [ ] Acceptance criteria in `spec.md` describe user-facing outcomes, not
      scaffolding

## Verdict

- Status: <PENDING — set to PASS/FAIL only after running the above>
- Reviewer: <who/what ran it>
- Date: <ISO date of this run>
