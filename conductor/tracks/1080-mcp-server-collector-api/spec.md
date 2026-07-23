# Spec: MCP server for the Collector API

## Problem Statement

Today, the only way an AI agent drives LaneConductor is the file-based skill (`.claude/skills/laneconductor`), which assumes the agent has direct repo filesystem + bash access to read/write `conductor/tracks/NNN-*/index.md` markers. That's true for Claude Code, but not for MCP-capable clients that don't have a shell into this repo — Claude Desktop, or any other MCP agent someone points at their LaneConductor instance. Those clients have no way to list tracks, see what's waiting for a reply, move a track, or leave a comment, even though the Collector API (`localhost:8091`) already exposes all of that over HTTP for the Vite dashboard.

## Requirements

- REQ-1: A standalone MCP server (stdio transport) exposing a small, well-defined set of tools
  that each call the existing Collector API — no new business logic, no direct DB access, no
  duplicated track-state logic. The API is the single source of truth; the MCP server is a thin
  translation layer.
- REQ-2: Scope to `local-api` mode only for v1 — the MCP server talks to
  `http://localhost:8091` (configurable via `LC_API_URL` env var, default `localhost:8091`).
  `remote-api` mode (with collector auth/tokens) is explicitly out of scope for this track — a
  natural v2 once the local version is proven.
- REQ-3: Tool surface (v1, deliberately small — see Non-Goals):
  - `list_projects` — `GET /api/projects`
  - `list_tracks` — `GET /api/projects/:id/tracks` (optional lane filter applied client-side)
  - `get_track` — `GET /api/projects/:id/tracks/:num`
  - `get_track_comments` — `GET /api/projects/:id/tracks/:num/comments`
  - `comment_track` — `POST /api/projects/:id/tracks/:num/comments`
  - `move_track` — `PATCH /api/projects/:id/tracks/:num` (lane/lane_status/progress)
  - `create_track` — `POST /api/projects/:id/tracks`
  - `get_inbox` — `GET /api/inbox` (tracks with `waiting_for_reply: true` — the single most
    useful query for an agent checking "what needs me")
- REQ-4: Each tool has a Zod input schema and returns the API's JSON response verbatim (or a
  clear error) — no reshaping that could drift from what the REST API actually returns.
- REQ-5: MCP SDK version pinned exactly (no `^`/`~` range) in `package.json`, given known
  protocol/SDK churn (per the user's own prior experience: "so unstable at the moment").
- REQ-6: stdio transport, matching local Claude Desktop MCP config conventions — the MCP client
  spawns and owns this process's lifecycle per session. No daemon, no PID file, no
  `lc mcp start`/`stop` — explicitly the opposite of Track 1079's problem, not a repeat of it.
- REQ-7: Document the Claude Desktop config snippet (`claude_desktop_config.json` `mcpServers`
  entry) needed to register it, and add a short section to `SKILL.md` describing what it's for
  and how it relates to the existing file-based skill (complementary, not a replacement).
- REQ-8: If the Collector API isn't reachable (not started), tool calls return a clear error
  message telling the user to run `lc api start` — not a raw connection-refused stack trace.

## Acceptance Criteria

- [ ] Running the MCP server via `node bin/mcp-server.mjs` (or equivalent) and connecting an MCP
  client over stdio successfully lists its 8 tools.
- [ ] `list_projects` and `list_tracks` return real data matching what `curl
  localhost:8091/api/projects` / `.../tracks` return, for this very project.
- [ ] `move_track` on a scratch/test track actually changes its lane in the DB (verified via
  `curl` after the call, not just a 200 response).
- [ ] `comment_track` posts a comment visible in `conversation.md` / the DB after the call.
- [ ] With the Collector API stopped (`lc api stop`), any tool call returns a clear,
  actionable error — not a raw `ECONNREFUSED` stack trace surfaced to the MCP client.
- [ ] `claude_desktop_config.json` snippet in the docs is copy-pasteable and actually works when
  tried against a real Claude Desktop install (manual check, not automatable).

## Non-Goals

- `remote-api` mode / collector auth (token handling) — v2.
- Any tool beyond the 8 listed above (e.g. worker management, workflow.json editing, dev-server
  start/stop) — keep v1 intentionally small; expand later once the core pattern is proven.
- HTTP/SSE transport — stdio only for v1, since that's what avoids reintroducing a
  daemon-lifecycle problem (see Track 1079).
- Replacing or modifying the existing file-based skill — this is an additional interface onto
  the same underlying API, not a replacement.
