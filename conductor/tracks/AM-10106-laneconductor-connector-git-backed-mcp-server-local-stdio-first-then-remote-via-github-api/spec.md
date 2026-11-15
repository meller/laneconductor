# Spec: LaneConductor connector (git-backed MCP server)

## Problem Statement

"Plan X" should work from any Claude surface (Claude Code, claude.ai web, desktop, mobile) without
pasting the LaneConductor pattern into every session. The durable value of LaneConductor is its
files: track folders (`index.md`, `spec.md`, `plan.md`, `test.md`, `conversation.md`) and the
project context files (`product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`,
`quality-gate.md`, `kpis.md`). The DB, worker, dispatch and remote-sync layers are where most recent
bugs came from and are parked.

The connector is an MCP server whose store is the git repo. It provides **state, context and
advice**. It does not schedule, dispatch or supervise lane execution: Claude's native sub-agent and
worktree behaviour is used as is (track 10108). It is a second opinion, never a controller: what it
serves is phrased as recommendations, and Claude may deviate if it says why.

Two firm rules, and only two: (a) mechanical integrity (file formats, and the base-commit check that
prevents silent overwrites); (b) the human's authority (ask before merge or push, never handle
secrets).

## Verified facts this design relies on

Each was checked on 2026-11-15 against the cited page.

| # | Fact | Source |
|---|------|--------|
| F1 | A server MAY return an optional `instructions` string, described as "a 'hint' to the model" that clients "MAY" add to the system prompt. In the 2025-06-18 revision it is in `InitializeResult`. In the current 2026-07-28 revision it is in the `server/discover` result. | https://modelcontextprotocol.io/specification/2025-06-18/schema (InitializeResult.instructions), https://modelcontextprotocol.io/specification/2026-07-28/server/discover |
| F2 | Claude Code loads "only tool names and server instructions" at session start when tool search defers tools, and recommends instructions that say what tasks the tools handle and when to search for them. Server instructions are cut at **4,096 characters**, and only the text before the cut reaches Claude. | https://code.claude.com/docs/en/mcp ("Scale with MCP tool search", "Tool search for MCP server authors") |
| F3 | Standard transports are stdio and Streamable HTTP. On stdio the server MUST NOT write anything but MCP messages to stdout, and logs go to stderr. Streamable HTTP uses one endpoint that handles POST and GET. Servers MUST validate `Origin`, and SHOULD bind to localhost when run locally. HTTP+SSE is the deprecated older transport. | https://modelcontextprotocol.io/specification/2025-06-18/basic/transports |
| F4 | Authorization is OPTIONAL. stdio servers SHOULD NOT use it and SHOULD take credentials from the environment. A protected HTTP server is an OAuth 2.1 resource server, MUST serve Protected Resource Metadata (RFC 9728), and MUST answer 401 with `WWW-Authenticate`. It MUST validate the token audience, and it **MUST NOT pass through** the client's token to upstream APIs: an upstream (GitHub) token must be a separate token. | https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization |
| F5 | Tool execution failures are reported in the result with `isError: true`. JSON-RPC errors are for unknown tools, invalid arguments and server errors. A tool returning `structuredContent` SHOULD also return the serialized JSON as text. If an `outputSchema` is declared, structured results MUST conform. | https://modelcontextprotocol.io/specification/2025-06-18/server/tools |
| F6 | Claude's connectors (claude.ai, Desktop, mobile, Cowork, Claude Code) support Streamable HTTP and legacy SSE, plus tools, prompts and resources. They do not support sampling or resource subscriptions. Limits on the hosted surfaces: tool result about **150,000 characters** and **240 s** per call. Claude Code: 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`). | https://claude.com/docs/connectors/building/index.md |
| F7 | Claude Code saves a text result longer than **50,000 characters** to a file instead of inline, and it truncates `isError` text over about 11,000 characters. | https://code.claude.com/docs/en/mcp |
| F8 | All MCP tools must declare `readOnlyHint` and `destructiveHint`. | https://claude.com/docs/connectors/building/mcp.md |
| F9 | Custom-connector auth options are `none`, OAuth with DCR, OAuth with CIMD, the user's own OAuth client, and `static_headers` (beta, limited organizations). The hosted callback is `https://claude.ai/api/mcp/auth_callback`. Claude Code uses a loopback redirect on any port. A `401` is required to start sign-in. PKCE is S256. OAuth endpoints have 10 s to respond. Traffic comes from `160.79.104.0/21`. A machine-to-machine `client_credentials` grant is not supported. | https://claude.com/docs/connectors/building/authentication.md, https://claude.com/docs/connectors/custom/remote-mcp.md |
| F10 | GitHub REST primary limits: 5,000 req/h for user tokens. GitHub App installations get 5,000, scaling up to 12,500 (15,000 on Enterprise Cloud). Secondary limits: 100 concurrent requests, 900 points/min, 80 content-creating requests/min and 500/h. | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| F11 | A conditional request answered `304` (with `If-None-Match`/ETag) does not count against the primary limit. GitHub advises making requests serially and waiting at least 1 s between mutating requests. | https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api |
| F12 | Get-a-tree accepts a SHA or ref. A recursive read is capped at 100,000 entries / 7 MB, past which `truncated` is true. | https://docs.github.com/en/rest/git/trees |
| F13 | GraphQL `createCommitOnBranch` "appends a commit to the given branch as the authenticated user" with `expectedHeadOid` ("the git commit oid expected at the head of the branch prior to the commit") and `fileChanges` (additions and deletions). GitHub signs the commit, and author and committer cannot be set. | https://docs.github.com/en/graphql/reference/commits |
| F14 | The official TypeScript SDK v2 (`@modelcontextprotocol/server`, npm latest 2.4.0, Node >= 20) implements the 2026-07-28 spec. v1 (`@modelcontextprotocol/sdk`, 1.32.2) gets fixes for at least six months after 2026-07-27. Both accept an `instructions` server option (checked in the published type definitions). | https://github.com/modelcontextprotocol/typescript-sdk (README), `npm view` |

