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

## Verification note on the plan (2026-11-15)

Independent check of fact F2 in spec.md (Claude Code truncates server instructions at 4,096 characters; "Tool search for MCP server authors" section): two separate fetches of https://code.claude.com/docs/en/mcp found NEITHER that section NOR the 4,096-character statement. This may be a limit of the fetch tool, but it is not confirmed - treat F2 and the cap as UNVERIFIED until read directly from the live page (and the "Correction to the Direction update" in spec.md likewise). Firsthand evidence stands: server instructions ARE injected into context in Claude Code in practice. U1 (claude.ai web/mobile) remains the first test (Phase 1 canary). Verified by me: the plan's commits touch only this track folder; conversation.md is gitignored (.gitignore:58, so D5 is real); product.md line 32 says "100% local" (the fundamentals conflict is real).

## PLAN ADDITION (2026-11-15): a generated track-summary file replaces the database as the read model

Idea (human): keep one summary file of all tracks, kept current, so no Postgres is needed. Findings: `conductor/tracks.md` exists but is stale (last updated 2026-08-10, lists none of 10105-10109; it is only regenerated by a manual `init-tracks-summary`); `conductor/tracks-metadata.json` is kept fresh by the daemon but holds only folder paths and timestamps, not lane/status/progress. Measured: reading every track index.md across 17 repos (1,087 files, 2.2 MB) takes ~98 ms locally, so locally a summary is optional for speed - its real value is the REMOTE connector: `list_tracks` becomes ONE file read instead of listing and fetching many files through GitHub's API (rate limits).
Requirements to add to the plan: (1) the summary is GENERATED, never hand-edited, derived from each track's index.md markers (id, title, lane, lane status, progress, phase, depends on, last-modified) with a generated-at stamp and a per-track source hash; (2) the connector's write path regenerates it in the SAME commit as the track change; plain-skill edits regenerate it via a hook or `lc` command; (3) readers verify per-track hashes/mtimes and fall back to scanning folders on mismatch, so a stale summary can never silently mislead; (4) it is a single shared file, so concurrent writers will conflict - conflicts are resolved by regenerating, never by hand-merging; (5) one summary per repo; a cross-project view reads each repo's summary; (6) a file-backed UI (if ever wanted) reads this summary plus the track files - no database, no sync.

## PLAN ADDITION (2026-11-15): the summary is maintained by CODE, with read-time self-healing

Lesson (human, from experience): anything kept in sync by an LLM following prose instructions drifts out of sync. The old Postgres sync was reliable because it was real code. So: (1) the track summary is produced by a deterministic generator function (read track folders -> write summary), never by a "remember to update it" instruction in a skill; no worker/daemon is needed; (2) it runs inside code paths that already touch the files: the connector's write path (same commit as the change) and `lc` commands (`lc new`, `lc move`, `lc pulse`); a git hook covers other edits but cannot be the only safeguard (hooks can be bypassed and GitHub-API writes never run local hooks); (3) SELF-HEALING: every reader verifies per-track hash/mtime against the summary and regenerates or falls back to a folder scan on mismatch, so a skipped update can never mislead silently; (4) the generator doubles as a linter: tracks with inconsistent markers (e.g. Lane Status `running` with no live run, an invalid Lane value) are listed under "needs attention" and feed the health report; (5) optional backstop: a CI/pre-push check that the committed summary matches regeneration. Reuse resolveTrackFolderFs (conductor/services/track-folder-fs.mjs) for folder resolution.

## DECISION (2026-11-15): the UI stays on Postgres; no file-backed UI

Human decision: a web UI that reads files directly is an unfamiliar architecture and not worth building; the UI keeps Postgres. Three tiers: (1) skill only - plain files + `lc`, no DB/daemon/sync; (2) connector - the same files through git; (3) optional UI tier - Postgres as a rebuildable ONE-WAY index (files -> DB), parked until wanted. Tiers 1 and 2 never depend on tier 3. Caveat adopted: files are the source of truth; UI actions must go through the same code that edits files (`lc move` etc.) instead of writing the DB first and syncing back - the two-way path is the source of the DB/file desync bugs. Non-goal of this track: any UI work.

## PLAN ADDITION (2026-11-15): many concurrent writers on git

Concern (human): with the connector everyone updates GitHub at once. Assessment: git is built for concurrent writers (failure mode = merge conflict, not corruption); the old design had the same contention hidden behind a DB sync that added desync bugs. Hot spots and fixes to put in the plan: (1) append-only files (conversation.md, advice log): `.gitattributes` `merge=union` so concurrent appends both survive (note D5: conversation.md is currently gitignored - tracking it is a prerequisite); (2) the generated summary: resolved by regenerating, never hand-merging; (3) marker fields in index.md: a genuine conflict only when two writers change the same field at once - caught by the base-hash check and reported; (4) GitHub-API writes: atomic ref update with compare-and-swap on the branch head, retry on a stale head (see U5); (5) team scale: constant state commits on main cause non-fast-forward rejections for code pushers, so the state branch is a SETTING (`state_branch`, default `main` for solo + sub-agents; a dedicated `conductor` branch for teams), and the store must work on either.

## DATA FLOW (2026-11-15): what updates what (one page)

Rule: the git repo is the ONLY truth; everything else is a copy or an index of it. Writers: (a) local (you, skill, `lc`, UI): edit local files -> auto-commit -> lazy push; (b) remote (web/mobile Claude via the connector): API commit straight to the GitHub repo. Readers refresh by `git pull` (fetch at session start; staleness label when behind) - git is pulled into the FILES, never into the DB. The optional UI tier's indexer reads changed files and updates the local Postgres; nothing else writes the DB, so it is always rebuildable (wipe + reindex must give an identical board). Conflicts surface at pull/push time, the normal git moment, handled by union-merge for append-only files, regeneration for the summary, and the base-hash check for markers. Diagram: GitHub <- connector (remote writes); GitHub <-> local files (push/pull); local files -> indexer -> Postgres -> UI.

## PLAN ADDITION (2026-11-15): the remote half means production deployment and OAuth - policy

Human point: the remote connector is a real website, so every connector code change needs a production deploy, plus OAuth support. Both belong to the remote half only (Phases 7-9); the local stdio connector has no deploy (it runs from the repo; updating = git pull). Policy to add:
1. **Knowledge is data in git, not server code.** Lane guides, recipes and skill files are served from the repo on demand, so changing them is a git push, NEVER a deploy. Server code should change rarely.
2. **The tool contract is versioned and additive-only**; a breaking change ships as new tool names, so clients never have to reconfigure.
3. **Deploy path:** a human-triggered, tag-based Cloud Run deploy using the repo's existing deploy pattern (scripts/deploy.sh, secrets from GCP Secret Manager); post-deploy smoke test (healthz, initialize, tools/list matches the expected hash); rollback = shift traffic back to the previous Cloud Run revision. The human performs deploy and GitHub App registration (already Phase 8 Task 3).
4. **No background loops; scale to zero** (lesson from the always-on polling that exhausted the Neon quota).
5. **NEW decision D6 - where OAuth/GitHub tokens live.** Phase 8 says tokens are stored server-side, encrypted, but not WHERE. The remote server is therefore not database-free. Options: (a) STATELESS: the connector's own access/refresh tokens are encrypted blobs that carry the upstream GitHub token (key in Secret Manager/KMS) - no store, but revocation is harder; (b) Firestore (serverless, scale-to-zero friendly) for encrypted per-user tokens; (c) Cloud SQL - overkill. Recommendation: (a) for the beta (single allow-listed user), revisit (b) when there is more than one user.
