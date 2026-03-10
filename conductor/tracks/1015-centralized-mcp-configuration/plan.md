# Track 1015: Centralized MCP Configuration (Extension-Only) — Implementation Plan

## Overview
Enable projects to define specialized "Extension" MCP servers (e.g., Knowledge Base, Browser) in `.laneconductor.json`, sync them to the database, and inject them when spawning AI agents. This avoids forcing LLMs to use MCP for things they already do well (like bash/git) while still providing a standard way to add project-specific superpowers.

---

## Phase 1: Database Schema & Config Model

**Goal**: Prepare the database to store MCP servers and add types/validation.

### Tasks

- [ ] **DB Migration**: Add `mcp_servers JSONB` column to `projects` table
  - Column default: `'[]'::jsonb`
  - Nullable: false (empty array is valid)
  - Add migration script to `conductor/migrations/` if migration system exists, or run raw SQL via setup

- [ ] **TypeScript Types** (if using TS):
  - Create `types/mcp.ts` with:
    - `MCPServerConfig` — the shape of one server entry (name, command/args/url, env, enabled, lanes)
    - `MCPServerList` — array of MCPServerConfig
  - Export from main types barrel

- [ ] **Schema Validation**:
  - Add validation function `validateMCPServers()` in `conductor/utils/` or `server/utils/`
  - Validates: name not empty, no duplicate names, command XOR url (not both, not neither), lanes is string[] or null
  - Used by `/project/ensure` endpoint

- [ ] **Test**:
  - [ ] Unit test: `validateMCPServers()` passes valid config, rejects duplicates, rejects both command+url
  - [ ] SQL test: Insert `mcp_servers` via raw query, verify it round-trips

**Acceptance Criteria**:
- [ ] `projects.mcp_servers` column exists in Postgres
- [ ] TypeScript types defined and importable
- [ ] `validateMCPServers()` blocks invalid configs and passes valid ones
- [ ] Existing projects can be queried (column has default `[]`)

---

## Phase 2: Sync Worker — Push `mcp_servers` to DB

**Goal**: When `.laneconductor.json` is read at startup or modified, push `mcp_servers` to the database via `/project/ensure`.

### Tasks

- [ ] **Read Config**:
  - In `conductor/laneconductor.sync.mjs`, read `project.mcp_servers` from `.laneconductor.json`
  - Handle missing key gracefully (default to `[]`)

- [ ] **Extend `upsertWorker()` POST Body**:
  - Add `mcp_servers: project.mcp_servers ?? []` to the request body sent to `/project/ensure`

- [ ] **Extend `/project/ensure` Handler**:
  - Accept `mcp_servers` in request body
  - Validate via `validateMCPServers()`
  - Merge logic: if `mcp_servers` is provided and non-null, update; else keep existing
  - Return the updated `mcp_servers` in response (for worker to confirm)

- [ ] **File Sync** (optional for Phase 2):
  - If `.laneconductor.json` is modified, trigger re-read + re-push
  - Chokidar already watches this file; just ensure the watcher calls the push logic

- [ ] **Test**:
  - [ ] Spin up a test project with `mcp_servers` in config
  - [ ] Start worker, verify POST to `/project/ensure` includes `mcp_servers`
  - [ ] Query `projects` table, confirm column was updated
  - [ ] Verify empty array is handled (project without MCP servers)

**Acceptance Criteria**:
- [ ] `/project/ensure` accepts and stores `mcp_servers`
- [ ] Worker reads `mcp_servers` from `.laneconductor.json` on startup
- [ ] DB update succeeds with valid config, fails with invalid
- [ ] Empty array is properly stored (project without MCP servers)

---

## Phase 3: Inject MCP Config When Spawning Agents

**Goal**: Modify `buildCliArgs()` and `spawnCli()` to create and use a temporary MCP config file.

### Tasks

- [ ] **Fetch MCP Servers in `spawnCli()`**:
  - Query `projects.mcp_servers` for the current project
  - Or pass it as parameter (if already loaded in caller context)

- [ ] **Filter by Lane & Enabled**:
  - Keep only servers where `enabled === true`
  - Keep only servers where `lanes === null` OR `lanes.includes(currentLane)`
  - If result is empty, proceed with no MCP args (no error)

