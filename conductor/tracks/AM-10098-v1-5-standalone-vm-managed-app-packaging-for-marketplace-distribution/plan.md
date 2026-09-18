# Track AM-10098: V1.5 — Standalone VM / Managed-App packaging

> **Status: deferred capture.** Phase 0 (this re-planning pass) is complete. Phases 1–6 describe
> the eventual v1.5 build and are deliberately unstarted — this track is not queued for
> implementation, and must not be marked `done` while they remain open. Same resting state as
> TU-10048.
>
> **Execution Order & Prerequisites:**
> - Execution Order: **3 of 5** in the sovereign roadmap.
> - Hard Pre-condition: **Track AM-10099** (*Release readiness hardening gate*, Order 1) must be
>   `done:success` before implementation begins.
> - Prerequisite: **Track AM-10100** (*Run ledger*, Order 2) must be `done:success` before image
>   bundling (Phase 2/5).
> - Downstream: **Track AM-10101** (*Hub profile v2*, Order 4) connects to this image via its
>   disabled-by-default `collectors` config.
>
> **Read `spec.md` first** — D-1..D-9 are the decisions these phases implement, and REQ-13, REQ-1,
> REQ-2, and REQ-7 are hard blockers.

## Phase 0: Re-plan and align with Roadmap & Azure Managed App model ✅

**Problem**: The original auto-plan was produced without knowing the 5-track roadmap, recommended
a bare VM over an Azure Managed Application (which conflicted with product direction), and assumed
an interactive CLI wizard rather than a manager-driven conversational first run.
**Solution**: Reconcile decisions against source code, roadmap tracks, and the product owner's
direction.

- [x] Resolve packaging format: Azure Managed Application (MSP model) over 16GB dev-class VM (D-1)
- [x] Establish roadmap execution order: AM-10099 (1) → AM-10100 (2) → AM-10098 (3) → AM-10101 (4) → AM-10102 (5)
- [x] Align first run with Zero-Secrets bootstrap form + manager conversational setup (D-2)
- [x] Establish hub-readiness requirement (D-8 / AM-10101 alignment)
- [x] Integrate single-node run ledger requirement (D-9 / AM-10100 alignment)
- [x] Record all prerequisite gaps as REQ-1..REQ-16 with file-level anchors

**Impact**: The track plan is completely aligned with the active roadmap, the Azure Managed App
model, and the zero-secrets policy.

---

## Prerequisite Gate Check (Before Phase 1 Execution)

- [ ] Verify Track **AM-10099** has reached `Lane: done, Lane Status: success` (REQ-13).
      No marketplace packaging begins with untrusted test suites or active lane-state corruption.
- [ ] Verify Track **AM-10100** has reached `Lane: done, Lane Status: success` (REQ-14).
      The single-node `runs` table and agent metric capture must be completed.

---

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

**Impact**: The codebase can be exposed on a network interface without leaking traffic to
the vendor or handing a stranger process execution on the host.

---

## Phase 2: Path portability, hub-readiness, and run ledger integration

**Problem**: Service units and install paths hardcode `/home/meller`, the hub configuration does
not ship pre-wired, and the run ledger schema from AM-10100 must be included.
**Solution**: Configurable install prefixes, templated units, disabled-by-default hub collector
settings, and run ledger persistence.

- [ ] Task 2.1: Template the three `conductor/systemd/` units over an install prefix and a
      resolved agent-CLI `PATH`, generated at provision time (REQ-4)
- [ ] Task 2.2: Establish and document the project path convention
      (`/var/lib/laneconductor/projects/<name>`), including what a backup/restore must carry
      given `projects.repo_path` is the identity key (REQ-9)
- [ ] Task 2.3: Ship the `collectors` array present-but-disabled in default config, verifying that
      an instance can register with a hub via config change without rebuild (REQ-15 / D-8)
- [ ] Task 2.4: Verify the single-node `runs` ledger from AM-10100 is packaged and initializes
      cleanly in the standalone DB schema (REQ-14 / D-9)

