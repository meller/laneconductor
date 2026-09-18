# Spec: V1.5 — Standalone VM / Managed-App packaging for marketplace distribution

## Problem Statement

LaneConductor today is installed by cloning this repo and running `make install` on a
developer's own machine. That install path assumes a great deal about the machine it lands on
(a developer's `$HOME`, a `sudo`-able shell, an already-authenticated agent CLI, Docker, a
hand-started Vite dev server) and none of it is verified on any machine except the author's.

**North star:** one codebase, three deployment profiles — standalone (worker + hub-capable),
hub (org management, worker-less), federated hubs (private-tracker worker sharing). Sovereign,
vendor-agnostic, customer-owned. Vendor-hosted multi-tenant (TU-10048) is v3/later.

This track is the **v1.5 revenue unlock**: a single-tenant standalone instance a customer
deploys into their own Azure subscription — a dev-machine-class VM (16GB RAM minimum) with
Postgres, the API/UI, a worker and the agent CLI pre-installed and auto-starting — as an
**Azure Managed Application** (MSP/publisher-managed model: the publisher gets delegated access
into the customer resource group for support and updates).

**Roadmap Context & Execution Order (Order 3 of 5):**
1. **Execution order 1 of 5: AM-10099** — Release readiness: hardening gate before any marketplace
   image ships (**hard dependency**; nothing ships with untrusted tests or live lane-corruption paths).
2. **Execution order 2 of 5: AM-10100** — Run ledger: per-run `requested_by`, `executed_by`, and
   actual usage (ships single-node, included on this standalone image).
3. **Execution order 3 of 5: AM-10098 (This track)** — V1.5 standalone Azure Managed Application packaging.
4. **Execution order 4 of 5: AM-10101** — Hub deployment profile v2 (worker-less org management node).
5. **Execution order 5 of 5: AM-10102** — Federated hubs v2.5 (private-tracker worker sharing between hubs).

*Related:* AM-1120 (real-credential live deploy verification), AM-10091 (tighten auto-launch
Depends On gate to require `done:success`).

**Legal position (confirmed by reading this repo's own `LICENSE`, Elastic License 2.0,
copyright Asaf Meller 2026):** ELv2's hosted-service limitation binds a *licensee*, not the
licensor. The copyright holder distributing their own software as a VM image or Managed
Application listing is unrestricted by it. See D-4 for the consequence.

## Scope

**This track produces decisions and a prerequisite inventory.** It deliberately builds no
packaging artifacts — see Non-Goals. Its phases in `plan.md` describe the eventual v1.5 build
and are all unstarted; that is the intended resting state (same deferred-capture pattern as
TU-10048).

### Non-Goals
- Building the VM image, Dockerfile, compose stack, or ARM/Bicep template.
- Submitting a live listing to Microsoft Partner Center prior to Phase 5–6 execution.
- Pricing and commercial packaging — a business decision, explicitly out of scope.
- Anything multi-tenant. That is TU-10048's problem, not this track's.

## Decisions

Each open question carried on this track's `index.md` is resolved below.

### D-1 — Packaging format: Azure Managed Application (MSP model) over a dev-class VM

**Decision:** Target the **Azure Managed Application (MSP/publisher-managed model)** deploying a
dev-machine-class VM (16GB RAM minimum) that runs Postgres, the Express API, the built UI, and
the sync worker with customer project checkouts on a persistent host volume.

Rationale and reconciliation:
- **Commercial & Support Model:** The product owner decided on the Managed Application / MSP model
  for distribution. A Managed Application grants the publisher delegated access into the managed
  resource group for operational support and seamless updates, solving the customer-support gap
  while keeping execution single-tenant in the customer's cloud tenancy.
- **Resource Floor:** A dev-class machine (16GB RAM minimum) is required because Postgres, Node API/UI,
  and concurrent LLM agent CLI spawns (`claude`/`agy` running git, test runners, and compiles)
  cannot operate reliably on smaller VM SKUs (REQ-12).
- **Architecture:** VM boots a containerized/compose stack (or supervised systemd units) with
  persistent volume mapping for `/var/lib/laneconductor/projects/<name>`.

### D-2 — First-run: Zero-Secrets Bootstrap Form followed by Manager-driven Conversational Setup

`runSetup()` (`bin/lc.mjs:805`) is a linear chain of `await question(...)` prompts with no
headless path. A booting VM image cannot expect a human at a TTY.

