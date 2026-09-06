# Track 1108: Worker VM provisioning from the remote app (first-host onboarding)

Phase order is deliberate: each phase leaves the product in a better state than
it found it, and the enrollment primitive built in Phase 3 is what both the
"I have a machine" path and the "create a VM for me" path consume. Phase 6
(retiring the legacy direct route) is last because it is only safe once the
bootstrap it replaces actually exists.

## Phase 1: Design — instance mode, admin model, clouds, credentials

**Problem**: Four questions had no owning track and no answer, and every later
phase depends on all four.
**Solution**: Answer them in `spec.md` (D1–D5), with the reasoning recorded so
a reviewer can disagree with the decision rather than guess at it.

- [x] D1: where instance mode is declared and read from → the API process,
      published at `GET /api/instance`
- [x] D2: what an instance admin is → minimum uid allowlist here, full model
      recommended as a separate track
- [x] D3: post-launch mode switching → not in v1, mode fixed at process start
- [x] D4: which clouds first → Hetzner, then DigitalOcean; AWS/GCP/Azure deferred
- [x] D5: credentials → enrollment token (tier 0) first, BYO provider token
      (tier 1) in Phase 5; nothing stored at rest
- [x] Read the actual current behavior rather than the description of it:
      `worker/start` no longer shells `make lc-start` (track 1114 changed it),
      `worker/stop` still does, and `/api/workers/:id/stop` has the same defect
- [x] Second pass (2026-09-06): re-verified every code reference in `spec.md`
      against the current tree — all correct — and found three gaps the first
      pass missed: a fifth defective route (REQ-23), the auth-vs-capability
      confusion (REQ-24), and the Atlas-managed migration constraint. The
      stale line numbers in `index.md` (`:519`, `:8359`) were corrected to the
      real ones (`:432`, `:6571`)
- [ ] Human confirms D4 and the D2 spin-out before Phase 5 starts

**Impact**: Phases 2–6 have a single contract to build against.

## Phase 2: Instance definition and capability endpoint

**Problem**: The UI guesses at what the server may do, from the browser's
hostname (`IS_LOCAL_HOST` in `WorkersList.jsx`). The server never says.
**Solution**: The API declares its own mode and capabilities; the UI reads them.

- [ ] `ui/server/instance.mjs` — resolve mode per D1's order, validate the
      value, fail startup loudly on an unrecognized one
- [ ] `GET /api/instance` (REQ-1, REQ-2), with the `admins` list returned only
      to an admin
- [ ] Admin bootstrap: `LC_INSTANCE_ADMINS` / `instance.json`, first
      authenticated user recorded when the list is empty (REQ, D2)
- [ ] Gate `POST /api/workers/manager/start` on `api+workers`, returning 409
      with an explanation (REQ-3)
- [ ] Delete `IS_LOCAL_HOST`; drive its three call sites in `WorkersList.jsx`
      (lines 209, 328, 409) from `capabilities.local_worker_start`, and update
      the stale reference to it in `CreateManagerWorkerForm.jsx:21`'s comment
      (REQ-4)
- [ ] Add `requireAuth` to the four unauthenticated worker-spawning routes, and
      admin-only to `workers/manager/start` (REQ-24) — the capability flag
      answers "may this instance", never "may this caller"
- [ ] Add `instance.json` to `.gitignore`

**Impact**: A hosted deployment stops offering buttons that would run on the
wrong machine, and a local stack behaves exactly as it does today.

## Phase 3: Enrollment tokens and the bootstrap command

**Problem**: The first worker on a host cannot be dispatched to — nothing is
polling there yet — and the only existing answer is a hand-typed
`lc worker start --manager`.
**Solution**: A single-use, short-TTL enrollment token that a one-line command
trades for a real API key, then starts a manager worker.

- [ ] Migration: `enrollment_tokens` table (REQ-8) — through `schema.prisma` +
      `atlas migrate dev`, never a hand-dropped `.sql` (see spec's
      Implementation constraints; `migrations/atlas.sum` breaks repo-wide)
- [ ] `POST /api/enrollment-tokens`, `GET /api/enrollment-tokens` (REQ-9)
- [ ] `POST /worker/enroll` — validate, mark used, mint the `lc_live_*` key
      through the existing `api_keys` path, return collector URL and projects
      dir; expired / already-used / unknown are three distinguishable failures
      (REQ-10)
- [ ] `lc enroll --token --url [--projects-dir]` — writes the host directory
      (`.laneconductor.json`, `.env`, `conductor/`) and starts the manager from
      it (REQ-11)
- [ ] Bootstrap script served by the instance, parameterized only by token and
      URL, usable verbatim as cloud-init `user_data` (REQ-12)
