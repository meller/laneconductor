# Spec: Cloud Workers — Claude Cloud Instances as Workers

## Problem Statement

Every worker today is a machine pulling from the queue. Claude can now run sessions in
Anthropic's cloud sandbox, which means lane actions could execute with no user-owned compute at
all. LaneConductor has no worker runtime that dispatches to a Claude cloud session, no place to
hold the Claude-account credentials such a dispatch requires, and its worker is structurally
welded to a local filesystem (chokidar sync, worktrees, git locks) — which is also the scaling
bottleneck for the intended end-state: a public multi-tenant UI/API where users bring Claude +
GitHub credentials and every project's work runs in cloud sessions, with the server doing
orchestration only (see brainstorm dialogue in conversation.md, 2026-08-30).

## Decisions (from brainstorm)

- **D-1: Execution surface = claude.ai cloud sessions** (option A). Not self-provisioned VMs
  (that's track 1108) and not a worker inside the sandbox (sandbox is ephemeral — nowhere for a
  long-lived process to live).
- **D-2: GitHub remote is required** for cloud-runtime workers. Repo access for the sandbox comes
  from the user installing **Claude's GitHub App** on the repo (Anthropic-side, one-time) — NOT
  from our track-1002 GitHub OAuth login, which is identity-only.
- **D-3: v1 is outbound-only.** Git (branches/PRs) is the sandbox's only write channel back to
  us; the dispatcher polls session status and GitHub state from our side. Inbound live-progress
  callbacks (internet-reachable Collector + scoped injected keys) are explicitly v2 — see
  Phase 8 (unchecked, out of this pass).
- **D-4: All lanes run in the cloud** for a cloud-runtime worker — plan, implement, review,
  quality-gate, merge. The sandbox is a full dev environment (can run tests); plan commits
  conductor docs; merge resolves conflicts (conflict resolution is already LLM work).
- **D-5: The orchestrator is a thin dispatcher, reusing today's worker.** All four LLM call
  sites (autoLaunchLocalFs ~5823, startNextAutoCompleteStage ~5916, checkDispatchInbox ~7193,
  runCreateProject ~6082) get one **executor seam**; decision logic (claims, gates, retries,
  transitions) is reused verbatim. Dispatcher-only mode = same worker with file-sync and
  worktree subsystems disabled.
- **D-6: Source-of-truth inversion in dispatcher mode**: DB is truth for lane state; the GitHub
  repo is truth for conductor files (written only by cloud sessions on branches). File↔DB sync
  does not run in dispatcher mode.
- **D-7: Scope split with track 017 (LaneConductor Cloud)**: this track is the execution engine,
  runnable by a solo dev locally against their own creds; the public wizard / multi-tenant
  hosting / billing is 017.

## Requirements

- REQ-1 **Worker runtime type**: `workers.runtime TEXT DEFAULT 'machine'` (`machine|cloud`).
  Selectable at worker creation (CLI; UI field where the worker-creation UX already exists).
  `machine` workers behave exactly as today — zero behavior change.
- REQ-2 **Executor seam**: an executor interface (`run(prompt, ctx) → { id }`, `poll(id)`,
  `result(id)`) with two implementations — `LocalCliExecutor` (wraps today's spawnCli path,
  behavior-identical) and `CloudSessionExecutor` (launches and polls a claude.ai cloud
  session). All four LLM call sites route through the seam, including `runCreateProject`
  (normalized off its bespoke `spawn`).
- REQ-3 **Claude credential storage**: per-user Claude-account credential (OAuth token / session
  credential — exact artifact determined by the Phase 1 spike) stored following 1118/1033
  patterns: `.env` / DB secret storage, never in `.laneconductor.json`, never in git. A stored
  credential can be **validated live** (cheap session ping), not just "a token exists".
- REQ-4 **Preflight validation at cloud-worker creation** — all four checks, each failing with
  actionable fix-it guidance (link/command), blocking creation:
  1. Claude credential present AND live-validated (REQ-3);
  2. project has a GitHub remote;
  3. Claude's GitHub App is installed on that repo;
  4. a GitHub token usable by the dispatcher for PR watching/merging is available.
- REQ-5 **Cloud lane actions, all lanes**: a cloud-runtime worker claims a queued track exactly
  like today (same auto_run/allowlist/assignee gates) and runs the lane action in a cloud
  session. implement ends in a pushed branch/PR; plan commits spec/plan/test to the repo;
  review/quality-gate run the project's tests in the sandbox; merge merges clean PRs via
  GitHub API and dispatches a cloud session to resolve conflicted ones (same prompt intent as
  the local merge action).
