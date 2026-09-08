# Spec: Revert to a previous deployed version (hosting only)

## Problem Statement

A bad deploy has no undo. The CI/CD Release tab dispatches `deploy` /
`build_and_deploy` to a worker, which runs `runDeploy` →
`bash scripts/deploy.sh <env>` in the worker's own checkout. That always ships
whatever is at `HEAD` right now. Going back to the previous release means a
human hand-checking-out an old commit and re-running the script, which also
re-runs the forward-only Atlas migration step — the thing you least want to
touch during an incident.

Planning verified three facts that shape the whole design:

1. **The "Build Artifact" toggle does not target the artifact's commit.** The
   worker sets `CONDUCTOR_BUILD_ID` / `CONDUCTOR_BUILD_COMMIT` /
   `CONDUCTOR_BUILD_TRACKS` into the deploy child process env
   (`conductor/laneconductor.sync.mjs`, the `deploy` and `build_and_deploy`
   handlers) and `bin/lc.mjs` does the same for `lc deploy --build`. Nothing
   reads them. `scripts/deploy.sh` never mentions them, and `runDeploy` runs
   the command with `cwd: projectRoot` at the live HEAD. A build-artifact
   deploy therefore ships HEAD, identically to a HEAD deploy. The build chip
   in the dispatch history is a label, not a claim about what shipped.
