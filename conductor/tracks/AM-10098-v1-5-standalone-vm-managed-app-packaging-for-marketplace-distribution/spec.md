# Spec: V1.5 — Standalone VM / Managed-App packaging for marketplace distribution

## Problem Statement

LaneConductor today is installed by cloning this repo and running `make install` on a
developer's own machine. That install path assumes a great deal about the machine it lands on
(a developer's `$HOME`, a `sudo`-able shell, an already-authenticated agent CLI, Docker, a
hand-started Vite dev server) and none of it is verified on any machine except the author's.

V1.5 is the **single-tenant distribution** path: a customer deploys their own standalone
instance into their own cloud subscription — a marketplace VM image, or an Azure Managed
Application ARM/Bicep template deploying that same payload. LaneConductor holds no customer
credentials, no shared infrastructure, no multi-tenant state, and no billing surface. That is
what makes it materially nearer-term and lower-risk than TU-10048 (V2 managed hosting), which
needs all four.

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
- Choosing a marketplace vendor account or submitting a listing.
- Pricing and commercial packaging — a business decision, explicitly out of scope.
- Anything multi-tenant. That is TU-10048's problem, not this track's.

## Decisions

Each open question carried on this track's `index.md` is resolved below. Decisions marked
**[business]** are the author's call and are recorded here as a recommendation, not a
technical finding.

### D-1 — Packaging format: a VM image whose payload is a container stack

**Decision:** ship a **VM image (AWS AMI / Azure VHD / GCP image) that boots a
docker-compose stack** — Postgres, the Express API, the built UI, and the sync worker — with
customer project checkouts on a persistent host volume. Not a bare VM with host-installed
Node/Postgres; not a pure serverless container app.

Rationale, all from the current code:
- **Containers are already in the dependency chain.** `make install-db` (and `lc setup`'s DB
  fallback) already `docker run postgres:16`. Requiring Docker on the image costs nothing new.
- **There is no compiled artifact to ship.** `ui/server/index.mjs` imports ~20 modules from
  `../../conductor/`, and `getInstallPath()`/`resolveSyncScript()` (`bin/lc.mjs:100`, `:330`)
  resolve the worker script from a repo root recorded in `~/.laneconductorrc`. The deployable
  unit is the whole repo tree, which is exactly what a container image is good at.
- **But it needs a real, writable, persistent filesystem and the customer's own CLI.** The
  worker creates git worktrees and `spawn`s the customer's agent CLI (`claude`/`agy`). That
  rules out a locked-down serverless container and argues for a VM the customer can SSH into
  and point at their own repos.

**[business]** Target the **plain marketplace VM image on a single platform first**, not the
Azure Managed Application. A Managed Application's distinguishing feature is a
*publisher-managed* resource group — which directly contradicts the product's sovereignty
positioning and reintroduces a slice of the vendor-holds-customer-infrastructure surface this
track exists to avoid. Add the Managed Application wrapper later, over the same image, if a
customer asks for it.

### D-2 — First-run: yes, `lc setup` needs a non-interactive mode

`runSetup()` (`bin/lc.mjs:805`) is a linear chain of `await question(...)` prompts with no
flag-driven or file-driven path. A booting VM image has nobody to answer them, so first boot
would hang or leave the instance unconfigured.

**Decision:** two-part first run.
1. **Unattended:** `lc setup --non-interactive --seed <file>` reads a seed JSON
   (`/etc/laneconductor/seed.json`, written by cloud-init / ARM template parameters) and
   provisions mode, DB connection, ports and paths with no TTY.
2. **Attended, in the browser:** the UI's first-run screen collects only what genuinely needs
   a human — an admin credential for the instance (REQ-2) and the customer's own agent-CLI
   authentication (REQ-7). No license key is collected (D-4).

### D-3 — Updates: pinned image tags + `lc update`, not a git pull

This repo's canonical-install model does not translate. `getInstallPath()` reads
`~/.laneconductorrc` to find a shared checkout that a customer VM will not have, and schema
migrations run exactly once, at `make install` (`install-migrate`), via an Atlas CLI that
`make install-atlas` fetches by piping `https://atlasgo.sh` into `sh`.

**Decision:** `lc update` pulls version-pinned container images, runs Atlas migrations, and
restarts the stack. Atlas is **baked into the image** — no `curl | sh` at update time on a
customer machine. Migrations run on **every boot and every update**, not once at install.
Customer-managed (SSH in and update by hand) stays available but is not the documented path.

### D-4 — Licensing/entitlement: no technical gate

A grep of `bin/`, `conductor/`, and `ui/server/` finds **no license-key or entitlement
machinery of any kind** today. ELv2's "you may not circumvent the license key functionality"
clause is conditional on such functionality existing — it creates no obligation to add one.

