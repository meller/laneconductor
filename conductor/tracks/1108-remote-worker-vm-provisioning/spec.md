# Spec: Track 1108 — Worker VM provisioning from the remote app (first-host onboarding)

## Problem Statement

In remote mode (`remote-api`, Firebase auth enabled) a freshly signed-up user
has zero machines running a worker. Nothing in the product detects that state
or offers a way out of it: the board renders empty, every lane action queues
forever, and the only escape is a side channel (someone tells you to run
`lc worker start --manager --projects-dir <path>` on a box you already own).

The bootstrap is a genuine chicken-and-egg, not an oversight. The correct
provisioning route — enqueue a `provision-worker` dispatch, let a manager
worker claim it from the target machine (`laneconductor.sync.mjs:6571`) — only
reaches a machine that is *already polling*. The first worker on a host has
nothing to receive its dispatch. The legacy route that appears to fill the gap
(`POST /api/projects/:id/worker/start`, `ui/server/index.mjs:432`) does not:
it shells out on whatever machine the **API server** runs on, which on a hosted
deployment is a Cloud Function container, not the user's box. `WorkersList.jsx`
already hides those buttons behind a client-side `IS_LOCAL_HOST` guess rather
than solving it.

This track closes the bootstrap gap, and — because closing it is what makes the
legacy route removable — retires the legacy route in the same effort.

## Design decisions (Phase 1 — the Open Questions from `index.md`)

### D1. Where "instance mode" (api-only vs. api+workers) is declared and read

**Decision: it is a property of the deployed API process, declared where that
process is deployed, and published to clients at `GET /api/instance`.**

Resolution order, highest wins:
1. `LC_INSTANCE_MODE` environment variable (`api-only` | `api+workers`)
2. `instance.json` beside the API server (gitignored, self-hosted convenience)
3. Default: `api+workers` when auth is disabled, `api-only` when auth is enabled

Not the database, and not `.laneconductor.json`. The DB is shared by every API
instance pointed at it, and `.laneconductor.json` describes one *project on one
machine* — neither can express "the box this API is running on may also run
workers". The default preserves today's behavior exactly: a local `lc ui start`
stack keeps its worker-start buttons, a hosted deployment does not.

This is deliberately broader than VM provisioning, per the note in
`conversation.md`. `GET /api/instance` is what replaces the client-side
`IS_LOCAL_HOST` guess in `WorkersList.jsx`, and it is what gates
`POST /api/workers/manager/start` — an instance may start a worker on its own
box only if it declares `api+workers`. That single flag is the whole reason the
legacy direct route becomes safe to keep (scoped) or drop.

### D2. Instance admins

**Decision: introduce the minimum admin concept this track needs, and spin the
rest out.** An instance admin is a Firebase uid in `instance.admins`
(`LC_INSTANCE_ADMINS` env or `instance.json`). If the list is empty, the first
authenticated user is recorded as admin and written back — the standard
self-hosted bootstrap. Admins are the only identities that may read the full
instance settings payload.

Everything past that (per-instance roles, delegating provisioning rights,
transferring ownership, an admin UI) is a separate feature with its own
surface, and blocking first-host onboarding on it would also block track 1107.
**Recommendation to the human: file a follow-up track for the full instance /
admin model, depending on this track's `GET /api/instance` contract rather than
replacing it.** Not filed here — creating tracks is outside the plan lane's
boundary.

### D3. Does an existing api-only instance need to switch to api+workers?

**Decision: no, not in v1.** Mode is fixed at process start and changing it
means redeploying with a different env var. This is what keeps D2 minimal: with
no runtime mutation there is no privileged write path to protect yet.

### D4. Which clouds first

**Decision: Hetzner Cloud first, DigitalOcean second. AWS, GCP and Azure are
explicitly deferred.**

Hetzner and DigitalOcean both create a server in a single authenticated POST
that accepts a cloud-init `user_data` blob, authenticate with one pasteable
project-scoped API token, and cost roughly €4–12/month for a box that can host
an agent. AWS/GCP/Azure each require IAM role or service-account setup, VPC and
security-group selection, and per-region image lookup before the first server
exists — each is its own track-sized effort and none is needed to prove the
flow. The provider layer is a driver interface (REQ-14) so adding them later is
additive.

### D5. Credentials model

**Decision: two tiers, and tier 0 ships first and stands alone.**

- **Tier 0 — the enrollment token (Phases 2–4).** No cloud credentials ever
  reach the Collector. The app mints a short-lived, single-use enrollment token
  and renders a bootstrap command that embeds it. The user runs that command on
  a machine they already have, *or* pastes the same content into their cloud
  console's user-data field. The "I have a machine" path and the "create a VM"
  path become the same artifact, which is why tier 0 is a complete feature by
  itself rather than a stepping stone.
