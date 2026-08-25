# Track 1118: Manager worker needs its own credential storage

**Lane**: review
**Merge Mode**: direct
**Lane Status**: queue
**Progress**: 100%
**Last Run**: mock (primary)
**Phase**: Planned
**Type**: bug
**Track Kind**: bug
**Summary**: A manager worker has no credential storage or endpoint of its own — started from a directory that is also a real project, it borrows that project's token (from .env, the per-worker token store, AND…

## Problem

Filed from [1102](../1102-e2e-session-findings/index.md) F13. `resolveCollectorToken()`
(`conductor/laneconductor.sync.mjs:706`) falls through to
`collectors[0].machine_token` — read from whatever `.laneconductor.json`
is in the current working directory. A manager worker started from a
directory that is *also* a real project (a common setup for a solo
developer running `lc worker start --manager` from inside a project they
also work on) has no credential storage of its own — it authenticates its
heartbeats using that co-located project's `machine_token`.

This caused a concrete incident (F13): the server's `collectorAuth`
resolved `req.worker_project_id` from that token's owning row (the
project worker's), and the heartbeat handler's old precedence let that
auth-derived value silently win over the manager's own correct
`project_id: null` — every manager heartbeat overwrote the *project
worker's* row with the manager's own `pid`, causing the pid to flap
between the two processes every ~10s.

**F13 fixed only the symptom**: the heartbeat handler now trusts an
explicit `project_id` in the request body (including an explicit `null`)
over the auth-derived value. The manager still has no credential storage
of its own — any other code path that resolves identity/auth from the
co-located project's token could reproduce a variant of this bug.

## Solution

A manager should persist its own `machine_token` in
`~/.laneconductor/manager-config.json` (alongside the existing
`projectsDir` setting) rather than ever reading `collectors[].machine_token`
from whatever directory it happens to be started in.

## Phases

Expanded from the four phases originally filed here — see `plan.md` for the
mapping. The audit (filed Phase 3) ran during planning and found four more
live defects in this class, which is why it splits into two phases.

- [ ] Phase 1: Server — `POST /worker/register`'s manager branch returns a `machine_token` it never persists (missing from its `ON CONFLICT DO UPDATE`), so every manager restart adopts a dead credential. Hard blocker for the rest.
- [ ] Phase 2: `manager-config.json` becomes the manager's credential store — shared read/write module, `0600`, `collectors` + `bootstrap_key`, `lc worker start --manager --collector/--key`
- [ ] Phase 3: Manager token/collector resolution reads only that store — never the launch directory's `.env`, per-worker token store, or `.laneconductor.json`
- [ ] Phase 4: A manager writes nothing into its launch directory — it currently shares the project worker's `.worker.tokens.json` and `.sync.pid`, scaffolds `conductor/` there, and live-reloads that project's config
- [ ] Phase 5: Close the remaining borrowed-identity call sites — `DELETE /worker` still carries the exact F13 precedence bug and marks the co-located project worker offline on manager shutdown
- [ ] Phase 6: Regression tests — decoy-token fixture proving a manager reads none of the four borrowable sources, plus manager/project-worker co-existence

## Depends on
[1102](../1102-e2e-session-findings/index.md) F13 (symptom fix, traced this deeper cause), [1091](../1091-manager-worker-and-new-project-flow/index.md) (manager worker design).
**Auto Run**: yes
