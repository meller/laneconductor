# Track AM-10039: Cloud Workers — Claude Cloud Instances as Workers

**Lane**: plan
**Lane Status**: queue
**Waiting for reply**: yes
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Support "cloud workers": when creating a worker, choose machine-based (today's model) or a Claude cloud instance. Cloud workers need stored Claude account auth (per logged-in user) to launch cloud…

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

- [ ] Phase 1: Feasibility spike — cloud execution surface + auth flow (planning output)
