# Spec: Cloud Workers — Managed Agents Sessions as Workers (rev. 2, post-Phase-1 pivot)

## Problem Statement

Every worker today is a machine pulling from the queue. LaneConductor has no worker runtime
that executes lane actions in Anthropic's cloud, no place to hold the credentials such a
dispatch requires, and its worker is structurally welded to a local filesystem (chokidar sync,
worktrees, git locks) — which is also the scaling bottleneck for the intended end-state: a
public multi-tenant UI/API where users bring Anthropic + GitHub credentials and every
project's work runs in cloud sessions, with the server doing orchestration only (see
brainstorm dialogue in conversation.md, 2026-08-30).

## Decisions

Revision history: rev. 1's D-1 (claude.ai/code cloud sessions, "option A") was **killed by
the Phase 1 spike** — no headless creation path exists (see the preserved Phase 1 Findings at
the bottom of this file). The pivot to the Managed Agents API was decided by the human on
2026-08-30 after a docs review (see the "PIVOT RECORDED" comment in conversation.md).

- **D-1 (rev. 2): Execution surface = Managed Agents API** (`api.anthropic.com/v1/sessions`,
  beta `managed-agents-2026-04-01`): headless, API-key-authenticated session lifecycle with an
  Anthropic-hosted container sandbox (bash, files, code execution). claude.ai/code stays on
  file as a possible second executor if its headless restriction lifts at GA. The platform's
  scheduled-deployments (cron) feature is deliberately NOT used — the dispatcher fires
  sessions on demand from the queue.
- **D-2 (rev. 2): GitHub is the repo channel, via built-in repo mounting.** A session
  environment resource clones the repo into the container before the agent starts (repos are
  cached across sessions); the agent commits/pushes with plain git using a vault-held token.
  PR opening is a single GitHub API call (dispatcher-side or agent-side — decided in
  Phase 1b). The rev-1 "Claude GitHub App installed" preflight check is dropped (it belonged
  to the abandoned surface — see the Phase 1 D-2 correction); a GitHub-token check replaces
  it, covering both repo mounting and PR operations.
- **D-3: v1 is outbound-only.** Git (branches/PRs) is the sandbox's write channel; the
  dispatcher polls session events/status and GitHub state. Managed Agents **webhooks** are the
  natural v2 push mechanism once a Collector endpoint is internet-reachable (Phase 8,
  unchecked).
- **D-4: All lanes run in the cloud** for a cloud-runtime worker — plan, implement, review,
  quality-gate, merge. The sandbox runs the project's tests; plan commits conductor docs;
  merge resolves conflicts (conflict resolution is already LLM work).
- **D-5: The orchestrator is a thin dispatcher, reusing today's worker.** All four LLM call
  sites (autoLaunchLocalFs ~5823, startNextAutoCompleteStage ~5916, checkDispatchInbox ~7193,
  runCreateProject ~6082) get one **executor seam**; decision logic (claims, gates, retries,
  transitions) is reused verbatim. Dispatcher-only mode = same worker with file-sync and
  worktree subsystems disabled.
- **D-6: Source-of-truth inversion in dispatcher mode**: DB is truth for lane state; the
  GitHub repo is truth for conductor files (written by cloud sessions on branches). File↔DB
  sync does not run in dispatcher mode.
- **D-7: Scope split with track 017 (LaneConductor Cloud)**: this track is the execution
  engine, runnable by a solo dev locally against their own creds; the public wizard /
  multi-tenant hosting / billing is 017.
- **D-8 (new): Concept mapping.** Managed **Agent** = versioned config (1–2 total, defined as
  YAML in git and applied via the `ant` CLI, shared by all workers and projects — an Agent is
  a job description, not a worker; never created in the request path). **Session = a track,
  1:1** — mirroring the worker's existing per-track session resume
  (`resolveTrackSession`/`persistTrackSession`): one session per track, one message per lane
  action, context and prompt cache accumulating across lanes. Fallback if session lifetime
  cannot span a multi-day track (verified in Phase 1b): session-per-lane-action — the repo's
  conductor/ files are the durable context either way. A **worker** is the dispatcher identity
  driving many sessions concurrently (parallel_limit governs, as today).