- [ ] **Generate Temp Config File**:
  - For Claude: Create a `.json` file matching the `{ mcpServers: { ... } }` format
  - Transform `mcp_servers` array into object keyed by server name
  - Write to `/tmp/lc-mcp-{trackNumber}-{timestamp}.json` (use crypto for timestamp)
  - For Gemini/others: Research and document the config format (see spec notes)

- [ ] **Inject into CLI Args**:
  - For Claude: Add `--mcp-config /path/to/temp.json` to the CLI args
  - Inject before spawning the process

- [ ] **Cleanup on Process Exit**:
  - In `spawnCli()` process `'close'` event handler, delete the temp config file
  - Use `fs.unlink()` with error suppression (file may already be gone)

- [ ] **Test**:
  - [ ] Spawn agent for a project with filesystem MCP; verify `--mcp-config` is in args
  - [ ] Spawn agent for a project without MCP servers; verify no `--mcp-config` arg
  - [ ] Verify temp file is created before spawn and deleted after process exits
  - [ ] Test lane filtering: server with `lanes: ["review"]` only injected when spawning for review
  - [ ] Test `enabled: false`; server should not appear in config

**Acceptance Criteria**:
- [ ] `buildCliArgs()` generates correct MCP config for Claude
- [ ] Temp file is created and deleted properly
- [ ] Per-lane filtering works (server with lanes restriction only used in those lanes)
- [ ] `enabled: false` servers are never injected
- [ ] Projects without MCP servers spawn agents unchanged
- [ ] Remote URL-based servers (no command) are formatted correctly

---

## Phase 4: UI — Project Settings Panel

**Goal**: Add a UI view to list, enable/disable, and manage MCP servers for a project.

### Tasks

- [ ] **API Endpoints**:
  - [ ] `GET /api/projects/:id/mcp-servers` — return `mcp_servers` array from DB
  - [ ] `PATCH /api/projects/:id/mcp-servers` — replace full array (body: `{ mcp_servers: [...] }`)
  - [ ] Validate requests using `validateMCPServers()`

- [ ] **UI Components**:
  - [ ] Create `ProjectSettings.jsx` modal/panel (reachable from Kanban header or sidebar)
  - [ ] Tab: "MCP Servers"
    - [ ] List table with columns: Name, Type (stdio/HTTP), Enabled (toggle), Lanes, Actions (remove, edit)
    - [ ] "Add Server" button → modal with form fields
    - [ ] "Remove" button per row → confirm + PATCH endpoint
    - [ ] Toggle `enabled` → PATCH endpoint (fire-and-forget or optimistic update)

- [ ] **Add Server Modal**:
  - [ ] Fields: Name (text), Transport (radio: stdio/HTTP)
    - [ ] If stdio: Command (text), Args (array input), Env (key-value pairs)
    - [ ] If HTTP: URL (text)
  - [ ] Lanes restriction (multi-select or chips; default: all lanes)
  - [ ] Enabled toggle (default: true)
  - [ ] "Add" button → validate locally + PATCH → dismiss on success
  - [ ] Error handling: show toast on failed PATCH

- [ ] **State Management**:
  - [ ] Use React state or context to manage `mcp_servers`
  - [ ] Optimistic UI updates on toggle (confirm with DB response)
  - [ ] Polling or WebSocket to refresh if changed by another session

- [ ] **Test**:
  - [ ] Open project settings, verify MCP servers list renders
  - [ ] Toggle enabled → verify PATCH request sent + DB updated
  - [ ] Add new server → verify appears in list
  - [ ] Remove server → verify deleted from list
  - [ ] Verify form validation (rejects empty name, invalid URLs, etc.)

**Acceptance Criteria**:
- [ ] Project settings accessible from Kanban
- [ ] MCP servers list displays all servers with enabled/disabled state
- [ ] Toggle `enabled` updates DB and UI reflects change within 1 second
- [ ] "Add Server" modal works and creates entry in DB
- [ ] "Remove" button deletes server from DB
- [ ] Invalid inputs are rejected (empty name, invalid URL)
- [ ] No regressions in existing Kanban functionality

---

## Phase 5: Documentation & Integration

**Goal**: Document the feature and ensure all parts work together.

### Tasks