**Correction to the index.md Direction update:** that note says the Claude Code MCP page does not
document server instructions. It now does (F2). What remains unverified is whether **claude.ai
web/mobile custom connectors** inject `instructions`. None of the claude.com connector pages fetched
mentions them (U1).

## UNVERIFIED (each has a concrete test, scheduled in plan.md)

- **U1** claude.ai web/mobile custom connectors inject server `instructions` into the model's
  context. *Test (Phase 1):* run a probe server whose instructions contain a canary codeword that no
  tool returns. In a fresh claude.ai chat with only the probe connector on, ask "What is the
  LaneConductor canary codeword?". A correct answer with no tool call means the instructions are
  injected. A tool call or "don't know" means they are not.
- **U2** claude.ai and Claude Code connect cleanly to a server built on SDK v2 (2026-07-28 revision).
  claude.com lists only the 2025-03-26, 2025-06-18 and 2025-11-25 authorization revisions. *Test
  (Phase 1):* the probe server is built on SDK v2 and both surfaces must list its tools. Fallback: v1
  SDK.
- **U3** GitHub's OAuth authorization server offers neither DCR nor CIMD, so the connector must run
  its own small authorization server in front of GitHub. (F4 forbids token passthrough, so its own
  tokens are needed anyway.) *Test (Phase 8):* fetch `https://github.com/.well-known/oauth-authorization-server`
  and check for `registration_endpoint` / `client_id_metadata_document_supported`.
- **U4** Downloading `GET /repos/{o}/{r}/tarball/{ref}` costs one primary-limit request and the
  redirected download costs none. *Test (Phase 7):* read `x-ratelimit-remaining` before and after a
  cold-start tarball seed.
- **U5** The exact error shape `createCommitOnBranch` returns when `expectedHeadOid` is stale.
  *Test (Phase 7):* force it against the scratch repo and record the error, then key the retry on it.
- **U6** Whether this account has the beta `static_headers` request-header auth. *Test:* open
  claude.ai "Add custom connector" and look for **Request headers**. This only matters for option
  D1-c.
- **U7** How tokens are measured for KC-5. The plan uses Claude Code's `/cost` output or the usage
  records in the session transcript JSONL, plus the connector's own response-size log. *Test (Phase
  6):* confirm that one of them gives per-session totals before the baseline runs.

## Requirements

### Storage and concurrency
- REQ-1: The git repo is the only store. No database is read or written. Runs with Postgres stopped
  and no `.laneconductor.json` collectors.
- REQ-2: One `StateStore` interface (see API Contracts) with two backends:
  `LocalGitStore` (working tree plus git CLI, behind the stdio server) and `GitHubStore` (GitHub
  REST/GraphQL, behind the remote HTTP server).