**Decision:** Two-part first run:
1. **Bootstrap Secrets Form (Zero-Secrets Policy):** A dedicated, minimal first-run web form collects
   the necessary initial secrets: instance admin credentials, TLS setup, and the customer's Claude API key
   (the ToS-clean org-key path, headless-compatible). These values are written directly to `.env` or
   local secret storage. **Crucial Rule:** Secrets *never* enter `conversation.md` or the database.
2. **Manager-Driven Conversational Setup:** Once bootstrapped, the manager worker is seeded with
   `set-up-this-machine` instead of `create-a-project` (leveraging the "Create with chat" flow from
   Track 1091 Phase 7 / AM-1119). The manager conversationally discovers repositories, verifies
   git access, and configures optional hub registration.

### D-3 — Updates: pinned image tags + `lc update`, not a git pull

This repo's canonical-install model does not translate. `getInstallPath()` reads
`~/.laneconductorrc` to find a shared checkout that a customer VM will not have, and schema
migrations run exactly once, at `make install` (`install-migrate`), via an Atlas CLI that
`make install-atlas` fetches by piping `https://atlasgo.sh` into `sh`.

**Decision:** `lc update` pulls version-pinned container images, runs Atlas migrations, and
restarts the stack. Atlas is **baked into the image** — no `curl | sh` at update time on a
customer machine. Migrations run on **every boot and every update**, not once at install.
Managed Application update packages apply via ARM template updates or `lc update`.

### D-4 — Licensing/entitlement: no technical gate

A grep of `bin/`, `conductor/`, and `ui/server/` finds **no license-key or entitlement
machinery of any kind** today. ELv2's "you may not circumvent the license key functionality"
clause is conditional on such functionality existing — it creates no obligation to add one.

**Decision:** ship no license gate. The Azure Marketplace's own entitlement and billing is the
commercial control, ELv2 is the legal one, and adding a key check would require a phone-home
dependency.

### D-5 — Telemetry: none by default; a pull-based support bundle instead

The product's positioning is sovereign and local. Automatic phone-home contradicts customer
expectations.

**Decision:** no automatic telemetry, no crash reporting, opt-in or otherwise, in v1.5.
Support is served by `lc support-bundle` — a command that writes a **local, redacted** tarball
(logs, versions, config with secrets stripped) that the customer or publisher support inspects.

### D-6 — Marketplace requirements: Azure Marketplace publisher certification

Engineering requirements for Azure Marketplace: no default passwords, first-boot credential
generation, documented open ports, reproducible image provenance, bundled license and third-party
attribution, and ARM template verification.

### D-7 — Pricing/packaging: out of scope

Restated from `index.md`. Marketplace SKU / billing structure is a business decision.

### D-8 — Hub-capable by design (AM-10101 Alignment)

**Decision:** The standalone v1.5 image ships **hub-capable by design**.
The configuration setting "which hub am I registered to" (the `collectors` array) ships
present-but-disabled (`enabled: false`). When Track AM-10101 (Hub v2) is deployed, existing
v1.5 standalone instances can register with the hub via a simple configuration toggle, without
requiring a full redeploy or rebuild.

### D-9 — Run ledger integration (AM-10100 Alignment)

**Decision:** The standalone v1.5 image includes the **run ledger** developed in Track AM-10100.
The single-node schema will include the `runs` table capturing `requested_by`, `executed_by`,
and parsed `stream-json` metrics (`total_cost_usd`, duration, token consumption), providing
immediate per-track and per-developer usage metrics on the local instance.

---

## Requirements

Every requirement below is a **prerequisite gap found in the current code** or an **external
roadmap gate**. REQ-13, REQ-1, REQ-2 and REQ-7 are hard blockers.

- **REQ-13 (blocker) — Release readiness hardening gate (Track AM-10099).**
  Nothing ships to a marketplace until the test suite is trustworthy and lane-state corruption paths
  are closed:
  - Migrate 25 worker-spawning tests to `isolated-worker.mjs` sandboxes.
  - Triage and fix baseline vitest/node:test flakies (~39 cases).
  - Resolve `lc worker run <track> --worker-number` parsing bug and claim-scoped worker cap.
  - Harmonize SKILL.md and `isTrackClaimable` regarding auto-run bypass.
  - Prevent DB->FS sync clobbering markers, and ensure process restart post-merge.

