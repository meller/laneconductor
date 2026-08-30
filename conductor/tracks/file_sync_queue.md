## Track Creation Requests


## Completed Queue

### Track 10041: GitHub Actions Executor — Keyless Federated Cloud Workers
**Status**: processed
**Type**: track-create
**Created**: 2026-08-30T15:08:17.000Z
**Title**: GitHub Actions Executor — Keyless Federated Cloud Workers
**Description**: Third executor behind 10039's seam: lane actions as GitHub Actions runs, authenticated via GitHub OIDC + Anthropic WIF — zero stored Anthropic secrets. Keyless self-serve tier for users with their own Anthropic org. Depends on 10039 Phases 2 and 6.
**Author**: AM
**Processed**: 2026-08-30T15:08:17.995Z

### Track 10040: Manager Stuck-Track Healing — Escalate Permanent Workspace-Guard Blocks
**Status**: processed
**Type**: track-create
**Created**: 2026-08-30T09:45:00Z
**Title**: Manager Stuck-Track Healing — Escalate Permanent Workspace-Guard Blocks
**Description**: Stuck-track detection (reset-stuck-actions → stuck_timeout) only re-queues, so tracks blocked by a permanent cause loop forever — track 10036 bounced queue→running→blocked 191 times over a permanently dirty checkout (committed ui/node_modules symlink) because workspace-guard blocks happen before spawn and never count as retries (workspaceGuardBlocked flag is set but never read). Manager worker gains a healing sweep: count consecutive guard blocks per track, escalate to lane_action_status failure with a single ❌ root-cause comment after N blocks, and optionally auto-heal known-safe causes.
**Author**: AM
**Processed**: 2026-08-30T07:47:08.376Z

### Track 10039: Cloud Workers — Claude Cloud Instances as Workers
**Status**: processed
**Type**: track-create
**Created**: 2026-08-30T07:36:40.000Z
**Title**: Cloud Workers — Claude Cloud Instances as Workers
**Description**: Support choosing worker runtime at creation: machine (today's pull model) or a Claude cloud instance. Cloud workers require stored Claude account auth for the logged-in user; reuse existing lanes, queue, worker identity, and credential-storage machinery.
**Author**: AM
**Processed**: 2026-08-30T07:36:34.161Z

### Track 10038: Widen Bookkeeping-Conflict Auto-Resolve to Checkbox Mirroring
**Status**: processed
**Type**: track-create
**Created**: 2026-08-28T10:20:00Z
**Title**: Widen Bookkeeping-Conflict Auto-Resolve to Checkbox Mirroring
**Description**: Follow-up from track 10037's merge — `isSafeToAutoResolveBookkeepingConflict` (conductor/services/track-metadata-conflict.mjs) only recognizes main's divergence from a track's worktree branch as a safe sync-mirror artifact when it's limited to known `**Lane**:`-style header lines; it doesn't recognize the same benign mirroring when it shows up as plan.md checkbox-line edits, forcing a manual/agent resolution for a case that's provably safe whenever main's content is byte-identical to the branch's. Add a second safe-resolve rule (main content == branch content) alongside the existing header-only rule, without weakening the existing block on genuine divergence.
**Author**: AM
**Processed**: 2026-08-28T14:32:04.208Z

### Track 10037: Worker Strip — Running/Last Track + Chat With Worker
**Status**: processed
**Type**: track-create
**Created**: 2026-08-26T12:20:00Z
**Title**: Worker Strip — Running/Last Track + Chat With Worker
**Description**: Worker strip on the lanes view shows each worker's running track (active workers sorted first, as not all fit) and its last-context track; clicking deep-dives into the running track or opens a chat with the worker — reusing the Live Transcript machinery from the track conversation — available from both the lanes-view strip and the Machine Workers view. Last-track chip exploits the worker's warm session context (track_sessions) for lower-memory conversations.
**Author**: AM
**Processed**: 2026-08-28T07:44:56.810Z


### Track 1120: Wizard Real-Deploy Verification (Digger Game, Live Firebase)
**Status**: processed
**Type**: track-create
**Created**: 2026-08-26T09:19:06Z
**Title**: Wizard Real-Deploy Verification (Digger Game, Live Firebase)
**Description**: Spun out of track 1119 (App Creator Wizard) — human-supervised real run of the wizard against a disposable Firebase/GCP project, confirming generated Auto-Run tracks reach done and the recorded app_url is actually live. Satisfies 1119's originally-deferred TC-16/AC-4/AC-5.
**Author**: AM
**Processed**: 2026-08-27T07:50:14.375Z


### Track 1119: App Creator Wizard Mode (E2E New-Project Wizard)
**Status**: processed
**Type**: track-create
**Created**: 2026-08-25T14:51:30Z
**Title**: App Creator Wizard Mode (E2E New-Project Wizard)
**Description**: Multi-step New Project wizard in the UX collecting product description, KPIs, design/tech stack, and deployment config (reuse existing deployment UX as a wizard step / reusable components), then auto-generating tracks in auto-run mode and driving them end-to-end to a deployed webapp (Firebase/GCP first). Target experience: "create the digger game", provide all info once, and get a working deployed app link — with simplified UX explaining how to follow tracks and where to find the final webapp URL. Positions LaneConductor in the full app-creator market.
**Author**: AM
**Processed**: 2026-08-25T14:51:49.401Z

### Track 10034: Auto-run demo (throwaway)
**Status**: processed
**Type**: track-create
**Created**: 2026-08-25T07:59:57.940Z
**Title**: Auto-run demo (throwaway)
**Description**: Created purely to demonstrate auto_run + a sync+poll worker auto-claiming a queued track live. Safe to discard after.
**Processed**: 2026-08-25T08:00:01.306Z


