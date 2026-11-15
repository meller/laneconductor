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

## Phase 4: Advice log, report_outcome, health_report

**Problem**: Failures must be visible, and advice must be accountable (REQUIREMENT section).
**Solution**: Log writer, two tools and the report.

- [ ] Task 1: `connector/src/advice-log.mjs`: JSONL writer (spec format). Connector-side events on every call. Batching per D3 (local: the working-tree append rides along with the next connector commit).
- [ ] Task 2: `report_outcome` (an orphan `serve_id` is recorded with a warning)
- [ ] Task 3: `health_report`: per-item and connector metrics, and a kill-criteria table with verdicts (thresholds below, kept in `connector/src/kill-criteria.mjs` as data)
- [ ] Task 4: `beta_start` / `beta_end` markers in `conductor/advice-log/beta.json`, written when the human says the beta starts or ends (plain file edit, nothing automatic)

**Impact**: Override rates, error rates and stale reads are measurable from day one of the beta.

## Phase 5: Local hygiene (no manual commits, visible drift, push under human control)

**Problem**: State must be visible to remote surfaces without "commit and push before everything" (DESIGN NOTE).
**Solution**: Connector writes already commit (REQ-7). Add the drift and push pieces with the
smallest footprint possible.

- [ ] Task 1: `freshness` reports ahead, behind and last fetch (done in Phase 2). Add to the plan-lane framing that Claude should `git fetch` when the last fetch is over 1 h old.
- [ ] Task 2: Push policy per D4. Default `ask`: responses carry `unpushed_local_commits` plus a hint to ask the human. Opt-in `auto-state`: fast-forward-only push of commits that touch only `conductor/`, 60 s idle debounce, every push logged.
- [ ] Task 3: Document in `connector/README.md` that docs-only lanes run in the primary checkout with no worktree, and that code branches never carry state.

**Impact**: Local work becomes remotely visible quickly, and push stays under the human's authority.

## Phase 6: Local beta validation (AC-a, AC-c local, AC-d local, AC-e, AC-f)

**Problem**: The local half must be shown to work before anything is hosted.
**Solution**: Run the scenarios in `test.md` "Beta scenarios" against a scratch project, and record the results.

- [ ] Task 1: Scratch project `~/Code/lc-connector-beta` (own git repo, a `conductor/` with context files, no LaneConductor skill, no CLAUDE.md mention) with the stdio connector configured
- [ ] Task 2: B-a: "plan <small feature>" with no pattern prompting, then check the files with the format checker
- [ ] Task 3: B-c local: commit locally without pushing, and check that a read shows `unpushed_local_commits`
- [ ] Task 4: B-d: two sessions edit `plan.md` from the same base; the second gets `CONFLICT`, and the file holds the first edit
- [ ] Task 5: B-e: run all of the above with Postgres stopped and no sync daemon running
- [ ] Task 6: B-f: confirm the token-measurement method (U7), then 5 paired "plan X" runs (skill only vs connector), medians recorded in `beta-report.md` in this track folder
- [ ] Task 7: The human records `beta_start` (Phase 4 Task 4)

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
(F9). It federates sign-in to the GitHub App (D1-a), stores GitHub tokens server-side (encrypted,
key in Secret Manager), issues its own audience-bound tokens, and never passes the GitHub token
through (F4).

- [ ] Task 1: Resolve U3, and use the SDK's auth helpers where they cover the AS role
- [ ] Task 2: HTTP server, auth endpoints, user allow-list, and per-user repo selection (`project` = `owner/name`, limited to repos the App is installed on)
- [ ] Task 3: Container and deployment config for Cloud Run (D2-a). **The human performs the deploy and the GitHub App registration**, and secrets go into Secret Manager by the human.
- [ ] Task 4: Advice-log buffering and flush for the remote backend (D3-a)

**Impact**: A remote connector URL that a claude.ai user can add.

## Phase 9: Remote beta validation (AC-b, AC-c remote, AC-d remote)

**Problem**: The remote half must work from claude.ai itself.
**Solution**: Run the remote scenarios in `test.md`.

- [ ] Task 1: B-b: add the connector on claude.ai web, then "plan <small feature>" against the scratch GitHub repo; a valid track appears as a commit authored by the user
- [ ] Task 2: B-c remote: with the laptop holding unpushed state commits, a remote read shows the head commit and its age, and Claude mentions possible staleness
- [ ] Task 3: B-d remote: a concurrent edit gives `CONFLICT`, and the GitHub file holds the first edit
- [ ] Task 4: Check the request budgets from the spec (spot check through the `x-ratelimit-remaining` deltas logged)

**Impact**: The full beta scope is shown working.

## Phase 10: Beta run and kill-criteria decision (human-judged; cannot be checked by the implement lane)

**Problem**: Whether the connector earns its place is decided from evidence, not opinion.
**Solution**: Use the connector for real work through the beta window, then let the human decide.

- [ ] Task 1: The beta window runs at least 2 weeks **and** at least 10 connector sessions (at most 4 weeks)
- [ ] Task 2: Run `health_report` and save the summary into `beta-report.md` with the AC-f numbers
- [ ] Task 3: The human records keep / change / remove (connector, LaneConductor advice, remote half) in `conversation.md`, citing the kill-criteria table
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