- [ ] **SKILL.md Update**:
  - [ ] Add MCP configuration section under "Best Practices" or new "MCP Servers" section
  - [ ] Document the `.laneconductor.json` schema (reference spec.md)
  - [ ] Include example configs (filesystem, postgres, remote)
  - [ ] Link to MCP documentation (modelcontextprotocol.io)

- [ ] **Update `.laneconductor.json` Template**:
  - [ ] Add `mcp_servers: []` to the `project` section in template
  - [ ] Include example entries (commented out)

- [ ] **Setup Flow** (`/laneconductor setup collection`):
  - [ ] After question about agents, ask: "Configure MCP servers? (y/n) [n]"
  - [ ] If yes, prompt for MCP server list (offer a questionnaire or link to docs)
  - [ ] Write servers to `.laneconductor.json` template

- [ ] **Update Conductor Docs**:
  - [ ] Add section to `conductor/workflow.md` on MCP server management
  - [ ] Example: "To add a filesystem MCP to your project, edit `.laneconductor.json` and add to `project.mcp_servers`"

- [ ] **End-to-End Test**:
  - [ ] Create a test project with 3 MCP servers
  - [ ] Start worker, verify sync to DB
  - [ ] Trigger auto-implement, verify server is injected
  - [ ] Check temp file is cleaned up
  - [ ] Open project settings UI, toggle one server, verify change takes effect on next spawn

- [ ] **Update Canary Track** (1000-canary):
  - [ ] If canary testing is used, add MCP server configuration as a test step

**Acceptance Criteria**:
- [ ] SKILL.md documents MCP servers feature
- [ ] Docs include at least one example config
- [ ] Setup flow guides users to configure MCP servers
- [ ] End-to-end test passes (config → DB → injection → cleanup)
- [ ] No documentation gaps or broken examples

---

## Cross-Phase Considerations

### Dependencies
- **Phase 1** → **Phase 2**: DB column must exist before sync worker can update it
- **Phase 2** → **Phase 3**: MCP servers must be in DB before agent can fetch and inject them
- **Phase 3** → **Phase 5**: Agent injection must work before documenting and end-to-end testing

### Backwards Compatibility
- Projects without `mcp_servers` key in `.laneconductor.json` should work unchanged (defaults to `[]`)
- Agents spawn normally if no servers are configured (no `--mcp-config` arg)
- Existing `.laneconductor.json` files do not require migration

### Testing Strategy
- **Unit Tests**: Validation, filtering logic, temp file cleanup
- **Integration Tests**: Sync worker reads config, updates DB, agent retrieves and injects
- **E2E**: Full workflow from `.laneconductor.json` to agent injection to temp cleanup
- **Manual**: UI interactions (toggle, add, remove)

### Future Enhancements (Post-Phase 5)
- Sync DB→FS (track 1010): Write UI changes back to `.laneconductor.json`
- MCP server health checks: Verify servers are running before injecting
- Per-agent MCP selection: Assign different servers to different agents
- MCP marketplace: Browse and install servers from a registry

---

## Summary

| Phase | Duration | Key Files | Outcome |
|-------|----------|-----------|---------|
| 1     | ~4h      | migrations/, conductor/types/, conductor/utils/ | DB ready, types defined, validation written |
| 2     | ~6h      | conductor/laneconductor.sync.mjs, ui/server/index.mjs | Config synced to DB on startup |
| 3     | ~8h      | conductor/laneconductor.sync.mjs | MCP config injected when agents spawn |
| 4     | ~10h     | ui/src/ components + API routes | UI for server management |
| 5     | ~4h      | SKILL.md, docs, tests | Feature complete & documented |

**Total Estimate**: 32 hours of focused work

---

## Rollback Plan

If a phase fails:
1. **Phase 1 fails**: Remove `mcp_servers` column, revert types
2. **Phase 2 fails**: Remove `/project/ensure` MCP handling, keep DB column dormant
3. **Phase 3 fails**: Temp files left behind; manually delete `/tmp/lc-mcp-*.json`; agents spawn without MCP
4. **Phase 4 fails**: DB updated but UI not available; users edit `.laneconductor.json` directly
5. **Phase 5 fails**: Feature works but undocumented; document manually later

All rollbacks are low-risk; no data loss, clean revert to previous state.
