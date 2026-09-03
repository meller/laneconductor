# Tests: Track 10053 — Port missing worker routes to the cloud function

## Test Commands

```bash
# Worker/offline suites (node:test, zero deps) — route parity, rewrites, constants
node --test conductor/tests/cloud-route-parity.test.mjs
node --test conductor/tests/firebase-rewrites.test.mjs

# NOTE: `node --test conductor/tests/` (a bare directory) fails on Node 22 —
# it resolves the path as a module. Use a glob. But see the hazard below before
# running the whole suite.
#
# ⚠️  DO NOT run `node --test conductor/tests/*.test.mjs` from inside a
# worktree. Several of those E2E tests exercise real `git worktree`
# create/remove against the real repository rather than a fixture clone, and
# their cleanup deletes the worktree they are running in — observed on this
# track: the directory was removed, the track-10053 branch ref deleted, and the
# worktree deregistered mid-run. Run it from the primary checkout, or run
# individual files.

# Cloud function handlers (jest + supertest, mocked pg)
cd cloud/functions && npm test

# Local collector API (vitest + supertest) — collectorAuth changes
cd ui && npm test

# Migration applies cleanly and is idempotent
./scripts/migrate.sh && ./scripts/migrate.sh

# Cloud DB migration currency (Phase 1 gate)
atlas migrate status --url "$DATABASE_URL"

# Live reachability sweep (Phase 5) — 401/403 = reached, 404 or HTML = not
scripts/… ad-hoc curl loop; see TC-30
```

## Test Cases

### Phase 1 — Parity harness, routing, schema

- [x] TC-1: `cloud-route-parity` extracts worker collector paths from
      `conductor/laneconductor.sync.mjs` — expected: the extracted set contains
      all of `/projects/:id/workflow`, `/conductor-files`, `/track/:num`,
      `/track/:num/lock`, `/track/:num/session`, `/tracks/claim-queue`,
      `/worker/:id/dispatch`, `/worker-dispatch/:id`,
      `/api/projects/:id/claimable-tracks` (guards the extractor itself — a
      silently-empty extraction would make the whole test vacuous).
- [x] TC-2: `:param` route matching helper — expected: `/track/:num` matches
      `/track/10053` but not `/track/10053/lock`; `/track/:num/prespawn-block`
      matches `/track/1/prespawn-block` but not `/track/1/prespawn-block/reset`.
- [x] TC-3: Route parity, pre-port — expected: RED, listing exactly the 11
      unmatched families from spec.md's gap table (baseline assertion; the
      count is recorded in plan.md).
- [x] TC-4: Route parity, post-port — expected: zero unmatched paths.
- [x] TC-5: `firebase-rewrites` with `/conductor-files` added to `WORKER_PATHS`
      and no rewrite present — expected: RED for both hosting targets.
- [x] TC-6: Same, after the rewrite is added — expected: `/conductor-files`
      routes to the `api` function on both `app` and `landing` targets.
- [x] TC-7: SPA paths still resolve to `index.html` after the rewrite addition
      — expected: `/`, `/board`, `/inbox` unchanged (regression guard on 10052's
      work).
- [x] TC-8: `./scripts/migrate.sh` twice in a row — expected: first applies the
      `prespawn_block_*` migration, second is a clean no-op (`ADD COLUMN IF NOT
      EXISTS`).
- [ ] TC-9: `SELECT prespawn_block_count, prespawn_block_kind,
      prespawn_block_reason, prespawn_blocked_at FROM tracks LIMIT 0` against
      the cloud DB — expected: succeeds (columns exist) after Phase 1.5.
      **NOT SATISFIED — and confirmed so.** Live introspection shows all four
      columns absent from the cloud DB. The migration that adds them is written
      and verified locally, but applying it is a production write, withheld
      pending authorization (see plan.md's Phase 5 note). Until it is applied,
      `POST /track/:num/prespawn-block` will 500 in the cloud.
- [x] TC-10: `CLAIMABLE_LANES` parity — expected: the cloud function's literal
      list deep-equals `conductor/constants.mjs`'s export; test fails if a lane
      is added to one and not the other.

### Phase 2 — Worker identity and transactions

- [x] TC-11: `auth` with a valid `lc_` key and no `X-Worker-Token` — expected:
      `req.worker_id` undefined, request still authorized (no regression for
      the cloud UI or already-working worker routes).
- [x] TC-12: `auth` with `X-Worker-Token` matching a worker in the caller's
      workspace — expected: `req.worker_id`, `req.worker_project_id`,
      `req.worker_visibility`, `req.machine_token` all populated.
- [x] TC-13: `auth` with `X-Worker-Token` matching a worker in a **different**
      workspace — expected: `403`, and `req.worker_id` never set (AC-8).
- [x] TC-14: `auth` with an `X-Worker-Token` matching no worker at all —
      expected: `403` (an unknown credential is a rejection, not a
      fall-through to anonymous).
- [x] TC-15: Local `collectorAuth`, api-key bearer + `X-Worker-Token` →
      `GET /track/:num/session` — expected: `200`, not the pre-fix
      `400 worker identity required`.
- [x] TC-16: Local `collectorAuth`, machine-token bearer + a *different*
      `X-Worker-Token` — expected: the bearer's identity wins; the header
      cannot re-point an already-identified worker.
- [ ] TC-17: Worker sends `X-Worker-Token` after registration — expected:
      the header is present on subsequent `post`/`patch`/`get` calls with the
      value from `ownMachineTokens`, and `Authorization` is unchanged.
      **NOT AUTOMATED.** `applyWorkerTokenHeader` is not exported from the
      worker monolith, so asserting this needs the mock-collector harness
      (`conductor/tests/local-api-e2e.test.mjs`) to record request headers.
      Implemented and code-reviewed but only exercised end-to-end via the live
      run in Phase 5, which is blocked — see the Phase 5 note in plan.md.
- [ ] TC-18: Worker before registration (no machine token yet) — expected: no
      `X-Worker-Token` header at all (not an empty-valued one).
      **NOT AUTOMATED** — same reason as TC-17. The code path is a plain
      early return when `ownMachineTokens` has no entry for the URL.
- [x] TC-19: `withTransaction` on success — expected: `BEGIN`, the callback's
      statements, `COMMIT`, and `release()` all on one client.
- [x] TC-20: `withTransaction` when the callback throws — expected: `ROLLBACK`,
      `release()` still called, error propagates to the caller.

### Phase 3 — Coordination and read routes

- [x] TC-21: `GET /projects/:id/workflow` with `conductor_files.workflow_json`
      set — expected: the parsed object. With it absent — expected: `{}` (no
      disk read attempted in the cloud).
- [x] TC-22: `GET /projects/:id/workflow` for a project in another workspace —
      expected: `403` from `checkProject`, not the workflow.
- [x] TC-23: `POST /conductor-files` — expected: `{ ok: true }` and the
      `UPDATE` scoped to the caller's own project.
- [x] TC-24: `GET /track/:num` — expected: track fields plus a `comments`
      array; `404` for an unknown track number.
- [x] TC-25: `POST /track/:num/lock` — expected: `{ ok: true }`, a
      `track_locks` upsert, and `tracks.lane_action_status` set to `running`;
      `404` when the track doesn't exist.
- [x] TC-26: `POST /track/:num/unlock` — expected: the lock row deleted and
      `tracks.locked_by` cleared.
- [x] TC-27: `POST /track/:num/prespawn-block` — expected: `{ count, kind,
      reason }` with `count` incremented; `400` when `kind` is missing; `404`
      for an unknown track. `.../reset` — expected: `{ ok: true }` and all four
      columns nulled/zeroed.

### Phase 4 — Claim, session, dispatch

- [x] TC-28: `POST /tracks/claim-queue` — verified **structurally**, with a
      mocked pg: the claim statement contains `FOR UPDATE SKIP LOCKED` and runs
      on the single client `withTransaction` checked out (one `connect()` call),
      which is the property a genuine race depends on. Proven non-vacuous by
      mutation: deleting the `FOR UPDATE SKIP LOCKED` line from this handler
      fails this case. A real two-worker race is AC-5, which is live-only and
      blocked — a mocked pool cannot exhibit row-lock contention at all.
- [x] TC-29: Claim ordering — expected: `priority DESC`, then the
      plan/review/quality-gate/other lane order, then `created_at ASC`.
- [x] TC-30: Claim visibility — expected: `private` claims only its owner's
      (or owner-null) tracks; `team` additionally claims tracks whose
      `last_updated_by_uid` has a `worker_permissions` row for this worker;
      `public` claims any in-project track.
- [x] TC-31: Targeted claim (`track_number` in body) for a track that is no
      longer `queue` — expected: zero rows **and** a populated `reason`
      diagnostic. Untargeted claim returning zero — expected: `reason` is null
      (no extra query on idle polling).
- [x] TC-32: `GET /track/:num/session` with no stored row — expected:
      `{ claude_session_id: null, last_context_tokens: null, resume_count: 0 }`
      — `last_context_tokens` **null, never 0** (track 10047's cap policy
      distinguishes them).
- [x] TC-33: `POST /track/:num/session` twice with the *same*
      `claude_session_id` — expected: `resume_count` becomes 1 then 2.
- [x] TC-34: `POST /track/:num/session` with a *different* `claude_session_id`
      — expected: `resume_count` resets to 0.
- [x] TC-35: `POST /track/:num/session` omitting `context_tokens` after a prior
      POST that supplied it — expected: the stored `last_context_tokens` is
      preserved, not nulled (`COALESCE`).
- [x] TC-36: `DELETE /track/:num/session` — expected: `{ ok: true }`, and a
      following `GET` returns the empty shape from TC-32.
- [x] TC-37: Session routes with no worker identity — expected: `400 worker
      identity required` on all three verbs.
- [x] TC-38: `GET /worker/:id/dispatch` — expected: only `pending` entries for
      that worker, `created_at ASC`, under an `entries` key.
- [x] TC-39: `GET /worker/:id/dispatch/claimed` — expected: only `claimed`
      entries, `claimed_at ASC`.
- [x] TC-40: `GET /worker/:id/dispatch` where `:id` is a worker in another
      workspace — expected: `403`, empty or otherwise — never that worker's
      entries (AC-8).
- [x] TC-41: `PATCH /worker-dispatch/:id` with `status: 'claimed'` — expected:
      `claimed_at` set. With an invalid status — expected: `400` naming the
      valid set. With an unknown id — expected: `404`. With `result` present
      vs absent — expected: `result` written only when supplied.
- [x] TC-42: `GET /api/projects/:id/claimable-tracks` — expected: a track with
      no assignee/creator/owner is claimable by any worker; a track whose
      assignee owns workers is claimable only by one of those workers; a track
      whose assignee owns no workers is claimable by any.
- [x] TC-43: `GET /api/projects/:id/claimable-tracks` without `worker_id` —
      expected: `400 worker_id is required`.

### Phase 5 — Live, against the deployed cloud API

- [~] TC-44: Reachability sweep of all 11 ported paths against
      `https://app.laneconductor.com` — expected: every response is JSON.
      **PRE-DEPLOY BASELINE CAPTURED** (see plan.md's Phase 5 note): all 11
      currently return `200` with the SPA's `index.html`, i.e. 10052's rewrite
      fix is not live yet. The post-deploy pass is blocked on authorization.
      `401`/`403` passes (route reached); a `404` fails, and **a `200` whose
      body starts with `<!doctype html>` fails** — that is the SPA-fallback
      symptom, and asserting on status alone would miss it.
- [ ] TC-45: Real worker, `remote-api` mode, `lc worker start` — expected: the
      worker registers, `GET /projects/:id/workflow` returns the project's real
      workflow, and a queued track is claimed and shown `running` on the cloud
      board (AC-1).
- [ ] TC-46: That worker completes one lane action end to end — expected:
      claim → lock → run → unlock → lane transition, with the new lane visible
      in the cloud UI (AC-2).
- [ ] TC-47: A second lane action on the same track — expected: the worker's
      spawn line contains `--resume <the id stored by TC-46>` (AC-3).
- [ ] TC-48: Manual dispatch created in the cloud UI — expected: it appears in
      the worker's inbox, transitions `pending → claimed → done`, and the UI
      shows the outcome (AC-4).
- [ ] TC-49: Two cloud workers, one queued track — expected: exactly one claim
      succeeds; the other's response is empty (AC-5).
- [ ] TC-50: Cross-workspace `X-Worker-Token` against the deployed API —
      expected: `403` (AC-8, live counterpart of TC-13).

### Phase 6 — Caveat removal

- [ ] TC-51: `grep -rn "10052\|not fully supported\|not ready yet" ui/src/App.jsx
      bin/lc.mjs .claude/skills/laneconductor/SKILL.md conductor/product.md` —
      expected: no remaining `remote-api`-unsupported claims (AC-9).
- [ ] TC-52: Full suites green after removal: `node --test conductor/tests/`,
      `cd ui && npm test`, `cd cloud/functions && npm test` (AC-6, AC-7).

## Acceptance Criteria

- [ ] Route parity test is GREEN with zero unmatched worker paths (TC-4)
- [ ] All 11 route families return real JSON from the deployed cloud API,
      verified on the body and not just the status (TC-44)
- [ ] A real `remote-api` worker registers, claims, locks, resumes a session,
      and heartbeats end to end, with observations recorded (TC-45–TC-48)
- [ ] Exactly one claim under concurrency, unit and live (TC-28, TC-49)
- [ ] Cross-workspace worker-token access is rejected, unit and live
      (TC-13, TC-50)
- [ ] Session null/increment/COALESCE semantics preserved exactly
      (TC-32–TC-35)
- [ ] 10052's caveats removed only after the live observations exist
      (TC-51 gated on TC-45–TC-48)
- [ ] No regressions: `conductor/tests/`, `ui` vitest, and `cloud/functions`
      jest all pass (TC-52)