**Decision:** ship no license gate. The marketplace's own entitlement and billing is the
commercial control, ELv2 is the legal one, and adding a key check would require exactly the
phone-home dependency D-5 rejects.

### D-5 — Telemetry: none by default; a pull-based support bundle instead

The product's own positioning in `conductor/product.md` is "Sovereign: 100% local — no cloud,
no auth, no cost". Automatic phone-home contradicts that in a way a customer evaluating a
sovereign product will notice.

**Decision:** no automatic telemetry, no crash reporting, opt-in or otherwise, in v1.5.
Support is served by `lc support-bundle` — a command that writes a **local, redacted** tarball
(logs, versions, config with secrets stripped) that the customer chooses whether to send.

This is not merely a preference: REQ-1 documents an *existing, unintentional* egress path that
must be closed before any image ships, or the "100% local" claim is false on a customer VM.

### D-6 — Marketplace requirements: scope after platform choice

Per-platform certification is bureaucratic, not engineering, work and should be scoped once
D-1's platform is chosen. The engineering-visible subset is generic across platforms and is
captured as REQ-6, REQ-10, REQ-11 and REQ-12 rather than deferred: no default passwords,
first-boot credential generation, documented open ports, reproducible image provenance,
bundled licence and third-party attribution.

### D-7 — Pricing/packaging: out of scope

Restated from `index.md`. Not a technical requirement; no engineering work depends on it.

## Requirements

Every requirement below is a **prerequisite gap found in the current code**, not a
nice-to-have. REQ-1, REQ-2 and REQ-7 are hard blockers: shipping an image without them
produces an instance that is respectively dishonest, remotely exploitable, or non-functional.

- **REQ-1 (blocker) — Remove or gate the hardcoded cloud proxy.**
  `ui/server/index.mjs:176-213` installs a global middleware that, for any request whose
  `req.hostname` is neither `localhost` nor `127.0.0.1`, forwards the request to a hardcoded
  Cloud Run URL (`https://api-pu7bcq73zq-uc.a.run.app`) and returns that response verbatim,
  never reaching the local handler. A customer reaching their own VM by its public DNS name or
  IP would therefore have every `/api/*`, `/track/*`, `/worker/*` call silently served by the
  vendor's cloud — a functional break *and* a data-egress violation of the sovereignty claim.
  The proxy must be off unless explicitly enabled.

- **REQ-2 (blocker) — Bind and authenticate the instance.**
  `server.listen(PORT, ...)` (`ui/server/index.mjs:5995`) passes no host, so the API binds all
  interfaces. `loadAuthConfig()` (`ui/server/auth.mjs`) sets `AUTH_ENABLED = false` whenever
  `VITE_FIREBASE_PROJECT_ID` is unset, which is the standalone case by definition — so
  `requireAuth` passes everything through. The API spawns agent CLI processes and performs git
  and filesystem operations on the host. Unauthenticated on a routable interface, that is
  remote code execution. Needs: loopback binding by default, plus a local auth mode that does
  not require a Firebase project (Firebase is a cloud dependency this deployment model must
  not have).

- **REQ-3 — Serve a built UI, not the Vite dev server.**
  `conductor/systemd/laneconductor-ui.service` runs `ui/node_modules/.bin/vite`. Nothing in
  `ui/server/index.mjs` serves `ui/dist` (no `express.static`, no `sendFile`), and the dev
  server's `/api` and `/auth` proxying lives in `ui/vite.config.js`, so removing it moves that
  routing responsibility to Express. A shipped image must run `vite build` and serve static
  assets.

- **REQ-4 — Path-portable services.** All three units in `conductor/systemd/` hardcode
  `/home/meller/Code/laneconductor`, and the worker unit additionally hardcodes
  `Environment=PATH=/home/meller/.local/bin:...` to find the `claude` binary. None of these
  paths exist on a customer VM. The image needs generated or templated units over a fixed
  install prefix.

- **REQ-5 — Non-interactive provisioning.** Implements D-2 part 1: `lc setup
  --non-interactive --seed <file>`, covering every prompt in `runSetup()` including the DB
  fallback branch, with a non-zero exit and a clear diagnostic when the seed is incomplete
  rather than falling back to a prompt.

- **REQ-6 — No default credentials.** `make install-db`, `lc setup`'s Docker fallback, and
  `.env.example` all use `postgres`/`postgres`, with 5432 published to the host. First boot
  must generate a unique DB credential, store it where the stack reads it, and never publish
  the DB port beyond the compose network.

