# Tests: Track 1108 — Worker VM provisioning from the remote app

## Test Commands

```bash
# Collector API + UI unit/integration (vitest + supertest)
cd ui && npm test

# Worker / CLI end-to-end (node:test, spawns real processes, zero deps)
node --test conductor/tests/track-1108-enrollment.test.mjs
node --test conductor/tests/track-1108-instance-mode.test.mjs

# Browser flows
npx playwright test --project=fast

# Provider drivers against a recorded fixture server (no real cloud spend)
node --test conductor/tests/track-1108-vm-providers.test.mjs
```

New API tests live beside the existing ones in `ui/server/tests/`; new worker
and CLI tests in `conductor/tests/`; new browser specs in
`conductor/tests/playwright/` (they land in the `fast` tier by default, which
is correct — none of them drives an LLM run).

## Test Cases

### Phase 2 — instance definition

- [ ] TC-1: `GET /api/instance` with `LC_INSTANCE_MODE=api-only` — expected:
      `mode: "api-only"`, `capabilities.local_worker_start: false`
- [ ] TC-2: no env var and auth disabled — expected: `mode: "api+workers"`,
      matching today's local behavior exactly
- [ ] TC-3: no env var and auth enabled — expected: `mode: "api-only"`
- [ ] TC-4: `LC_INSTANCE_MODE=nonsense` — expected: startup fails with the
      offending value named; the server does not come up on a default
- [ ] TC-5: `POST /api/workers/manager/start` on an `api-only` instance —
      expected: 409, body explains that this instance does not run workers and
      points at enrollment
- [ ] TC-6: same call on `api+workers` — expected: 200 and a manager actually
      running
- [ ] TC-7: `admins` field absent for a non-admin caller, present for an admin
- [ ] TC-8 (browser): with `local_worker_start: false`, no worker start/stop
      button renders anywhere in `WorkersList`; with `true`, they do — expected
      to hold with the browser at a non-localhost origin, which is exactly the
      case `IS_LOCAL_HOST` got wrong
- [ ] TC-8a: unauthenticated `POST /api/workers/manager/start` on an
      `api+workers` instance with auth enabled — expected: 401, no `lc` process
      spawned. Today this returns 200 and starts a manager against a
      caller-supplied `projectsDir` (REQ-24)
- [ ] TC-8b: authenticated but non-admin caller, same endpoint — expected: 403
      (D2), distinguishable from TC-8a's 401
- [ ] TC-8c: unauthenticated `POST /api/projects/:id/workers/start-new` and
      `.../worker/stop` — expected: 401 each (REQ-24)

### Phase 3 — enrollment

- [ ] TC-9: `POST /api/enrollment-tokens` — expected: raw token returned once;
      a second read of the same record never exposes it again
- [ ] TC-10: `POST /worker/enroll` with a fresh token — expected: an
      `lc_live_*` key owned by the token's `user_uid`, plus collector URL and
      projects dir
- [ ] TC-11: same token a second time — expected: 401, `reason: "already_used"`
- [ ] TC-12: a token past its TTL — expected: 401, `reason: "expired"`
- [ ] TC-13: a token that never existed — expected: 401, `reason: "unknown"`
      (distinct from TC-11 and TC-12, per REQ-10)
- [ ] TC-14: `lc enroll` in an empty directory against a mock collector —
      expected: `.laneconductor.json` with `mode: remote-api` and the returned
      URL, `.env` holding the key, `conductor/` created, and a manager process
      running from that directory
- [ ] TC-15: the manager from TC-14 registers — expected: a `workers` row with
      `type: 'manager'`, `project_id: NULL`, and `user_uid` equal to the
      enrolling user
- [ ] TC-16: run `lc enroll` twice on the same hostname — expected: one manager
      row, updated, not two (the `ON CONFLICT (hostname) WHERE type='manager'`
      path)
- [ ] TC-17: the served bootstrap script and the cloud-init `user_data` differ
      only in the token and URL — expected: byte-identical otherwise, so the
      two paths cannot drift

### Phase 4 — zero-hosts detection and the first-host screen

- [ ] TC-18: user with no workers — expected: `GET /api/hosts/summary` reports
      `mine: 0`
