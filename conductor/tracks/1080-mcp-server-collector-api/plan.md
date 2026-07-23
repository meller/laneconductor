# Track 1080: MCP server for the Collector API

## Phase 1: Project scaffold

**Problem**: No MCP server exists yet in this repo. Need the base process, dependency, and
transport wiring before any tool logic.

**Solution**: A new `bin/mcp-server.mjs`, following the same ESM/no-TypeScript convention as
`bin/lc.mjs` and `bin/systemd-user.mjs`. Uses `@modelcontextprotocol/sdk`'s `McpServer` +
`StdioServerTransport`.

- [ ] Task 1: Add `@modelcontextprotocol/sdk` to root `package.json` as a **pinned** exact
  version (no `^`/`~`) — checked into `package-lock.json` too
- [ ] Task 2: Add `zod` if not already a root dependency (check `ui/package.json` first — it may
  already be there and just need hoisting to root)
- [ ] Task 3: `bin/mcp-server.mjs` — server bootstrap, `LC_API_URL` env var (default
  `http://localhost:8091`), stdio transport connect, empty tool registry (no tools yet)
- [ ] Task 4: A small internal `apiFetch(path, opts)` helper in the same file (or a sibling
  `bin/mcp-api-client.mjs` if it gets large) — wraps `fetch`, throws a clear
  "Collector API not reachable — run `lc api start`" error on `ECONNREFUSED`/connection failure
  specifically (not a generic catch-all)

**Impact**: New file(s), no existing behavior touched.

## Phase 2: Implement the 8 tools

**Problem**: Server boots but does nothing useful yet.

**Solution**: Register each tool from spec.md REQ-3 with a Zod input schema, backed by
`apiFetch`. One tool at a time, verified against the real running API before moving to the next
— this project already has a live `localhost:8091` running under systemd (Track 1079), so there's
no excuse to guess at response shapes instead of checking them.

- [ ] Task 1: `list_projects` (no input) → `GET /api/projects`
- [ ] Task 2: `list_tracks` (`project_id`, optional `lane`) → `GET /api/projects/:id/tracks`,
  filter by `lane` client-side if provided
- [ ] Task 3: `get_track` (`project_id`, `track_number`) → `GET
  /api/projects/:id/tracks/:num`
- [ ] Task 4: `get_track_comments` (`project_id`, `track_number`) → `GET
  /api/projects/:id/tracks/:num/comments`
- [ ] Task 5: `comment_track` (`project_id`, `track_number`, `body`) → `POST
  /api/projects/:id/tracks/:num/comments`
- [ ] Task 6: `move_track` (`project_id`, `track_number`, `lane`, optional `lane_status`,
  `progress_percent`) → `PATCH /api/projects/:id/tracks/:num`
- [ ] Task 7: `create_track` (`project_id`, `title`, `description`, optional `type`) → `POST
  /api/projects/:id/tracks`
- [ ] Task 8: `get_inbox` (no input) → `GET /api/inbox`

**Impact**: Server is now functionally useful over stdio.

## Phase 3: Docs + Claude Desktop wiring

**Problem**: A working server nobody knows how to point a client at is dead weight.

**Solution**: Document it where the rest of the project's operational docs live.

- [ ] Task 1: Add a "MCP Server" section to `SKILL.md` — what it's for, how it relates to (not
  replaces) the file-based skill, the 8 tools and what each does
- [ ] Task 2: Write the exact `claude_desktop_config.json` `mcpServers` snippet (command: `node`,
  args: absolute path via the same `getInstallPath()`-style resolution used elsewhere) into the
  docs
- [ ] Task 3: Note the `LC_API_URL` env var and the `lc api start` prerequisite prominently —
  first-run failure mode should be obvious from the docs alone

**Impact**: Someone other than the implementer can actually use this.

## Phase 4: Live verification

**Problem**: An MCP server that only "looks right" in code review isn't verified — this project
just spent a whole track learning that lesson the hard way (Track 1079).

**Solution**: Actually connect an MCP client (or the SDK's own test client / a small manual
script using `@modelcontextprotocol/sdk`'s client transport) to the running server and exercise
every tool against the real local API.

- [ ] Task 1: Confirm all 8 tools appear in `tools/list`
- [ ] Task 2: Call `list_projects`/`list_tracks`, diff against direct `curl` output for the same
  endpoints — must match
- [ ] Task 3: Create a scratch track via `create_track`, `move_track` it to a different lane,
  `comment_track` on it, `get_track_comments` back and confirm the comment round-tripped, then
  clean it up (`DELETE /api/projects/:id/tracks/:num` directly, or note if that needs its own
  tool)
- [ ] Task 4: Stop the API (`lc api stop`), call any tool, confirm the error message is the
  documented friendly one, not a raw stack trace — then restart it (`lc api start`)