- REQ-3: State lives on the **state branch** (default `main`, configurable). Local writes are
  refused with `NOT_ON_STATE_BRANCH` when the checkout is on another branch. Reads still work, with a
  warning.
- REQ-4 (base-commit rule): every read that can precede a write returns
  `base = { commit, files: {name: blobSha}, markers: {name: value} }`. `update_track` requires that
  `base`. A write is accepted only if (i) `base.commit` is the state-branch head or an ancestor of
  it, and (ii) for each file being replaced, its current blob sha equals `base.files[name]`, and for
  each marker being set, its current value equals `base.markers[name]`. Anything else is rejected
  with `CONFLICT` and the current sha or value. The connector never silently overwrites. Unrelated
  commits since `base.commit` (other tracks, other files, the sync daemon) do not cause a conflict.
- REQ-5: A blob sha is git's blob id of exactly the bytes returned:
  `sha1("blob " + byteLength + "\0" + bytes)`. That matches `git hash-object` locally and the tree
  entry sha on GitHub, so both backends compare the same way.
- REQ-6: A file returned truncated is left out of `base.files`, and writing it then fails with
  `BASE_MISSING_FILE`. A truncated view must never become the base for a full overwrite.
- REQ-7: Every connector write is a commit made by the server. The user never types one. Locally
  that is `git commit -- <exactly the written paths>`, so unrelated staged or dirty files are never
  swept in. On GitHub it is one `createCommitOnBranch` per tool call with `expectedHeadOid`, and a
  stale head is re-checked against REQ-4 and retried up to 3 times.
- REQ-8: Commit message format: `chore(track-NNN): <tool> <files> via lc-connector`. The body holds
  `Base: <base.commit>` and `Surface: <client name from MCP clientInfo, or unknown>`.
- REQ-9: The connector never pushes unless the human has enabled it (decision D4). Commit is local
  and cheap; push stays under the human's authority.

### Provenance and staleness
- REQ-10: Every tool response, errors included, carries `provenance`, and the first line of its text
  is a one-line summary, for example:
  `LaneConductor state as of a1b2c3d on main (local, clean); origin/main: ahead 2, behind 0; last fetch 3h ago.`
- REQ-11: `freshness` is `fresh`, `possibly_stale` or `stale`, with `stale_reasons` from a fixed
  list (see API Contracts). The rules are deterministic and listed there.
- REQ-12: The local backend never runs `git fetch` on a read (a read stays a read). It reports
  `last_fetch_at` from `.git/FETCH_HEAD`'s mtime. The plan-lane guidance tells Claude to run
  `git fetch` itself when the last fetch is more than 1 h old.

### Formats
- REQ-13: `append_conversation` takes a raw body and author and writes
  `> **author**: first line` with every following line (blank ones included) prefixed `>`. Before
  writing, it checks with the existing parser (`conductor/sync-conversation-utils.mjs`
  `parseConversationComments`) that the block parses back to exactly one entry by that author. A body
  that already starts with `> **` is rejected with a hint.
- REQ-14: Writes to `index.md` must keep `**Lane**` and `**Lane Status**` present, with a lane name
  from `conductor/workflow.json` (plus `backlog`) and a status from
  `queue|running|success|failure|waiting`. `conversation.md` can only be changed through
  `append_conversation`.
- REQ-15: `create_track` allocates the next number as max(numbers in local `conductor/tracks/` of
  both naming conventions, numbers on the upstream state-branch tree when available) + 1, then
  creates `INITIALS-NNN-slug` with an exclusive mkdir, retrying up to 3 times. It does not touch
  `tracks-metadata.json` or `file_sync_queue.md` (legacy). `list_tracks` reports duplicate numbers
  as an integrity warning.

### Context and advice
- REQ-16: Server `instructions` (at most 4,096 characters with the critical part first, per F2)
  replace the per-session "use LaneConductor" prompt. Draft text is below. If U1 fails on claude.ai,
  the fallback is a one-line pointer (project instructions on claude.ai, `CLAUDE.md` in Claude Code).
  The connector must not rely on something that has not been verified.
- REQ-17: `get_context` serves project context and lane guides (the skill's `lanes/<lane>.md` from
  the repo, or a copy bundled with the connector). Each served advice item gets a `serve_id`, and its
  text is framed as a recommendation that Claude may decline, saying why through `report_outcome`.