- **Tier 1 — bring-your-own cloud token (Phase 5).** The user's provider token
  is accepted per request, used for the duration of one provisioning call, and
  never written to the database or to logs. Encrypted-at-rest credential
  storage and OAuth-to-cloud-account flows are out of scope for this track.

## Requirements

### Instance definition
- **REQ-1**: `GET /api/instance` returns `{ instance_id, name, mode,
  auth_enabled, capabilities: { local_worker_start, vm_providers[] }, version }`.
  Readable by any authenticated user; the `admins` list is returned only to an
  admin.
- **REQ-2**: Mode resolves per D1's order. An unrecognized value fails startup
  loudly rather than silently defaulting.
- **REQ-3**: `POST /api/workers/manager/start` returns `409` with an
  explanatory body when the instance is `api-only`. The UI offers the
  enrollment bootstrap instead of the button.
- **REQ-4**: `WorkersList.jsx`'s `IS_LOCAL_HOST` constant is deleted and every
  use replaced by `capabilities.local_worker_start` from REQ-1.

### Zero-hosts detection
- **REQ-5**: `GET /api/hosts/summary` returns `{ live, mine, pending_enrollments,
  stale }` for the calling identity. "Mine" counts workers of any type whose
  `user_uid` is the caller, or that the caller reaches through
  `worker_permissions`.
- **REQ-6**: The zero-hosts state is `mine == 0` over live workers only
  (`last_heartbeat > now() - 60s`). A registered-but-dead host is still a dead
  end and must not suppress onboarding.
- **REQ-7**: REQ-5's "mine" count must **not** include the
  `OR w.user_uid IS NULL` clause that `GET /api/workers` currently applies
  (`ui/server/index.mjs:418`). That clause exists so pre-identity workers stay
  visible, but counting an unattributed worker as *yours* would tell a brand-new
  user they already have a machine. Confirmed present in the current query; this
  is a real defect, not a hypothetical.

### Enrollment
- **REQ-8**: New table `enrollment_tokens` — `id, token_hash, token_prefix,
  user_uid, label, projects_dir, expires_at, used_at, consumed_by_worker_id,
  created_at`. The raw token is returned exactly once and never stored.
- **REQ-9**: `POST /api/enrollment-tokens` (auth required) mints a token with a
  60-minute TTL, single use. `GET /api/enrollment-tokens` lists the caller's
  outstanding ones with status (`pending` | `used` | `expired`).
- **REQ-10**: `POST /worker/enroll` accepts `{ token }`, and on success marks
  the token used, mints an `lc_live_*` API key owned by the token's `user_uid`
  through the existing `api_keys` machinery, and returns
  `{ api_key, collector_url, projects_dir }`. A token that is expired, already
  used, or unknown returns `401` with a distinguishable `reason` — the three
  cases must not collapse into one opaque failure.
- **REQ-11**: New CLI command `lc enroll --token <t> --url <u>
  [--projects-dir <p>]`. It creates a host directory containing
  `.laneconductor.json` (`mode: remote-api`, the returned collector URL),
  `.env` (`COLLECTOR_0_TOKEN`), and an empty `conductor/`, then runs
  `lc worker start --manager --projects-dir <p>` from it. The manager worker
  reads its collectors from the `.laneconductor.json` in its cwd
  (`laneconductor.sync.mjs:281`), so this directory is what makes a manager
  runnable on a machine that has no project yet.
- **REQ-12**: The API serves a bootstrap script whose only parameters are the
  token and the instance URL, so the identical artifact works pasted into a
  terminal or into a cloud-init `user_data` field.
- **REQ-13**: The enrolled manager registers with `type: 'manager'` and the
  API-key-resolved `user_uid`, so it appears under the enrolling user's
  identity (`/worker/register`, `ui/server/index.mjs:3264`). Re-enrolling the
  same host updates the existing manager row rather than creating a second one.

### VM provisioning
- **REQ-14**: A provider driver interface — `createServer({ token, region,
  size, image, userData })` → `{ provider_server_id, ip, status }` — with a
  Hetzner implementation. DigitalOcean is a second implementation of the same
  interface, not a second code path.
- **REQ-15**: `POST /api/vm-provisions` takes the provider, the user's provider
  token, a size/region selection, and mints its own enrollment token internally.
  The provider token is used for that request only and is never persisted or
  logged.
- **REQ-16**: New table `vm_provisions` — `id, user_uid, provider,
  provider_server_id, region, size, status, enrollment_token_id, error,
  created_at, enrolled_at`. Survives the user closing the tab: the provisioning
  state is server-side, not client state.
- **REQ-17**: The chooser shows each provider's estimated monthly cost before
  the user commits, and states separately that agent/LLM usage is billed by the
  model provider and is not included in that figure.
