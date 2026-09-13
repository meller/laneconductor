# Track AM-10098: V1.5 — Standalone VM / Managed-App packaging

> **Status: deferred capture.** Phase 0 (this planning pass) is complete. Phases 1–6 describe
> the eventual v1.5 build and are deliberately unstarted — this track is not queued for
> implementation, and must not be marked `done` while they remain open. Same resting state as
> TU-10048.
>
> **Read `spec.md` first** — D-1..D-7 are the decisions these phases implement, and REQ-1,
> REQ-2 and REQ-7 are hard blockers. Settle `spec.md`'s "Open items for a human" (especially
> the REQ-7 commercial question) before starting Phase 1; it can invalidate the track.

## Phase 0: Decide the shape and inventory the prerequisites ✅

**Problem**: The open questions on `index.md` were unanswered, and nobody had checked what in
the current code actually stands between `make install` on the author's machine and a
deployable single-tenant image.
**Solution**: Resolve each question against the real code, and turn the findings into a
requirement list.

- [x] Resolve packaging format, first-run, updates, licensing, telemetry, marketplace scope,
      pricing → `spec.md` D-1..D-7
- [x] Audit the install path (`Makefile`, `bin/lc.mjs` `runSetup`/`getInstallPath`),
      the service units (`conductor/systemd/`), and the server
      (`ui/server/index.mjs`, `ui/server/auth.mjs`, `ui/vite.config.js`)
- [x] Record prerequisite gaps as REQ-1..REQ-12 with file-level anchors
- [x] Confirm the ELv2 position by reading `LICENSE` directly

**Impact**: The track now has a decided shape and a concrete, evidence-backed blocker list
instead of open questions. Three findings were not previously known: the cloud proxy
(REQ-1), the unauthenticated all-interfaces bind (REQ-2), and the customer-supplied agent CLI
problem (REQ-7).

## Phase 1: De-cloud and harden the local server

**Problem**: An instance reached by anything other than `localhost` silently proxies to the
vendor's cloud, binds every interface, and requires no authentication — while being able to
spawn processes on the host.
**Solution**: Make the standalone server genuinely standalone and closed by default.

- [ ] Task 1.1: Gate the Cloud Run proxy middleware (`ui/server/index.mjs:176-213`) behind an
      explicit opt-in; default off, hardcoded URL removed from the default path (REQ-1)
- [ ] Task 1.2: Bind the API to loopback by default, with the listen host configurable (REQ-2)
- [ ] Task 1.3: Add a local authentication mode that does not require a Firebase project, and
      make `requireAuth` fail closed when no auth mode is configured (REQ-2)
- [ ] Task 1.4: Build and serve the UI from Express (`vite build` → static), moving the `/api`
      and `/auth` routing out of `ui/vite.config.js` (REQ-3)

**Impact**: The same codebase can be exposed on a network interface without leaking traffic to
the vendor or handing a stranger process execution on the host.

## Phase 2: Path portability

**Problem**: Service units and install-path resolution hardcode the author's `$HOME`.
**Solution**: A fixed install prefix and generated units.

- [ ] Task 2.1: Template the three `conductor/systemd/` units over an install prefix and a
      resolved agent-CLI `PATH`, generated at provision time (REQ-4)
- [ ] Task 2.2: Establish and document the project path convention
      (`/var/lib/laneconductor/projects/<name>`), including what a backup/restore must carry
      given `projects.repo_path` is the identity key (REQ-9)

**Impact**: The stack starts and supervises itself on a machine that is not the author's.

## Phase 3: Unattended provisioning and first run

**Problem**: `lc setup` can only be driven by a human at a TTY, ships default credentials, and
verifies an agent CLI's presence but never its authentication.
**Solution**: Seed-driven provisioning, generated credentials, and an honest first-run state.

- [ ] Task 3.1: `lc setup --non-interactive --seed <file>` covering every `runSetup()` prompt,
      failing loudly on an incomplete seed rather than prompting (REQ-5)
- [ ] Task 3.2: Generate unique Postgres credentials at first boot; stop publishing 5432 to
      the host; purge `postgres`/`postgres` from the shipped defaults (REQ-6)
- [ ] Task 3.3: First-run UI screen: set the instance admin credential, connect the customer's
      own agent CLI, verify it is *authenticated* (not merely installed), and show an
      unmistakable non-functional state until it is (REQ-7)

**Impact**: A customer goes from "deployed" to "configured" without SSH, and is told plainly
when the instance cannot do any work yet.

## Phase 4: Updates and migrations

**Problem**: Updates assume a shared canonical checkout that a customer VM does not have, and
migrations run once at install behind an Atlas CLI fetched by `curl | sh`.
**Solution**: Pinned images, a first-class update command, migrations on every start.

- [ ] Task 4.1: Bake Atlas into the image; remove any network fetch from the update path
- [ ] Task 4.2: Apply migrations on every boot and every update, idempotently
- [ ] Task 4.3: `lc update` — pull pinned image tags, migrate, restart, report the resulting
      version; safe to re-run (REQ-8)
- [ ] Task 4.4: `lc support-bundle` — local, redacted diagnostics the customer chooses to send
      (D-5); explicitly no automatic phone-home

**Impact**: A deployed instance can receive fixes without the customer reasoning about schema
state, and support has something to ask for that does not require telemetry.

## Phase 5: Image build pipeline

**Problem**: There is no packaging artifact of any kind in the repo — no Dockerfile, no
compose file, no ARM/Bicep template.
**Solution**: A reproducible build from a tagged commit.

- [ ] Task 5.1: Compose stack (Postgres, API, UI, worker) with the persistent volume from
      Task 2.2
- [ ] Task 5.2: VM image build from a git tag, version-stamped so `lc --version` and the UI
      report what is actually running (REQ-10)
- [ ] Task 5.3: First-boot unit that runs Phase 3's provisioning then starts the stack
- [ ] Task 5.4: **[business gate]** Choose the target platform, then produce the
      platform-specific wrapper (AMI / VHD / GCP image; Managed Application template only if
      asked for — see D-1)

**Impact**: A customer-deployable artifact exists for the first time.

## Phase 6: Listing and certification

**Problem**: Marketplace listings carry per-platform requirements that are bureaucratic rather
than technical, and cannot be scoped before Phase 5's platform choice.
**Solution**: Satisfy them against the chosen platform.

- [ ] Task 6.1: Bundle `LICENSE` and third-party attributions in the image (REQ-11)
- [ ] Task 6.2: Document prerequisites (including REQ-7's agent-CLI requirement), open ports,
      and a resource floor (REQ-12)
- [ ] Task 6.3: Work the chosen platform's certification checklist (D-6)

**Impact**: The image is listable.