- REQ-18: No response exceeds **40,000 characters** of text: below Claude Code's 50,000-character
  persist threshold (F7) and the hosted 150,000 limit (F6). Bigger content is truncated with explicit
  flags and a hint on how to fetch the rest.

### Accountability (advice log, health report, kill criteria, removal)
- REQ-19: An append-only, file-based **advice log** per project at
  `conductor/advice-log/YYYY-MM.jsonl` (format below). The connector writes the reliable events
  itself: `serve`, `tool_error`, `stale_read`, `empty_result`, `conflict`, `call`. Claude reports
  `outcome` events through `report_outcome`. Those are best-effort, and their coverage is measured.
- REQ-20: A `health_report` tool returns a readable summary plus JSON. Per advice item: served,
  followed, deviated, failed, unreported, override rate, top 3 deviation reasons, and a flag when
  overridden at least 50% of the time with at least 5 outcomes. For the connector: error rate,
  stale-read rate, empty-result rate, conflicts, p50/p95 latency, estimated tokens added, and the
  status of every kill criterion.
- REQ-21: The kill criteria and their thresholds (plan.md "Kill criteria") are fixed **before** the
  beta starts and are evaluated by `health_report`. The keep / change / remove decision belongs to
  the human and is recorded in `conversation.md`.
- REQ-22: Easy removal. Every file the connector writes is a normal LaneConductor file, readable and
  writable without it. Removing it means disconnecting the server (and deleting `connector/` if
  wanted) with nothing lost. The connector never creates state that exists only inside itself.