**Impact**: The stack starts and supervises itself cleanly on any host, supports run ledger
accounting, and is hub-capable by design.

---

## Phase 3: Bootstrap Secrets Form & Manager-driven Conversational Setup

**Problem**: `lc setup` requires an interactive terminal wizard, ships default credentials,
verifies agent CLI presence without verifying authentication, and riskily prompts for secrets.
**Solution**: A dedicated bootstrap secrets web form strictly enforcing the Zero-Secrets Policy,
followed by a conversational setup driven by the manager agent.

- [ ] Task 3.1: First-run bootstrap secrets web form: configure admin credential, TLS, and
      Claude API key (headless org-key path) directly into `.env` / key store (REQ-5, REQ-7, REQ-16)
- [ ] Task 3.2: Verify Zero-Secrets Policy: ensure bootstrap credentials are never written to
      `conversation.md` or the database (REQ-16)
- [ ] Task 3.3: First-run UI state: verify that the agent CLI is authenticated (not merely
      installed) and display an unmistakable non-functional state until configured (REQ-7)
- [ ] Task 3.4: Generate unique Postgres credentials at first boot, purge default `postgres`/`postgres`,
      and restrict port 5432 to internal network (REQ-6)
- [ ] Task 3.5: Seed the manager worker with `set-up-this-machine` task (leveraging Track 1091
      "Create with chat" flow) to conversationally discover repositories, configure git access,
      and handle optional hub registration

**Impact**: A customer configures the instance securely in a browser without SSH, secrets stay
out of project commentary, and the manager agent onboards projects smoothly.

---

## Phase 4: Updates, migrations, and support bundle

**Problem**: Customer VMs lack a canonical git checkout for updates, and migrations run once at
install behind `curl | sh`.
**Solution**: Pinned images, a first-class update command, migrations on every start, and a
redacted diagnostic bundle.

- [ ] Task 4.1: Bake Atlas into the image; remove any network fetch from the update path
- [ ] Task 4.2: Apply migrations on every boot and update idempotently, preserving existing
      project data and the `runs` ledger (REQ-8)
- [ ] Task 4.3: `lc update` — pull pinned image tags, migrate, restart, and report resulting version (REQ-8)
- [ ] Task 4.4: `lc support-bundle` — generate local, redacted diagnostics (logs, versions, configs
      with secrets stripped) for publisher support inspection with no automatic phone-home (D-5)

**Impact**: Managed instances update safely without data loss, and support can diagnose issues
without telemetry.

---

## Phase 5: Image build pipeline & Azure Managed Application packaging

**Problem**: No packaging artifacts exist in the repo.
**Solution**: Reproducible build pipeline for dev-class VM image and Azure Managed Application template.

- [ ] Task 5.1: Container compose stack (Postgres, API, UI, worker) with persistent volume mappings
- [ ] Task 5.2: Version-stamped VM image build from tagged commit, reporting via `lc --version` and UI (REQ-10)
- [ ] Task 5.3: First-boot unit that launches Phase 3 bootstrap provisioning then starts stack
- [ ] Task 5.4: Azure Managed Application ARM/Bicep template packaging, defining delegated publisher
      access permissions for the MSP model and sizing the VM to >= 16GB RAM (D-1, REQ-12)

**Impact**: A complete, listable Azure Managed Application package is produced.

---

## Phase 6: Azure Marketplace listing and certification

**Problem**: Marketplace listings require certification against technical and operational standards.
**Solution**: Fulfill Azure Marketplace publisher requirements.

- [ ] Task 6.1: Bundle `LICENSE` and third-party attributions in the image (REQ-11)
- [ ] Task 6.2: Document listing prerequisites (customer Claude API key / agent subscription),
      network security rules / open ports, and 16GB RAM floor (REQ-12)
- [ ] Task 6.3: Pass Azure Marketplace certification and test deployment in customer subscription (D-6)

**Impact**: The Azure Managed Application listing is published and verified.