- **REQ-1 (blocker) — Remove or gate the hardcoded cloud proxy.**
  `ui/server/index.mjs:176-213` installs a global middleware that forwards non-localhost requests to
  a hardcoded Cloud Run URL. Must be gated behind an explicit opt-in and off by default.

- **REQ-2 (blocker) — Bind and authenticate the instance.**
  `server.listen` binds all interfaces while `loadAuthConfig` disables auth when Firebase is absent.
  Must default to loopback binding, and provide a local standalone auth mode that fails closed on
  routable interfaces.

- **REQ-7 (blocker) — Customer-supplied agent CLI and authentication.**
  LaneConductor requires an authenticated agent CLI (`claude`/`agy`). The listing must clearly state
  this prerequisite, first run must verify real authentication (not just `--version`), and the UI
  must display an unmistakable non-functional state until configured.

- **REQ-3 — Serve a built UI, not the Vite dev server.**
  Serve `ui/dist` via Express static middleware with direct API routing.

- **REQ-4 — Path-portable services.**
  Replace hardcoded `/home/meller/Code/laneconductor` and paths in `conductor/systemd/` with
  templated units over a configurable install prefix.

- **REQ-5 — Non-interactive provisioning.**
  Support unattended bootstrapping for image initialization without blocking on readline prompts.

- **REQ-6 — No default credentials.**
  Generate unique DB credentials at first boot, purge default `postgres`/`postgres`, and do not
  publish port 5432 outside the internal network.

- **REQ-8 — Update and migration mechanism.**
  `lc update` with baked-in Atlas CLI running idempotent migrations on every boot/update.

- **REQ-9 — Fixed project path convention.**
  Standardize on `/var/lib/laneconductor/projects/<name>` for consistent repository identity.

- **REQ-10 — Reproducible, version-stamped image build.**
  Built from tagged commits, reporting version via `lc --version` and UI.

- **REQ-11 — License and attribution artifacts.**
  Bundle `LICENSE` and dependency attributions in the image.

- **REQ-12 — Documented prerequisites, ports and sizing.**
  Document 16GB RAM minimum, open ingress ports, and agent CLI subscription requirement.

- **REQ-14 — Run ledger schema & capture (Track AM-10100).**
  Bundle the `runs` table and agent stream-json usage parser.

- **REQ-15 — Hub-ready configuration (Track AM-10101).**
  Ship `collectors` array present-but-disabled for future hub connectivity.

- **REQ-16 — Zero-Secrets Policy on first-run.**
  Ensure credentials entered during bootstrap form bypass conversation comments and database records.

---

## Prior Groundwork

- **AM-10093** — Fixed silent lane-change reverts from concurrent dispatches/DB pulls.
- **AM-10097** — Clean `.gitignore` templates preventing runtime state contamination.
- **AM-10096** — Nested `.claude` directory cleanup tooling.
- **AM-10091** — *Not* prior groundwork: still `backlog:queue`, unplanned, as of this
  writing. Its narrower core (`Depends On` gate requiring `done:success`) is being
  delivered instead by REQ-13's own gate track, AM-10099 (item (h)/REQ-12) — see
  that track's spec for why it deliberately doesn't close AM-10091 fully (broader
  dependency semantics stay with that track, left open).

---

## Acceptance Criteria — this planning pass

- [x] Every open question on `index.md` has a recorded decision (D-1..D-9).
- [x] Roadmap dependencies (AM-10099, AM-10100, AM-10101) and execution order (3 of 5) are defined.
- [x] Hard blockers identified: REQ-13 (AM-10099 gate), REQ-1 (proxy), REQ-2 (auth), REQ-7 (CLI auth).
- [x] Packaging reconciled with Azure Managed Application / MSP model.
- [x] First run updated to Zero-Secrets Bootstrap Form + Manager-driven setup.
- [x] `plan.md` reflects updated phases and external gates.

## Acceptance Criteria — v1.5 delivery (deferred)

- [ ] AM-10099 hardening gate passed with all test suites green.
- [ ] AM-10100 run ledger integrated and logging per-run metrics.
- [ ] Azure Managed Application template deploys successfully in customer Azure subscription.
- [ ] Bootstrap secrets form configures instance credentials without secret leakage.
- [ ] Manager agent successfully onboards repositories conversationally.
- [ ] Instance operates fully sovereign with no data leaking to vendor cloud endpoints.
- [ ] Hub registration can be enabled via config toggle without image rebuild.