2. **Nothing records which commit a deploy actually shipped.**
   `worker_dispatch` has `payload` (client-supplied at dispatch time, and the
   browser cannot know the worker's HEAD), `status`, and `result`. The
   worker's terminal `PATCH /worker-dispatch/:id` only sends `status` and
   `result`, and the endpoint only accepts those two.
3. **The automated deploy has exactly two hosting steps and no function
   step.** `scripts/deploy.sh` production is `[1/4]` Atlas migrations,
   `[2/4]` Cloud Functions *skipped and decommissioned*, `[3/4]`
   `firebase deploy --only hosting:app`, `[4/4]`
   `firebase deploy --only hosting:landing`. So "revert the hosting half" is
   the whole of the automated deploy minus the migration step — there is no
   third moving part being silently left behind.

## Solution

Add a **Revert to this version** action on eligible rows of the CI/CD Release
tab's dispatch history. It reverts **Firebase Hosting only**, by asking
Firebase Hosting to re-release a version it already holds — not by rebuilding
or redeploying anything.

Firebase Hosting keeps every prior version immutable and re-releasable. The
mechanism is the Hosting REST API:

```
GET  https://firebasehosting.googleapis.com/v1beta1/sites/{SITE}/releases?pageSize=N
POST https://firebasehosting.googleapis.com/v1beta1/sites/{SITE}/releases?versionName=sites/{SITE}/versions/{VERSION_ID}
```

authorised with `gcloud auth print-access-token`. `gcloud` is already a hard
dependency of the deploy path (`scripts/deploy.sh` fetches `DATABASE_URL` from
Secret Manager with it), so the worker that can deploy can also revert.

`firebase hosting:clone` was evaluated and rejected as the mechanism: its help
text states both operands are `<siteId>:<channelId>`, so it clones a channel's
current version, and cannot address a specific historical version.

### Rejected alternative: rebuild from the recorded commit

Checking the target commit into a scratch worktree and re-running the deploy
was rejected as the v1 mechanism:

- It re-runs `scripts/deploy.sh`, whose first step is `atlas migrate apply`.
  Suppressing that needs a new hosting-only code path in the script anyway, so
  it is not the cheaper option it looks like.
- It re-resolves dependencies (`npm ci` against an old lockfile) and rebuilds,
  so it produces *a* build of that commit, not *the bytes that were live*.
  During an incident those are not the same guarantee.
- It is slow (minutes) where a Hosting re-release is seconds.
- The provider-agnostic argument does not hold here: the rebuild path ends in
  `firebase deploy` regardless, so it is no less Firebase-specific.

It is not forbidden forever — the config shape below leaves room for a second
provider — but it is out of this track.

### Database rollback is out of scope, decided not deferred

The revert action must never run `atlas migrate apply`, never invoke
`scripts/deploy.sh`, and never touch `runDeploy`. This is enforced by test,
not just by convention (see TC-4.4). The UI states "hosting only" on the
action itself, and the confirmation dialog names any migrations that landed
between the target commit and current `HEAD` so the operator sees exactly what
is *not* being undone. If DB rollback is ever wanted it needs its own track;
the per-migration reversibility judgement is a different and harder problem.

## Requirements

### Provenance

- **REQ-1**: `worker_dispatch` gains `deployed_commit text` and
  `deploy_meta jsonb`, both nullable, via an Atlas migration.
- **REQ-2**: `PATCH /worker-dispatch/:id` accepts optional `deployed_commit`
  and `deploy_meta` alongside `status`/`result`, and persists them. Omitting
  them leaves the existing values untouched (a `claimed` PATCH must not blank
  a later `done` PATCH's data, and vice versa).
- **REQ-3**: On every `deploy` and `build_and_deploy` dispatch the worker
  resolves the commit it is about to ship — `git rev-parse HEAD` in the
  project root — and reports it on the terminal PATCH. This applies to a
  build-artifact deploy too: it records the commit that was *actually*
  shipped (HEAD), not the artifact's `git.commit`, which per Problem fact 1 is
  not what runs. When a build artifact is attached, its id and its
  `git.commit` are recorded separately in `deploy_meta.build` so the
  discrepancy is visible rather than papered over.
- **REQ-4**: After a successful deploy, for an environment that has Firebase
  Hosting rollback configured, the worker records the live release of each
  configured site into `deploy_meta.hosting` as
  `{ "<siteId>": { "version": "sites/…/versions/…", "releaseTime": "<ISO>" } }`.
  This is best-effort: a failure records `deploy_meta.hosting_error` and never
  fails the deploy dispatch.
- **REQ-5**: The worker records the deploy log's file name in
  `deploy_meta.log_file`, and
  `GET /api/projects/:id/dispatch/:dispatchId/log` prefers that file when
  present. (Today the endpoint returns the newest `deploy-<env>-*.log` by
  mtime for *every* row, so every history row shows the same latest log. This
  requirement fixes that for rows written from now on and is a prerequisite
  for a revert run's own log being viewable.)

### Configuration

- **REQ-6**: `conductor/deploy.json` gains an optional per-environment
  `rollback` block. First supported provider:

  ```json
  "rollback": {
    "provider": "firebase-hosting",
    "project": "laneconductor-site",
    "sites": ["laneconductor-app", "laneconductor-site"]
  }
  ```

  A `{ "provider": "command", "command": "..." }` shape is parsed and
  validated but its execution is explicitly not implemented in this track; a
  dispatch naming it fails with a clear message rather than silently doing
  nothing.
- **REQ-7**: An environment with no `rollback` block has no revert action.
  The UI shows the control disabled with a tooltip explaining what to
  configure. It never falls back to a rebuild or to a plain redeploy.

### Revertibility

- **REQ-8**: A new service `conductor/services/deploy-rollback.mjs` decides
  revertibility from a dispatch row plus its environment's rollback config,
  returning `{ revertible, reason }`. A row is revertible when all hold: the
  action is `deploy` or `build_and_deploy`; `status` is `done`; the
  environment has a rollback config; and a Hosting version can be resolved for
  every configured site. It is **not** revertible when it is the newest
  successful deploy for that environment — that version is already live, so
  the reason reads "already the live version".
- **REQ-9**: Rows recorded before this track shipped have no
  `deploy_meta.hosting`. For those, the target version is resolved by asking
  Hosting for the newest release of each site whose `releaseTime` is at or
  before the dispatch's completion time. When that succeeds the row is
  revertible and the preview says the commit is unknown, showing the release
  time instead of a commit. Existing history is therefore usable, honestly
  labelled.
- **REQ-10**: `GET /api/projects/:id/dispatch/:dispatchId/revert-preview`
  returns everything the confirmation dialog needs: `revertible`, `reason`,
  `targetCommit`, `shortCommit`, `buildId`, `deployedAt`, `environment`,
  `sites` (each with the version that would be released), and
  `migrationsSince`.
- **REQ-11**: `migrationsSince` is the list of `.sql` files under
  `migrations/` added between the target commit and current `HEAD`
  (`git diff --name-only <commit>..HEAD -- migrations/`). Empty when the
  commit is unknown or not present locally, with `migrationsUnknown: true` so
  the dialog can say "could not be determined" instead of implying "none".

### The revert action

- **REQ-12**: New dispatch action `revert-deploy`, payload
  `{ environment, sourceDispatchId }`.
- **REQ-13**: `POST /api/projects/:id/dispatch` re-validates revertibility
  server-side for `revert-deploy` and rejects with 400 and the reason when it
  does not hold. The client's view is never trusted.
- **REQ-14**: The worker handles `revert-deploy` explicitly, before the
  generic lane-action fallback, and for each configured site POSTs a new
  release pointing at the resolved version. It writes its own
  `conductor/logs/deploy-<env>-<ts>.log` so the existing log viewer works, and
  reports `deployed_commit` (the source row's commit, when known) plus
  `deploy_meta.revert_of = <sourceDispatchId>`.
- **REQ-15**: The `revert-deploy` handler must not call `runDeploy`, must not
  spawn `scripts/deploy.sh`, and must not invoke `atlas`.
- **REQ-16**: A partial failure across sites is reported as `failed` naming
  which sites were re-released and which were not. It does not attempt to roll
  its own partial work back.
- **REQ-17**: `GET /api/projects/:id/dispatch/:dispatchId/log` accepts
  `revert-deploy` (today it 400s on any action outside
  `deploy`/`build_and_deploy`/`build`).

### UI

- **REQ-18**: Each dispatch-history row that is a deploy shows a commit chip
  when `deployed_commit` is recorded.
- **REQ-19**: Each eligible row shows a **Revert to this** control labelled so
  that "hosting only" is visible without opening anything. Ineligible rows
  show it disabled with the reason as its tooltip.
- **REQ-20**: Activating it opens a confirmation dialog stating the target
  (short commit or release time), the sites that will be re-released, and a
  prominent, non-dismissible statement that the database is not rolled back.
  When `migrationsSince` is non-empty the dialog lists those migration files
  under a stronger warning; when `migrationsUnknown` it says so rather than
  showing an empty list.
- **REQ-21**: Confirming dispatches `revert-deploy`. The resulting row appears
  in the history like any other dispatch, with its own log.

### Docs

- **REQ-22**: `conductor/deployment-stack.md` documents the `rollback` block,
  the hosting-only boundary, and the explicit exclusion of DB rollback.

## Acceptance Criteria

- [ ] After a deploy dispatched from the Release tab, its history row shows
      the short commit that was deployed.
- [ ] A previously-successful deploy row offers a **Revert to this** control;
      the newest successful deploy for that environment does not, and says
      why.
- [ ] Activating that control shows a confirmation naming the target version,
      the hosting sites affected, and stating plainly that the database is not
      rolled back.
- [ ] When migrations landed between the target commit and HEAD, the
      confirmation lists those migration files by name.
- [ ] Confirming produces a new history row that completes, and the live
      Firebase Hosting site serves the earlier version's content afterwards —
      verified by observing the served response, not by reading code.
- [ ] The revert run's own log is viewable from its history row, and shows the
      per-site release calls.
- [ ] A revert of an environment with no `rollback` configured is impossible
      from the UI and rejected by the API.
- [ ] A revert run performs no database migration: its log contains no Atlas
      invocation, and `scripts/deploy.sh` is not executed.
- [ ] History rows created before this track are still offerable for revert
      when Hosting holds a matching release, and their confirmation says the
      commit is unknown rather than showing a wrong one.

## Data Model Changes

```sql
ALTER TABLE "public"."worker_dispatch"
  ADD COLUMN "deployed_commit" text NULL,
  ADD COLUMN "deploy_meta" jsonb NULL;
```

`deploy_meta` shape (all keys optional):

```json
{
  "log_file": "deploy-production-1757000000000.log",
  "build": { "id": "build-20260810-163119", "commit": "81cb428…" },
  "hosting": {
    "laneconductor-app": { "version": "sites/laneconductor-app/versions/abc", "releaseTime": "2026-09-08T…Z" }
  },
  "hosting_error": "gcloud auth print-access-token failed: …",
  "revert_of": 412
}
```

## API Contracts

`GET /api/projects/:id/dispatch/:dispatchId/revert-preview` →

```json
{
  "revertible": true,
  "reason": null,
  "environment": "production",
  "targetCommit": "81cb428aeddc…",
  "shortCommit": "81cb428",
  "buildId": "build-20260810-163119",
  "deployedAt": "2026-09-08T10:12:00.000Z",
  "sites": [
    { "site": "laneconductor-app", "version": "sites/laneconductor-app/versions/abc", "releaseTime": "…" }
  ],
  "migrationsSince": ["migrations/20260907120000_unique_api_token_per_user.sql"],
  "migrationsUnknown": false
}
```

`POST /api/projects/:id/dispatch` →
`{ "worker_id": 3, "action": "revert-deploy", "payload": { "environment": "production", "sourceDispatchId": 412 } }`

## Out of Scope

- Rolling back database migrations, in any form. Decided, not deferred.
- Rolling back Cloud Functions — the automated deploy does not deploy them
  (`[2/4]` is decommissioned).
- Making the "Build Artifact" toggle actually deploy the artifact's commit.
  Real, confirmed defect (see conversation.md); needs its own track.
- Fixing the `firebase hosting:clone`-style channel workflows, staging
  environments (`scripts/deploy.sh staging` exits 1 today), or any non-Firebase
  hosting provider.
- The `{ "provider": "command" }` rollback shape's execution.
