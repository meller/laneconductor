# Track TU-10053: Port missing worker routes to the cloud function

Ordering rationale: the two structural blockers (worker identity, transactions)
and the schema gap come **before** any handler, because half the ported handlers
are meaningless without them. The live end-to-end run comes before the caveat
removal, because the caveats are the track's only user-visible promise and
removing them on unverified code is exactly the failure the acceptance criteria
guard against.

## Phase 1: Parity harness, routing, and schema groundwork

**Problem**: Nothing currently fails when the worker calls a route the cloud
function doesn't serve — that's why this gap reached production. And two
prerequisites (a missing rewrite, four missing columns) would make an otherwise
correct handler still fail.
**Solution**: Land the failing test first, then the routing and schema fixes it
depends on.

- [x] Task 1.1: Write `conductor/tests/cloud-route-parity.test.mjs`. It reads
      `conductor/laneconductor.sync.mjs`, extracts every collector path it calls
      (template literals normalised to concrete example paths), reads
      `cloud/functions/index.js` via `extractExpressRoutes` from
      `conductor/services/firebase-rewrites.mjs`, and asserts each worker path
      matches a registered cloud route. **Expect RED**: 11 families unmatched.
      Record the actual failure list in this file as the baseline.

      **RED baseline captured** — 15 unserved `(method, path)` pairs, which is
      the 11 families expanded per verb (session ×3, prespawn ×2, lock/unlock
      ×2, dispatch read ×2):

      ```
      GET    /api/projects/1/claimable-tracks
      POST   /conductor-files
      GET    /projects/1/workflow
      GET    /track/1
      POST   /track/1/lock
      POST   /track/1/unlock
      POST   /track/1/prespawn-block
      POST   /track/1/prespawn-block/reset
      GET    /track/1/session
      POST   /track/1/session
      DELETE /track/1/session
      POST   /tracks/claim-queue
      PATCH  /worker-dispatch/1
      GET    /worker/1/dispatch
      GET    /worker/1/dispatch/claimed
      ```
    - [x] Reuse `extractExpressRoutes` / `concreteExamplePath` rather than
          writing a second route parser — they exist and 10052's suite proves
          them.
    - [x] The Express-route → request-path match needs `:param` → segment
          matching (a `/track/:num` route must match `/track/10053`); write it
          as a small helper with its own unit cases.
- [x] Task 1.2: Add `/conductor-files` and `/conductor-files/**` to the
      `rewrites` array of **both** hosting targets in `firebase.json` (REQ-6).
- [x] Task 1.3: Add `/conductor-files` to `WORKER_PATHS` in
      `conductor/tests/firebase-rewrites.test.mjs`; confirm it fails before 1.2
      and passes after.
- [x] Task 1.4: Write the Atlas migration for the four `prespawn_block_*`
      columns (REQ-5). Generate it the repo's way (`make db-diff` / Prisma
      schema first, per `scripts/migrate.sh`'s `atlas-prisma.mjs` step) rather
      than hand-dropping a SQL file, so `atlas.sum` stays valid.
    - [x] Add the same four fields to `prisma/schema.prisma`, since Atlas
          derives the desired state from it.
    - [x] Run `./scripts/migrate.sh` against the local DB and confirm it
          applies cleanly and is a no-op on re-run.
- [x] Task 1.5: Verify cloud DB currency: `atlas migrate status` against the
      cloud `DATABASE_URL` (credentials via `scripts/migrate-prod.sh`'s Secret
      Manager path). Record which migrations are pending. If any are, apply
      them — this is the prerequisite the whole port assumes.
- [x] Task 1.6: Write the `CLAIMABLE_LANES` parity test (REQ-8): assert the
      literal list in `cloud/functions/index.js` equals the ESM
      `conductor/constants.mjs` export. **Expect RED** until Phase 3 adds the
      cloud copy.

**Impact**: The gap becomes a failing test instead of a production surprise.
`/conductor-files` becomes routable. The cloud DB gains the columns the
prespawn handler needs.

### Phase 1 findings

**The migration set is not replayable, and `migrate.sh` could not be used.**
Two pre-existing defects, both hit while verifying Task 1.4:

- `20260304181909_enable_rls.sql` adds an enum value (`'waiting'`) and creates
  an index referencing it **in the same transaction**, which Postgres rejects
  (`unsafe use of new value "waiting" of enum type`). A fresh database cannot
  be migrated from scratch at all — it dies on migration 7 of 34.
- `20260901133000_add_session_context_bounds.sql` (track 10047) uses bare
  `ADD COLUMN` for columns that `ui/server/migrations/014` already added out of
  band, so **the local dev DB is wedged**: it sits at `20260825120000` with 2
  pending files and `atlas migrate apply` fails on the first one. (This is
  precisely why the new migration here uses `IF NOT EXISTS`.)