- **REQ-18**: A VM that was created but never enrolled is surfaced as such,
  with its provider server id, so the user knows they are being billed for it.
  It is never silently deleted.

### Retiring the direct api→machine route (scope extension, 2026-09-04)
- **REQ-19**: Remove `POST /api/projects/:id/worker/start` and
  `POST /api/projects/:id/worker/stop`, along with the client calls in
  `WorkersList.jsx`. Note for the record: the index.md description of these is
  now stale — `worker/start` was changed to run `lc start` directly (track
  1114); only `worker/stop` still shells out to `make lc-stop`, and it carries
  both defects (wrong machine, and the missing-Makefile-target fragility 1114
  fixed on the start side).
- **REQ-20**: `POST /api/workers/:id/stop` (`ui/server/index.mjs:514`) has the
  same runs-on-the-API's-machine assumption and must be either dispatch-backed
  or gated on `capabilities.local_worker_start`. The index.md's retirement list
  flagged this endpoint as needing confirmation; it does have the defect.
- **REQ-21**: `POST /api/workers/manager/start` and `CreateManagerWorkerForm`
  are kept but gated per REQ-3, not deleted: on an `api+workers` instance,
  starting a manager on the API's own box is correct and useful. This is an
  addition to the index.md's retirement list, which did not mention them.
- **REQ-22**: `conductor/product.md` documents exactly one provisioning path
  per situation — enrollment for the first worker on a host, dispatch for every
  subsequent one — so a reader can tell which component starts a worker on
  which machine.

## Acceptance Criteria

Written as observable user outcomes. No criterion is satisfiable by a stub.

- [ ] **AC-1**: A user signs in to a remote instance with no machines and sees
      a first-host screen with two paths and a cost statement, instead of an
      empty board.
- [ ] **AC-2**: Running the generated bootstrap command on a machine that has
      never seen LaneConductor results in a manager worker registered under
      that user, visible on their dashboard within one heartbeat, with no
      manual editing of `.laneconductor.json` and no token typed by hand.
- [ ] **AC-3**: After AC-2, the first-host screen is gone and dispatching a
      `provision-worker` action to that host actually starts a project worker
      there.
- [ ] **AC-4**: An enrollment token cannot be used twice; the second attempt
      fails with a reason distinguishable from "expired" and from "unknown".
- [ ] **AC-5**: A user with zero machines of their own is shown the first-host
      screen even when unattributed (`user_uid IS NULL`) workers exist in the
      database.
- [ ] **AC-6**: Creating a VM through the app produces a running server at the
      chosen provider that phones home and appears as a live host, and the
      provider token used to create it appears nowhere in the database or the
      logs afterwards.
- [ ] **AC-7**: Closing the browser mid-provision and returning shows the
      provision's real current state, including a created-but-never-enrolled VM
      with its provider server id.
- [ ] **AC-8**: An invalid provider token fails before any server is created,
      with a message naming the provider's own rejection reason.
- [ ] **AC-9**: On an `api-only` instance the UI offers no button that would
      start a worker on the API's machine; on an `api+workers` instance it does,
      and that button works.
- [ ] **AC-10**: After REQ-19, no HTTP route remains that starts or stops a
      worker by shelling out on the API's machine except ones gated by
      `capabilities.local_worker_start`.

## Non-goals

- Storing cloud credentials at rest, or OAuth into a user's cloud account.
- AWS, GCP, Azure drivers (deferred; the interface in REQ-14 accommodates them).
- Runtime switching of instance mode (D3).
- A full instance role/permission model (D2 — recommended as its own track).
- Billing or quota enforcement. REQ-17 sets expectations; it does not meter.

## Open items for human review

- **Fundamentals conflict (non-blocking, see `conversation.md`)**: this track
  introduces a LaneConductor "instance" as a first-class concept, which
  `conductor/product.md` does not currently have — its mode table describes
  collectors and workers only. `conductor/tech-stack.md` likewise lists no
  cloud-provider dependency. Both will need updating, but not by this track's
  plan lane.
- **Doc inconsistency found while planning**: `conductor/deployment-stack.md`
  says the Cloud API functions are decommissioned, while `conductor/product.md`
  describes the remote-api gap as Firebase Hosting rewrite globs misrouting to
  the SPA (track 10052). Both cannot be the current state. Whichever is true,
  production remote-api is not serving the worker endpoints today, so Phases
  2–5 are verified against a locally hosted remote configuration (auth enabled,
  API and worker on separate hosts) and the production rollout is blocked on
  10052.
- **Decision needed from the human**: confirm Hetzner-first (D4), and confirm
  whether the instance/admin model is spun out as its own track (D2).
