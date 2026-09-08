# Track AM-10082: Revert to a previous deployed version from the CI/CD dispatch history

Five phases. Each is independently commitable and leaves the Release tab
working. Phases 1–2 make the history record enough to revert *from*; phase 3
decides revertibility; phase 4 performs the revert; phase 5 surfaces it.

Verification note that applies to every phase: the sync worker and the API
server do not hot-reload. Restart both (`lc worker restart`, `lc api stop &&
lc api start`) before checking any behaviour, or you will be testing the old
process.

---

## Phase 1: Record what each deploy actually shipped

**Problem**: `worker_dispatch` stores only the client-supplied payload, a
status, and a result string. Nothing says which commit went out, so there is
nothing to revert *to*.

**Solution**: Two nullable columns, an extended PATCH contract, and a worker
that fills them in.

- [ ] Task 1.1: Atlas migration
  `migrations/20260908XXXXXX_add_dispatch_deploy_provenance.sql` adding
  `worker_dispatch.deployed_commit text NULL` and
  `worker_dispatch.deploy_meta jsonb NULL`. Regenerate `migrations/atlas.sum`
  (`atlas migrate hash`) — an unhashed migration breaks every later
  `atlas migrate apply`.
- [ ] Task 1.2: `PATCH /worker-dispatch/:id` (`ui/server/index.mjs`) accepts
  optional `deployed_commit` and `deploy_meta`. Build the `UPDATE` from only
  the keys actually present in the body, so a `claimed` PATCH does not blank
  what a later `done` PATCH writes, and vice versa. Reject a `deploy_meta`
  that is not a plain object with 400.
- [ ] Task 1.3: In `conductor/laneconductor.sync.mjs`, resolve the deploy
  commit before running the deploy — `git rev-parse HEAD` in the project root,
  reusing `getGitMetadata` from `ui/server/build-manager.mjs` rather than a
  second `execSync` — for both the `deploy` and `build_and_deploy` handlers.
- [ ] Task 1.4: Send `deployed_commit` and `deploy_meta` on the terminal PATCH
  of both handlers. `deploy_meta.log_file` is `basename(result.logFile)`.
  `deploy_meta.build` is `{ id, commit }` when a build artifact was attached,
  recording the artifact's own commit separately from the shipped one (they
  differ today — see spec Problem fact 1).
- [ ] Task 1.5: `GET /api/projects/:id/dispatch/:dispatchId/log` prefers
  `deploy_meta.log_file` when present, falling back to today's
  newest-by-mtime scan for older rows.
- [ ] Task 1.6: `DispatchHistory` in `ui/src/components/CICDView.jsx` renders a
  commit chip (monospace short sha, `title` = full sha) on rows that have
  `deployed_commit`. The existing `GET /api/projects/:id/dispatch` already
  selects `wd.*`, so no query change is needed — confirm that rather than
  assuming it.

**Impact**: Every new deploy row states what shipped and which log is its own.
No behaviour changes for existing rows.

---

## Phase 2: Capture the Firebase Hosting release per deploy

**Problem**: The commit identifies *source*; a Hosting rollback needs a
*version*. Nothing records which Hosting version each deploy produced.

**Solution**: A small Hosting REST client, a `rollback` config block, and a
best-effort post-deploy capture.

- [ ] Task 2.1: `conductor/services/hosting-release.mjs`, zero new
  dependencies (`node:child_process` for the token, global `fetch` for the
  API):
    - [ ] `getAccessToken()` — `gcloud auth print-access-token`, trimmed;
      throws a message naming `gcloud` on failure.
    - [ ] `listReleases(site, token, { pageSize })` — `GET .../sites/{site}/releases`.
    - [ ] `currentRelease(site, token)` — newest release as
      `{ version, releaseTime }` or `null`.
    - [ ] `findReleaseAt(site, token, isoTime)` — newest release with
      `releaseTime <= isoTime`; this is what makes pre-existing history
      revertible (REQ-9).
    - [ ] `createRelease(site, token, versionName)` — `POST
      .../sites/{site}/releases?versionName=…`; returns the created release.
    - [ ] Every function throws with the HTTP status and response body on a
      non-2xx, never returns a silent `null` for a real error.
- [ ] Task 2.2: Add the `rollback` block to `conductor/deploy.json` for
  `production` and `prod`: provider `firebase-hosting`, project
  `laneconductor-site`, sites `laneconductor-app` and `laneconductor-site`
  (the two `.web.app` hosts `scripts/deploy.sh` names). Leave `staging`
  without one — it is not a configured environment today.
- [ ] Task 2.3: In the worker's `deploy` / `build_and_deploy` handlers, after
  a successful deploy and only when the environment has a `firebase-hosting`
  rollback config, call `currentRelease` per site and merge the results into
  `deploy_meta.hosting`. Wrap the whole capture in a try/catch that records
  `deploy_meta.hosting_error` and logs a warning — a capture failure must
  never turn a successful deploy into a failed dispatch.
- [ ] Task 2.4: Verify the client against the real API before building
  anything on top of it: `listReleases('laneconductor-app', token)` returns
  real releases with version names. Do **not** exercise `createRelease`
  against a live site here; phase 4 does that safely.

**Impact**: New deploys carry a re-releasable Hosting version. Existing rows
still work via `findReleaseAt`.

---

## Phase 3: Revertibility resolution and the preview endpoint

**Problem**: The UI needs to know, per row, whether revert is possible, what
it would target, and what it would *not* undo — without duplicating that logic
in the browser.