### Open item: fundamentals conflict
- REQ-23 (open): the remote half needs cloud hosting and OAuth, and the connector makes files (not
  Postgres) the authority. `conductor/product.md` (Core Goals: "Sovereign: 100% local — no cloud, no
  auth, no cost") and `conductor/tech-stack.md` (Postgres as the database layer) say otherwise. This
  plan does not edit those docs. It is flagged in `conversation.md` for the human to decide.

## Acceptance Criteria (the beta, as observable outcomes)

- [ ] AC-a: In a scratch project that has `conductor/` but **no** LaneConductor skill installed and
  no `CLAUDE.md` mention of it, Claude Code with only the stdio connector configured turns
  "plan <feature>" into a track folder whose `index.md`, `spec.md`, `plan.md`, `test.md` and
  `conversation.md` pass the format checks, with nobody prompting the LaneConductor pattern.
- [ ] AC-b: The same request typed into claude.ai web, with the remote connector pointed at a GitHub
  repo, produces a commit on that repo's `main` with a valid track folder authored by the signed-in
  user.
- [ ] AC-c: With the laptop holding unpushed commits under `conductor/`, a local read reports
  `unpushed_local_commits` and the remote read shows the head commit and its age. Claude tells the
  user the plan may be stale.
- [ ] AC-d: Two edits from the same base to the same file: the second gets `CONFLICT` and the file on
  disk or on GitHub still holds the first edit, byte for byte.
- [ ] AC-e: Every beta scenario passes with Postgres stopped and the legacy sync daemon not running.
- [ ] AC-f: Tokens and wall-clock for 5 paired "plan X" runs (skill only vs connector) are recorded
  in the beta report, with medians.
- [ ] AC-g: `health_report` run at the end of the beta shows every kill criterion with a value and
  verdict, and the human's keep / change / remove decision is recorded in `conversation.md`.

## API Contracts / Data Models

### Common response envelope
Every tool returns `structuredContent` plus one text block. The text block holds the provenance line,
a short markdown rendering, and the full JSON (F5 back-compatibility). v0 declares no `outputSchema`,
because declaring one obliges every result to conform, error results included.

```jsonc
{
  "ok": true,                         // false on any isError result
  "data": { /* tool-specific */ },
  "error": null,                      // or { "code": "CONFLICT", "message": "...", "details": {...}, "hint": "..." }
  "warnings": [ "..." ],
  "provenance": {
    "backend": "local" | "github",
    "repo": "/abs/path" | "owner/name",
    "branch": "main",                 // the state branch
    "commit": "a1b2c3d…",             // state-branch head the read was served at
    "commit_time": "ISO",
    "read_at": "ISO",
    "dirty_paths": ["conductor/tracks/…/plan.md"],   // local only: uncommitted state files
    "upstream": { "ref": "origin/main", "ahead": 2, "behind": 0, "last_fetch_at": "ISO" | null } | null,
    "cache": { "served_from_cache": false, "age_s": 0 },   // github only
    "freshness": "fresh" | "possibly_stale" | "stale",
    "stale_reasons": [ "..." ],
    "line": "LaneConductor state as of a1b2c3d on main (local, clean); origin/main: ahead 2, behind 0; last fetch 3h ago."
  }
}
```

**Freshness rules** (fixed, testable):
- `stale` if any of: `behind_upstream` (behind > 0 as of the last fetch), `served_from_cache_rate_limited`.
- `possibly_stale` if any of: `unpushed_local_commits` (ahead > 0: remote surfaces cannot see
  these), `last_fetch_older_than_1h`, `no_upstream`, `dirty_state_files` (uncommitted state the
  remote cannot see), `remote_head_older_than_24h` (github: hint that a laptop may hold newer work),
  `cache_age_over_60s`.
- `fresh` otherwise.

### Error codes (tool results with `isError: true`)
| Code | When | Counts as connector error (KC-2)? |
|------|------|------|
| `CONFLICT` | REQ-4 precondition failed | no (correct behaviour) |
| `UNKNOWN_BASE` | `base.commit` is not the head or an ancestor of it | no |
| `BASE_MISSING_FILE` | writing a file not in `base.files` (never read, or truncated) | no |
| `VALIDATION_FAILED` | format rules REQ-13/14, size limits, bad lane name | no |
| `TRACK_NOT_FOUND` / `AMBIGUOUS_TRACK` | no folder / two or more folders for the number | no |
| `NOT_ON_STATE_BRANCH` | local checkout not on the state branch (writes only) | no |
| `NOT_A_LANECONDUCTOR_REPO` | no `conductor/tracks/` | no |
| `NUMBER_COLLISION` | create_track lost 3 allocation races | yes |
| `WRITE_FAILED` | filesystem or git failure after validation | yes |
| `BACKEND_UNAVAILABLE` | GitHub 5xx or network failure, git missing | yes |
| `RATE_LIMITED` | GitHub budget exhausted and no cache to serve | yes |
| `AUTH_REQUIRED` | remote: GitHub token missing or revoked for this user | no |

Unknown tools and schema-invalid arguments stay JSON-RPC protocol errors (F5), handled by the SDK.

### Tools (v0)

All tools take an optional `project` (local: absolute path, default the server's `--repo`; remote:
`owner/name`, default the configured repo). `track` accepts `10106` or `AM-10106`.

| Tool | readOnlyHint | destructiveHint | idempotentHint |
|------|---|---|---|
| `list_tracks` | true | false | true |
| `get_track` | true | false | true |
| `get_context` | true | false | true |
| `health_report` | true | false | true |
| `create_track` | false | false | false |
| `update_track` | false | **true** (replaces file content) | false |
| `append_conversation` | false | false | false |
| `report_outcome` | false | false | false |

1. **`list_tracks`** — input `{ lane?, lane_status?, query?, include_done? = false, limit? = 50 (max 200) }`.
   data `{ tracks: [{ number, id, folder, title, lane, lane_status, progress, phase, type, summary (<= 200 chars), waiting_for_reply, depends_on: [] }], total, truncated }`.
   Warnings: duplicate numbers, `index.md` without `**Lane**`. Errors: `NOT_A_LANECONDUCTOR_REPO`,
   `BACKEND_UNAVAILABLE`, `RATE_LIMITED`. Logs `empty_result` when nothing matches a non-empty filter.
2. **`get_track`** — input `{ track, files? = ["index","spec","plan","test","conversation"], conversation_tail? = 20 }`.
   data `{ track: { number, id, folder, title, markers: {…} }, files: { <name>: { content, sha, bytes, truncated } }, conversation: { entries: [{ author, body }], total, unparsed_lines }, base }`.
   Truncation order once the 40,000-character budget (REQ-18) is reached: conversation entries
   (oldest first), then `test`, `plan`, `spec`. Truncated files are left out of `base.files` (REQ-6).
   Errors: `TRACK_NOT_FOUND`, `AMBIGUOUS_TRACK` (lists the folders).
3. **`create_track`** — input `{ title (1..120), problem (markdown, required), type? = dev, track_kind?: bug|feature, author_initials?, auto_run? = "no", merge_mode? = "direct", depends_on?: [] }`.
   Creates `index.md` (`**Lane**: plan`, `**Lane Status**: queue`, `**Progress**: 0%`, `**Phase**: New`,
   `**Type**`, `**Merge Mode**`, `**Auto Run**`, `**Author**`, `**Problem**`, `**Summary**`, plus
   `**Track Kind**`/`**Depends On**` when given), stub `spec.md`/`plan.md`/`test.md`, and a
   `conversation.md` header. data `{ track: { number, id, folder }, files_created, commit: { sha, message } | null, base }`.
   Errors: `VALIDATION_FAILED`, `NUMBER_COLLISION`, `NOT_ON_STATE_BRANCH`, `WRITE_FAILED`.
4. **`update_track`** — input `{ track, base (verbatim from get_track/create_track), files?: { index|spec|plan|test: string }, markers?: { "<Marker Name>": "value" | null }, summary?: string }`.
   `files` replaces whole files. `markers` sets or removes individual `**Name**: value` lines in
   `index.md` without rewriting the rest. A request may not carry `files.index` and `markers` together.
   data `{ written: [...], commit: { sha, message } | null, base (new) }`.
   Errors: `CONFLICT` (`details: [{ file|marker, base, current }]`, hint "re-read with get_track,
   merge, retry"), `UNKNOWN_BASE`, `BASE_MISSING_FILE`, `VALIDATION_FAILED`, `NOT_ON_STATE_BRANCH`,
   `TRACK_NOT_FOUND`, `WRITE_FAILED`.
5. **`append_conversation`** — input `{ track, author: "human"|"claude"|"gemini"|"system", body }`.
   Append-only and commutative, so no base is needed: locally it appends under the write lock, and
   on GitHub it reads the head content, appends, and commits with `expectedHeadOid`, retrying up to 3
   times. data `{ appended: { author, lines }, commit }`. Errors: `VALIDATION_FAILED`
   (pre-formatted body, empty body, more than 20,000 characters), `TRACK_NOT_FOUND`, `WRITE_FAILED`.
   The tool description says `human` is only for relaying the human's own words.
6. **`get_context`** — input `{ files?: string[], lane?: "plan"|"implement"|"review"|"quality-gate"|"merge"|"brainstorm" }`.
   With no arguments it returns a **manifest** of the context files present (`product.md`,
   `product-guidelines.md`, `tech-stack.md`, `workflow.md`, `quality-gate.md`, `kpis.md`,
   `code_styleguides/*`): `{ name, bytes, sha, headings (h2), first_paragraph (<= 300 chars) }`, plus
   `workflow.json` lane transitions inline and the available lane guides. `files` returns those
   files, capped by REQ-18. `lane` returns that lane guide, prefixed with the advice framing and with
   `source: "repo:.claude/skills/laneconductor/lanes/<lane>.md@<sha>"` or `"bundled@<connector version>"`.
   Every served lane guide or file gets a `serve_id`, logged as a `serve` event.
   Errors: `VALIDATION_FAILED` (unknown name).
7. **`report_outcome`** — input `{ serve_id, outcome: "followed"|"deviated"|"failed", reason? (required unless followed, <= 500 chars), track? }`.
   data `{ recorded: true }`. An unknown `serve_id` is still recorded, with `orphan: true` and a
   warning, so no data is dropped.
8. **`health_report`** — input `{ since?: ISO date (default: beta start in `conductor/advice-log/beta.json`, else 30 days ago), format?: "summary"|"json" = "summary" }`.
   data `{ window, items: [...], connector: {...}, kill_criteria: [{ id, metric, threshold, value, n, verdict: "ok"|"warn"|"breach"|"insufficient_data" }] }`.

### Storage interface (`connector/src/store.mjs`)
```js
/** Both backends implement this. Paths are repo-relative POSIX. */
export interface StateStore {
  describe(): { backend: 'local'|'github', repo: string, branch: string }
  head(): Promise<{ commit: string, commitTime: string }>
  freshness(): Promise<{ dirtyPaths: string[], upstream: {ref, ahead, behind, lastFetchAt}|null, cache?: {...} }>
  listDir(path: string): Promise<Array<{ name: string, type: 'file'|'dir', sha: string }>>
  readFiles(paths: string[]): Promise<Map<string, { content: string, sha: string } | null>>
  isAncestor(commit: string): Promise<boolean>        // commit is head or an ancestor of it
  commitFiles(req: {
    preconditions: Array<{ path: string, sha: string|null }>,  // null = must not exist
    changes: Array<{ path: string, content: string } | { path: string, delete: true }>,
    message: string,
  }): Promise<{ ok: true, commit: string|null, commitError?: string } | { ok: false, conflict: Array<{ path, expected, actual }> }>
  appendLog(lines: object[]): Promise<void>            // advice log; batching per decision D3
}
```
`LocalGitStore`: reads the working tree. Serializes writes with an in-process mutex and an exclusive
lock file `.git/lc-connector.lock`. Checks preconditions against working-tree blob shas, writes
atomically (tmp + rename), then `git commit -- <paths>`. It retries `index.lock` contention 3 times
with backoff. If the commit fails, the write stays on disk and the result is `commit: null` with
`commitError`, never a silent success.

`GitHubStore`: content-addressed cache (trees and blobs by sha are immutable, so they are cached
indefinitely in an LRU of about 50 MB). The ref is read with a conditional request (F11: a 304
costs nothing). The walk goes root tree, `conductor`, `tracks` (non-recursive, F12). An unchanged
track folder sha means nothing in that folder is fetched again. Cold start seeds the cache from one
tarball of the state branch (U4), falling back to per-blob fetches. All calls go through one serial
queue (F11), with at least 1 s between mutations. When `x-ratelimit-remaining` drops under 10% of
the limit, reads are served from cache with `served_from_cache_rate_limited`. Writes are one
`createCommitOnBranch` per tool call (F13). Request budgets are checked in tests:

| Operation | Warm, nothing changed | Warm, k tracks changed | Cold |
|---|---|---|---|
| `list_tracks` | 1 (usually a 304, free) | 1 + 2k | 1 tarball + 1 |
| `get_track` | 1 | 1 + changed files | 1 + folder tree + 5 blobs |
| `update_track` | 1 ref + 1 GraphQL (+1 re-check per retry) | same | same |

### Advice log line format (`conductor/advice-log/YYYY-MM.jsonl`)
```jsonc
{"v":1,"ts":"2026-11-20T10:01:02Z","kind":"serve","id":"s_01J…","session":"c_…","surface":"claude-code",
 "tool":"get_context","item":"lane:plan","source":"repo:.claude/skills/laneconductor/lanes/plan.md@9f2c…",
 "track":"10110","chars":7412,"latency_ms":38,"commit":"a1b2c3d"}
{"v":1,"ts":"…","kind":"outcome","serve_id":"s_01J…","outcome":"deviated","reason":"spec already existed; refined instead of scaffolding","track":"10110","surface":"claude-code"}
{"v":1,"ts":"…","kind":"call","tool":"update_track","ok":true,"latency_ms":120,"chars":2210,"surface":"claude.ai"}
{"v":1,"ts":"…","kind":"tool_error","tool":"update_track","code":"WRITE_FAILED","message":"…","surface":"claude-code"}
{"v":1,"ts":"…","kind":"stale_read","tool":"get_track","reasons":["unpushed_local_commits"],"surface":"claude.ai"}
```
`kind` is one of `serve|outcome|call|tool_error|conflict|stale_read|empty_result|beta_start|beta_end`.
`session` is a per-connection id the server generates. `surface` comes from the client's
`clientInfo.name`. No file contents, prompts or secrets are logged: only ids, codes, counts and
Claude's one-line reasons.

### Server instructions (draft, about 1,500 characters, critical part first)
```
LaneConductor keeps this project's plans as files in git: conductor/tracks/<ID>/ holds index.md (status markers), spec.md, plan.md, test.md, conversation.md. When the user asks to plan, spec, review or check the status of a feature or track ("plan X", "what's the status of 10106"), use these tools instead of guessing the format.
- Start with get_context (lane guide + project context) and list_tracks/get_track.
- To change files, pass back the `base` you got from get_track; a CONFLICT means someone else edited first: re-read, merge, retry. Never work around it.
- Append to conversation.md only with append_conversation.
- Lane guides and context are advice from past work, not orders. If you decide against one, do it and call report_outcome with a one-line reason; that is how bad advice gets fixed.
- Every response says which commit it reflects. If it says stale or possibly_stale, tell the user before relying on it.
- Ask the human before any push or merge. Never put secrets in track files.
Execution (writing code, running tests, sub-agents, worktrees) is yours as usual; this server only holds state, context and advice.
```
