# Spec: Centralized MCP Configuration (Extension-Only)

## Problem Statement
While agents like Claude Code and Gemini CLI already natively handle bash commands, git operations, and filesystem reads/writes incredibly well, they lack access to specialized, project-specific "extension" tools. For example, a web browser MCP for UI testing, a semantic knowledge base MCP for deep repository context, or a custom API integration. Currently each developer must configure these manually in `~/.claude/` or equivalent CLI config files. When LaneConductor spawns agents via `buildCliArgs()`, it has no way to inject project-specific MCP servers, meaning agents run without the specialized tools the project needs.

## Goals
- Define specialized "Extension-Only" MCP servers once in `.laneconductor.json` per project
- Exclude standard tools (Filesystem, Git, Postgres) which LLMs already use effectively via bash
- Sync config to the `projects` table via the existing `/project/ensure` flow
- Inject MCP servers when spawning agents via a temporary config file
- Optional per-lane filtering (e.g., a browser MCP only in `review`)
- UI panel to view, enable/disable, and add MCP servers per project

## Non-Goals
- This does NOT replace the developer's global `~/.claude/` config — it merges with it
- This does NOT manage MCP server installation — servers must already be installed
- Remote MCP servers (HTTP transport) are supported as config entries but their availability is not verified
- This does NOT intend to wrap standard CLI tools like `git` or `psql` in MCP

## Config Schema (`.laneconductor.json`)

```json
{
  "project": {
    "mcp_servers": [
      {
        "name": "browser",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
        "env": {},
        "enabled": true,
        "lanes": ["review", "quality-gate"]
      },
      {
        "name": "knowledge-base",
        "command": "npx",
        "args": ["-y", "my-custom-kb-mcp", "/home/user/docs"],
        "enabled": true,
        "lanes": null
      },
      {
        "name": "remote-api",
        "url": "https://mcp.example.com/sse",
        "enabled": false,
        "lanes": null
      }
    ]
  }
}
```

Fields per entry:
- `name` (required) — identifier, used as the MCP server key
- `command` + `args` — for stdio transport (local process)
- `url` — for HTTP/SSE transport (remote server); mutually exclusive with command
- `env` (optional) — env vars to pass to the server process
- `enabled` (default: true) — global on/off toggle
- `lanes` (default: null = all lanes) — restrict to specific lane names

## DB Schema

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mcp_servers JSONB DEFAULT '[]'::jsonb;
```

## Sync Worker — `/project/ensure` extension

In `upsertWorker()`, add to the POST body:
```js
mcp_servers: project.mcp_servers ?? [],
```

The `/project/ensure` handler stores this in the `projects` table. It does a merge-not-overwrite: if `mcp_servers` is non-null in the request, update; if null/missing, keep existing.

## Agent Injection — `buildCliArgs()` changes

Before spawning, filter the project's `mcp_servers` by:
1. `enabled === true`
2. `lanes === null || lanes.includes(currentLane)`

Build a temp config file appropriate for the chosen CLI:

### Claude Code (`--mcp-config`)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    },
    "remote-api": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```
Write to `/tmp/lc-mcp-{trackNumber}-{timestamp}.json`.
Add to CLI args: `--mcp-config /tmp/lc-mcp-{trackNumber}-{timestamp}.json`

Cleanup: delete the temp file when the spawned process exits (in the `proc.on('close')` handler in `spawnCli()`).

### Gemini CLI
Gemini CLI MCP config injection mechanism needs to be verified during implementation. Likely either:
- A `--mcp-config` equivalent flag, or
- Writing to a session config file before spawning
Document the actual format once confirmed.

### Other CLIs (Codex, Amp)
Same pattern — research the MCP config injection method during implementation and document here.

### No MCP servers configured
If `mcp_servers` is empty or all are filtered out for the current lane: spawn agent normally with no MCP args. No error, no warning.

## UI — Project Settings Panel

Add a new "Project Settings" view (reachable from the Kanban board header or a settings icon).

### MCP Servers Tab
- List all configured MCP servers with name, transport type, and enabled toggle
- Toggle `enabled` → PATCH `/api/projects/:id/mcp-servers/:name/toggle` → updates DB → sync worker picks up on next `/project/ensure` (or we push back to `.laneconductor.json` via file_sync_queue from track 1010)
- "Add Server" button → modal with fields: name, command/args or URL, lanes restriction
- "Remove" button per server

### API Endpoints Needed
- `GET /api/projects/:id/mcp-servers` — returns `mcp_servers` array from `projects` table
- `PATCH /api/projects/:id/mcp-servers` — replace full `mcp_servers` array (UI manages state)

Note: Writing changes back to `.laneconductor.json` requires the DB→FS direction (track 1010). Until track 1010 is complete, UI edits update the DB only; the file remains the ground truth on next worker restart.

## Requirements
- REQ-1: `mcp_servers` in `.laneconductor.json` are synced to the `projects` table on worker startup
- REQ-2: `buildCliArgs()` injects a temp MCP config file for Claude when servers are configured
- REQ-3: Per-lane filtering: servers with `lanes: ["review"]` only inject in the review lane
- REQ-4: `enabled: false` servers are never injected
- REQ-5: Temp config files are cleaned up after agent process exits
- REQ-6: UI shows the current MCP server list for a project
- REQ-7: No regression if `mcp_servers` is empty or absent

## Acceptance Criteria
- [ ] Project with filesystem MCP configured has it injected when Claude is spawned for `in-progress` auto-action
- [ ] A server with `lanes: ["review"]` does NOT appear in the config when spawning for `in-progress`
- [ ] Temp `/tmp/lc-mcp-*.json` files are deleted after agent exits
- [ ] UI project settings shows MCP servers from DB
- [ ] Toggling `enabled` in UI updates the DB within 1 API call
- [ ] Projects without `mcp_servers` in config work unchanged
