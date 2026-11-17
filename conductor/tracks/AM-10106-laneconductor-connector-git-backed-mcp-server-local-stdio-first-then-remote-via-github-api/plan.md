# Track 10106: LaneConductor connector: git-backed MCP server (local stdio first, then remote via GitHub API)

Spec: `spec.md` (tool contracts, storage interface, log format, verified facts F1-F14, unverified
U1-U7). Tests: `test.md`.

**Where the code goes:** a new top-level `connector/` folder with its own `package.json`
(`"type": "module"`, Node >= 20). Its dependencies are `@modelcontextprotocol/server` (SDK v2,
pinned) and `zod@4` (F14), so the root's vitest and legacy dependencies stay out of it. It reuses,
by relative import, the pure helpers `conductor/sync-conversation-utils.mjs`
(`parseConversationComments`) and `conductor/services/track-folder.mjs` (`decideTrackFolder`). It
never imports `laneconductor.sync.mjs`, which has side effects at import time. Tests use `node:test`
(tech-stack.md: anything that touches the filesystem) and run against temp repos that each get
**their own `git init`** (memory: track 10082's worktree redirect hazard), and they never spawn the
legacy worker.

**Principle check for every phase:** the connector stores, validates and advises. It does not
schedule or dispatch work, retry lanes, or supervise sub-agents. Any feature that starts doing that
is out of scope.

## Decisions needed before implement

The plan assumes the recommended option for each. The human can override any of them before
implement starts. Only Phases 7-9 depend on D1/D2, and D3/D4 change small parts of Phases 4-5.

### D1: Remote auth model
| Option | Summary | Tradeoff |
|---|---|---|
| a. **GitHub App** with user-to-server tokens, behind the connector's own small OAuth AS (recommended) | The connector is the OAuth 2.1 AS and resource server for Claude (PRM, CIMD + DCR, PKCE S256, its own short-lived tokens; F4/F9). It holds the user's GitHub App user token server-side and calls GitHub with it. | Fine-grained: installed per repo, permission `contents: write` only. User tokens expire and refresh. Commits are authored as the user (F13). More setup (App registration, private key in Secret Manager). |
| b. GitHub OAuth App, same AS front | Same front, but the upstream token is a classic OAuth token with `repo` scope. | Simpler to register, but `repo` grants every private repo with long-lived tokens: a broader blast radius for a single-user beta. |
| c. Static header (fine-grained PAT) | No OAuth: an Owner pastes a header credential (F9 `static_headers`). | Least code, but beta-only for a limited set of organizations (U6), one shared credential with no per-user identity, and an Owner-level setup. Acceptable as a stopgap only. |

**Recommendation: a.** Allow-list one GitHub user id during the beta.

### D2: Hosting for the remote HTTP server
| Option | Tradeoff |
|---|---|
| a. **Cloud Run** in the existing shared GCP project (recommended) | Matches the user's stack (GCP, ADC, Secret Manager for the App key; the recipe-1 convention in track 10107). Plain Node container, so the same code runs locally. Scale to zero means cold starts refill the in-memory cache (the tarball seed keeps that to about 2 requests). |
| b. Cloudflare Workers + KV/Durable Objects | Edge latency and good OAuth tooling (claude.com mentions Cloudflare hosting with OAuth). But a different runtime (no full Node, no git CLI), a new vendor, and secrets outside GCP. |
| c. Firebase Functions (v2) behind Hosting | Already in use, but Hosting rewrites have a known multi-segment glob bug (product.md, track 10052) that would need working around for `/.well-known/*` and `/mcp`. |

**Recommendation: a.** Expose the Cloud Run URL directly (no Hosting rewrite layer).

### D3: High-churn writes (status markers and the advice log)
| Option | Tradeoff |
|---|---|
| a. **Status stays in `index.md` markers. Each write tool call is one commit. Advice-log lines are buffered and committed in batches** (recommended) | One source of truth, and the files stay valid without the connector (REQ-22). Field-level marker checks (REQ-4) keep status churn from causing false conflicts. Claude is advised to bundle status with doc edits in one `update_track`. Locally the log is appended to the working tree and committed together with the next connector commit. Remotely the server buffers log lines and commits at most once per 10 minutes or 50 lines, so it stays far under 500 content writes/h (F10). Cost: more commits on main, all docs-only. |
| b. Status in a gitignored local file | Zero churn, but remote surfaces cannot see status, which defeats AC-b. |
| c. Status and the log on a side branch (`lc-state`) or in git notes | Keeps main's history clean, but a second ref to keep in sync on both backends, and tools that ignore notes lose the state. |

**Recommendation: a.**

### D4: Push policy for state commits (design note "lazy push" vs principle "ask before push")
| Option | Tradeoff |
|---|---|
| a. **Ask, with an opt-in standing permission** (recommended) | By default the connector never pushes. When `unpushed_local_commits` is set, its responses tell Claude to ask the human. The human can set `connector.push: "auto-state"` in `.laneconductor.json`. That is a standing human decision, so the connector then pushes fast-forward-only, only when every unpushed commit touches nothing outside `conductor/`, debounced to the end of a write burst (60 s idle). |
| b. Always ask | Safest, but remote surfaces lag whenever the human forgets, and KC-7 will show it. |
| c. Always auto-push state commits | Fastest remote visibility, but it overrides the human's authority over push. Rejected by the PRINCIPLE unless the human chooses it explicitly, which is what option a allows. |

**Recommendation: a.**

### D5: `conversation.md` is gitignored in this repo (found during planning)
`.gitignore:58` ignores `conductor/tracks/**/conversation.md`. Locally, `append_conversation` could
write the file but could not commit it (`git add` refuses ignored paths). Remotely, conversation
history would not exist on GitHub at all, which contradicts "git is the store".
| Option | Tradeoff |
|---|---|
| a. **Track `conversation.md` in git** (recommended): the human removes the ignore rule. Existing conversations get committed the first time each is touched, or in one sweep. | One store, and remote surfaces see the discussion. Cost: conversation history becomes part of git history, so it needs the same "no secrets in track files" discipline as everything else. |
| b. The connector force-adds (`git add -f`) the files it writes | No .gitignore change, but tracked and ignored files get mixed silently and other tools stay confused. Not recommended. |
| c. Keep conversations local-only | Remote surfaces cannot read or append discussion, so AC-b loses comments. Remote `append_conversation` would be disabled. |

**Recommendation: a.** Until the human decides, `append_conversation` treats an ignored target as
`commit: null` with `commitError: "conversation.md is gitignored (decision D5)"`. It never
force-adds.

## Phase 1: Instructions and SDK spike (gate; build nothing else first)

**Problem**: The design assumes server `instructions` replace per-session prompting. That is
documented for Claude Code (F2) but not for claude.ai (U1), and SDK v2's compatibility with Claude's
clients is unverified (U2).
**Solution**: A throwaway probe server, `connector/spike/probe.mjs`, built on SDK v2. Its
instructions hold a canary codeword. It has one tool, `probe_echo`, which never returns the codeword.
Run it over stdio in Claude Code, and over Streamable HTTP through a temporary tunnel or a
throwaway, authless, data-free Cloud Run service for claude.ai.

- [x] Task 1: Write the probe (SDK v2, `instructions` with the canary, one tool with readOnlyHint/destructiveHint). Done: `connector/spike/probe.mjs` (stdio, plus `--http <port>` for the claude.ai tunnel), verified with the SDK v2 client and raw 2025-03-26/2025-06-18 JSON-RPC clients (`connector/test/probe.test.mjs`).
- [ ] Task 2 (HUMAN): Claude Code: add it with `claude mcp add --transport stdio lc-probe -- node connector/spike/probe.mjs` and ask for the codeword in a fresh session (expected: answered without a tool call, per F2)
- [ ] Task 3 (HUMAN): claude.ai web: add it as a custom connector (auth "No sign-in"), ask for the codeword in a fresh chat with only this connector on, and record the result for U1. Repeat on mobile if available.
- [ ] Task 4 (HUMAN, after Tasks 2-3; SDK side already recorded in conversation.md): Record U1/U2 results in `conversation.md`. If claude.ai ignores instructions, adopt the fallback (REQ-16: a one-line pointer in claude.ai project instructions) and note it in spec.md. If SDK v2 fails to connect, switch to v1 `@modelcontextprotocol/sdk` and note it.
- [ ] Task 5 (HUMAN): Tear down the throwaway remote endpoint

**Impact**: The design either stands on verified ground, or changes direction before any real code exists.

## Phase 2: Core library and LocalGitStore

**Problem**: Every tool needs format parsing, blob shas, provenance and safe local writes.
**Solution**: Pure modules plus the local backend, with no MCP code yet.

- [x] Task 1: `connector/src/blob.mjs`: git blob sha of a string (REQ-5), checked against `git hash-object`
- [x] Task 2: `connector/src/markers.mjs`: parse, set and remove `**Name**: value` lines; validate lane and status against `workflow.json` (REQ-14)
- [x] Task 3: `connector/src/conversation.mjs`: format a raw body into a turn block, and validate it with `parseConversationComments` (REQ-13)
- [x] Task 4: `connector/src/tracks.mjs`: resolve a track (both naming conventions, through `decideTrackFolder`), next number (REQ-15), slug, templates
- [x] Task 5: `connector/src/store-local.mjs`: `LocalGitStore` implementing the spec interface (lock, preconditions, atomic write, `git commit -- <paths>`, index.lock retry, state-branch check)
- [x] Task 6: `connector/src/provenance.mjs`: provenance, `freshness` and `stale_reasons` exactly as the spec's rules, plus the one-line summary

**Impact**: The concurrency and format guarantees exist and are unit-tested before any client sees them.

## Phase 3: stdio MCP server with the v0 tools

**Problem**: Claude Code needs the tools.
**Solution**: `connector/bin/lc-connector.mjs --repo <path> [--state-branch main]` runs the stdio
transport (logs to stderr only, F3), with tool handlers that are backend-agnostic
(`connector/src/tools/*.mjs`).

- [x] Task 1: Response envelope (structuredContent + text with the provenance line + JSON), error mapping to `isError` (F5), 40,000-character cap (REQ-18)
- [x] Task 2: `list_tracks`, `get_track` (truncation order, `base`), `get_context` (manifest, files, lane guide with framing and `serve_id`)
- [x] Task 3: `create_track`, `update_track` (files/markers, REQ-4 checks), `append_conversation`
- [x] Task 4: Tool annotations as in the spec table (F8) and the server `instructions` from the spec (under 4,096 characters, F2)
- [x] Task 5: `connector/README.md`: setup (`claude mcp add ...` or `.mcp.json`) and removal (REQ-22)

**Impact**: Claude Code can plan and update tracks through the connector.

## Phase 3b: Generated track summary (code-maintained, self-healing)

**Problem**: `list_tracks` must stay one read on the remote half, and `conductor/tracks.md` is stale
because nothing in code maintains it (see the two PLAN ADDITIONs on the summary in index.md).
**Solution**: One deterministic generator function. No daemon, no LLM instruction.

- [x] Task 1: `connector/src/summary.mjs`: `generateSummary(repoTrackFiles)` reads every track's `index.md` markers (id, title, lane, lane status, progress, phase, depends on, last-modified) and returns the summary text with a generated-at stamp and a per-track source hash (blob sha of the index.md). Pure; reuses `resolveTrack` for folder resolution. Output file: `conductor/tracks-summary.md` (generated; header says never hand-edit).
- [x] Task 2 (partly; "Lane Status `running` with no live run" is deferred: the files hold no run registry, so a live run cannot be told from a stale `running`): Lint pass in the same function: tracks with inconsistent markers (invalid Lane, Lane Status `running` with no live run, missing required marker) go under a "needs attention" section and are returned to `health_report`.
- [x] Task 3: Write path: `create_track` and `update_track` regenerate the summary and commit it in the SAME commit as the track change (one `commitFiles` call with both paths).
- [x] Task 4: Read path self-healing: `list_tracks` verifies each track's hash against the summary and, on any mismatch or a missing file, regenerates from a folder scan (and says so in `stale_reasons`); it never returns a stale row silently.
- [x] Task 5 (`lc summary [--check]` in `bin/lc.mjs`, a 5-line branch that runs `connector/bin/lc-summary.mjs`; it writes the file and does not commit; `lc new` / `lc move` do not call it yet): `lc summary` command (thin wrapper over the same function) so `lc new` / `lc move` and plain-skill edits have a deterministic path. A conflict on the summary is resolved by regenerating, never by hand-merging.
- [x] Task 6: the committed summary lists only tracks that are in git; found when a draft track's title reached a commit. A track is listed when its `index.md` is in the tree of HEAD (`git ls-tree`), or is written by the same create_track/update_track commit; untracked drafts are left out. `list_tracks` still lists them (`untracked: true` plus a warning) and compares the file against the tracked set; `lc summary` follows the same rule, `--include-untracked` lists everything.

**Impact**: A stale or hand-edited summary can never mislead, and no sync process exists to drift.

## Phase 4: Advice log, report_outcome, health_report

**Problem**: Failures must be visible, and advice must be accountable (REQUIREMENT section).
**Solution**: Log writer, two tools and the report.

- [x] Task 1: `connector/src/advice-log.mjs`: JSONL writer (spec format). Connector-side events on every call. Batching per D3 (local: the working-tree append rides along with the next connector commit).
- [x] Task 2: `report_outcome` (an orphan `serve_id` is recorded with a warning)
- [x] Task 3: `health_report`: per-item and connector metrics, and a kill-criteria table with verdicts (thresholds below, kept in `connector/src/kill-criteria.mjs` as data)
- [x] Task 4 (the connector only READS `beta.json`, validated by `parseBeta`; the human writes it by hand, format in `connector/README.md`; the human's act of recording `beta_start` is Phase 6 Task 7): `beta_start` / `beta_end` markers in `conductor/advice-log/beta.json`, written when the human says the beta starts or ends (plain file edit, nothing automatic)

**Impact**: Override rates, error rates and stale reads are measurable from day one of the beta.

## Phase 5: Local hygiene (no manual commits, visible drift, push under human control)

**Problem**: State must be visible to remote surfaces without "commit and push before everything" (DESIGN NOTE).
**Solution**: Connector writes already commit (REQ-7). Add the drift and push pieces with the
smallest footprint possible.

- [x] Task 1: `freshness` reports ahead, behind and last fetch (done in Phase 2). Add to the plan-lane framing that Claude should `git fetch` when the last fetch is over 1 h old.
- [x] Task 2: Push policy per D4. Default `ask`: responses carry `unpushed_local_commits` plus a hint to ask the human. Opt-in `auto-state`: fast-forward-only push of commits that touch only `conductor/`, 60 s idle debounce, every push logged.
- [x] Task 3: Document in `connector/README.md` that docs-only lanes run in the primary checkout with no worktree, and that code branches never carry state.
- [ ] Task 4 (D5, privacy): `connector.track_conversations` in `.laneconductor.json`, default **false**. When false, `append_conversation` writes the file but never commits it (today's behaviour for an ignored file) and says so. When true, the project owner has removed the ignore rule on purpose. The scaffold default stays "ignored".
- [ ] Task 5 (D5, privacy): a scan before the connector commits any conversation turn or `update_track` body: the REQ-12 secret patterns (10107 secrets.mjs when it exists, a minimal local copy until then) plus email and phone patterns. A match blocks the commit and returns an error naming the file and line, never the matched text.
- [ ] Task 6 (D5, PROPOSED, needs human OK): decisions are a first-class TRACKED artifact. Reason: an ignored `conversation.md` is per machine, so it drifts between computers and is invisible to remote surfaces. Add a way to record a decision (a `## Decisions` section in `index.md`, or `decisions.md`) through the connector's write path, with the Task 5 scan in front, so what matters travels with git. `conversation.md` stays a per-machine scratchpad (tracking it stays opt-in per Task 4). Skill/lane-guide rule: anything important goes in plan, spec or decisions, never only in conversation. Additive tool change, so the tool contract rule holds.

**Impact**: Local work becomes remotely visible quickly, and push stays under the human's authority.

## Phase 5b: Self-describing responses (`next`)

**Problem**: A client should be able to follow the connector without reading a schema, and a response
should say what to do next (REQ-24).
**Solution**: One small, additive change to the response envelope.

- [ ] Task 1: `next` field in the envelope (string or null) with the rules in REQ-24; the handlers that already produce hints (unpushed commits, CONFLICT, stale summary, empty results) set it
- [ ] Task 2: Tests: every tool returns `next`; it never triggers an action; the tool list hash changes only additively
- [ ] Task 3: Mention `next` in the server instructions (stay under 4,096 characters) and README

**Impact**: Chats that can only follow instructions still get a clear path, and the same field serves the remote `/start`.

## Phase 5c: LaneConductor plugin (the skill and the connector delivered as one unit)

**Problem**: Claude clients may ignore a server's `instructions` (U1), and a connector alone leaves Claude to guess the workflow from tool names. The official plugin format (verified in the Claude docs, 2026-11-17) bundles a skill and an MCP connector, installs from a git marketplace, syncs to claude.ai and Claude Code, and updates from its source.
**Solution**: One generated plugin directory, one marketplace file. Constraints from the docs: only the plugin directory is copied on install (so the connector code lives inside it); a top-level `bin/` stops claude.ai and Cowork installing the plugin (so the server code is not under `bin/`, and the repo root cannot be the plugin root); symlinks leading outside the plugin are rejected (so the plugin directory is generated by code, copying, and a test fails on drift, the same rule as the track summary); Claude Code installs registry dependencies from an npm lockfile at cache time (exact pins, no lifecycle scripts, 60 s limit).

- [x] Task 1: `scripts/build-plugin.mjs` generates `plugins/laneconductor/`: `.claude-plugin/plugin.json` (name `laneconductor`), `skills/laneconductor/` (copied from `.claude/skills/laneconductor`), `server/` (the connector code: `bin/lc-connector.mjs`, `src/`, `guides/`), `package.json` + `package-lock.json` at the plugin root (npm lockfile v2/3, registry packages only), and `.mcp.json` with a stdio entry (`node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs --repo ${CLAUDE_PROJECT_DIR}`). Committed output; no top-level `bin/` (done: `scripts/build-plugin.mjs`, output committed; the repo files the server imports from outside `connector/` (`conductor/providers.mjs`, `conductor/sync-conversation-utils.mjs`, `conductor/services/track-folder.mjs`) are found by following imports and copied to the same repo-relative path under the plugin root, so the connector's `../../conductor/...` imports keep resolving. `bin/lc-connector.mjs` now looks for `package.json` beside `bin/` and one level up, because the plugin root, not `server/`, holds it. A real `npm ci --offline` from the lockfile in a temp copy works)
- [x] Task 2: `.claude-plugin/marketplace.json` at the repo root: marketplace name `laneconductor`, one entry whose `name` equals the manifest name and whose `source` is `./plugins/laneconductor` (done, generated by the same script; `claude plugin validate .` passes. Validate warns without `author`/marketplace `description`, so both are set; it also advises a README install line with the real `<owner>/<repo>`, left to the human)
- [x] Task 3: Skill path audit: every path in the skill that assumes `.claude/skills/laneconductor/...` must also work from the plugin location (relative to SKILL.md or `${CLAUDE_SKILL_DIR}`); a test greps the generated skill for hard-coded project paths (done; findings: every link inside the skill is relative to SKILL.md and works from both locations. Hard-coded locations found: SKILL.md prose naming only `.claude/skills/laneconductor/` (reworded to name the plugin location too); `setup/scaffold.md` and `setup/templates.md` symlink/copy from `~/.laneconductorrc` or `$HOME/Code/laneconductor/...` (a plugin install has neither: added a skip note for the link step and an ask-the-human note for the `workflow.json` copy, left the commands alone); `lanes/implement.md` and `ops/tracks.md` look in project `.claude/skills/` for OTHER recommended skills (left: that is the project skill folder, not this skill); lane files tell the agent to run `node conductor/lock.mjs`, `unlock.mjs`, `measure.mjs` and `lc` from the project (left: they assume a LaneConductor install in the project and are outside this phase). `${CLAUDE_SKILL_DIR}` was not needed. Frontmatter: description+when_to_use is 844 of 1,536 chars and `validate --strict` passes. Test greps the generated skill)
- [x] Task 4: Tests: regenerating gives byte-identical output (no drift); `claude plugin validate` passes on the plugin and on the marketplace; no secrets (REQ-12 scan); no top-level `bin/`; lockfile has registry-only exact pins; the generated server starts over stdio and answers `tools/list` from a throwaway repo (done, `connector/test/plugin-build.test.mjs`, 11 tests: drift, drift detection, validate on plugin and marketplace (skips when `claude` is missing), shape, no `bin/`, lockfile, secret scan, skill frontmatter and links, path audit, generated server over stdio from a temp copy via `.mcp.json` args. Not verified by a test: `claude plugin details` (the sandbox classifier refused to run it), and any real install)
- [ ] Task 5 (HUMAN; written for the single plugin of 0.2.x, since split into three: install `laneconductor` and `laneconductor-connector`, and `/mcp` then shows `plugin:laneconductor-connector:lc`): `claude plugin marketplace add <repo>` then `claude plugin install laneconductor@laneconductor`; `/mcp` shows `plugin:laneconductor:lc-connector` connected; "plan X" on a scratch repo works through the connector; run `claude plugin eval` (it cannot authenticate from inside a nested session here). Confirms the `${CLAUDE_PROJECT_DIR}` substitution in MCP args, which the docs describe but this plan has not seen work
  - VERIFIED 2026-11-17 (human installed the plugin from the marketplace with scope local; `/reload-plugins` in a real Claude Code session): the connector's 8 tools and its instructions appeared in the session with no tool call (U1 holds for Claude Code); a real `list_tracks` call returned live data with provenance (`state_branch_source: origin_head`, commit 8f124bb); `${CLAUDE_PROJECT_DIR}` resolved to the project; Claude Code auto-installed the plugin's `node_modules` at cache time. The human's `/mcp` panel did not list the server, which is unexplained and does not stop it working.
  - VERIFIED the same day on a throwaway repo, driving the INSTALLED plugin's own server over stdio: `create_track` made all five track files plus `tracks-summary.md` in ONE commit; a valid `update_track` landed (Progress 10% on disk, summary regenerated in the same commit); a second `update_track` with the stale `base` returned CONFLICT and the file kept the first edit; `append_conversation` committed; `list_tracks` returned the track. Guard found: a repo with no `conductor/tracks/` is refused (NOT_A_LANECONDUCTOR_REPO) until the human agrees to create it.
  - STILL HUMAN: an LLM planning "plan X" from the tools alone in a scratch repo (plugin installed there with `--scope local`), and `claude plugin eval`.
- [ ] Task 6 (after Phase 8): add the remote entry (`type: http`, the deployed `/mcp` URL) so claude.ai and Cowork list it on the plugin's Connectors tab. Open question: Claude Code would then see the local and the remote server in one plugin (two tool sets); decide between a per-surface plugin variant and a `userConfig` toggle. Never put secrets in `.mcp.json`
- [x] Task 7: Release rule: knowledge (skill, guides) changes ship by bumping the plugin `version` and pushing; user-added marketplaces do not auto-update by default, so the README says how to update (done: documented in the connector README, "The LaneConductor plugin"; the commands `claude plugin marketplace update` and `claude plugin update` exist in this CLI per `--help`, the update flow itself is not run)
- [x] Task 8 (found by surveying ~/Code, 2026-11-17; built in `connector/src/state-branch.mjs`, tests in `connector/test/state-branch.test.mjs`, plugin regenerated; the response field is `provenance.state_branch_source`, plus a per-repo stderr line at startup, and a `--state-branch` flag still wins over everything): per-repo state branch. The connector defaults to `main` and only a CLI flag changes it, but the plugin's `.mcp.json` passes none, and 6 of the 20 conductor projects are on `master` (1 on `public`), where writes would be refused. Resolve it per repo, in this order: `connector.state_branch` in `.laneconductor.json`; else the repo's default branch (`origin/HEAD`); else the current branch if it is `main` or `master`; else refuse as today. The response says which rule chose it. Tests for each rule, including a `master` repo.
- [ ] Task 9: Rollout checklist (HUMAN, one project at a time): confirm `/mcp` shows the connector; check the branch rule above; remove that project's `.claude/skills/laneconductor` symlink once the plugin provides the skill (two copies double the skill text in context); keep daemons off in migrated projects. Survey on 2026-11-17: 20 projects have `conductor/`; 16 symlink the skill, 1 (laneconductor) has a copy, 4 have no skill link; only the laneconductor project runs a sync daemon, so every other project is skill-only today.

**Impact**: "plan X" works the same on Claude Code now and on claude.ai and mobile once the remote entry exists, without re-prompting the pattern each session.

## Phase 5d: A place to see the tracks (a board per project; no daemon)

**Problem**: With the daemon dropped (2026-11-17) nothing syncs files into Postgres, so the Kanban UI no longer updates, and the human wants to see each project's tracks in one place and refresh it by asking Claude.
**Solution**: One code-maintained generator, one dashboard per project. Files stay the truth; a board is a rebuildable snapshot (never hand-edited, never written back). Honest limits (verified from the tool contracts): only Claude can create or update a Claude artifact (a script, hook or the connector cannot call the Artifact tool), so a board is as fresh as the last time Claude refreshed it, and the page shows its "generated at" time.

- [x] Task 1: `lc board` (`connector/bin/lc-board.mjs`, `connector/src/board.mjs`; shipped in the plugin as `server/bin/lc-board.mjs`): for ONE project, reads `conductor/tracks/*/index.md` markers and prints the board data as JSON on STDOUT (track, title, lane, lane status, progress, phase, depends on, needs-attention flags, generated-at, source hash per track; nothing is written into the repo, `--out <file>` writes a file; a board is a snapshot, not a committed `conductor/board.json`), reusing `connector/src/summary.mjs` and its lint. Titles, lanes, status and progress only: never conversation text or file bodies. Deterministic; `--check <file>` mode for drift. Tested in `connector/test/board.test.mjs`
- [x] Task 2: The board artifact per project (recommended first viewer): ONE static page, `connector/src/board-page.html` (shipped byte for byte; lanes as columns, a Done list, a needs-attention list, a status filter with a banner saying where the matches are, generated-at stamp, light and dark, loading and "Could not load board.json" states), and the data is a SEPARATE file, `board.json` (`boardPageData` in `connector/src/board.mjs`: live tracks only; titles, lanes, status, progress, phase and check reasons). The page fetches `board.json` by a relative URL, so a refresh replaces only the data file and the page never changes. `lc-board.mjs --site <dir>` writes both files (refuses a folder inside `conductor/`) and prints their paths. Private by default; the artifact URL is kept in `.laneconductor.json` as `board.artifact_url`. Code and fake-DOM tests: `connector/test/board-page.test.mjs`. The real publish (page plus a published `board.json` that the page can fetch) is (verified by the orchestrator)
- [x] Task 3: The update path is a SKILL command, not a daemon and not an MCP tool (only Claude can call the Artifact tool): `.claude/skills/laneconductor/ops/board.md`, routed from SKILL.md ("board", "show the board", "update the board", `/laneconductor board`). It runs `lc board --site <tmpdir>`, reads the artifact once, publishes `board.html` with `files: {"board.json": ...}` to `board.artifact_url`, then opens it. Decision on the artifact database: NOT used. The page is static and the data is one small file, so a refresh is one publish of `board.json`; a database would add a capability, a write path and shared state for no gain at this size. The skill frontmatter limit and the plugin copy are checked by `connector/test/plugin-build.test.mjs`. The command run in a real session is (verified by the orchestrator)
- [x] Task 4: New projects: `setup/scaffold.md` ends by OFFERING the board (asks once; on yes it follows `ops/board.md` "No URL: create"); existing projects get it on request ("show the board"). Nothing is created without a yes, and nothing refreshes it unless Claude is running. The create step in a real session is (verified by the orchestrator)
- [ ] Task 5: Optional overview page (a second artifact): one row per project (counts per lane, needs-attention count, link to that project's board). Projects are listed only if opted in (`board.include`); a private project's board is never merged into another's artifact
- [ ] Task 6: Privacy: a board is private by default and is never shared automatically; publishing is checked against the project's visibility (a public repo can still have a private board, but say so). Optional later viewer: the Vite UI through an on-demand `lc index` (files to Postgres, one way), only if the artifact is not enough
- [x] Task 7 (built and tested in code 2026-11-17: `connector/src/board-docs.mjs`, `connector/src/scan.mjs`, `lc-board.mjs --site [--json]`, the drawer in `connector/src/board-page.html`, tests in `connector/test/{scan,board-docs,board-page}.test.mjs`; the real publish of the docs files and the page in a live artifact is (verified by the orchestrator)): Track detail: Click or tap a track card to open a detail view inside the board page that mirrors the UI's track panel (`ui/src/components/TrackDetailPanel.jsx`): a header with id, title, lane, status pill, progress and phase, and tabs Overview (index.md), Plan, Spec and Tests (test.md). Conversation tab: OFF by default (`board.include_conversation: false` in .laneconductor.json), because conversation.md is per-machine, gitignored for privacy, and one real conversation in this repo discusses an exposed password; when a project turns it on it is read-only, goes through the same secret/email/phone scan, and a match withholds that track's conversation. Logs tab: not included (runs and logs belong to the parked daemon). Docs are published as separate files alongside the page (one JSON file per track, `docs/<number>.json` holding the index/spec/plan/test text), fetched on click, rendered as markdown by a small in-page renderer that builds DOM nodes with createElement/createTextNode only (no html-string API anywhere; only https links become anchors; chosen over a cdnjs library plus a sanitizer because it needs no external script and the repo's real plans and specs only use headings, lists, task items, code, tables, quotes and links). Scope: tracks not in done (about 60 per project, within the 255-file publish limit); done tracks link to the repo's GitHub page when the project has a remote. Privacy: bodies go through the secret/email/phone scan (`connector/src/scan.mjs`; a similar scanner is on the track-10107 branch and the two should be merged later) and a track with a match is shown as 'withheld: possible secret or personal data'; the footer says that sharing the board shares these documents; opt-out via `board.include_docs: false` in .laneconductor.json. `lc board --site` writes the docs files (at most 200 per site, each cut at 60,000 characters; the oldest backlog tracks are dropped first and counted as `docs_dropped` in `board.json`), `--json` prints `{ page, root, files }` for the Artifact tool, and `board.json` gains `d` (docs available) per track and `gh` (the track folder on GitHub, `/tree/` URL, only on done tracks and only with a github.com origin); the page stays static. Done tracks have no docs file: the drawer links to GitHub. Real run on this repo's primary checkout (read-only): 50 docs files, 869,179 bytes in all, 3 index.md files withheld (tracks 1120, 10041, 10103: email addresses in the Created By line), largest docs/10106.json at 116,585 bytes.

**Impact**: Each project has one place to see its tracks, refreshed by asking Claude, with nothing running in the background.

## Phase 5e: Anthropic directory submission (three plugins: the lean main plugin is the one submitted)

**Problem**: FINDING (2026-11-17, from running Anthropic's directory validation on the single plugin: 8 blocking, 3 warnings, 7 policy holds). From a publisher that is not a Verified organization (ours is not) the directory accepts ONLY Markdown, text, JSON and YAML files plus PNG/JPEG/GIF/WebP/ICO images, and a remote MCP server that connects to a public URL. It BLOCKS a local (stdio) MCP server, `package.json` or lockfile installs, script or program files (any `.mjs`, anything starting with `#!`), `allowed-tools` entries beyond Read, Grep, Glob and LS (our `SKILL.md` had `Read, Edit, Write, Bash, Glob, Grep`), `.mcp.json` entries that run commands, hooks that run commands, package-manager config files, a `.claude/skills` folder inside the plugin, any `.claude-plugin` folder other than the plugin's own, and `package.json` fields beyond a plain list. It warns for a missing icon (square PNG, 512 to 2048 px, under 2 MB). So a directory-eligible plugin must be Markdown-only: the local connector, the board script and the hooks cannot be in it.
**Solution**: DECISION (human, 2026-11-17; see index.md): three plugins in one marketplace, built by one generator from the same sources, with an "agent-neutral core, Claude adapter" design (`connector/ARCHITECTURE.md`): `laneconductor` (LEAN main plugin: skill without `allowed-tools`, commands, agents, icon, README, LICENSE; Markdown and one PNG only; the only one submitted), `laneconductor-board` (local add-on: the board generator and exactly the files it imports, no npm package) and `laneconductor-connector` (OPTIONAL local add-on: the safe-writes MCP connector, server key `lc`, tools named `mcp__plugin_laneconductor-connector_lc__<tool>`). Both add-ons depend on `laneconductor` and ship no skill and no commands. The commands and agents work with or without the connector (its tools when present, direct file edits otherwise). The remote connector is listed separately later (a remote MCP server on a public URL is accepted by the directory). The portal's Validate and the submission remain HUMAN and apply to the lean plugin only.

- [x] Task 1: README + license + manifest: `connector/PLUGIN-README.md` (copied by `scripts/build-plugin.mjs` to `plugins/laneconductor/README.md`, version filled in; says what runs, what is read and written, that nothing is sent, where it works, the safety rules, the board command, license, support); the repo `LICENSE` (Elastic License 2.0) is copied to the plugin folder; `plugin.json` gains `license`, `homepage`, `repository`, `keywords`, `documentationUrl`, `supportUrl` and the author url. No `privacyPolicyUrl` (none exists; the README states that nothing leaves the machine). Tested in `connector/test/plugin-build.test.mjs` (>= 40 words outside code blocks, fields, LICENSE identical to the repo's)
- [x] Task 2: Lean skill: the plugin's skill no longer ships `legacy/` (the parked worker, syncdb, remote-sync and Postgres-schema tier); `setup/` and `deploy/` still ship. The generator applies explicit, unit-tested edits (`SKILL_EDITS`: routing rows and the schema pointer in `SKILL.md`; the `legacy/` mentions and DB-step headings in `setup/setup.md`) and fails the build if a source anchor disappears. SKILL.md, `lanes/` and `ops/` contain no psql, gcloud, DATABASE_URL, neon.tech, supabase, run.app or collector; every relative link resolves; no file names a `legacy/` path. The source skill in `.claude/skills/laneconductor` is unchanged
- [x] Task 3: Env-based repo resolution: `.mcp.json` args are just `["${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs"]`; the connector serves the `--repo` flag(s), else `CLAUDE_PROJECT_DIR`, else the git top level of the cwd, else exits 2 with a clear message; the choice is logged to stderr (`connector/src/repo-source.mjs`, `connector/test/repo-source.test.mjs`). REAL-SESSION CHECK, HUMAN: after updating the plugin, `/mcp` still shows the connector connected (`plugin:laneconductor-connector:lc` since the split) (this confirms Claude Code exports `CLAUDE_PROJECT_DIR` to the server; the tests only set it themselves)
- [x] Task 4: `.gitattributes`: the `* text=auto eol=lf` line is gone (only the binary entries remain). No tracked file changes; a renormalize under the old rule would have rewritten only `Makefile`
- [x] Task 5: Pre-checks as a test (`connector/test/directory-precheck.test.mjs`): `claude plugin validate` `--strict` on the plugin folder and on the repo root (skipped with a message when the `claude` CLI is missing); at most 512 files, each under 256 KiB, text-only, no links, no `.DS_Store`, `Thumbs.db`, `__MACOSX`, `.npmrc`, `bunfig.toml`; no minified code; secret scan clean; `.mcp.json` uses node, a file in the plugin and only `${CLAUDE_PLUGIN_ROOT}`; no content-rewriting `.gitattributes`; `git archive HEAD` under 48 MiB and under 10,000 files
- [ ] Task 6 (HUMAN, LEAN plugin only): pull the latest, then at claude.ai/directory/manage choose Submit new > Plugin bundle > repo `meller/laneconductor`, plugin folder `plugins/laneconductor`, and run the portal's Validate; the 8 blocking findings should be gone, because the lean plugin has no server, no package files, no scripts, no hooks and no `allowed-tools`. Fix what it reports. The "held for a reviewer" findings about the lockfile install and the local Node server no longer apply to the submitted plugin. Accept the Directory Terms and Policy yourself and submit. The two add-ons are installed from the marketplace, never submitted
- [x] Task 7: Split the generator into three profiles in `scripts/build-plugin.mjs` (lean, board, connector), `--check` covers all three and the marketplace file (three entries, names equal the manifest names, relative sources); `connector/package.json` and its lockfile are 0.3.0 and all three plugins carry that version. `claude plugin validate --strict` passes on the three folders and on the marketplace; the add-ons declare `"dependencies": ["laneconductor"]` and validate accepts that
- [x] Task 8: Lean-skill transforms (generator only, the source skill is untouched): the `allowed-tools` key is deleted from `SKILL.md` (Claude Code then applies its normal permission check; description + when_to_use stay under 1,536 characters), `ops/board.md` points at `laneconductor-board` instead of a `server/` folder the lean plugin lacks, and a short `## Habits (this plugin has no hooks)` section is appended (3-line status once per session, one next step per finished lane, change markers by hand only with a fresh read or with the connector's tools, say what will be pushed and ask first)
- [x] Task 9: Icon: `scripts/make-icon.mjs` (no dependencies, a tiny PNG encoder on zlib) writes `connector/plugin-extras/icon.png`, 1024x1024, five rounded vertical lanes on `#0F1613` in `#5FC7A8` and softer tints; the generator copies whatever PNG is at that path into all three plugins, so the human can replace it
- [x] Task 10: Commands and agents work with the connector present or absent: command bodies say "with `laneconductor-connector` use its tools, otherwise edit the track files following the skill"; `board` and `run` say the board needs `laneconductor-board` or the `lc` CLI on PATH and otherwise stop; the lean agents' `tools` lists name no connector tool (`plan-reviewer` stays read-only: Read, Grep, Glob; `track-runner` keeps Read, Edit, Write, Bash, Grep, Glob and `isolation: worktree`)
- [x] Task 11: Tests: `connector/test/directory-lean.test.mjs` emulates the directory's rules on the lean plugin (allowed file types, no `#!`, no package files or config, no `.mcp.json`, no hooks, no `.claude/skills`, no foreign `.claude-plugin`, manifest keys, `allowed-tools`, icon header, README words, file counts and sizes, UTF-8 and registry lines) and proves each rule fires on a broken copy; `connector/test/addons.test.mjs` covers both add-ons (dependency, imports resolve inside the plugin, the board script runs from a bare copy with no `node_modules`); the plugin-build, precheck and coverage tests are updated to the three-plugin layout. Not emulated: the portal's policy holds (a reviewer reads the listing) and whether it also inspects subagent `tools:` lists
- [x] Task 12: `connector/ARCHITECTURE.md` (the layers: neutral core, Claude adapter, what another agent would need, and the rule that Claude-specific behaviour never leaks into the core), linked from `connector/README.md`
- [ ] Task 13 (later, after Phase 8): list the remote connector separately in the directory (a remote MCP server on a public URL is accepted); it is not part of any of the three plugins
- [ ] Task 14 (HUMAN): install the marketplace and the three plugins in a real session: `/mcp` shows `plugin:laneconductor-connector:lc` connected; `/laneconductor:board` finds `laneconductor-board`'s script; without the connector the commands still work by editing files

**Impact**: The lean plugin passes every offline check of the directory's pre-submission list and its emulation of the non-Verified-publisher rules; what remains is the human's portal validation, terms and submission of that one plugin.

## Phase 6: Local beta validation (AC-a, AC-c local, AC-d local, AC-e, AC-f)

**Problem**: The local half must be shown to work before anything is hosted.
**Solution**: Run the scenarios in `test.md` "Beta scenarios" against a scratch project, and record the results.

- [ ] Task 1 (HUMAN: a real directory in ~/Code with the connector added to a real Claude Code config): Scratch project `~/Code/lc-connector-beta` (own git repo, a `conductor/` with context files, no LaneConductor skill, no CLAUDE.md mention) with the stdio connector configured
- [ ] Task 2 (HUMAN: needs a real Claude session; the format checks themselves are covered by TC-3.7 and TC-2.4): B-a: "plan <small feature>" with no pattern prompting, then check the files with the format checker
- [x] Task 3 (automated against a throwaway repo and the real stdio server, `connector/test/beta-local.test.mjs`; the live scratch-project run is Task 1's): B-c local: commit locally without pushing, and check that a read shows `unpushed_local_commits`
- [x] Task 4 (automated, same file, two real server processes, sequential and 5 simultaneous rounds): B-d: two sessions edit `plan.md` from the same base; the second gets `CONFLICT`, and the file holds the first edit
- [ ] Task 5 (partly automated: B-c and B-d pass with unreachable Postgres settings, no sockets in the server process and no DB or network code in `connector/src`; the full run including B-a with Postgres actually stopped is HUMAN): B-e: run all of the above with Postgres stopped and no sync daemon running
- [ ] Task 6 (HUMAN: real Claude sessions and the token measurement): B-f: confirm the token-measurement method (U7), then 5 paired "plan X" runs (skill only vs connector), medians recorded in `beta-report.md` in this track folder
- [ ] Task 7 (HUMAN): The human records `beta_start` (Phase 4 Task 4)

**Impact**: Local go or no-go evidence. The beta clock starts.

## Phase 7: GitHubStore

**Problem**: Remote surfaces cannot see the local filesystem.
**Solution**: `connector/src/store-github.mjs` implementing the same interface (spec "Storage
interface"): a serial request queue, conditional ref reads, a sha-addressed tree and blob cache, a
tarball cold-start seed, a rate-limit guard, and writes through `createCommitOnBranch` with
`expectedHeadOid` and re-checked preconditions.

- [ ] Task 1: Read path (ref, then trees, then blobs) with the cache and the budgets from the spec table, checked against a recorded-fixture fake fetch
- [ ] Task 2: Write path and retry. Resolve U5 on a scratch GitHub repo: the human creates it and supplies a fine-grained token through an env var. Claude never sees or echoes the value.
- [ ] Task 3: Resolve U4 (tarball cost) and record it in spec.md
- [ ] Task 4: The shared tool-contract test suite passes against both stores

**Impact**: The same tools work against a GitHub repo.

## Phase 8: Remote HTTP server and auth (per D1/D2)

**Problem**: claude.ai needs a Streamable HTTP endpoint with OAuth (F4, F9).
**Solution**: `connector/bin/lc-connector-http.mjs`: a Streamable HTTP endpoint at `/mcp` plus
`Origin` validation (F3). It is the OAuth AS and resource server: PRM at
`/.well-known/oauth-protected-resource` with `resource` equal to the exact connector URL, a `401`
with `WWW-Authenticate: Bearer resource_metadata=…`, AS metadata, CIMD and DCR, PKCE S256, and
redirect URIs `https://claude.ai/api/mcp/auth_callback` plus loopback on any port for Claude Code
(F9). Sign-in is Google (D1 as decided, reusing FITI's pattern: Firebase Auth on a static `/authorize` page plus an email allow-list). GitHub access is a GitHub App INSTALLED on the repos: the server mints short-lived installation tokens from the App private key (Secret Manager), limited by a per-email repo map, so no per-user GitHub token is stored (D6 mostly moot). It issues its own audience-bound tokens and never passes a GitHub token through (F4).

- [ ] Task 1: Resolve U3, and use the SDK's auth helpers where they cover the AS role
- [ ] Task 2: HTTP server, auth endpoints, user allow-list, and per-user repo selection (`project` = `owner/name`, limited to repos the App is installed on)
- [ ] Task 3: Container and deployment config for Cloud Run (D2-a). **The human performs the deploy and the GitHub App registration**, and secrets go into Secret Manager by the human.
- [ ] Task 4: Advice-log buffering and flush for the remote backend (D3-a)
- [ ] Task 5 (REQ-25): `GET /start` (static, self-describing, with a `next` line) and read-only GET views of tracks for browse-only chats. No state-changing GET endpoint exists; a test enumerates the route table and fails on any GET that writes.
- [ ] Task 6 (D1, human part): deploy shape follows FITI (Firebase Hosting rewrites `/mcp`, `/oauth/**`, `/.well-known/**` to one function in `laneconductor-site`); the human registers the GitHub App and performs the deploy.

**Impact**: A remote connector URL that a claude.ai user can add.

## Phase 9: Remote beta validation (AC-b, AC-c remote, AC-d remote)

**Problem**: The remote half must work from claude.ai itself.
**Solution**: Run the remote scenarios in `test.md`.

- [ ] Task 1: B-b: add the connector on claude.ai web, then "plan <small feature>" against the scratch GitHub repo; a valid track appears as a commit authored by the user
- [ ] Task 2: B-c remote: with the laptop holding unpushed state commits, a remote read shows the head commit and its age, and Claude mentions possible staleness
- [ ] Task 3: B-d remote: a concurrent edit gives `CONFLICT`, and the GitHub file holds the first edit
- [ ] Task 4: Check the request budgets from the spec (spot check through the `x-ratelimit-remaining` deltas logged)
- [ ] Task 5 (REQ-26, HUMAN): fill `compat-matrix.md` with what each client actually did (claude.ai web, mobile, Claude Code, plus any other the human tries): read the instructions, called the tools, followed `next`, did not claim a save that did not happen. Claim nothing about a client without a row.

**Impact**: The full beta scope is shown working.

## Phase 10: Beta run and kill-criteria decision (human-judged; cannot be checked by the implement lane)

**Problem**: Whether the connector earns its place is decided from evidence, not opinion.
**Solution**: Use the connector for real work through the beta window, then let the human decide.

- [ ] Task 1: The beta window runs at least 2 weeks **and** at least 10 connector sessions (at most 4 weeks)
- [ ] Task 2: Run `health_report` and save the summary into `beta-report.md` with the AC-f numbers
- [ ] Task 3: The human records keep / change / remove (connector, LaneConductor advice, remote half) in `beta-report.md` and the `index.md` decisions section (tracked files: `conversation.md` is per-machine), citing the kill-criteria table
- [ ] Task 4: If remove: disconnect it, delete `connector/` on a branch, and leave the track files untouched (REQ-22)

**Impact**: A decision about the connector backed by the beta's numbers.

## Kill criteria (fixed before the beta; evaluated by `health_report`)

Window: from `beta_start` to `beta_end`. A verdict of `insufficient_data` holds when n is below the
stated minimum. The decision is always the human's.

| ID | Metric | Threshold | Consequence |
|----|--------|-----------|-------------|
| KC-1 | Silent overwrites or corrupted track files attributable to the connector | **> 0** | Stop the beta at once and disconnect until fixed (integrity is firm) |
| KC-2 | Connector error rate: `tool_error` / calls, excluding correct-behaviour codes (spec table) | > **5%** over the window (n >= 50 calls), or > 3 in one session | Change. If still > 5% after one fix iteration, remove |
| KC-3 | Advice override rate: deviated / (followed + deviated) | > **50%** overall with >= 20 outcomes. Per item > 50% with >= 5 outcomes is flagged for rewrite or delete | Change LaneConductor advice (rewrite or prune the guides) |
| KC-4 | Outcome reporting coverage: outcomes / serves | < **30%** | The follow/deviate signal is unusable. Judge KC-3 by human review of 5 sampled sessions instead. Not a kill on its own |
| KC-5 | Efficiency over 5 paired "plan X" runs | Connector median total tokens **and** median wall-clock both no better than 10% below the skill baseline, **and** no fewer pattern re-prompts | No measurable saving: remove the connector from Claude Code (the skill stays). The remote half is judged by KC-6/7 |
| KC-6 | Remote use: real claude.ai/mobile sessions using the connector | < **3** in the window | Park the remote half (hosting and auth cost not earned) |
| KC-7 | Remote stale-read rate: `stale_read` / remote reads | > **25%** | Push hygiene is failing: revisit D4, or park the remote half |
| KC-8 | Context overhead: estimated tokens of instructions + tool list per session | > **2,000** | Trim instructions and descriptions (change, not kill) |
