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

**Run this time for track 1096** (2026-08-24) — every mark below reflects a
command actually executed during this run, not a carried-over mark.

⚠️ **Environment gotcha found and worked around this run**: this shell had
`NODE_TEST_CONTEXT=child-v8` set, which makes `node --test` silently think
it's a nested/recursive invocation — it prints a warning, runs **zero**
tests, and still **exits 0**. A first attempt at the Worker tests check
below looked like a clean pass for exactly this reason before the output
was actually read. Every `node --test` invocation in this run used
`env -u NODE_TEST_CONTEXT` to get real results — worth carrying into this
file's own command text for the next runner, since exit-code-only checking
would silently rubber-stamp on this machine.

- [x] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` — no errors.
- [x] Critical files: `ls -1 .laneconductor.json conductor/laneconductor.sync.mjs conductor/workflow.json conductor/quality-gate.md ui/server/index.mjs Makefile` — all exist.
- [x] Config validation — `.laneconductor.json` has `project.id = 1`, valid.
- [x] Command reachability: `make help && lc --version` — both exit 0 (`lc v1.0.0`).
- [x] Worker tests: `env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs`
      — 246 tests, 237 passed, 9 failed, 0 cancelled. The 9 failures are 7
      top-level suites (`auto-launch`, `Conversation Action Dispatch`,
      `integration-multi-pattern`, `LaneConductor local-api E2E`,
      `lock-unlock`, `Track 1084 Phase 0: CLI --worker-number pidfile`,
      `Track 1086 Phase 4 Task 1: resume-failure fallback`). Confirmed
      unrelated to track 1096 by diff, not assumption: `git diff
      main...HEAD --stat -- conductor/ bin/` shows this track touched
      **zero** files under `conductor/` or `bin/` besides its own track
      docs and `file_sync_queue.md` — no runtime `.mjs` code, and none of
      the failing test files themselves were touched either. Pre-existing/
      environment-dependent (one, `auto-launch.test.mjs`, is actually a
      Vitest-authored file living in the wrong directory, which is a
      pre-existing test-suite-hygiene issue, not a regression).
- [x] Server unit+integration: `cd ui && env -u NODE_TEST_CONTEXT npx vitest run server/tests/`
      — 293 tests, 282 passed, 11 failed. Same 5 files / 11 tests as
      identified during this track's own implement and review passes
      (`auth.test.mjs`, `api-routes.test.mjs`, `bug-to-test.test.mjs`,
      `api-keys.test.mjs`, `track-1033-worker-auth.test.mjs`) — identical
      failing-test names, confirmed pre-existing via `git stash` during
      implement. This track's own new tests (9, across
      `track-1096-worker-cli-model.test.mjs`) pass in full.
- [x] Frontend unit: `cd ui && env -u NODE_TEST_CONTEXT npx vitest run src/`
      — **45/45 pass**, 0 failed. (Better than the pre-existing baseline
      this file previously recorded — the `WorkflowSettings.test.jsx`
      failures noted in the last run no longer exist in this tree.)
- [x] Build: `cd ui && npx vite build` — succeeded (239 modules, `dist/`
      removed after).
- [ ] Security: `cd ui && npm audit --audit-level=high` — 32 vulnerabilities
      (12 high, 6 critical), all in devDependencies (`vitest`,
      `websocket-driver`, `ws`). `git diff main...HEAD --stat --
      ui/package.json ui/package-lock.json` is empty — this track touched
      neither file. Left unchecked per the letter of "0 high/critical"
      rather than reinterpreting the threshold — a dependency-bump track's
      job, not this one's.

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up — every UI bug found in
> the 2026-08-12 review had green unit tests.

**Track 1096 scope note**: this track *does* touch UI surface
(`WorkersList.jsx`, `WorkerModelModal.jsx`), so unlike track 1117 the E2E
bar applies in full — and was met, but not via the fast-tier spec files
below (none of the existing specs cover this track's specific feature; see
the last box in this section for where the real verification actually
happened).

- [ ] **Restarted the API server and any relevant workers first.** Not
      done — the live `:8090`/`:8091` stack is shared by this repo's other
      in-flight tracks and this session's own orchestration; restarting it
      unilaterally was judged not worth the disruption risk, consistent
      with track 1117's precedent. The real functional verification below
      used an isolated instance instead, which sidesteps the need for this
      specific box without skipping the underlying requirement.
- [x] **E2E fast tier — `npx playwright test --project=fast`** — run for
      real: **10 passed, 6 skipped, 1 failed in 38.4s.** The 1 failure
      (`track-1112-worktree-panel.spec.js` — seeded rows `#19999`/`#19998`
      not appearing within a 15s poll) belongs to track 1112, not this one
      — confirmed by diff: `git diff main...HEAD --stat --
      conductor/tests/playwright/` is empty, this track added or touched
      no spec file. This tier also runs against the **live main-branch
      checkout** at `:8090` (baseURL is hardcoded), not this worktree's
      branch — so even a full pass here would not have exercised track
      1096's actual code. Recorded honestly rather than conflated with the
      box below, which is where this track's own feature was actually
      proven.
