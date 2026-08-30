# Track 1108: Worker VM provisioning from the remote app (first-host onboarding)

**Lane**: backlog
**Lane Status**: success
**Progress**: 100%
**Phase**: New
**Type**: dev
**Summary**: In remote app/api mode, a user who logs in with zero registered hosts currently hits a dead end — nothing can run anywhere. Detect that state and offer creating a worker VM on the major hosting…

## Problem

In remote mode the app is useful only once at least one machine is running
a worker — and a brand-new user has none. Today nothing detects or
addresses this: the UI just looks empty, with no path from "I signed up"
to "I have a machine doing work". The New Project / provisioning flows all
assume a manager worker already exists somewhere
([1089](../1089-remote-worker-provisioning/index.md) /
[1091](../1091-manager-worker-and-new-project-flow/index.md) both
bootstrap from an existing manager), and
[1103](../1103-e2e-onboarding-experience/index.md)'s machine-model
questions (Q3) stop at *showing* which machines exist — not at getting the
first one.

Note: [1089](../1089-remote-worker-provisioning/index.md) explicitly
declared cloud compute provisioning out of scope ("a materially bigger,
different feature — cloud account, billing, image/container build,
security hardening"). This track IS that feature, now deliberately in
scope as its own effort rather than scope-creep on 1089.

## Solution (to be refined at planning)

- **Detect the zero-hosts state on login** (remote mode): user
  authenticated, no live workers registered under their identity → show a
  first-host onboarding flow instead of an empty dashboard.
- **Offer two paths**:
  1. **"I have a machine"** — guided instructions for installing
     LaneConductor and running the one-time
     `lc worker start --manager --projects-dir <path>` bootstrap
     (the same one-time step 1089/1091 already assume; here it finally
     gets a user-facing home).
  2. **"Create a worker VM for me"** — provision a VM on the big hosting
     clouds (candidate set for planning: AWS, GCP, Azure, DigitalOcean,
     Hetzner — pick the initial 1-2 by effort/demand, don't promise all
     five at once), cloud-init/startup script installs LaneConductor,
     registers the manager worker against this user's account (API key /
     machine_token flow from [1033](../1033-track-1033-worker-use-connection/index.md)),
     and the dashboard shows the new host coming online.
- Credentials model needs real design: the user's cloud credentials/API
  keys must not be stored by the Collector beyond what's strictly needed —
  likely a bring-your-own-token flow per cloud, or generated cloud-init
  the user pastes themselves as a first increment.
- The zero-hosts screen is also where quota/cost expectations get set (a
  VM running an LLM worker costs real money — say so up front).
- **Instance mode is a config choice, not just a VM-provisioning detail.**
  Any remote API launch — not only ones created through this track's
  "Create a worker VM for me" path — should be able to declare whether the
  instance backing it may also run a worker, not just serve API/UI
  traffic:
  1. **api-only** — Collector API + UI, no local execution capacity.
  2. **api + workers** — full dev VM: same Collector API, plus a manager
     worker running on that same instance.
  This needs a home broader than one VM's cloud-init script — likely a
  general LaneConductor **instance definition** (what an "instance" is:
  its API/UI, its mode, which workers are attached to it) that both this
  track's provisioned VMs and any other remote-api deployment read from.
  Where exactly that gets defined, and how instance admins are identified
  and authorized to change the mode after launch, is open — see below.

## Open Questions (raised 2026-08-18, folded into Phase 1)
- Where does "instance mode" (api-only vs. api+workers) get declared and
  read from — per-instance config on the Collector, a field on the
  `.laneconductor.json`-equivalent for remote instances, or a new general
  LaneConductor instance/UI/API definition doc/schema that doesn't exist
  yet? No existing track owns this.
- How do we define "admin" for a LaneConductor instance (who can flip the
  mode, who can provision/deprovision workers on it)? No existing track
  addresses instance-level admin roles — [1003](../1003-laneconductor-app-billing/index.md)'s
  "admin" is a billing/analytics dashboard, not this.
- Does switching an existing api-only instance to api+workers (after
  launch) need to be supported, or is mode fixed at creation time for v1?

## Phases
- [ ] Phase 1: Plan — zero-hosts detection contract, which clouds first, credentials model (BYO-token vs. paste-cloud-init), the exact bootstrap the VM runs, **and the instance-mode (api-only vs. api+workers) + admin-model questions above**
- [ ] Phase 2: Zero-hosts onboarding UI (remote mode): detection + the two-path chooser + "I have a machine" instructions
- [ ] Phase 3: VM creation path for the first cloud(s), incl. startup script that installs, registers the manager, and appears on the dashboard
- [ ] Phase 4: Tests + the negative paths (bad credentials, VM never phones home, user closes mid-provision)

## Depends on
[1033](../1033-track-1033-worker-use-connection/index.md) — auth/API-key machinery the VM registers through. [1091](../1091-manager-worker-and-new-project-flow/index.md) — the manager worker the VM bootstraps. [1103](../1103-e2e-onboarding-experience/index.md) — the onboarding design this extends to "zero machines".

## Validated by
[1107](../1107-e2e-remote-api-walkthrough/index.md) — the remote e2e walkthrough starts from a fresh user with zero hosts, so its first step exercises exactly this flow; this track is a prerequisite for that walkthrough to complete without side channels.