- **D-9 (new): Platform features adopted deliberately** (from the 2026-08-30 docs review):
  - **Vault credentials** for the GitHub token — substituted at egress, never visible inside
    the sandbox; resolves the brainstorm's credential-leak concern properly.
  - **Session budgets** — hard, dollar-denominated, platform-enforced cap per session; the
    per-track cost ceiling a multi-tenant product needs (REQ-10).
  - **Built-in prompt caching + context compaction** — automatic; effectiveness observable via
    `cache_read_input_tokens` in usage events. Replaces (and improves on) the local worker's
    stable-prefix caching.
  - **Skills auto-discovery** from the mounted repo's `.claude/skills` — the existing
    laneconductor skill loads in the sandbox, so lane-action prompts remain skill invocations
    (`/laneconductor implement NNN`) nearly unchanged.
  - **Console live-trace URL** per session
    (`platform.claude.com/workspaces/{ws}/sessions/{id}`) — the Kanban deep link (REQ-7).

## Requirements

- REQ-1 **Worker runtime type**: `workers.runtime TEXT DEFAULT 'machine'` (`machine|cloud`).
  Selectable at worker creation (CLI; UI field where the worker-creation UX already exists).
  `machine` workers behave exactly as today — zero behavior change.
- REQ-2 **Executor seam**: an executor interface (`run(prompt, ctx) → { id }`, `poll(id)`,
  `result(id)`) with two implementations — `LocalCliExecutor` (wraps today's spawnCli path,
  behavior-identical) and `CloudSessionExecutor` (creates/resumes a Managed Agents session and
  sends the lane action as an event). All four LLM call sites route through the seam,
  including `runCreateProject` (normalized off its bespoke `spawn`).