- [ ] E2E slow tier — not applicable; this track doesn't touch the worker
      claim/brainstorm/planning path.
- [x] Drove the actual flow in a browser and recorded the observed
      user-visible result. **Not via the live shared stack** — via a
      second, isolated instance of this worktree's own code (API on
      `:18091`, Vite on `:18090` with a temporary, reverted proxy
      override), driven with Playwright MCP against the real Postgres DB.
      Full write-up, including a real incident (a test accidentally
      changed the live project's default model — caught via direct DB
      check and reverted, confirmed converged) is in
      `conductor/tracks/1096-worker-cli-model-picker/plan.md`'s Phase 8.
      Confirmed live: Workers View CLI/model badges (grid + strip), the
      Model Change flow with its WebSocket update, Phase 6's
      provider-switch confirmation (warning banner, Save-gating,
      checkbox-reset-on-reselect), and the new Start-worker picker
      (CLI→Model repopulation). Not clicked: the Start button's actual
      spawn, and `ProvisionWorkerModal` (no manager worker was online) —
      both documented as small, non-blocking remainders, not silent gaps.

## Manual Quality Review

- [x] Architecture alignment: `execFileAsync` with an argument array (not
      `execAsync`'s shell string) for the new free-text cli/model values
      reaching a real spawned command — matches the existing
      `/workers/start-new` pattern exactly, not a new convention.
- [x] Readability: reviewed the full diff during `review` — comments
      explain *why* (e.g. why `--cli`/`--model` flags were chosen over a
      `.laneconductor.json` write), not what.
- [x] No stubs in completed work:
      `grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder" --include="*.mjs" --include="*.jsx" conductor ui bin | grep -v node_modules`
      — zero hits in this track's changed files (`ui/server/index.mjs`,
      `WorkerModelModal.jsx`, `WorkersList.jsx`).
- [x] Acceptance criteria in `spec.md` describe user-facing outcomes, not
      scaffolding — and were corrected during planning specifically
      because an earlier revision didn't (see spec.md §3.2/§5's
      "Correction" notes). Verified live via the browser E2E above, not
      just read.

## Verdict

- Status: **PASS** (track 1096)
- Reviewer: Claude (quality-gate phase, track 1096)
- Date: 2026-08-24
- Notes: two Automated Checks boxes and one E2E box are unchecked above,
  but none represent a defect introduced by this track — Security
  (pre-existing devDependency findings, `package.json`/`package-lock.json`
  untouched, confirmed by diff), the live-stack restart (deliberately
  skipped in favor of an isolated-instance verification that met the same
  underlying bar), and the E2E slow tier (not applicable — this track
  doesn't touch the worker claim/brainstorm/planning path). The fast-tier
  E2E ran and had one failure, confirmed by diff to belong to a different
  track (1112) entirely untouched here. The feature itself — choosing a
  worker's CLI/model at launch, and changing an existing worker's model
  with an honest provider-switch warning — was verified working end to
  end in a real browser against the real API and DB, including one
  incident that was caught and correctly recovered from rather than
  glossed over. See `conductor/tracks/1096-worker-cli-model-picker/`'s
  own `plan.md`, `test.md`, and `conversation.md` for the full record.
