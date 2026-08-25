# Track 1118: Manager worker needs its own credential storage

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: bug
**Summary**: A manager worker has no credential storage of its own — when started from a directory that is also a real project, it authenticates using that co-located project's own machine_token, which caused…

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
- [ ] Phase 1: Design manager-config.json's token storage/rotation and how a manager registers/obtains its own token
- [ ] Phase 2: Update resolveCollectorToken() (or add a manager-specific path) to use it instead of falling through to a co-located project's token
- [ ] Phase 3: Audit every other call site that currently assumes "the manager borrows a co-located project's identity" for similar risk
- [ ] Phase 4: Regression test — a manager started from inside a real project directory never reads that project's machine_token

## Depends on
[1102](../1102-e2e-session-findings/index.md) F13 (symptom fix, traced this deeper cause), [1091](../1091-manager-worker-and-new-project-flow/index.md) (manager worker design).