- [ ] TC-19: a worker exists with `user_uid IS NULL` — expected: still
      `mine: 0` (REQ-7; the current `/api/workers` query would say otherwise)
- [ ] TC-20: the user's own worker last beat 90 seconds ago — expected:
      `mine: 0`, `stale: 1` — a dead host is still a dead end
- [ ] TC-21: another user's `public` worker is visible — expected: `mine: 0`,
      because visibility is not ownership
- [ ] TC-21a: another user's worker granted to the caller by an explicit
      `worker_permissions` row — expected: `mine: 1`. This is the other side of
      TC-21's line and the only case REQ-5 counts as yours without owning it;
      untested, the implementation could satisfy TC-21 by dropping the grant
      path entirely and stranding a user who has only shared machines
- [ ] TC-22 (browser): signed in with zero hosts — expected: the first-host
      screen, both paths, and the cost statement, rather than an empty board
- [ ] TC-23 (browser): a minted, unconsumed enrollment — expected: the waiting
      state, not the chooser again
- [ ] TC-24 (browser): that enrollment's TTL elapses — expected: the
      never-connected message and an offer of a fresh token
- [ ] TC-25 (browser): a live attributable host appears — expected: the screen
      goes away without a manual reload

### Phase 5 — VM creation

- [ ] TC-26: Hetzner driver against a fixture server — expected: one POST
      carrying the bootstrap as `user_data`, returning server id and IP
- [ ] TC-27: fixture returns 401 for the provider token — expected: the call
      fails before any `vm_provisions` row claims a created server, and the
      error names the provider's own reason (AC-8)
- [ ] TC-28: after a successful create — expected: the provider token appears
      in no table and in no log line; asserted by scanning both
- [ ] TC-29: a provision whose enrollment is never consumed — expected: it
      stays visible with its provider server id and a "never connected" status,
      and is not deleted (REQ-18)
- [ ] TC-30: reload mid-provision — expected: the same state comes back from
      the server, not a fresh chooser (AC-7)
- [ ] TC-31: DigitalOcean driver — expected: satisfies the same interface tests
      as TC-26/TC-27 with no changes outside the driver

### Phase 6 — retirement

- [ ] TC-32: `POST /api/projects/:id/worker/start` — expected: 404, route gone
- [ ] TC-33: `POST /api/projects/:id/worker/stop` — expected: 404, route gone
- [ ] TC-34: `POST /api/workers/:id/stop` on an `api-only` instance — expected:
      it does not shell out on the API's machine (REQ-20)
- [ ] TC-34a: `POST /api/projects/:id/workers/start-new` on an `api-only`
      instance — expected: 409, no `lc` spawned (REQ-23). Distinct from TC-34:
      this is the route reached from the track panel's add-capacity control,
      not from `WorkersList`
- [ ] TC-35: repo-wide grep — expected: no remaining caller of the removed
      routes in `ui/src`, `bin`, or `conductor`
- [ ] TC-35a: enumerate every `execAsync`/`execFileAsync` call site in
      `ui/server/index.mjs` — expected: each one is either gone or reached only
      behind `requireAuth` **and** `capabilities.local_worker_start` (AC-10).
      The baseline is five call sites, at lines 446, 488, 501, 537 and 563;
      a sixth appearing later must fail this case rather than slip through

### Phase 7 — end-to-end

- [ ] TC-36: full walkthrough on a locally hosted remote configuration (auth
      enabled, API and worker on separate hosts): sign in with zero hosts →
      first-host screen → run the bootstrap on the second host → host appears
      live → dispatch `provision-worker` → a project worker actually starts
      there (AC-1, AC-2, AC-3)
- [ ] TC-37: the same walkthrough with the VM path instead of the manual one,
      against one real provider account (AC-6) — the single test in this suite
      that spends real money; run deliberately, not in CI

## Acceptance Criteria

- [ ] Every AC-1 through AC-10 in `spec.md` demonstrated, each by a named test
      case above
- [ ] `cd ui && npm test` passes with no regressions
- [ ] `npx playwright test --project=fast` passes
- [ ] TC-36 performed and its observed result recorded — a worker actually
      running on a second machine, not a log line saying it would
- [ ] No test asserts a placeholder message or an unimplemented code path
