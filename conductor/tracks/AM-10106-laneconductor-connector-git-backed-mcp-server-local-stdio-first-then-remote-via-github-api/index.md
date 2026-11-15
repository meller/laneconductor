# Track AM-10106: LaneConductor connector: git-backed MCP server (local stdio first, then remote via GitHub API)

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planned
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Design + build a LaneConductor connector (an MCP server) so that "plan X" works from any Claude surface without re-prompting the LaneConductor pattern every session. Git is the store.

WHY: usage has shifted to Claude Code remote control plus sub-agents; the web app and the worker/executor layer are barely used. The durable value is the files - tracks (index/spec/plan/test/conversation.md) plus product.md, tech-stack.md, KPIs, quality-gate.md, workflow - i.e. an agile Kanban with an extended CLAUDE.md. The executor/DB/remote-sync layer is where nearly all recent bugs came from (duplicate dispatch, orphan reclaim, DB-vs-file desync, stuck status rows, always-on Neon polling that burned 80 of 100 CU-hours). The cloud collector was disabled on 2026-11-15 (laneconductor + laneconductor-meta configs).

DESIGN DECISIONS (agreed in discussion):
1. Files are the single source of truth; the repo is the store. No database authority. A DB, if any, is a rebuildable derived index/cache for cross-project search and KPI rollups.
2. One storage interface, two backends: (a) local filesystem via stdio MCP - for Claude Code, validates the tool design with no hosting; (b) GitHub API via remote MCP over HTTP - for web/mobile Claude, where a connector cannot see the local filesystem. All project repos are on GitHub.
3. Tool set v0: list_tracks, get_track, create_track, update_track (REQUIRES a base commit SHA - optimistic concurrency; a stale write fails and is reported, never silently clobbers), append_conversation (validates the "> **author**:" format that previously broke sync silently), get_context (project context files + recipe hints).
4. Every response carries provenance: "as of commit X on branch Y, last push T ago", so Claude can say a plan may be stale. Drift between a laptop and the remote is unavoidable - make it visible, not silent.
5. Server `instructions` plus tool descriptions replace the per-session "use the LaneConductor pattern" prompt.
6. Planning docs live on main (verified on track 10105: only status-line churn exists on the track branch). Keep high-churn status out of git or batch it.
7. Local hygiene: a hook/skill that runs git fetch and warns when ahead/behind before planning, and auto-commits+pushes only conductor/ files at the end of a planning turn so local work becomes visible to the remote connector quickly. Track folders are independent and conversation.md is append-only, so conflicts should be rare.
8. Legacy is PARKED, not deleted: DB, workers/dispatch, remote API, cloud collector, web UI. Tag the current state, build the connector alongside it, decide on removal only after the beta has earned it.

BETA VALIDATION (acceptance): (a) from Claude Code, "plan X" creates valid track files through the connector with no pattern prompting; (b) from claude.ai web with the remote connector, the same against a GitHub repo; (c) laptop-ahead-of-remote scenario shows a staleness warning; (d) concurrent edit to the same file is reported as a conflict, not overwritten; (e) runs with no database at all; (f) measure tokens/latency vs the current skill.

OUT OF SCOPE: the recipe library (separate track), Jira sync (later: one more connector over the files), UI.

OPEN QUESTIONS: remote auth (GitHub OAuth app vs GitHub App); hosting (Cloud Run vs Workers); how to represent status churn; GitHub rate limits and caching for tree reads.
**Summary**: Design + build a LaneConductor connector (an MCP server) so that "plan X" works from any Claude surface without re-prompting the LaneConductor pattern every session. Git is the store.

## Direction update (2026-11-15)

- The daemon, workers and Auto Run are being retired, not just parked for the connector's sake: lane execution moves to the lane-runner skill (track 10108), where the main Claude session schedules and sub-agents work in worktrees. The skill itself is being restructured first (track 10109). Legacy stays parked until the beta earns its removal.
- **First beta test - MCP server instructions.** The design leans on a server's `instructions` being injected into context so nobody has to prompt "use LaneConductor". Evidence so far: it is observed in Claude Code in this very session (a connected server's instructions appear in context). Not established: the official MCP page (https://code.claude.com/docs/en/mcp) does not document it either way, and it is unverified for claude.ai web/mobile custom connectors. A subagent claimed "MCP servers don't auto-provide instructions"; that was checked and is unsupported by the docs and contradicted by observation. Verify it on a claude.ai connector before building on it; fallback is a one-line CLAUDE.md pointer or a skill description trigger.

## Correction (2026-11-15)

Lane execution is NOT moving to a scheduling runner: per decision, Claude's native sub-agent/worktree behaviour is used as-is, with only a ~25-line track-conventions note (track 10108, scope changed). The connector's job is state, context and recipes, not supervising execution.

## PRINCIPLE (2026-11-15): LaneConductor is a second opinion, never a controller

LaneConductor advises; Claude may always decide against it. Recipes, lane order, conventions and tool results are phrased as recommendations with their reasoning ("this worked for you because..."), never as orders. Only two things are firm, and neither is LaneConductor outranking Claude: (a) mechanical integrity - file formats and the base-commit check that prevents silent overwrites; (b) the human's authority - ask before merge/push, never handle secrets (Claude may disagree, but says so and asks). When Claude deviates from advice it says why, and that deviation is recorded so the recipe can be improved or pruned; a recipe Claude keeps overriding is a bad recipe.

## REQUIREMENT (2026-11-15): failures must be visible, and removal must be easy

- **Advice log (file-based, append-only, per project):** each time the connector serves a recipe or context it records the serve; Claude appends one line of outcome - followed / deviated (with reason) / failed. The connector also logs what it can observe itself and reliably: tool errors, stale reads (remote behind local), calls that returned nothing useful. Follow/deviate reporting is best-effort (it depends on Claude reporting it); connector-side metrics are the reliable part; periodic human review is the backstop.
- **Health report on request** (tool + readable summary): per recipe - served, followed, overridden, top override reasons; connector - error rate, stale-read rate, token cost added. Flags recipes overridden most of the time as candidates to rewrite or delete.
- **Easy removal:** files stay valid without the connector (it is additive), so removing it means disconnecting it and losing nothing.
- **Kill criteria defined BEFORE the beta starts** (thresholds set in the plan): e.g. advice override rate, connector error rate, or no measurable time/token saving over N sessions => decide keep / change LaneConductor / remove the connector, from evidence, with the human making the call.

## DESIGN NOTE (2026-11-15): kill the "commit and push before everything" pattern

Root cause: track STATE (index/spec/plan/test/conversation) and CODE both went through the same worktree+branch machinery, so a new or changed track folder had to be committed (and, for a remote reader, pushed) before anything else could see it. Separate them:
1. State lives on main; only code lives on branches in worktrees. Docs-only lanes (plan; review notes) run in the primary checkout with NO worktree - the plan lane never needed one.
2. No manual commits: a hook (or the connector itself) auto-commits `conductor/` changes with a standard message; a small script creates a worktree and silently syncs the track folder first. This also keeps main clean, avoiding the dirty-primary-checkout blocks that stopped main-mode runs before.
3. Commit and push are different costs: commit is local and cheap; push matters only for remote surfaces (web connector) and is lazy/debounced (end of turn or session), never a precondition for local work.
4. In the connector, every write is a commit made by the server; the user never types one.