- REQ-3 **Credentials** — **keyless-only policy (human decision, 2026-08-30)**: LaneConductor
  code and config never store, read, or accept a long-lived Anthropic API key — not in
  `.env`, not in `.laneconductor.json`, not in a DB column. Exactly two Anthropic auth modes:
  1. **OAuth profile** (`ant auth login` — ADC-style: browser login, short-lived
     auto-refreshing tokens under `~/.config/anthropic/`, picked up by zero-arg SDK clients)
     for interactive dev machines;
  2. **Workload Identity Federation** (federation rule in the user's org trusting the
     dispatcher's IdP) for servers/CI/hosted infra.
  Whichever is present is validated **live** (cheap real call, not presence-only), and
  preflight reports which mode it found. A deployment with neither (headless box, no IdP,
  no browser) cannot run a cloud dispatcher — by design. Consumer-SaaS users without either
  get bundled billing (1003/017), never key-paste.
  Also stored (not Anthropic — unaffected by the keyless policy): per-user **GitHub token**
  with access to the project repo — registered as a **vault credential** for in-sandbox git
  use (never visible in-container) and used by the dispatcher for PR operations; kept in the
  secret store per 1118's pattern.
- REQ-4 **Preflight validation at cloud-worker creation** — each check failing with actionable
  fix-it guidance (link/command), blocking creation:
  1. Anthropic auth resolvable via profile or WIF (never a key) AND live-validated, mode
     reported;
  2. Managed Agents beta reachable for that identity (cheap sessions-API probe);
  3. project has a GitHub remote;
  4. GitHub token present AND can access that repo (live check).
- REQ-5 **Cloud lane actions, all lanes**: a cloud-runtime worker claims a queued track
  exactly like today (same auto_run/allowlist/assignee gates) and runs the lane action as a
  message to the track's session (created on first lane action, with the repo mounted).
  implement ends in a pushed branch + PR; plan commits spec/plan/test to the repo;
  review/quality-gate run the project's tests in the sandbox; merge merges clean PRs via
  GitHub API and sends a conflict-resolution turn to the session for conflicted ones (same
  prompt intent as the local merge action).
- REQ-6 **Dispatcher-only worker mode**: a startup mode (flag/config) in which the worker runs
  no chokidar watchers, creates no worktrees, takes no git locks, and needs no repo checkout —
  its loop is: DB queue → executor.run → poll session events → poll GitHub (PR state;
  conductor file contents for mid-run board freshness) → update DB → close/requeue/retry.
  Existing stuck-run recovery (resetStuckActions), orphan reconciliation (list sessions
  instead of PIDs), and retry logic operate on session/API signals.
- REQ-7 **Status visibility**: a cloud-dispatched track's Kanban card shows live state
  (launched / running / idle / needs-input / budget-reached / PR open / merged / failed), the
  Console live-trace deep link, and session token/cost usage from usage events.
- REQ-8 **Permanent-failure escalation**: permanent causes (revoked/expired Anthropic
  identity — dead profile refresh token or broken WIF rule — dead GitHub token, org-side budget exhaustion, preflight that can never pass) must escalate to
  `lane_action_status: failure` + one ❌ Inbox comment after N attempts — not loop forever.
  Reuses track 10040's classification/escalation pattern; counters DB-persisted (10040 asked
  to keep its state DB-side — see both tracks' conversations).
- REQ-9 **Machine-worker parity untouched**: with `runtime: machine` (the default), every
  existing test suite passes unchanged; no existing workflow requires the new credentials.
- REQ-10 **Cost controls**: every session is created with a session budget (project-level
  default, per-track override). Budget-reached is a first-class outcome — surfaced on the
  card and in the Inbox, with settle-then-decide semantics — never a mystery hang.

## Explicitly Out of Scope (v2+ / other tracks)

- Webhook-based push updates from sessions (needs an internet-reachable Collector endpoint) —
  Phase 8, unchecked.
- Public multi-tenant wizard, hosting, billing — track 017.
- Self-provisioned VM workers — track 1108.
- claude.ai/code executor — revisit at GA if headless creation ships (Phase 1 findings
  preserved below).

## Open Risk (owned by Phase 1b)

The Managed Agents findings driving this revision are **docs-grade only** — Phase 1's live
probing budget was spent proving the claude.ai/code dead end. Phase 1b is a second, smaller
go/no-go spike: create a real agent + environment + session with a mounted scratch repo,
drive one trivial change end to end (edit → commit → push → PR), and verify live: repo
mounting + push auth via vault credential, skills auto-discovery, session budgets, the trace
URL, event polling, and session resume/lifetime semantics (which decides D-8's track↔session
vs session-per-lane-action). If the surface fails live validation, the fallback decision
returns to a human — not made silently.

## Acceptance Criteria

All criteria are user-observable outcomes; none are satisfiable by stubs.

- [ ] AC-1: Creating a cloud-runtime worker with valid Anthropic + GitHub credentials
  succeeds; each preflight failure mode (bad API key, no Managed Agents access, no remote,
  GitHub token can't see repo) blocks creation with its specific fix-it guidance.
- [ ] AC-2 (E2E, real services): a track dispatched to a cloud worker runs in a real Managed
  Agents session with the repo mounted, and results in a real PR on the GitHub repo — observed
  once against a scratch repo and recorded (session id, trace URL, PR URL) in conversation.md.
- [ ] AC-3: while AC-2's session runs, the Kanban card shows live cloud status and a working
  Console trace deep link.
- [ ] AC-4: a conflicted PR on a cloud-dispatched track reaches a mergeable/merged state via a
  session conflict-resolution turn, without any local git operation on the dispatcher.
- [ ] AC-5: a worker started in dispatcher-only mode with no repo checkout drives a track
  through plan → implement → PR → merge lifecycle updates purely via DB + external APIs
  (mock session/GitHub servers acceptable in the automated test; the loop logic must be the
  real dispatcher code).
- [ ] AC-6: with a revoked Anthropic identity (expired profile / broken WIF rule), the
  affected track reaches `failure` with
  exactly one ❌ Inbox comment within N cycles (no infinite requeue loop).
- [ ] AC-7: full existing test suite passes with `runtime: machine` defaults (parity, REQ-9).
- [ ] AC-8: a session that hits its session budget surfaces as a distinct "budget reached"
  state on the track (not a generic error or silent hang), with the configured cap visible.

## Data Model Changes

- `workers.runtime TEXT NOT NULL DEFAULT 'machine'` — `machine|cloud`.
- `tracks`: `cloud_session_id TEXT`, `cloud_session_url TEXT` (Console trace URL),
  `cloud_session_budget NUMERIC` (nullable per-track override).
- Credential storage: NO Anthropic credential is stored by LaneConductor (keyless-only
  policy — profile/WIF resolved at runtime by the SDK chain). Stored: the GitHub token
  (vault-registered for sandbox use; secret store per 1118's pattern) and non-secret auth
  metadata (mode detected, profile name, federation rule id) for preflight reporting.
- Escalation counters (REQ-8): DB-persisted, shared shape with track 10040 (coordinate — see
  both tracks' conversations).
- Agent/environment config: YAML under `conductor/cloud/` (agent definition, environment,
  default session budget), applied via the `ant` CLI; resulting ids cached in config/DB and
  never re-created in the request path.

---

## Phase 1 Findings (2026-08-30 spike)

(Preserved verbatim from the Phase 1 run — documents why the claude.ai/code surface was
abandoned. Note: its characterization of the Managed Agents API predates the 2026-08-30 docs
review; repo mounting, skills auto-discovery, vault credentials, and session budgets — which
substantially shrink the "build it ourselves" cost described below — are reflected in D-9
above and in the PIVOT RECORDED comment in conversation.md.)

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
  session** — this sinks rev-1 REQ-3 as scoped ("per-user Claude credential storage...
  validated live") for this specific surface.
- Consequently **Task 2/3's planned live exercise (prototype driver hitting a real scratch
  repo) could not be run**: not merely "not attempted," but structurally blocked from *any*
  non-interactive process, including this one. That absence is itself part of the finding, not
  a gap in this spike.

### D-2 correction (repo access mechanism)

The rev-1 plan's D-2 said repo access "comes from the user installing Claude's GitHub App,"
not our OAuth. Per **[docs]** (`code.claude.com/docs/en/web-quickstart`), that's not quite
right: base repo access for a cloud session comes from the **GitHub account the user connects
directly to claude.ai** (an OAuth grant to Anthropic) — "sessions can reach any repository
your GitHub account can see," independent of the App. The **Claude GitHub App is optional**,
needed only for *Auto-fix* (Claude reacting to CI failures / review comments on already-open
PRs), not for a session's base ability to clone/push. Rev-1 REQ-4 check (b) ("Claude's GitHub
App is installed on that repo") should be corrected to "the user's GitHub-to-claude.ai
connection can see this repo" if Surface 1 is pursued further.

### GO/NO-GO

**NO-GO** for the specific mechanism rev-1 D-1/D-5 assumed — a dispatcher/worker process
headlessly invoking `claude --cloud` per lane action and polling status, reusing the existing
`spawnCli`-shaped executor seam. Both legs of that design are confirmed blocked (no non-TTY
invocation; no headless-capable credential that reaches connector-backed sessions), not merely
undocumented. See the GO/NO-GO comment in `conversation.md` for the fallback options put to
the human, per this phase's own checkpoint rule (do not pivot silently). **Resolution: the
human chose the Managed Agents pivot — this spec revision.**