**Correction to spec.md's original B3.** It said `ui/server/migrations/` has
"no runner anywhere in the repo". It does: `runMigration()` in
`ui/server/index.mjs` iterates that directory on **every local API server
startup** — including every vitest run, which imports the app — applying each
file and swallowing failures as warnings. The earlier grep missed it because
the path is built as `join(__dirname, 'migrations')`, never written literally.
The substance is unchanged and now better explained: that runner only ever
touches the database the *local collector* connects to, so anything defined
only there is present on every dev machine and absent from the cloud DB, which
is served by `cloud/functions/index.js`. spec.md has been corrected.

Neither is caused by this track and neither is fixed here. Task 1.4 was
therefore verified directly instead: the migration was applied twice against a
scratch database holding a real `tracks` table — creating all four columns with
the intended types (`integer NOT NULL DEFAULT 0`, `text`, `text`,
`timestamptz`) on the first run and no-opping with `skipping` notices on the
second. `atlas migrate validate` confirms `atlas.sum` integrity.

**The cloud DB is not Atlas-managed, but has almost everything already**
(Task 1.5, read-only introspection via the `DATABASE_URL` secret).
`atlas migrate status` reports *no migration applied yet* — the schema was
provisioned by some other path, so `scripts/migrate-prod.sh` has evidently
never successfully run. Introspection of the live schema shows every table the
ported handlers need is present: `track_locks`, `track_sessions`,
`worker_dispatch`, `worker_permissions`, `track_comments`, `workers`,
`projects`, `tracks`, `api_keys`.

Column-level, the only gaps that matter to this track are the four
`prespawn_block_*` columns — **confirmed absent**, exactly as spec.md predicted.
Present and verified: `projects.conductor_files`/`owner_uid`/`repo_path`/
`workspace_id`, `tracks.claimed_by`/`locked_by`/`last_updated_by_uid`/
`assignee_uid`/`created_by_uid`/`priority`/`auto_run`, all of
`track_sessions` (incl. `last_context_tokens`, `resume_count`), all of
`worker_dispatch` (incl. `result`, `claimed_at`), `track_comments.is_replied`,
`workers.machine_token`/`user_uid`/`visibility`.

Also absent from the cloud DB but **not** used by any route ported here, so out
of scope and left alone: `tracks.merge_mode`, `tracks.workspace_mode` (from
`ui/server/migrations/009` and `010` — the same orphaned-directory problem).

One schema detail that shapes Phase 4: `worker_dispatch` has **no**
`project_id` column, so scoping a dispatch to a workspace has to go
`worker_id → workers.project_id → projects.workspace_id`.

**Applying the migration to the cloud DB is a production write and is not done
here** — see the Phase 5 note.

**Unplanned fix, found by the new control assertion.** The parity suite asserts
the *local* server serves every worker call, as a check on the extractor itself.
It failed on `POST /track/1/action`: `conductor/laneconductor.sync.mjs:2721`
(the `/replan` and `/bug` conversation-command handler) called
`postToCollectors`, but `/track/:num/action` is registered `app.patch` in both
`ui/server/index.mjs` and `cloud/functions/index.js`. That POST 404'd on every
invocation. It went unnoticed because the `.catch()` only warns and the
`index.md` write immediately below re-establishes the same state through
file-sync — the HTTP call has been dead weight, not a working transition. Fixed
to `patchCollectors` (one line, plus a comment).

## Phase 2: Worker identity and transactions in the cloud function

**Problem**: B1 and B2 from spec.md. Ported verbatim, `/track/:num/session`
always returns `400` and `/tracks/claim-queue` can double-claim.
**Solution**: Fix the middleware and add a transaction primitive before any
handler relies on them.

- [ ] Task 2.1: Extend `cloud/functions/index.js`'s `auth` to resolve worker
      identity from `X-Worker-Token` (REQ-1). Look up
      `workers.machine_token`, join to `projects` to confirm
      `projects.workspace_id = req.workspace_id`, and set `req.worker_id`,
      `req.worker_project_id`, `req.worker_visibility`, `req.machine_token`.
    - [ ] A token that resolves to a worker in a **different** workspace must
          `403`, not fall through as anonymous — write this test first (AC-8).
    - [ ] An absent header stays valid: existing callers (the cloud UI, and
          every already-working worker route) must be unaffected.