- **REQ-7 (blocker) — Customer-supplied agent CLI and authentication.**
  *Not previously captured as an open question, and the largest product-level risk on this
  track.* LaneConductor performs no work without an agent CLI that is both installed and
  logged in: `conductor/providers.mjs` enumerates `claude`, `antigravity`, `copilot` and a
  retired `gemini`, and `spawnCli` launches that binary as the executing user. A marketplace
  image cannot ship Anthropic credentials, and a customer who deploys expecting a working
  product gets an instance that plans nothing and implements nothing until they bring their
  own subscription. This needs: an explicit prerequisite on the listing, a first-run step that
  verifies reachability *and* authentication (not just `--version`, which `lc setup` checks
  today), and an unmistakable UI state when no provider is authenticated.

- **REQ-8 — Update and migration mechanism.** Implements D-3: `lc update`, image-tag pinning,
  Atlas baked into the image, migrations applied on every boot and update.

- **REQ-9 — Fixed project path convention.** Project identity is the absolute `repo_path`
  (`projects.repo_path UNIQUE`, and `.laneconductor.json`'s own `project.repo_path`). The image
  needs a documented convention — e.g. `/var/lib/laneconductor/projects/<name>` — so that
  config, backups and restores are portable across a re-deployed instance.

- **REQ-10 — Reproducible, version-stamped image build.** Built from a tagged commit, with the
  version reachable from `lc --version` and visible in the UI, so a support conversation can
  establish what the customer is actually running.

- **REQ-11 — Licence and attribution artifacts.** `LICENSE` present in the image, plus
  third-party dependency attributions, as every marketplace certification requires.

- **REQ-12 — Documented prerequisites, ports and sizing** on the listing: the agent-CLI
  prerequisite from REQ-7, which ports are open, and a resource floor (Postgres, Node, the
  UI, and N concurrent agent CLI processes is not a 1-vCPU workload).

## Prior groundwork that de-risks this

Already shipped, and directly load-bearing for a customer install:
- **AM-10093** — a written lane change could be silently reverted by a stale concurrent
  dispatch or DB pull. Flagged at the time as marketplace hardening: a customer instance
  restarted repeatedly during upgrades or crashes is precisely the environment that hits it.
- **AM-10097** — CLI setup and skill-only scaffold both now write a correct `.gitignore`,
  closing a real "works on the dogfooded install, breaks on a fresh one" gap.
- **AM-10096** — the nested `.claude/.claude` corruption bug and its cleanup tooling, which
  would otherwise bloat a customer's own repo silently over time.

## Acceptance Criteria — this planning pass

- [x] Every open question on `index.md` has a recorded decision with its rationale (D-1..D-7).
- [x] Prerequisite gaps are enumerated as requirements, each anchored to a specific file and
      the observed behaviour that makes it a gap (REQ-1..REQ-12).
- [x] The three hard blockers are identified and distinguished from ordinary work.
- [x] `plan.md` carries the eventual build as explicitly unstarted phases.

## Acceptance Criteria — v1.5 delivery (deferred; NOT satisfiable by this track)

These describe the shipped product and are listed so the eventual build has a target. This
track builds none of them, so it cannot reach `done` at 100% — that is intended.

- [ ] A customer deploys the listing into their own subscription and reaches a working
      dashboard over an authenticated connection, without SSH-ing in to finish setup.
- [ ] That instance serves every API call from its own process — verified by confirming no
      request leaves the VM to any vendor-controlled endpoint.
- [ ] The customer connects their own agent CLI credentials and an autonomous track runs
      plan → implement → review → quality-gate → done on their own repo.
- [ ] `lc update` moves a running instance to a newer version, applying schema migrations,
      without losing project or track data.
- [ ] No default credential exists anywhere on a freshly deployed instance.

## Open items for a human

- **[business]** Which marketplace first (D-1). Needs a vendor account and the author's
  commercial preference; no engineering work is blocked by it until Phase 5.
- **REQ-7's listing consequence:** whether a product that requires the customer to bring their
  own Anthropic subscription is viable as a paid marketplace listing, or whether that makes
  the whole distribution model commercially awkward. This is worth settling *before* Phase 1,
  because it can invalidate the track.
- **Fundamentals conflict (flagged, not acted on):** REQ-2 requires adding authentication to
  the instance, which contradicts `conductor/product.md`'s stated pillar *"Sovereign: 100%
  local — no cloud, no auth, no cost"*. REQ-1 also shows that the "100% local" half of that
  claim is already untrue for any non-localhost access. Separately, `conductor/tech-stack.md`
  documents no containerization or distribution layer, which D-1 would add. Neither document
  has been modified by this track — a human should decide whether the positioning is scoped to
  the self-hosted developer install (in which case the docs need a distribution caveat) or
  whether the standalone product is a deliberate exception to it.
