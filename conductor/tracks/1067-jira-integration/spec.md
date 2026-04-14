# Spec: Track 1067 - Jira as Third View (Polling-Based Bidirectional Sync)

## Overview

Jira becomes an optional collector type in the existing multi-collector framework. Worker polls Jira every 60 seconds (same as DB pull) and syncs bidirectionally with "latest version wins" conflict resolution. Filesystem remains source of truth.

**No webhooks. No LC API required. No Jira admin panel config.**

## Requirements

### R1: Jira Collector Configuration

Store in `.laneconductor.json`:
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

**Note**: `token_env` points to environment variable (not inline token). Worker resolves at runtime.

### R2: Jira Polling Module (`conductor/jira-collector.mjs`)

Polling interval: 60 seconds (same as `pullTracksMetadataFromDB()`).

Functions:
- `readJiraConfig(collectors)` — Find collector with `type: 'jira'`, resolve token from env var
- `pollJira(config)` — GET `/rest/api/3/search?jql=project=KAN AND updated>={lastSync}`, return issues
- `jiraIssueToTrackUpdate(issue)` — Map Jira issue fields to `{track_number, title, lane, content}`
- `pushTrackToJira(config, trackData)` — PATCH issue description + POST status transition
- `pushCommentToJira(config, issueKey, text)` — POST comment to Jira
- `getJiraComments(config, issueKey, since)` — GET comments updated since timestamp

All functions handle auth via Basic (email:token) header.

### R3: Bidirectional Sync Logic

#### Inbound (Jira → FS)
1. Poll Jira every 60s for issues updated since `jira_last_synced`
2. For each changed issue:
   - Read track's mtime from FS
   - Compare Jira `fields.updated` vs FS mtime
   - If Jira newer: rewrite track folder (update `index.md` lane/title, create `conversation.md` entry)
   - Grace period: skip if mtime within last 10s (allow in-flight writes)
   - Update `jira_last_synced` in `tracks-metadata.json`

#### Outbound (FS → Jira)
Triggered in `conductor/laneconductor.sync.mjs`:
1. After `syncTrack()` updates FS: check if Jira collector exists
2. If changed: get jira_key from metadata, push via `pushTrackToJira()`
3. After `syncConversation()` adds comment: push via `pushCommentToJira()`

### R4: Track Metadata Structure

Store per-track Jira state in `conductor/tracks-metadata.json`:
```json
{
  "KAN-1": {
    "jira_key": "KAN-1",
    "jira_last_synced": "2026-04-13T12:00:00Z"
  },
  "KAN-2": {
    "jira_key": "KAN-2",
    "jira_last_synced": "2026-04-13T12:00:00Z"
  }
}
```

Populated at first sync, updated on each poll.

### R5: Lane ↔ Status Mapping (1:1 with Auto-Creation)

**Implementation approach**: 1:1 mapping between LC lanes and Jira workflow statuses. Worker automatically creates missing statuses during first sync.

**Default 1:1 Mapping** (Phase 6 implementation):
```
LC Lane          → Jira Status
─────────────────────────────
backlog          → Backlog (auto-created if missing)
plan, queue      → To Do
implement, running → In Progress
review           → In Review
quality-gate     → Testing (auto-created if missing)
done, success    → Done
```

**Labels** (complementary for filtering/reporting):
Worker also labels all issues with `lconductor-<lane>` and `lconductor-<action>`:
- `lconductor-backlog`, `lconductor-plan`, `lconductor-implement`, etc. — lane labels
- `lconductor-queue`, `lconductor-running`, `lconductor-success`, `lconductor-failed` — action labels

This enables filtering and cross-lane visibility in Jira UI while status transitions handle workflow automation.

**Custom Mapping** (optional, Phase 7):
Teams can override defaults via `lc add-target-mapping`:
```bash
lc add-target-mapping --lane quality-gate --target "QA Review"
```

Stored in `.laneconductor.json`:
```json
{
  "collectors": [
    {
      "type": "jira",
      "target_mapping": {
        "quality-gate": "QA Review"
      }
    }
  ]
}
```

The 1:1 constraint ensures no ambiguity: each LC lane has exactly one Jira status, and vice versa.

### R10: Workspace/Folder Mapping (Phase 8)

**Problem**: Multiple source folders (conductor, ui, infra) may need to sync to different Jira projects.

**Solution**: `lc add-target --workspace` saves folder path to config. Worker uses this to route tracks:
```json
{
  "collectors": [
    {
      "type": "jira",
      "domain": "...",
      "project_key": "KAN",
      "workspace": "conductor"
    },
    {
      "type": "jira",
      "domain": "...",
      "project_key": "INFRA",
      "workspace": "infra"
    },
    {
      "type": "jira",
      "domain": "...",
      "project_key": "UI",
      "workspace": "ui"
    }
  ]
}
```

**Worker Behavior**:
- Track in `conductor/tracks/NNN-*` → syncs to KAN project
- Track in `infra/tracks/NNN-*` → syncs to INFRA project
- Track in `ui/tracks/NNN-*` → syncs to UI project
- Track in other folders → syncs to first collector without workspace (default fallback)

**No workspace specified** → collector applies to all folders (default behavior)

### R8: Multi-File Field Mapping (Jira Description)

The Jira issue description acts as a container for all relevant track files. The content is formatted using ADF (Atlassian Document Format) with clear headings and code blocks for:
- **Index** (`index.md`)
- **Plan** (`plan.md`)
- **Spec** (`spec.md`)
- **Test** (`test.md`)
- **Log** (`log.md`) - *optional*

Formatting should use ADF `heading` (level 2) followed by a `codeBlock` (language: markdown) for each file. This ensures both readability in the Jira UI and deterministic parsing by the worker.

### R9: Interaction Logs & Conversations

- **Conversations**: Human messages in `conversation.md` are pushed as Jira comments. Inbound Jira comments are appended to `conversation.md` as `> **human** (jira): {message}`.
- **Run Logs**: If a track has a `log.md` or a recent run log tail, it can be updated in the description under a "Logs" heading or posted as a comment/worklog. Initially, we will include `log.md` in the multi-file description mapping.

### R6: CLI Extension (`bin/lc.mjs`)

Extend `add-target` to detect `--type jira`:
```bash
lc add-target --type jira \
  --domain mycompany.atlassian.net \
  --email user@example.com \
  --project-key KAN \
  --token-env JIRA_API_TOKEN \
  --workspace conductor
```

When `--type jira`:
- Skip `--url` requirement
- Require `--domain`, `--email`, `--project-key`
- Accept `--token` (inline) or `--token-env` (env var reference)
- Accept optional `--workspace` (folder path like `conductor`, `ui`, `infra` — defaults to all folders)
- Store as collector entry with `type: 'jira'`

Update `lc list-targets`:
- Display Jira collectors as: `jira: KAN @ mycompany.atlassian.net (workspace: conductor)`
- Display API collectors as: `api: http://...`

### R7: Multiple Workers (Race Condition Safety)

Same algorithm as existing FS ↔ DB sync:
- Per-track `jira_last_synced` timestamp in metadata
- Worker 1 polls Jira, updates FS, writes timestamp
- Worker 2 polls same Jira issue 1s later, sees same timestamp, skips (no diff)
- Grace period (10s): skip if FS mtime within 10s of Jira `updated` (allow multiple writers)

No database locks needed. Timestamp comparison ensures idempotency.