**Solution**: One service that answers it, one endpoint that exposes it.

- [ ] Task 3.1: `conductor/services/deploy-rollback.mjs`:
    - [ ] `getRollbackConfig(deployConfig, env)` — returns the block or `null`;
      validates `provider`, and for `firebase-hosting` that `sites` is a
      non-empty array of strings.
    - [ ] `isRevertible(row, { rollbackConfig, isNewestSuccessful })` →
      `{ revertible, reason }`. Reasons are user-facing strings: not a deploy,
      did not succeed, no rollback configured for this environment, already
      the live version, no hosting version could be resolved.
    - [ ] `migrationsSince(repoPath, targetCommit)` → `{ files, unknown }`.
      Runs `git diff --name-only <commit>..HEAD -- migrations/`, keeps `.sql`
      files, and returns `unknown: true` (with empty `files`) when the commit
      is absent or the command fails — never an empty list that reads as
      "no migrations".
- [ ] Task 3.2: `GET /api/projects/:id/dispatch/:dispatchId/revert-preview` in
  `ui/server/index.mjs`. Loads the row and the project's `deploy.json`,
  determines whether it is the newest successful deploy for its environment,
  resolves each site's target version (from `deploy_meta.hosting`, else
  `findReleaseAt` against the row's completion time), and returns the REQ-10
  shape.
- [ ] Task 3.3: When token acquisition or a Hosting call fails, the endpoint
  returns `revertible: false` with the underlying reason rather than a 500 —
  a credential problem should read as "can't revert, here's why", not as a
  broken page.

**Impact**: A single server-side authority for "can this be reverted, and to
what". Nothing user-visible yet.

---

## Phase 4: The `revert-deploy` dispatch, end to end

**Problem**: Nothing performs the revert.

**Solution**: A new dispatch action, validated server-side, handled explicitly
by the worker, that only ever creates Hosting releases.

- [ ] Task 4.1: `POST /api/projects/:id/dispatch` accepts
  `action: 'revert-deploy'`, requires `payload.environment` and
  `payload.sourceDispatchId`, and re-runs phase 3's revertibility check
  server-side, returning 400 with the reason when it fails.
- [ ] Task 4.2: Worker handler for `revert-deploy` in
  `conductor/laneconductor.sync.mjs`, placed with the other explicit action
  handlers and **before** the generic lane-action fallback (same position and
  reasoning as the `remove-worktree` handler).
    - [ ] Opens `conductor/logs/deploy-<env>-<Date.now()>.log` and writes to it
      throughout, matching the naming `DeployLogView`'s endpoint scans for.
    - [ ] Re-resolves the target version per site rather than trusting the
      payload, then calls `createRelease` for each.
    - [ ] Sets `updateWorkerHeartbeat('busy', …)` in the same
      `"<verb> <env> (dispatch <id>)"` shape `ui/src/lib/workerTaskInfo.js`
      parses, and back to `idle` on completion.
    - [ ] Terminal PATCH carries `status`, a human-readable `result`,
      `deployed_commit` (the source row's, when known) and
      `deploy_meta` with `revert_of` and `log_file`.
- [ ] Task 4.3: Partial failure — some sites re-released, others not — reports
  `failed` and names both groups in `result` and the log. No attempt to undo
  the sites that did succeed.
- [ ] Task 4.4: The `{ "provider": "command" }` shape is rejected at dispatch
  with an explicit "not implemented in this track" message. It must not
  silently succeed.
- [ ] Task 4.5: `GET /api/projects/:id/dispatch/:dispatchId/log` adds
  `revert-deploy` to its permitted actions.
- [ ] Task 4.6: Verify safely on the real project. Record
  `currentRelease` for `laneconductor-app`, dispatch a revert to the
  immediately-preceding release, confirm the served content changes, then
  revert forward again to the version recorded at the start. Capture what was
  observed — served response or console version list — not just the exit code.

**Impact**: A revert can be performed. Still only reachable by dispatching by
hand until phase 5.

---

## Phase 5: The Release tab action and its confirmation

**Problem**: The capability is not reachable from the UI, and a one-click
rollback that does not explain the hosting-only boundary is a trap.

**Solution**: A per-row control plus a confirmation that states what is and is
not being undone.

- [ ] Task 5.1: In `DispatchHistory`, add a **Revert to this** control to every
  `deploy` / `build_and_deploy` row. Label it so "hosting only" is legible
  without opening the dialog.
- [ ] Task 5.2: Fetch `revert-preview` for a row when its control is
  activated, not for all twenty rows on every five-second poll — the preview
  makes outbound Hosting calls.
- [ ] Task 5.3: Ineligible rows render the control disabled with the preview's
  `reason` as the tooltip.
- [ ] Task 5.4: Confirmation dialog showing the target (short commit, or
  release time when the commit is unknown), the sites to be re-released, and a
  prominent statement that the database is not rolled back. When
  `migrationsSince` is non-empty, list the files under a stronger warning;
  when `migrationsUnknown`, say it could not be determined rather than
  rendering an empty list.
- [ ] Task 5.5: Confirming POSTs the `revert-deploy` dispatch to the same
  worker selection the Deploy panel uses, and the new row appears in history
  on the next poll.
- [ ] Task 5.6: Document the `rollback` block, the hosting-only boundary, and
  the deliberate DB-rollback exclusion in
  `conductor/deployment-stack.md`.

**Impact**: Rollback is one click, and the click cannot be made without seeing
what it does not cover.
