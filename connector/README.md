# lc-connector

A git-backed MCP server for LaneConductor (track AM-10106). It exposes a project's track files
(`conductor/tracks/<ID>/index.md`, `spec.md`, `plan.md`, `test.md`, `conversation.md`) and project
context to Claude, and writes changes back as git commits. It stores, validates and advises. It does
not schedule or dispatch work, and it is a second opinion, never a controller.

Status: Phases 1 (code), 2 and 3 of the plan: local stdio server, six tools. Not yet built: the advice
log and `report_outcome` / `health_report` (Phase 4), push policy (Phase 5), the GitHub backend and
the remote HTTP server (Phases 7-9).

## Setup (Claude Code, local stdio)

```bash
cd connector && npm install        # once; Node >= 20
```

Add it for one project (writes to your local Claude Code config):

```bash
claude mcp add --transport stdio lc-connector -- node /ABS/PATH/connector/bin/lc-connector.mjs --repo /ABS/PATH/TO/PROJECT
```

Or commit a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "lc-connector": {
      "command": "node",
      "args": ["/ABS/PATH/connector/bin/lc-connector.mjs", "--repo", "/ABS/PATH/TO/PROJECT"]
    }
  }
}
```

Options: `--repo <path>` (repeatable; the first is the default; defaults to the current directory),
`--state-branch <name>` (default `main`: writes are refused with `NOT_ON_STATE_BRANCH` when the
checkout is on another branch; reads still work and say so).

Check it: `claude mcp list`, then in a session ask "list the LaneConductor tracks".

## Tools (v0)

`list_tracks`, `get_track`, `get_context` (read-only); `create_track`, `update_track` (requires the
`base` from your last read; stale files or markers are rejected with `CONFLICT`), `append_conversation`.
Every response starts with a provenance line (which commit, which branch, ahead/behind, last fetch) and
carries `structuredContent.provenance`; `freshness` is `fresh`, `possibly_stale` or `stale`.

Every write is a commit made by the server (`chore(track-NNN): <tool> <files> via lc-connector`) that
touches exactly the written paths, so unrelated staged or dirty files are never swept in. The server
never pushes (decision D4 is pending): when the response says `unpushed_local_commits`, ask the human.

`conversation.md` is gitignored in the LaneConductor repo itself (decision D5, pending): there
`append_conversation` writes the file but cannot commit it, and says so (`commit: null`, `commit_error`).

## Docs-only lanes and state vs code

Track state lives on the state branch (default `main`) and code lives on branches. The plan lane and
other docs-only work run in the primary checkout with no worktree; the connector commits the state
files itself, so nothing needs a manual commit before another session or surface can see it. Code
branches should never carry track-folder changes.

## Removal

Everything the connector writes is an ordinary LaneConductor file, readable and writable without it.
To remove it: `claude mcp remove lc-connector` (or delete the `.mcp.json` entry) and, if you want,
delete `connector/`. Nothing is lost and no state exists only inside the connector.

## Tests

```bash
cd connector && npm test            # node --test "test/*.test.mjs"; no network, temp git repos only
ps aux | grep -E "lc-connector|probe.mjs" | grep -v grep   # expected: empty afterwards
```

(`node --test test/` as written in test.md does not work on Node 22: it is read as a file, not a folder.)

## Phase 1 probe

`spike/probe.mjs` is a throwaway server whose instructions hold a canary codeword that no tool
returns. Stdio: `node spike/probe.mjs`. Streamable HTTP for claude.ai through a tunnel:
`LC_PROBE_ALLOW_ANY_HOST=1 node spike/probe.mjs --http 8765` (authless, data-free; tear it down after the test).

## SDK

Built on `@modelcontextprotocol/server` v2 (pinned 2.4.0). Tool handlers (`src/tools/*.mjs`) and the
stores never import the SDK; only `src/server.mjs` and `bin/lc-connector.mjs` do. To fall back to v1
(`@modelcontextprotocol/sdk`): change those two files' imports and pass `def.input.shape` where
`def.input` is given to `registerTool`.
