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

- [ ] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` (Expected: no errors)
- [ ] Critical files: `ls -1 .laneconductor.json conductor/laneconductor.sync.mjs conductor/workflow.json conductor/quality-gate.md ui/server/index.mjs Makefile` (Expected: all exist)
- [ ] Config validation: `node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('./.laneconductor.json')); if(!c.project.id) throw new Error('missing project.id')"` (Expected: valid)
- [ ] Command reachability: `make help && lc --version` (Expected: exit 0)
- [ ] Worker tests: `node --test conductor/tests/*.test.mjs` (Expected: no NEW failures vs. the known pre-existing set — record the count)
- [ ] Server unit+integration: `cd ui && npx vitest run server/tests/` (Expected: no NEW failures vs. the known pre-existing set — record the count)
- [ ] Frontend unit: `cd ui && npx vitest run src/` (Expected: all pass)
- [ ] Build: `cd ui && npx vite build` (Expected: succeeds; then `rm -rf ui/dist`)
- [ ] Security: `cd ui && npm audit --audit-level=high` (Expected: 0 high/critical)

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up — every UI bug found in
> the 2026-08-12 review had green unit tests.

- [ ] **Restarted the API server and any relevant workers first.** They do
      not hot-reload; verifying against a process older than your change
      tests the old code. Use `make api-stop && make api-start`, and check
      `lsof -i :8091 -sTCP:LISTEN` — a stale listener not tracked by the
      pidfile has repeatedly survived `make api-stop`.
- [ ] E2E suite: `npx playwright test` (19 specs across 6 files in
      `conductor/tests/playwright/`). Run the EXISTING specs — adding one
      trivial passing test does NOT satisfy this.
      **Known state as of 2026-08-12** (measured, not assumed):
      `worker-identity.spec.js` alone finishes in ~45s with **3 passed, 3
      failed** — pre-existing failures asserting on worker-card visibility
      badges, unrelated to any current track. The full suite did not finish
      inside a 3-minute budget: it is **not hanging**, it is sequential by
      config (`workers: 1`) with a 180s default per-test timeout, and two
      specs raise their own to 300s while polling real agent runs — so
      worst case is tens of minutes.
      **Until [track 1100](tracks/1100-fix-playwright-e2e-suite/index.md)
      lands**: run per-file rather than the whole suite, compare against
      this baseline instead of expecting all-green, and treat a *new*
      failure as a blocker while the 3 known ones are not.
- [ ] Drove the actual flow in a browser and recorded the observed
      user-visible result (screenshot, or the real API/DB response).

## Manual Quality Review

- [ ] Architecture alignment: ESM modules, no TypeScript, follows existing patterns
- [ ] Readability: clear naming, comments explain *why* not *what*
- [ ] No stubs in completed work:
      `grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder" --include="*.mjs" --include="*.jsx" conductor ui bin | grep -v node_modules`
      (Expected: nothing in code paths this track's plan.md marks `[x]`)
- [ ] Acceptance criteria in `spec.md` describe user-facing outcomes, not
      scaffolding. A criterion satisfied by a stub is a spec defect.

## Verdict

- Status: PENDING — set to PASS/FAIL only after running the above
- Reviewer: —
- Date: —
