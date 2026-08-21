# Spec: Track 10022 — make install: end-to-end DB provisioning & lc setup integration

## Problem Statement

Running `make install` on a fresh clone installs Node, UI deps, and the `lc` CLI — but leaves the user with a broken API (500 errors) because Postgres is never provisioned. The user has no guidance on what to do next. A first-time install on WSL/Linux also silently uses Windows node_modules (wrong platform binaries), causing Vite/rollup to crash.

Additionally `lc setup` (which handles per-project DB config) is completely disconnected from `make install` — there is no handoff between them.

## Requirements

- REQ-1: `make install` must provision Postgres if not already running — offer Docker (recommended) or native, never silently skip.
- REQ-2: When Docker is chosen, spin up the `laneconductor-pg` container automatically and wait for readiness before proceeding.
- REQ-3: `make install` must run DB migrations after Postgres is ready.
- REQ-4: `make install` must start the API + UI at the end so the dashboard is immediately accessible.
- REQ-5: `lc setup` (when `local-api` mode is selected) must check DB connectivity before asking for credentials — if unreachable, offer Docker as a fix with a one-liner.
- REQ-6: `lc setup` must be invoked (or prominently prompted) at the end of `make install` to complete the per-project registration.
- REQ-7: The Windows-node-interop detection (node path under `/mnt/`) already implemented must remain in place.
- REQ-8: All steps must be idempotent — re-running `make install` on an already-set-up machine must be safe and fast.

## Acceptance Criteria

- [ ] Fresh WSL/Linux clone: `make install` completes with Postgres running, migrations applied, UI at :8090, and user prompted to run `lc setup` in their project.
- [ ] Re-run on already-configured machine: `make install` detects existing container/Postgres and skips provisioning — no errors, no duplicate containers.
- [ ] `lc setup local-api` with Postgres unreachable: user is offered Docker start option; accepting it makes the setup proceed without manual intervention.
- [ ] `lc setup` at end of `make install` is either auto-launched (if in a project dir) or clearly prompted.
- [ ] Windows node_modules detected: cleaned and reinstalled with Linux binaries (existing behaviour retained).

## Depends On

- Track 1063 (setup simplification) — done, provides `lc setup` flow foundation
- Track 1103 (e2e onboarding) — in plan, this track feeds into its CLI path

## Decisions

- **make install scope**: handles all machine-level setup (DB, Atlas, migrations, UI start). It does NOT auto-launch `lc setup` — that is per-project and run separately from each project dir. End of `make install` prints "Next: cd your-project && lc setup".
- **Migrations**: Atlas is the canonical migration tool and must be installed as part of `make install` (new `install-atlas` step). No Node.js fallback — Atlas is the way.
