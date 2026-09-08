# Tests: Track 10082 — Revert to a previous deployed version (hosting only)

## Test Commands

```bash
# Worker-side unit/integration (node:test, zero deps)
node --test conductor/tests/track-10082-deploy-provenance.test.mjs
node --test conductor/tests/track-10082-hosting-release.test.mjs
node --test conductor/tests/track-10082-deploy-rollback.test.mjs
node --test conductor/tests/track-10082-revert-dispatch.test.mjs

# API / server-side (vitest + supertest)
cd ui && npx vitest run server/tests/track-10082-revert-preview.test.mjs
cd ui && npx vitest run server/tests/track-10082-dispatch-patch-provenance.test.mjs

# Full suites before calling any phase done
node --test conductor/tests/
cd ui && npm test
```

`node --test` can leave orphaned worker/mock child processes behind. Check
`ps aux | grep laneconductor` after a failed run and kill strays before
trusting a later result.

## Test Cases

### Phase 1 — Provenance (`track-10082-deploy-provenance.test.mjs`, `track-10082-dispatch-patch-provenance.test.mjs`)

- [ ] TC-1.1: `PATCH /worker-dispatch/:id` with `{status, deployed_commit, deploy_meta}` — expected: 200, and a re-read of the row returns both values.
- [ ] TC-1.2: `PATCH` with `{status: 'claimed'}` only, on a row that already has `deployed_commit` — expected: the existing `deployed_commit` and `deploy_meta` are unchanged, not nulled.
- [ ] TC-1.3: `PATCH` with `deploy_meta` set to a string or array — expected: 400, row unchanged.
- [ ] TC-1.4: Worker `deploy` dispatch against a mock collector in a temp git repo — expected: the terminal PATCH body carries `deployed_commit` equal to that repo's `git rev-parse HEAD`.
- [ ] TC-1.5: Worker `deploy` dispatch with `payload.buildId` pointing at an artifact whose `git.commit` differs from HEAD — expected: `deployed_commit` is HEAD and `deploy_meta.build` records `{id, commit}` of the artifact. Asserts the spec's Problem fact 1 is recorded rather than hidden.
- [ ] TC-1.6: Worker `deploy` dispatch — expected: `deploy_meta.log_file` is the basename of the file `runDeploy` wrote, and that file exists in `conductor/logs/`.
- [ ] TC-1.7: `GET /api/projects/:id/dispatch/:dispatchId/log` on a row with `deploy_meta.log_file` — expected: returns that file's contents even when a newer `deploy-<env>-*.log` exists in the directory.
- [ ] TC-1.8: Same endpoint on a row with no `deploy_meta` — expected: falls back to today's newest-by-mtime behaviour, unchanged.
- [ ] TC-1.9: `GET /api/projects/:id/dispatch` — expected: `deployed_commit` and `deploy_meta` appear on the returned rows.

### Phase 2 — Hosting release client (`track-10082-hosting-release.test.mjs`)

Run against a local `node:http` mock of `firebasehosting.googleapis.com`, with
the base URL injectable. No live credentials in automated tests.

- [ ] TC-2.1: `currentRelease` on a site with three releases — expected: the newest by `releaseTime`, as `{version, releaseTime}`.
- [ ] TC-2.2: `currentRelease` on a site with no releases — expected: `null`, no throw.
- [ ] TC-2.3: `findReleaseAt` with a time between release 2 and release 3 — expected: release 2 (newest at or before), not release 3.
- [ ] TC-2.4: `findReleaseAt` with a time before every release — expected: `null`.
- [ ] TC-2.5: `createRelease` — expected: issues `POST .../releases?versionName=<version>` and returns the created release body.
- [ ] TC-2.6: Any call receiving a 403 — expected: throws an Error whose message contains the status and the response body. Explicitly not a silent `null`.
- [ ] TC-2.7: `getAccessToken` when `gcloud` is absent from PATH — expected: throws a message naming `gcloud`.
- [ ] TC-2.8: Worker `deploy` with a `firebase-hosting` rollback config and a mock Hosting API — expected: `deploy_meta.hosting` has an entry per configured site.
- [ ] TC-2.9: Same, but the Hosting API returns 500 — expected: dispatch status is still `done`, and `deploy_meta.hosting_error` is set. A capture failure must not fail the deploy.
- [ ] TC-2.10: Worker `deploy` for an environment with no rollback config — expected: no Hosting calls made at all.

### Phase 3 — Revertibility and preview (`track-10082-deploy-rollback.test.mjs`, `track-10082-revert-preview.test.mjs`)

- [ ] TC-3.1: `getRollbackConfig` on the shipped `conductor/deploy.json` for `production` — expected: the `firebase-hosting` block with both sites.
- [ ] TC-3.2: `getRollbackConfig` for `staging` — expected: `null`.
- [ ] TC-3.3: `getRollbackConfig` on `{provider:'firebase-hosting', sites: []}` — expected: rejected as invalid, not returned.
- [ ] TC-3.4: `isRevertible` on a `build` action row — expected: `{revertible:false}`, reason names that it is not a deploy.
- [ ] TC-3.5: `isRevertible` on a `failed` deploy row — expected: false, reason names the failure.
- [ ] TC-3.6: `isRevertible` on the newest successful deploy for the environment — expected: false, reason "already the live version".
- [ ] TC-3.7: `isRevertible` on an older successful deploy with a resolved version — expected: true.
- [ ] TC-3.8: `migrationsSince` where two `.sql` files were added after the target commit — expected: both filenames, `unknown:false`.
- [ ] TC-3.9: `migrationsSince` with a commit sha that is not in the repo — expected: `{files: [], unknown: true}`.
- [ ] TC-3.10: `revert-preview` on a row with `deploy_meta.hosting` — expected: `sites[]` versions come from the stored metadata, no `findReleaseAt` call is made.
- [ ] TC-3.11: `revert-preview` on a pre-existing row with no `deploy_meta` — expected: versions resolved via `findReleaseAt` at the row's completion time; `targetCommit` is null and the response says so.
- [ ] TC-3.12: `revert-preview` when the token call fails — expected: 200 with `revertible:false` and the reason, not a 500.

