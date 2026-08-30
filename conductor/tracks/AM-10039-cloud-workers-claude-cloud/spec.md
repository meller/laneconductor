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

## Phase 1 Findings (2026-08-30 spike)

Research (official Anthropic docs) plus live probing of the installed `claude` CLI (v2.1.223,
logged in as this project's own Pro account — `claude auth status` confirms `authMethod:
"claude.ai"`). Findings are marked **[confirmed live]** where verified by actually running a
command in this sandbox, vs **[docs]** where sourced from documentation only.

### Two distinct, unrelated cloud-execution surfaces exist

1. **"Claude Code on the web" (claude.ai/code)** — this is literally what D-1 named. Clones a
   GitHub repo into an Anthropic-managed VM, works, pushes a branch, and creates a PR — the
   repo-clone/branch/PR behavior D-4/REQ-5 wants comes for free. **[docs]**
2. **Managed Agents API** (`api.anthropic.com/v1/sessions`, beta header
   `managed-agents-2026-04-01`) — a fully separate, genuinely headless HTTP API: `x-api-key`
   auth, `POST /v1/sessions` with an `agent` (a *custom* agent you define — model, system
   prompt, tools, MCP servers) and an `environment_id` (Anthropic-hosted or self-hosted
   sandbox), then `POST /v1/sessions/{id}/events` to drive it and poll/stream for status. This
   is a real, scriptable, API-key-based session lifecycle — but it is **not** "Claude Code": it
   has no built-in repo clone/branch/PR behavior. Getting that would mean building our own
   clone→edit→test→push→PR agent logic on top of it (give it a `bash` tool + a GitHub MCP
   server and prompt it to do what Claude Code does natively). This is architecturally much
   closer to the brainstorm's rejected **option B** (build our own agent) than D-1's "ride
   claude.ai cloud sessions," just with Anthropic hosting the sandbox instead of us
   provisioning one. **[docs]**

### Surface 1 (claude.ai/code) has no headless creation path — confirmed live

- The only two ways to start a session are (a) the browser at claude.ai/code — a
  **[docs]**-documented URL pre-fill (`?prompt=...&repositories=...`) exists for building
  "a button in your issue tracker," but it still requires a human logged into a browser to
  click submit; and (b) the `claude` CLI's `--cloud` flag (undocumented in `--help` in this
  build, but real — confirmed by running it).
- **[confirmed live]**: `timeout 8 claude --cloud </dev/null` returned immediately with:
  `Error: --cloud requires an interactive terminal. Non-interactive invocations (piped stdout,
  --init-only, --sdk-url) run locally and would silently ignore --cloud. Drop --cloud, or run
  from a TTY.` This is a hard, deliberate product-level block on headless invocation, not a
  missing-credential error — it fired before any auth/repo check. A background dispatcher
  process (no TTY, no human present) cannot invoke `--cloud` as the product exists today.
- **[confirmed live]**: `claude auth status` shows this environment already has a live
  claude.ai Pro login (`authMethod: "claude.ai"`) — so the TTY block is the actual obstacle,
  not missing credentials.
- **[confirmed live]**: `claude setup-token` exists and (per **[docs]**, corroborated by
  `--help`'s own description "requires Claude subscription") produces a 1-year
  `CLAUDE_CODE_OAUTH_TOKEN` meant exactly for headless/CI use — but Anthropic's own docs state
  this token "can only make model requests, so it can't establish Remote Control sessions or
  fetch claude.ai connectors." GitHub-connector-backed cloud sessions fall under "connectors,"
  so this credential doesn't unlock `--cloud` even where TTY weren't a problem. There is
  currently **no credential artifact that both (a) works headlessly and (b) can drive a cloud
  session** — this sinks REQ-3 as scoped ("per-user Claude credential storage... validated
  live") for this specific surface.
- Consequently **Task 2/3's planned live exercise (prototype driver hitting a real scratch
  repo) could not be run**: not merely "not attempted," but structurally blocked from *any*
  non-interactive process, including this one. That absence is itself part of the finding, not
  a gap in this spike.

### D-2 correction (repo access mechanism)

The plan's D-2 said repo access "comes from the user installing Claude's GitHub App," not our
OAuth. Per **[docs]** (`code.claude.com/docs/en/web-quickstart`), that's not quite right: base
repo access for a cloud session comes from the **GitHub account the user connects directly to
claude.ai** (an OAuth grant to Anthropic) — "sessions can reach any repository your GitHub
account can see," independent of the App. The **Claude GitHub App is optional**, needed only
for *Auto-fix* (Claude reacting to CI failures / review comments on already-open PRs), not for
a session's base ability to clone/push. REQ-4 check (b) ("Claude's GitHub App is installed on
that repo") should be corrected to "the user's GitHub-to-claude.ai connection can see this
repo" if Surface 1 is pursued further.

### GO/NO-GO

**NO-GO** for the specific mechanism D-1/D-5 assumed — a dispatcher/worker process headlessly
invoking `claude --cloud` per lane action and polling status, reusing the existing
`spawnCli`-shaped executor seam. Both legs of that design are confirmed blocked (no non-TTY
invocation; no headless-capable credential that reaches connector-backed sessions), not merely
undocumented. See the GO/NO-GO comment in `conversation.md` for the fallback options put to the
human, per this phase's own checkpoint rule (do not pivot silently).

## Data Model Changes

- `workers.runtime TEXT NOT NULL DEFAULT 'machine'` — `machine|cloud`.
- `tracks`: `cloud_session_id TEXT`, `cloud_session_url TEXT` (nullable; set while a cloud
  session is active/last ran).
- Credential storage: per-user Claude credential + GitHub token for dispatch — table or secret
  store per 1118's pattern (exact shape decided in Phase 3 against the Phase 1 findings; never
  plaintext in `.laneconductor.json` or git).
- Escalation counters (REQ-8): DB-persisted, shared shape with track 10040 (coordinate — see
  both tracks' conversations).
