# Tests: Track 1080 — MCP server for the Collector API

## Test Commands
```bash
# Syntax
node --check bin/mcp-server.mjs

# Prereq for all manual/tool tests below
lc api start
curl -sf http://localhost:8091/api/health

# Tool listing (via a small manual client script using
# @modelcontextprotocol/sdk's Client + StdioClientTransport, spawning
# bin/mcp-server.mjs as the child process)
node conductor/tests/mcp-tools-manual.mjs   # or equivalent — see Phase 4 of plan.md
```

## Test Cases

### Feature: server boot + tool discovery
- [ ] TC-1: Connect an MCP client over stdio to `bin/mcp-server.mjs` — expected: `tools/list`
  returns exactly the 8 tools from spec.md REQ-3, each with a valid Zod-derived input schema.

### Feature: read tools match the REST API directly
- [ ] TC-2: `list_projects` tool call vs `curl localhost:8091/api/projects` — expected:
  same project rows (at minimum, this project's row with `id: 1`).
- [ ] TC-3: `list_tracks` for `project_id: 1` vs `curl
  localhost:8091/api/projects/1/tracks` — expected: same track count and track numbers.
- [ ] TC-4: `get_track` for track 1079 vs `curl
  localhost:8091/api/projects/1/tracks/1079` — expected: identical `lane_status`,
  `progress_percent`.
- [ ] TC-5: `get_inbox` — expected: returns only tracks with `waiting_for_reply: true` (verify
  against at least one track known to be waiting, or note if none exist at test time and confirm
  the response is `[]` rather than an error).

### Feature: write tools actually mutate state
- [ ] TC-6: `create_track` with a throwaway title (e.g. "MCP test track — safe to delete") —
  expected: 201-equivalent success, new track appears in a follow-up `list_tracks` call.
- [ ] TC-7: `move_track` the track from TC-6 to a different lane — expected: a direct `curl
  localhost:8091/api/projects/1/tracks/<num>` afterward shows the new lane (not just a 200 from
  the tool call).
- [ ] TC-8: `comment_track` on the same track — expected: comment appears in
  `conductor/tracks/<NNN>-*/conversation.md` (or via `get_track_comments`) after the call.
- [ ] TC-9: Clean up the TC-6 track (`DELETE /api/projects/:id/tracks/:num` directly, since
  delete isn't in the v1 tool surface).

### Feature: friendly failure when the API is down
- [ ] TC-10: `lc api stop`, then any tool call — expected: error message explicitly says to run
  `lc api start`, not a raw `ECONNREFUSED`/stack trace. `lc api start` again afterward to restore
  state.

## Acceptance Criteria
- [ ] All 10 test cases pass
- [ ] `claude_desktop_config.json` snippet manually verified against a real Claude Desktop
  install (not automatable — human confirms)
- [ ] No regression to the existing REST API or file-based skill (this track only adds a new
  client of the existing API, never modifies `ui/server/index.mjs`)