### Phase 4 — The revert dispatch (`track-10082-revert-dispatch.test.mjs`)

- [ ] TC-4.1: `POST /api/projects/:id/dispatch` with `revert-deploy` and no `sourceDispatchId` — expected: 400.
- [ ] TC-4.2: Same, pointing at the newest successful deploy — expected: 400 carrying the "already the live version" reason. Server-side re-validation, not client trust.
- [ ] TC-4.3: Same, pointing at an eligible older deploy — expected: 200 and a `pending` `worker_dispatch` row with action `revert-deploy`.
- [ ] TC-4.4: Worker processes a `revert-deploy` dispatch — expected: `createRelease` called once per configured site with the resolved version, **and** the deploy command from `deploy.json` was never spawned. Assert by spying on the spawn used by `runDeploy` and asserting zero calls, and by asserting the written log contains no `atlas` and no `deploy.sh`. This is REQ-15's enforcement.
- [ ] TC-4.5: After a successful revert — expected: the row's `status` is `done`, `deploy_meta.revert_of` equals the source dispatch id, and `deployed_commit` equals the source row's commit.
- [ ] TC-4.6: A revert where site 1 succeeds and site 2 returns 500 — expected: `status: 'failed'`, and `result` names both the re-released site and the failed one. No compensating call is made against site 1.
- [ ] TC-4.7: A revert whose environment's config is `{provider:'command'}` — expected: `failed` with a "not implemented" message, and no Hosting calls.
- [ ] TC-4.8: The worker writes `conductor/logs/deploy-<env>-<ts>.log` — expected: the file exists, matches the pattern the log endpoint scans for, and contains one line per site release.
- [ ] TC-4.9: `GET /api/projects/:id/dispatch/:dispatchId/log` on a `revert-deploy` row — expected: 200 with the revert log, not the 400 that unknown actions get today.
- [ ] TC-4.10: An unrelated unknown action still reaches the generic lane-action fallback — expected: unchanged behaviour, confirming the new handler was inserted without swallowing others.

### Phase 5 — UI (`ui/src/components/__tests__/` vitest, plus a Playwright spec)

- [ ] TC-5.1: A history row with `deployed_commit` — expected: the short sha is rendered and the full sha is its `title`.
- [ ] TC-5.2: An eligible row — expected: a **Revert to this** control is present and its visible text or adjacent label says hosting only.
- [ ] TC-5.3: An ineligible row — expected: the control is disabled and its tooltip is the preview's `reason`.
- [ ] TC-5.4: Preview is fetched on activation only — expected: rendering twenty rows and letting the five-second poll fire issues zero `revert-preview` requests.
- [ ] TC-5.5: Confirmation dialog with `migrationsSince: ['migrations/2026…_x.sql']` — expected: that filename is visible, alongside the statement that the database is not rolled back.
- [ ] TC-5.6: Confirmation dialog with `migrationsUnknown: true` — expected: text saying it could not be determined; no empty "none" list.
- [ ] TC-5.7: Confirming — expected: one `POST /api/projects/:id/dispatch` with action `revert-deploy` and the row's id as `sourceDispatchId`.
- [ ] TC-5.8: Cancelling — expected: no request issued.
- [ ] TC-5.9 (Playwright, `conductor/tests/playwright/track-10082-revert-ui.spec.js`): against a seeded history, activate revert on an older deploy row, assert the dialog's hosting-only statement is visible, confirm, and assert a new `revert-deploy` row appears in the list.

## Manual / real-product verification

These are required before the track can be marked done. Unit tests cannot show
that a rollback actually rolled anything back.

- [ ] MV-1: Restart the worker and API server first. Verifying against a
      process started before the change is a false pass.
- [ ] MV-2: Record `currentRelease` for `laneconductor-app` and keep it. This
      is the escape hatch for MV-3.
- [ ] MV-3: From the Release tab, revert to the immediately-preceding release.
      Confirm the live app site serves the earlier content — record the
      observed response or the console's release list, not just the dispatch's
      exit status. Then revert forward to the version from MV-2 and confirm
      the site is back.
- [ ] MV-4: Open the revert row's log from the history and confirm it shows the
      per-site release calls, and that it is that row's own log rather than the
      newest deploy's.
- [ ] MV-5: Confirm the revert log contains no Atlas invocation and no
      `scripts/deploy.sh` execution, and that no migration was applied.
- [ ] MV-6: Confirm one of the two pre-existing build-artifact deploy rows in
      this repo either offers revert with the commit shown as unknown, or is
      disabled with a reason — never with a commit it cannot actually justify.

## Acceptance Criteria

- [ ] All test commands above pass, run in full, with output observed.
- [ ] MV-1 through MV-6 performed and their observations recorded in
      `conversation.md`.
- [ ] `grep -rniE "not yet implemented|TODO|FIXME|FFU" conductor/services/hosting-release.mjs conductor/services/deploy-rollback.mjs` returns nothing.
- [ ] No regression in the existing deploy path: `node --test conductor/tests/deploy-runner.test.mjs` and `ui/server/tests/track-1085-dispatch.test.mjs`, `track-1098-build-dispatch.test.mjs`, `track-1087-deploy-log.test.mjs` all still pass.
