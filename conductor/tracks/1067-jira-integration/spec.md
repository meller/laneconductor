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

### R5: Lane ↔ Label Mapping (Not Status Transitions)

**Implementation approach**: Use **labels** for lane representation, not Jira workflow status transitions. This avoids the need for Jira admin access to create/modify workflow statuses.

Labels follow the standardized format:
- `lconductor-plan` — LC lane: plan
- `lconductor-implement` — LC lane: implement  
- `lconductor-review` — LC lane: review
- `lconductor-quality-gate` — LC lane: quality-gate
- `lconductor-done` — LC lane: done
- `lconductor-success` — action status: success
- `lconductor-queue` — action status: queued
- `lconductor-running` — action status: running
- `lconductor-failed` — action status: failed

**Optional: Custom status mapping** *(Phase 7)*

Configurable via `lc add-target-mapping`. CLI configures `.laneconductor.json` with optional status mapping for teams that want Jira workflow integration:

```json
{
  "collectors": [
    {
      "type": "jira",
      "target_mapping": {
        "implement": "In Progress",
        "review": "In Review"
      },
      "create_missing_statuses": false
    }
  ]
}
```

If `target_mapping` is configured (optional), worker can optionally create missing workflow statuses (requires Jira Cloud admin token with workflow admin scope).

If not configured, lanes are tracked purely via labels (no Jira status transitions needed).

**Available Jira Statuses** (in your KAN project):
- `To Do` — used for backlog, plan, queue lanes
- `In Progress` — used for implement, running lanes
- `In Review` — used for review, quality-gate lanes
- `Done` — used for done, success lanes

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
  --token-env JIRA_API_TOKEN
```

When `--type jira`:
- Skip `--url` requirement
- Require `--domain`, `--email`, `--project-key`
- Accept `--token` (inline) or `--token-env` (env var reference)
- Store as collector entry with `type: 'jira'`

Update `lc list-targets`:
- Display Jira collectors as: `jira: KAN @ mycompany.atlassian.net`
- Display API collectors as: `api: http://...`

### R7: Multiple Workers (Race Condition Safety)

Same algorithm as existing FS ↔ DB sync:
- Per-track `jira_last_synced` timestamp in metadata
- Worker 1 polls Jira, updates FS, writes timestamp
- Worker 2 polls same Jira issue 1s later, sees same timestamp, skips (no diff)
- Grace period (10s): skip if FS mtime within 10s of Jira `updated` (allow multiple writers)

No database locks needed. Timestamp comparison ensures idempotency.