- [ ] Task 2.2: Apply the same resolution to `ui/server/index.mjs`'s
      `collectorAuth` (REQ-2), placed so an `X-Worker-Token` supplements — never
      overrides — a machine-token bearer that already identified the worker.
    - [ ] Add a test that a local api-key-authenticated worker sending
          `X-Worker-Token` now succeeds on `GET /track/:num/session` where it
          previously got `400 worker identity required`. This is a real local
          bug fixed as a side effect; assert it explicitly.
- [ ] Task 2.3: Send the header from the worker (REQ-3). In
      `conductor/laneconductor.sync.mjs`, have the `post`/`patch`/`get` helpers
      attach `X-Worker-Token` from `ownMachineTokens.get(url)` (falling back to
      the config's `machine_token` only for worker #1, matching
      `resolveCollectorToken`'s existing reasoning). `Authorization` is
      untouched.
    - [ ] Do not send the header before registration returns a token — a
          request with an empty header value must not be sent at all.
- [ ] Task 2.4: Add `withTransaction(fn)` to the cloud function (REQ-4):
      checkout a client from the pool, `BEGIN`, run `fn(client)`, `COMMIT`,
      `ROLLBACK` on throw, always `release()`. Mirror `query()`'s pool-reset
      behaviour on connection errors.
    - [ ] Unit-test rollback-on-throw and release-on-both-paths with the
          existing `pg` jest mock.

**Impact**: The cloud can tell *which worker* is calling, safely; and can run a
real claim transaction. Local gains the same identity path, fixing api-key
session continuity.

## Phase 3: Port the coordination and read routes

**Problem**: Six of the eleven families are straightforward single-statement
handlers whose only real work is auth/workspace scoping.
**Solution**: Port them together, each with a jest case for auth rejection,
404, and success shape.

- [ ] Task 3.1: `GET /projects/:id/workflow` — `auth` + `checkProject`; read
      `projects.conductor_files->>'workflow_json'`; drop the disk fallback,
      return `{}` (spec.md's documented divergence). Note the path has **no**
      `/api` prefix — keep it, the worker calls exactly this.
- [ ] Task 3.2: `POST /conductor-files` — `auth`; resolve project from
      `req.worker_project_id` or `project_id`, workspace-scoped;
      `UPDATE projects SET conductor_files = $1`.
- [ ] Task 3.3: `GET /track/:num` — `auth`; track + its `track_comments`,
      `404` when absent.
- [ ] Task 3.4: `POST /track/:num/lock` and `POST /track/:num/unlock` — upsert
      / delete `track_locks` and maintain `tracks.locked_by`, exactly as local
      does including the `lane_action_status = 'running'` side effect on lock.
    - [ ] Two concurrent locks on one track must leave one lock row with the
          later holder, not two rows — the local `ON CONFLICT (project_id,
          track_number)` gives this; confirm the constraint exists in the cloud
          DB (it comes from `20260227181000_track_1010_worker_coordination.sql`).
- [ ] Task 3.5: `POST /track/:num/prespawn-block` and `.../reset` — depends on
      Phase 1's migration being applied to the cloud DB.
- [ ] Task 3.6: Add the `CLAIMABLE_LANES` copy to the cloud function as a named
      const with a comment pointing at `conductor/constants.mjs` and at Task
      1.6's parity test. Task 1.6 should now go GREEN.

**Impact**: A cloud worker can fetch its workflow config, read a track, and
take/release git locks.

## Phase 4: Port claim, session, and dispatch

**Problem**: The five remaining families are the ones with real logic —
transactional claim, session upsert arithmetic, dispatch inbox, assignee
resolution.
**Solution**: Port each with its local semantics preserved literally, and test
the semantics (not just the status code).

- [ ] Task 4.1: `POST /tracks/claim-queue` via Phase 2's `withTransaction`.
      Preserve: `FOR UPDATE SKIP LOCKED`, the lane-priority `ORDER BY`,
      `claimed_by = machine_token`, the visibility filter
      (private/team/public + `worker_permissions`), the optional
      `track_number` targeted claim, and the targeted-claim-only diagnostic
      `reason`.
    - [ ] Test: single queued track, two concurrent claim calls → exactly one
          returns it (AC-5's unit-level counterpart; AC-5 itself is live).
    - [ ] Test: `team` visibility grants via `worker_permissions`; `private`
          does not.
- [ ] Task 4.2: `GET`/`POST`/`DELETE /track/:num/session`. Preserve exactly:
      the `400` when worker identity is absent, `resume_count` increment-on-same
      / reset-on-different, and `COALESCE` so an unmeasured `context_tokens`
      never erases a stored one.
    - [ ] Test each of those three semantics separately — they are what track
          10047's context-cap policy reads, and a plausible-looking rewrite that
          coerces `last_context_tokens` to `0` breaks it silently.
- [ ] Task 4.3: `GET /worker/:id/dispatch` and `GET /worker/:id/dispatch/claimed`
      — plus the workspace check on `:id` that the local handler doesn't need
      (spec.md divergence #2). Test that worker B cannot read worker A's inbox
      across workspaces (AC-8).
- [ ] Task 4.4: `PATCH /worker-dispatch/:id` — `DISPATCH_STATUSES` validation,
      `claimed_at` set on `claimed`, the `result`-present vs absent branch,
      `404` on no rows. Scope the `UPDATE` to a dispatch whose worker is in the
      caller's workspace.
- [ ] Task 4.5: `GET /api/projects/:id/claimable-tracks` — port
      `resolveAssignee` and `resolvePinnedWorkers` alongside it (they are local
      module-scope helpers, not exported); `auth` + `checkProject`.
- [ ] Task 4.6: Task 1.1's route-parity test should now go GREEN with zero
      unmatched paths. If any remain, they are real — port them, don't
      allowlist them.

**Impact**: A cloud worker can claim work, keep session continuity across lane
actions, and serve manual dispatches. Every route in the gap table is now real.

## Phase 5: Live verification against the deployed cloud API

**Problem**: Every check so far is offline. The route-parity test proves a route
is *registered*; it cannot prove a worker can actually work. Unit tests with a
mocked `pg` cannot catch a wrong column name, a missing cloud-DB constraint, or
a Hosting rewrite that still misses.
**Solution**: Deploy and drive a real worker, recording what was observed.

- [ ] Task 5.1: Deploy the function (`firebase deploy --only functions:api`)
      and the hosting rewrite change.
- [ ] Task 5.2: Reachability sweep against `https://app.laneconductor.com` for
      all 11 ported paths: each must return a real JSON response.
      **`401`/`403` counts as reached; `200` with `<!doctype html>` and `404`
      do not** — the SPA-fallback symptom is a `200`, so assert on the body,
      not just the status.
- [ ] Task 5.3: Configure a scratch project for `remote-api` against the cloud
      URL, `lc worker start`, and drive a real track through a lane action.
      Capture the worker log and the cloud board state for AC-1 and AC-2.
- [ ] Task 5.4: Second lane action on the same track → confirm `--resume` with
      the stored session id in the spawn line (AC-3).
- [ ] Task 5.5: Create a manual dispatch in the cloud UI → confirm the worker
      picks it up and reports an outcome (AC-4).
- [ ] Task 5.6: Two workers, one queued track → confirm exactly one claim
      (AC-5).
- [ ] Task 5.7: Cross-workspace `X-Worker-Token` rejection, against the
      deployed API (AC-8).
- [ ] Task 5.8: Record every observation in `conversation.md` — worker log
      excerpts and the actual HTTP responses. "The code looks right" is not an
      observation.

**Impact**: `remote-api` is either demonstrably working, or the specific thing
that still fails is named and pinned.

## Phase 6: Retire the 10052 caveats

**Problem**: Four documents currently tell users `remote-api` doesn't work.
They must stop saying that at exactly the moment it stops being true — not
before.
**Solution**: Remove them last, each justified by a Phase 5 observation.

- [ ] Task 6.1: `ui/src/App.jsx` — remove the amber "Cloud worker sync is not
      ready yet" banner and restore step 2's label to plain "Configure your
      worker".
- [ ] Task 6.2: `bin/lc.mjs` — remove the three `console.log` warnings in the
      interactive remote-collector prompt.
- [ ] Task 6.3: `.claude/skills/laneconductor/SKILL.md` (~line 720) — remove
      the "Not fully supported yet (track 10052)" block and its endpoint list.
- [ ] Task 6.4: `conductor/product.md` — remove the "remote-api known gap"
      section and the `¹` footnote under Feature Availability; the Cloud column
      becomes unqualified.
    - [ ] Leave the Hosting glob explanation itself as history if it reads as
          useful, but it must no longer be phrased as a live gap.
- [ ] Task 6.5: Re-run the full suites (`node --test conductor/tests/`,
      `cd ui && npm test`, `cd cloud/functions && npm test`) and confirm green
      before marking the phase done.

**Impact**: The onboarding path stops warning users away from a path that works.

## Deferred (explicitly not this track)

- **Reconciling `ui/server/migrations/` with `migrations/`.** Ten migration
  files with no runner. This track lifts only the four columns it needs. The
  rest needs its own audit — not deferred *capability*, a separate defect.
- **Porting `PATCH /track/:num/heartbeat`, `/last-comment`, `/sync-status`,
  `/reset`.** Not called by the worker or CLI; the cloud UI uses `/api/*`.
  Listed in spec.md's exclusions so a future audit doesn't re-flag them.
