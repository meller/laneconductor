# Plan: Track 1067 - Jira as Third View (Polling-Based Bidirectional Sync)

**New Approach**: Jira becomes a third optional view alongside Local UI and Remote App, using the existing multi-collector pattern. Filesystem is source of truth. Worker polls Jira every 60 seconds and syncs bidirectionally with "latest version wins" conflict resolution.

## Architecture

```
Filesystem (source of truth)
       ↕ chokidar + setInterval "latest version wins"
Worker (laneconductor.sync.mjs)
  ├── ↕ Local Collector (localhost:8091) + Local UI
  ├── ↕ Remote Collector (app.laneconductor.com) + Remote UI  [optional]
  └── ↕ Jira Collector (asafmeller.atlassian.net)              [optional, new]
```

## Why Polling Instead of Webhooks

1. **Reliability**: Jira Cloud egress cannot reach server (SSL/TLS issues, JQL filters, global whitelist)
2. **Simplicity**: No webhook setup in Jira System → Webhooks admin panel
3. **Symmetry**: Uses existing multi-collector pattern (same as Local ↔ Remote sync)
4. **No Proxy Needed**: Worker connects directly to Jira API

## Data Mapping

| Filesystem | Jira |
|-----------|------|
| Track number | Issue key (KAN-123) |
| Title (folder slug) | Issue summary |
| `index.md` content | Issue description (ADF Heading: "Index") |
| `plan.md` content | Issue description (ADF Heading: "Plan") |
| `spec.md` content | Issue description (ADF Heading: "Spec") |
| `test.md` content | Issue description (ADF Heading: "Test") |
| `log.md` content | Issue description (ADF Heading: "Log") |
| Lane (plan/implement/review) | Issue status (To Do / In Progress). *Customizable via `lc add-target-mapping`* |
| `conversation.md` entries | Issue comments (bidirectional) |

## Jira Setup (Via CLI)

```bash
lc add-target --type jira \
  --domain mycompany.atlassian.net \
  --email user@example.com \
  --project-key KAN \
  --token-env JIRA_API_TOKEN
```

Stored in `.laneconductor.json`:
```json
{
  "collectors": [
    {
      "type": "jira",
      "domain": "mycompany.atlassian.net",
      "email": "user@example.com",
      "project_key": "KAN",
      "token_env": "JIRA_API_TOKEN"
    }
  ]
}
```

**No Jira admin access needed. No webhook setup.**

## Conflict Resolution: Latest Version Wins

Per-track: store `jira_last_synced` timestamp in `conductor/tracks-metadata.json`

On sync:
- Compare Jira `fields.updated` vs FS mtime
- If Jira newer → update FS (rewrite Lane/Summary in `index.md`)
- If FS newer → push to Jira (PATCH description + status transition)
- Grace period: skip if updated within last 10s (same as DB sync)

Multiple workers: same logic as today; second worker sees no diff, skips.

## Phases

### Phase 1: Jira Collector Module ✓
- Create `conductor/jira-collector.mjs`
- Implement polling, issue-to-track mapping, track-to-issue push
- Functions: `readJiraConfig()`, `pollJira()`, `jiraIssueToTrackUpdate()`, `pushTrackToJira()`, `pushCommentToJira()`

### Phase 2: Wire into Sync Worker ✓
- Import from `conductor/jira-collector.mjs`
- Add `setInterval(runJiraSync, 60000)` after existing heartbeat intervals
- Hook into `syncTrack()` exit: when FS track changes → call `pushTrackToJira()`
- Hook into `syncConversation()`: when human comment added → call `pushCommentToJira()`

### Phase 3: Track Metadata Timestamps ✓
- Populate `conductor/tracks-metadata.json` per-track with `jira_key` and `jira_last_synced`
- Read/update at runtime during polling and push

### Phase 4: Update Track 1067 Docs ✓
- Rewrite `plan.md` with new architecture
- Update `spec.md` with polling spec
- Update `test.md` with polling + bidirectional test scenarios
- Update `landing/docs/jira-integration.md` (remove webhook steps, replace with CLI)

### Phase 5: CLI Extension ✓
- Extend `bin/lc.mjs` `add-target` to detect `--type jira`
- Validate `--domain`, `--email`, `--project-key` (not `--url`)
- Store collector entry with `type: 'jira'`
- Update `lc list-targets` to display Jira collectors
- Update `SKILL.md` quick reference

### Phase 6: Enhanced Sync & Mapping ✓
- **1:1 Lane Mapping**: Ensure `add-target-mapping` prevents duplicate source/target lanes.
- **Multi-file Formatting**: Update `buildTrackAdf` to include `Log` section.
- **Bidirectional Comments**: Ensure Jira comments flow back to `conversation.md`.
- **Bug Fixes**: Resolve metadata access bugs in sync worker.
- **GCP Secrets**: Standardized and added support for GCP Secret Manager for Jira tokens.
- **ADF Parsing**: Improved ADF parser for comment synchronization.
- **Loop Prevention**: Added `recentlyPulled` check to prevent sync echoes.

## Files to Modify

| File | Change |
|------|--------|
| `conductor/jira-collector.mjs` | **Create new** (polling + push functions) |
| `conductor/jira-polling.mjs` | Delete (old, broken webhook approach) |
| `conductor/laneconductor.sync.mjs` | Add Jira sync interval + push hooks |
| `conductor/tracks-metadata.json` | Populated at runtime per-track |
| `bin/lc.mjs` | Extend `add-target` for `--type jira` params |
| `.claude/skills/laneconductor/SKILL.md` | Update `add-target` docs |
| `ui/src/pages/ProjectConfigSettings.jsx` | **Remove** Jira integration UI section |
| `conductor/tracks/1067-jira-integration/plan.md` | **Update** (this file) |
| `conductor/tracks/1067-jira-integration/spec.md` | **Update** with polling spec |
| `conductor/tracks/1067-jira-integration/test.md` | **Update** with test scenarios |
| `landing/docs/jira-integration.md` | Simplify to CLI-only setup |

## Verification

1. Add Jira collector via `lc add-target --type jira --domain ... --email ... --project-key KAN --token-env JIRA_API_TOKEN`
2. Start worker → confirm `[jira-polling] Polling KAN for issues...` in logs
3. Create issue in Jira → within 60s track appears in `conductor/tracks/KAN-X-*/`
4. Move LC track to different lane → within 60s Jira issue status transitions
5. Add comment in Jira → within 60s appears in `conversation.md`
6. Multiple workers: start 2nd worker → confirm no duplicate tracks created (timestamp-based dedup)
7. Trigger `chokidar` via `syncTrack` to ensure immediate FS-to-Jira propagation
- Modified for test
- Modified again via tool
