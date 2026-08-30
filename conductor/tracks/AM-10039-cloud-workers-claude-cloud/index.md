# Track AM-10039: Cloud Workers — Claude Cloud Instances as Workers

**Lane**: implement
**Lane Status**: waiting
**Waiting for reply**: yes
**Progress**: 10%
**Phase**: Phase 1 — Feasibility spike: NO-GO, awaiting human decision on fallback
**Type**: dev
**Track Kind**: feature
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Cloud-runtime workers executing lane actions in claude.ai cloud sessions (option A), via an executor seam over the existing worker, with per-user Claude credential storage, 4-check preflight,…

## Problem

Every worker today is a machine pulling from the queue — a laptop, a VM
(track 1108's provisioning path), or a self-hosted box. Claude can now run
sessions in the cloud (Claude Code web/cloud sessions), which means work
could execute with **no user-owned machine at all**. LaneConductor has no
worker type that dispatches to a Claude cloud instance, and no place to
hold the Claude account credentials such a dispatch requires.

## Solution (to be refined at planning)

- **Worker runtime type**: at worker creation, choose `machine` (today's
  model, unchanged) or `cloud` (a Claude cloud instance executes lane
  actions).
- **Claude auth**: cloud workers need credentials tied to the logged-in
  user's Claude account. Store per-user auth (OAuth token / API key) using
  the credential-storage patterns from
  [1118](../1118-manager-worker-credential-storage/index.md) and the
  worker identity / API-key model from
  [1033](../1033-track-1033-worker-use-connection/index.md) — never in
  `.laneconductor.json`, never in git.
- **Dispatch model inversion to investigate**: machine workers *pull* from
  the queue; a cloud worker is likely *pushed* to (something must call the
  cloud API to start a session per lane action). Candidate: the Collector
  (or a thin local manager) acts as dispatcher — reusing the queue,
  claim/allowlist ([1109](../1109-worker-claim-allowlist/index.md)), and
  lane state machine unchanged, with only the execution transport swapped.
- **Reuse**: lanes, workflow.json, tracks schema, conversation.md
  protocol, worker registration/visibility
  ([1029](../1029-machine-workers-view-in-all-projects-mode/index.md)),
  and the provider abstraction groundwork from
  [10011](../10011-new-worker-providers-support/index.md) should all carry
  over; a cloud worker is "just" a worker whose executor is a remote
  Claude session instead of a local CLI spawn.
- **Open feasibility questions for planning**: which cloud surface to
  target (Claude Code cloud sessions / Agent SDK / API-driven sandbox),
  how the cloud session gets repo access (GitHub App / token), how results
  and conversation.md updates flow back (webhook vs. polling), and cost /
  session-limit expectations surfaced in the UI.

## Related Tracks

- [1108](../1108-remote-worker-vm-provisioning/index.md) — VM provisioning (the "bring compute" sibling; this track removes the need for user compute)
- [1118](../1118-manager-worker-credential-storage/index.md) — credential storage patterns
- [1033](../1033-track-1033-worker-use-connection/index.md) — worker identity & API keys
- [10011](../10011-new-worker-providers-support/index.md) — worker provider abstraction

## Phases

- [ ] Phase 1: Feasibility spike — cloud session driver prototype (GO/NO-GO)
- [ ] Phase 2: Executor seam — refactor with zero behavior change
- [ ] Phase 3: Credentials, preflight, and the runtime field
- [ ] Phase 4: CloudSessionExecutor + implement lane in the cloud
- [ ] Phase 5: All lanes cloud + merge/conflict handling
- [ ] Phase 6: Dispatcher-only worker mode
- [ ] Phase 7: Docs + fundamentals reconciliation
- [ ] Phase 8: Inbound live callbacks (v2 — out of this pass, deliberately unchecked)

- [ ] Phase 1: Feasibility spike — cloud execution surface + auth flow (planning output)