- [ ] Verify the enrolled manager lands under the right `user_uid` and that
      re-enrolling the same host updates rather than duplicates (REQ-13)

**Impact**: "I have a machine" becomes one copy-pasteable command. This phase
alone closes the bootstrap gap; Phases 4 and 5 make it discoverable and
automatic.

## Phase 4: Zero-hosts detection and the first-host screen

**Problem**: A user with no machines sees an empty board and no explanation.
**Solution**: Detect the state honestly and offer the two paths.

- [ ] `GET /api/hosts/summary` (REQ-5), live-only (REQ-6), and without the
      `user_uid IS NULL` clause that would count a stranger's unattributed
      worker as yours (REQ-7)
- [ ] First-host screen: the two-path chooser, the cost statement (REQ-17), and
      the "I have a machine" path rendering Phase 3's command with a real token
- [ ] Pending state: an enrollment that has been minted but not yet consumed
      shows "waiting for your machine to connect", not a repeat of the chooser
- [ ] Expired state: the token's TTL elapsed with no enrollment → say the
      machine never connected, offer a fresh token, and point at outbound HTTPS
      as the usual cause
- [ ] The screen disappears the moment a live attributable host exists

**Impact**: The dead end described in the Problem statement no longer exists,
with or without Phase 5.

## Phase 5: VM creation for the first provider

**Problem**: A user with no machine at all still has to go get one.
**Solution**: Create it for them, from a token they paste and we never keep.

- [ ] Migration: `vm_provisions` table (REQ-16) — same Atlas path as Phase 3
- [ ] Provider driver interface plus the Hetzner implementation (REQ-14)
- [ ] `POST /api/vm-provisions` — mints its own enrollment token, passes the
      bootstrap as `user_data`, uses the provider token for that call only and
      never persists or logs it (REQ-15)
- [ ] Provisioning status surfaced server-side so closing the tab loses nothing
      (REQ-16), including created-but-never-enrolled VMs with their provider
      server id (REQ-18)
- [ ] Cost and size selection in the chooser (REQ-17)
- [ ] DigitalOcean as a second driver against the same interface (REQ-14) —
      only after Hetzner is proven end to end

**Impact**: "Create a worker VM for me" works for real, on one provider, with
no credential ever stored.

## Phase 6: Retire the direct api→machine provisioning route

**Problem**: Two provisioning routes with different machine semantics, one of
which silently targets the wrong machine off localhost.
**Solution**: Delete it, now that the bootstrap it was standing in for exists.

- [ ] Remove `POST /api/projects/:id/worker/start` and `.../worker/stop` and
      their callers (REQ-19)
- [ ] Fix or gate `POST /api/workers/:id/stop` (REQ-20) — same defect,
      confirmed
- [ ] Fix or gate `POST /api/projects/:id/workers/start-new` (REQ-23) — the
      fifth route, missing from every earlier list including index.md's,
      reached from the track panel rather than `WorkersList.jsx`
- [ ] Keep `POST /api/workers/manager/start` and `CreateManagerWorkerForm`,
      gated on `api+workers` rather than deleted (REQ-21)
- [ ] `conductor/product.md`: enrollment for the first worker on a host,
      dispatch for every one after it (REQ-22)
- [ ] Confirm no remaining caller depends on the removed routes
- [ ] Enumerate every `execAsync`/`execFileAsync` call site in
      `ui/server/index.mjs` and account for each (AC-10) — enumerate the shell
      calls, do not grep for route names; that is how REQ-23 was missed

**Impact**: One documented answer to "which component starts a worker on which
machine".

## Phase 7: Negative paths and end-to-end verification

**Problem**: Every failure in this flow happens on someone else's machine,
where a silent failure looks identical to a slow success.
**Solution**: Make each one produce a distinct, visible outcome, and prove it.

- [ ] Bad / expired / reused enrollment token (AC-4)
- [ ] VM created but never phones home (AC-7)
- [ ] User closes the tab mid-provision (AC-7)
- [ ] Invalid provider credentials, rejected before any server exists (AC-8)
- [ ] Unattributed workers do not mask the zero-hosts state (AC-5)
- [ ] Full remote-mode walkthrough on a locally hosted remote configuration:
      auth enabled, API and worker on separate hosts — production is blocked on
      track 10052, so this is the verification environment, not a substitute
      for it

**Impact**: Track 1107's remote walkthrough can start from a fresh user with no
side channel.

## Deferred, and not satisfiable by any acceptance criterion here

These are named so nothing later mistakes them for done:

- AWS, GCP and Azure provider drivers (D4)
- Cloud credentials at rest, and OAuth into a cloud account (D5)
- Runtime instance-mode switching (D3)
- The full instance admin/role model (D2 — recommended follow-up track)
- Production remote-api rollout, blocked on track 10052
