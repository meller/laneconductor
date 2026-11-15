# Tests: Track 10106 — LaneConductor connector: git-backed MCP server (local stdio first, then remote via GitHub API)

## Test Commands
```bash
# Unit + contract tests (node:test, zero network; each test makes its own temp repo with its own `git init`)
cd connector && node --test test/

# One file
cd connector && node --test test/store-local.test.mjs

# Live GitHub tests (Phase 7+): skipped unless the HUMAN exports both variables; never commit or echo them
LC_GH_TEST_REPO=owner/scratch-repo LC_GH_TEST_TOKEN=... node --test test/github-live.test.mjs

# Afterwards (memory: leaked-process incidents on tracks 10073/10080): no stray processes
ps aux | grep -E "lc-connector|probe.mjs" | grep -v grep   # expected: empty
```
Tests never run inside a track worktree against the primary checkout (track 10082 hazard). Every
fixture repo is created under `os.tmpdir()` with its own `git init -b main` and
`user.name`/`user.email` set locally.

## Test Cases

### Phase 1: Instructions and SDK spike (manual, observable)
- [ ] TC-1.1: Claude Code with `lc-probe` over stdio, fresh session: "What is the LaneConductor canary codeword?" - expected: the correct codeword with no tool call (F2)
- [ ] TC-1.2: claude.ai web, probe added as a custom connector (No sign-in), only it enabled, fresh chat, same question - expected: record the result. A correct answer with no tool call means U1 is verified. Anything else means U1 is false and the REQ-16 fallback is adopted.
- [ ] TC-1.3: Both surfaces list the `probe_echo` tool and can call it - expected: works on SDK v2 (U2), or the v1 fallback is recorded
- [ ] TC-1.4: The probe writes nothing to stdout except MCP messages (a logging call goes to stderr) - expected: the client never reports a parse error (F3)

### Phase 2: Core library and LocalGitStore
- [ ] TC-2.1: `blobSha(s)` equals `git hash-object --stdin` for ASCII, UTF-8 multibyte, empty and CRLF content
- [ ] TC-2.2: Marker parse/set/remove round-trips `index.md` byte-for-byte except the edited line. Setting an absent marker inserts it after the last marker in the header block.
- [ ] TC-2.3: Lane validation: `**Lane**: implement` accepted, `**Lane**: impl` rejected, `backlog` accepted, `**Lane Status**: done` rejected
- [ ] TC-2.4: Conversation formatting: a multi-line body with blank lines and `##` headers gives every line prefixed `>`, and `parseConversationComments` returns exactly 1 entry with the same author and body
- [ ] TC-2.5: A body starting with `> **claude**:` gives `VALIDATION_FAILED` with a hint
- [ ] TC-2.6: Track resolution finds `AM-10106-x` and legacy `999-canary` by number. Two folders for one number gives `AMBIGUOUS_TRACK`.
- [ ] TC-2.7: The next number is max(local both conventions, upstream tree) + 1. A pre-created folder with that number causes a retry to the next one.
- [ ] TC-2.8: LocalGitStore precondition match: the write lands and exactly one commit touches only the written paths. An unrelated dirty file and an unrelated staged file stay uncommitted.
- [ ] TC-2.9: Precondition mismatch: `{ ok: false, conflict }`, file bytes unchanged, no commit
- [ ] TC-2.10: Precondition `sha: null` while the file exists gives a conflict (create never overwrites)
- [ ] TC-2.11: Two concurrent `commitFiles` on the same path from the same base: exactly one succeeds and the other conflicts (the lock serializes; run 20 iterations)
- [ ] TC-2.12: Checkout on branch `feature` gives `NOT_ON_STATE_BRANCH` for writes, while reads work with a warning
- [ ] TC-2.13: Commit failure (a pre-commit hook exiting 1) leaves the write on disk, the result has `commit: null` and `commitError` set, and it is not reported as a clean success
- [ ] TC-2.14: An `.git/index.lock` present for 500 ms is retried and succeeds. Present the whole time: `WRITE_FAILED`.
- [ ] TC-2.15: Freshness: ahead 2 gives `possibly_stale` + `unpushed_local_commits`. Behind 1 (after fetch) gives `stale` + `behind_upstream`. No upstream gives `no_upstream`. FETCH_HEAD older than 1 h gives `last_fetch_older_than_1h`. A dirty `conductor/` file gives `dirty_state_files`. Clean, synced and recently fetched gives `fresh`.
- [ ] TC-2.16: The provenance line contains the short commit, the branch, the backend, ahead/behind and the fetch age