- REQ-6 **Dispatcher-only worker mode**: a startup mode (flag/config) in which the worker runs
  no chokidar watchers, creates no worktrees, takes no git locks, and needs no repo checkout —
  its loop is: DB queue → executor.run → poll session → poll GitHub (PR state; conductor file
  contents for mid-run board freshness) → update DB → close/requeue/retry. Existing stuck-run
  recovery (resetStuckActions), orphan reconciliation, and retry logic operate on session/API
  signals instead of PIDs/files.
- REQ-7 **Status visibility**: a cloud-dispatched track's Kanban card shows coarse live state
  (launched / running / needs-input / PR open / merged / failed) and a deep link to the live
  session on claude.ai.
- REQ-8 **Permanent-failure escalation**: permanent causes (expired/revoked Claude credential,
  GitHub App uninstalled, preflight that can never pass) must escalate to
  `lane_action_status: failure` + one ❌ Inbox comment after N attempts — not loop forever.
  Reuses track 10040's classification/escalation pattern; the shared state (attempt counters,
  escalation flags) is DB-persisted (10040 was asked to keep it DB-side — see its conversation).
- REQ-9 **Machine-worker parity untouched**: with `runtime: machine` (the default), every
  existing test suite passes unchanged; no existing workflow requires the new credentials.

## Explicitly Out of Scope (v2+ / other tracks)

- Inbound live-progress callbacks from the sandbox (needs internet-reachable Collector + scoped
  short-lived keys) — Phase 8, unchecked.
- Public multi-tenant wizard, hosting, billing — track 017.
- Self-provisioned VM workers — track 1108.

## Open Risk (owned by Phase 1)

The programmatic surface for creating/driving claude.ai cloud sessions (API vs. SDK vs.
browser-session protocol), the credential artifact it needs, and its polling/limits semantics
are unverified. Phase 1 is a spike with a **go/no-go checkpoint**: it must produce a working
prototype driver before any dependent phase starts. If the surface turns out unusable, the
fallback decision (e.g. pivot to Agent-SDK-in-our-sandbox, option B from the brainstorm) goes
back to a human — it is not made silently.

## Acceptance Criteria

All criteria are user-observable outcomes; none are satisfiable by stubs.

- [ ] AC-1: Creating a cloud-runtime worker with valid Claude + GitHub setup succeeds; creating
  one with the GitHub App missing is blocked with a message containing the install link (both
  observed against real preflight logic, mocked externals allowed in tests but AC-2 covers the
  real path).
- [ ] AC-2 (E2E, real services): a track dispatched to a cloud worker runs in an actual
  claude.ai cloud session and results in a real PR on the GitHub repo, opened by the session —
  observed once manually against a scratch repo and recorded (URL + screenshot) in
  conversation.md.
- [ ] AC-3: while AC-2's session runs, the Kanban card shows a live cloud status and a working
  deep link to the session.
- [ ] AC-4: a conflicted PR on a cloud-dispatched track reaches a mergeable/merged state via a
  cloud merge session, without any local git operation on the dispatcher.
- [ ] AC-5: a worker started in dispatcher-only mode with no repo checkout drives a track
  through plan → implement → PR → merge lifecycle updates purely via DB + external APIs
  (mock session/GitHub servers acceptable in the automated test; the loop logic must be the
  real dispatcher code).
- [ ] AC-6: with an intentionally revoked Claude credential, the affected track reaches
  `failure` with exactly one ❌ Inbox comment within N cycles (no infinite requeue loop).
- [ ] AC-7: full existing test suite passes with `runtime: machine` defaults (parity, REQ-9).

## Data Model Changes

- `workers.runtime TEXT NOT NULL DEFAULT 'machine'` — `machine|cloud`.
- `tracks`: `cloud_session_id TEXT`, `cloud_session_url TEXT` (nullable; set while a cloud
  session is active/last ran).
- Credential storage: per-user Claude credential + GitHub token for dispatch — table or secret
  store per 1118's pattern (exact shape decided in Phase 3 against the Phase 1 findings; never
  plaintext in `.laneconductor.json` or git).
- Escalation counters (REQ-8): DB-persisted, shared shape with track 10040 (coordinate — see
  both tracks' conversations).