### Phase 3: stdio MCP server (driven through the SDK client over stdio)
- [ ] TC-3.1: `tools/list` returns exactly the 8 v0 tools, each with `readOnlyHint` and `destructiveHint` matching the spec table
- [ ] TC-3.2: The server `instructions` are present, at most 4,096 characters, and their first 300 characters mention planning tracks and `get_context`
- [ ] TC-3.3: Every result (success and error) has a `structuredContent.provenance` and a text block whose first line is the provenance line
- [ ] TC-3.4: `list_tracks` on a fixture with 3 tracks (one done): 2 returned by default, 3 with `include_done`, filters by lane, a duplicate number gives a warning
- [ ] TC-3.5: `get_track` returns `base` with shas equal to `git hash-object` of each file and markers equal to the parsed values
- [ ] TC-3.6: `get_track` on a track with an 80,000-character conversation: response text at most 40,000 characters, conversation truncated first, `spec`/`plan` full and present in `base.files`. A truncated file is absent from `base.files`.
- [ ] TC-3.7: `create_track` produces a folder `XX-NNN-slug` with five files, `index.md` markers parse (Lane plan / queue), one commit, and the returned `base` can be used directly by `update_track`
- [ ] TC-3.8: `update_track` with a fresh base and `files.plan`: written and committed, with the new base returned
- [ ] TC-3.9: `update_track` reusing the old base after TC-3.8 gives `CONFLICT` with `details[0].file == "plan"` and current sha, and the file holds the TC-3.8 content
- [ ] TC-3.10: `update_track` markers `{ "Lane Status": "success" }` while another session changed only `spec.md` since the base: accepted (no false conflict). The same marker changed by another session gives `CONFLICT` on the marker.
- [ ] TC-3.11: `update_track` with `files.index` and `markers` together gives `VALIDATION_FAILED`. `files.conversation` gives `VALIDATION_FAILED` with a hint to use `append_conversation`.
- [ ] TC-3.12: `update_track` with a base commit not in history gives `UNKNOWN_BASE`
- [ ] TC-3.13: `append_conversation` twice from two clients concurrently: both entries present, both parse, order is arrival order
- [ ] TC-3.14: `get_context` with no args returns a manifest with headings and first paragraphs and no full bodies. `files:["tech-stack.md"]` returns its content. `lane:"plan"` returns the repo's lane guide with the advice framing, `source` with its sha, and a `serve_id`.
- [ ] TC-3.15: `get_context` with `lane:"plan"` in a repo without `.claude/skills/...` returns the bundled guide with `source: "bundled@<version>"`
- [ ] TC-3.16: Unknown tool name gives a JSON-RPC error (protocol). Missing required `track` gives a JSON-RPC invalid-params error, not `isError`.

### Phase 4: Advice log, report_outcome, health_report
- [ ] TC-4.1: Each tool call appends one `call` line. `get_context` lane appends one `serve` line. All lines validate against the spec format (`v`, `ts`, `kind`, ...).
- [ ] TC-4.2: Log lines contain no file contents: for a fixture with the sentinel `SECRET_SENTINEL_123` inside `spec.md`, grep the log and expect no match
- [ ] TC-4.3: `report_outcome` deviated without a reason gives `VALIDATION_FAILED`. With a reason it is recorded. An unknown `serve_id` is recorded with `orphan: true` plus a warning.
- [ ] TC-4.4: Local batching (D3-a): log lines appear in the working tree immediately and are included in the next connector commit. No commit is made for log lines alone.
- [ ] TC-4.5: `health_report` on a synthetic log (100 calls, 6 tool_errors, 2 conflicts, 10 serves with 6 deviated / 2 followed): KC-2 = 6% (breach), conflicts excluded from the error rate, KC-3 = 75% with n=8 (`insufficient_data` overall, item flagged since n >= 5), KC-4 = 80%
- [ ] TC-4.6: `health_report` with an empty log: every KC is `insufficient_data` and nothing fails

### Phase 5: Local hygiene
- [ ] TC-5.1: Default push policy: after a connector commit with ahead 1, no push happens (remote ref unchanged, checked against a local bare remote), and the response warns with a hint to ask the human
- [ ] TC-5.2: `connector.push: "auto-state"`: after 60 s idle (injected clock) the commits that touch only `conductor/` are pushed fast-forward
- [ ] TC-5.3: `auto-state` with an unpushed commit touching `src/x.js`: no push, with a warning naming the commit
- [ ] TC-5.4: `auto-state` when the remote moved (non-fast-forward): no push, no force, warning `behind_upstream`

### Phase 7: GitHubStore (fake fetch with recorded fixtures; live tests opt-in)
- [ ] TC-7.1: The read path issues ref (with `If-None-Match`), then trees, then blobs. A second `list_tracks` with an unchanged ref issues exactly 1 request and it returns 304.
- [ ] TC-7.2: One changed track folder sha: the extra requests are exactly that folder tree + its `index.md` blob (budget 1 + 2k)
- [ ] TC-7.3: Cold start uses the tarball seed (1 + 1 requests). If the tarball fails, it falls back to per-blob fetches with the same results.
- [ ] TC-7.4: `x-ratelimit-remaining` under 10%: reads are served from cache with `stale` + `served_from_cache_rate_limited`. No cache: `RATE_LIMITED`.
- [ ] TC-7.5: The request queue never has more than 1 request in flight. Mutations are at least 1 s apart (injected clock).
- [ ] TC-7.6: Write with a matching precondition: one `createCommitOnBranch` with `expectedHeadOid` = current head and the right additions
- [ ] TC-7.7: Head moved, unrelated file changed: precondition re-checked, retried, success. Head moved and the same file changed: `CONFLICT`, no commit.
- [ ] TC-7.8 (live, opt-in): the U5 error shape for a stale `expectedHeadOid` is captured into a fixture
- [ ] TC-7.9 (live, opt-in): U4: `x-ratelimit-remaining` delta for a tarball seed is recorded
- [ ] TC-7.10: The shared contract suite (TC-3.4 to TC-3.15 logic) passes against `GitHubStore` backed by the fake

### Phase 8: Remote HTTP server and auth
- [ ] TC-8.1: An unauthenticated POST `/mcp` gives `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` (F9)
- [ ] TC-8.2: The PRM document's `resource` equals the configured connector URL exactly, and `authorization_servers[0]` is the connector's issuer
- [ ] TC-8.3: AS metadata advertises `code_challenge_methods_supported: ["S256"]`, a `registration_endpoint`, `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported` (F9)
- [ ] TC-8.4: Redirect URI `https://claude.ai/api/mcp/auth_callback` accepted, `http://localhost:53111/callback` and `http://127.0.0.1:9/callback` accepted (any port), `https://evil.example/cb` rejected
- [ ] TC-8.5: A token whose audience is another resource gives `401`. A raw GitHub token sent as the bearer gives `401` (no passthrough, F4).
- [ ] TC-8.6: A request with a disallowed `Origin` is rejected (F3)
- [ ] TC-8.7: A user not on the allow-list completes GitHub sign-in but gets `403` on tool calls
- [ ] TC-8.8: The token endpoint accepts `application/x-www-form-urlencoded` and answers in under 10 s locally. A revoked refresh token gives `invalid_grant` (F9).
- [ ] TC-8.9: No GitHub token, client secret or private key ever appears in responses, the advice log or stderr logs (grep for sentinel values in test config)
- [ ] TC-8.10: Remote advice-log flush (D3-a): 49 lines give no commit. The 50th line, or 10 minutes, gives exactly one commit.

## Beta scenarios (Phases 6 and 9; manual, results recorded in `beta-report.md`)
- [ ] B-a (AC-a): scratch project without the skill and CLAUDE.md mention. "plan a CSV export for the report page": a new track folder with 5 files. `index.md` markers parse. `conversation.md` parses. No human mention of LaneConductor in the session.
- [ ] B-b (AC-b): claude.ai web with the remote connector against the scratch GitHub repo, same request: a new commit on `main` authored by the signed-in user, with valid files
- [ ] B-c (AC-c): two unpushed local state commits. Local read: `possibly_stale` with `unpushed_local_commits`. Remote read: head commit and age shown, and Claude's reply mentions possible staleness.
- [ ] B-d (AC-d): two sessions read `plan.md`, both edit, both write. The second gets `CONFLICT`. The final file equals the first write byte for byte (`git show HEAD:<path>` / GitHub raw).
- [ ] B-e (AC-e): B-a, B-c and B-d with `pg_ctl status` showing Postgres stopped (or the service stopped) and `ps aux | grep laneconductor.sync.mjs` empty
- [ ] B-f (AC-f): 5 paired runs, medians of total tokens, wall-clock and pattern re-prompts recorded for skill-only and connector
- [ ] B-g (AC-g): end-of-beta `health_report` saved, and the human decision recorded in `conversation.md`

## Acceptance Criteria
- [ ] All `node --test test/` cases pass in `connector/` with no network access
- [ ] No regressions: root `npm test` (vitest) still passes. `connector/` adds no dependencies to the root `package.json`.
- [ ] No leaked processes after the test runs (command above)
- [ ] Beta scenarios B-a to B-g are recorded with results in `beta-report.md`
