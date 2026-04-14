# Jira Integration Setup

LaneConductor syncs Jira issues bidirectionally with your local project. Jira becomes an optional "third view" alongside Local UI and Remote App. The filesystem is the source of truth.

## How It Works

```
Jira Issues (polling every 60 seconds)
         ↓
Worker polls for updated issues
         ↓
LaneConductor creates/updates tracks
         ↓
User edits tracks locally or in UI
         ↓
Worker pushes changes back to Jira
         ↓
Jira status/description updates
```

**No webhooks. No cloud API required. Worker syncs directly with Jira.**

## Data Mapping

| Jira | ↔ | LaneConductor |
|------|---|---|
| Issue Key | ↔ | Track Number (e.g., KAN-123) |
| Summary | ↔ | Track Title |
| Description | ↔ | Track Content (`index.md`) |
| Status | ↔ | Track Lane (To Do ↔ queue, In Progress ↔ running, Done ↔ success) |
| Comments | ↔ | Conversation (`conversation.md`) |

## Setup Steps

### 1. Get Jira API Token

1. Go to **Jira** → Your profile icon → **Account Settings**
2. Left sidebar → **Security** → **API tokens**
3. Click **Create API token**
4. Name it (e.g., "LaneConductor")
5. Copy the token and save it (you'll need it in Step 2)

### 2. Add Jira as a Target

Run this command in your LaneConductor project directory:

```bash
lc add-target --type jira \
  --domain mycompany.atlassian.net \
  --email your.email@example.com \
  --project-key KAN \
  --token-env JIRA_API_TOKEN
```

Replace:
- `mycompany.atlassian.net` — Your Jira domain
- `your.email@example.com` — Your Jira account email
- `KAN` — Your Jira project key (appears in issue keys like KAN-123)
- `JIRA_API_TOKEN` — Environment variable name that will hold your API token

The CLI will:
- ✅ Check if the project exists (create if needed)
- ✅ Validate that required workflow statuses exist
- ⚠️ Show guidance if any statuses are missing

**What you'll see:**
```
🔍 Checking JIRA project: KAN...
✅ JIRA project KAN exists
✅ Jira collector added: KAN @ mycompany.atlassian.net

⚠️  LaneConductor detected missing JIRA statuses: "Backlog", "Testing"
   Issues will sync using labels, but for proper board visualization:

   📋 Create these statuses in your JIRA workflow:
      1. Go to: https://mycompany.atlassian.net/jira/software/projects/KAN/settings/workflows
      2. Click "Edit Workflow" on your active workflow
      3. Click "Add Status" for each missing status
      4. Save and publish the workflow
      5. Run: lc worker restart

✅ Jira integration ready! Worker will start syncing in 60 seconds.
```

If all statuses exist, you'll see:
```
✅ All JIRA statuses validated. Ready for lane-to-status transitions.
```

### 3. (Optional) Create Missing Jira Statuses

If the `lc add-target` command reports missing statuses, you'll need to create them manually in Jira:

```
⚠️  LaneConductor detected missing JIRA statuses: "Backlog", "Testing"
   1. Go to: https://mycompany.atlassian.net/jira/software/projects/KAN/settings/workflows
   2. Click "Edit Workflow" on your active workflow
   3. Click "Add Status" for each missing status
   4. Save and publish the workflow
   5. Run: lc worker restart
```

**Why manual?** Jira Cloud doesn't expose a REST API for creating statuses. They must be added through the workflow settings UI.

**Note:** Even without these statuses, sync will work using labels (`lconductor-backlog`, `lconductor-implement`, etc.) for lane tracking.

### 4. Set the Environment Variable

Add your Jira API token to your environment:

```bash
export JIRA_API_TOKEN="your_api_token_here"
```

Or add to `.env` in the project root:
```
JIRA_API_TOKEN=your_api_token_here
```

### 5. Verify Configuration

Check that Jira was added as a target:

```bash
lc list-targets
```

Expected output:
```
Targets:
  api: http://127.0.0.1:8091
  jira: KAN @ mycompany.atlassian.net
```

### 6. Start the Worker

```bash
make lc-worker-start
```

The worker will immediately begin polling Jira every 60 seconds. Check logs:

```bash
tail -f conductor/.sync.log | grep -i jira
```

## Lane-to-Status Mapping

LaneConductor lanes map to Jira statuses:

| LC Lane | Jira Status | Purpose |
|---------|-------------|---------|
| backlog | Backlog | Initial/unstarted work |
| plan, queue | To Do | Planned/queued work |
| implement, running | In Progress | Active development |
| review | In Review | Code/design review |
| quality-gate | Testing | Quality assurance |
| done, success | Done | Completed work |

**Backup tracking:** All issues are labeled with `lconductor-<lane>` so lane tracking works even if statuses don't exactly match.

## Troubleshooting

### "Issues sync but don't show proper status in Jira"
- Check if your workflow statuses exist
- Create missing statuses following Step 3
- Restart worker: `lc worker restart`

### "Can't see issues in Jira"
- Check token has read/write permissions
- Verify project key is correct
- Check worker logs: `lc worker logs | grep jira`

### "Issues get created but stay in default status"
- This is normal if required statuses don't exist
- Create the statuses and restart worker
- Worker will transition issues to correct statuses on next sync cycle

Expected output:
```
[jira-collector] Polling KAN for issues...
[jira-collector] Found 3 issues to sync
```

## Test the Integration

### Test 1: Jira → LaneConductor (Inbound)

1. **Create a new issue in Jira**: 
   - Go to your Jira project (KAN)
   - Click **Create issue**
   - Title: "Test Sync from Jira"
   - Status: "To Do"
   - Click **Create**

2. **Wait 60 seconds** for the next poll cycle

3. **Check LaneConductor**:
   ```bash
   ls conductor/tracks/KAN-*/
   cat conductor/tracks/KAN-*/index.md
   ```
   You should see a new track folder with the issue key and title.

### Test 2: LaneConductor → Jira (Outbound)

1. **Find an existing track** in `conductor/tracks/KAN-X-*/`

2. **Edit the track locally**:
   ```bash
   # Change the lane in index.md
   sed -i 's/^lane: queue/lane: running/' conductor/tracks/KAN-X-*/index.md
   ```

3. **Wait 10 seconds** for the sync to push the change

4. **Check Jira**:
   - Go to issue KAN-X
   - Status should now be "In Progress" (matching the new lane)

### Test 3: Comments

1. **Add a comment in Jira**:
   - Open issue KAN-X
   - Click **Add a comment**
   - Type "Test comment from Jira"
   - Click **Save**

2. **Wait 60 seconds**

3. **Check `conversation.md`**:
   ```bash
   cat conductor/tracks/KAN-X-*/conversation.md
   ```
   The comment should appear.

## Multiple Jira Projects

You can add multiple Jira projects as targets:

```bash
lc add-target --type jira \
  --domain mycompany.atlassian.net \
  --email your.email@example.com \
  --project-key OPS \
  --token-env JIRA_API_TOKEN

lc add-target --type jira \
  --domain mycompany.atlassian.net \
  --email your.email@example.com \
  --project-key ENG \
  --token-env JIRA_API_TOKEN
```

The worker will sync all of them simultaneously every 60 seconds.

## Conflict Resolution

When both Jira and LaneConductor are updated within a few seconds:
- The **latest version wins** (by timestamp)
- Comparison uses Jira `updated` timestamp vs filesystem mtime
- Grace period: 10 seconds (changes within 10s of each other won't conflict)

**Multiple workers**: If running multiple workers, each polls independently. Same timestamps ensure idempotency—second worker sees no changes, skips update.

## Lane Status Mapping

By default:

| Jira Status | → | LC Lane |
|-------------|---|---------|
| To Do, TODO, Backlog | → | queue |
| In Progress | → | running |
| In Review | → | review |
| Done, Resolved, Closed | → | success |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Jira token not found"** | ✓ Set `JIRA_API_TOKEN` environment variable: `export JIRA_API_TOKEN="..."`<br>✓ Or add to `.env` file in project root |
| **No tracks appearing after 60 seconds** | ✓ Check worker logs: `tail conductor/.sync.log \| grep jira`<br>✓ Verify API token is valid (test in Jira manually)<br>✓ Verify project key is correct (e.g., `KAN` not `kan`) |
| **"Poll error" in logs** | ✓ Check Jira domain is correct (e.g., `mycompany.atlassian.net`)<br>✓ Check email address matches your Jira account<br>✓ Verify API token hasn't expired |
| **Jira status not updating** | ✓ Check worker has outbound internet access<br>✓ Verify Jira user has permission to change status<br>✓ Check worker logs for push errors |
| **Comments not syncing** | ✓ Verify `conversation.md` file has read/write permissions<br>✓ Check worker logs for comment errors |
| **Multiple duplicate tracks created** | ✓ This shouldn't happen—timestamp dedup prevents it<br>✓ Check `tracks-metadata.json` has `jira_last_synced` per track<br>✓ Restart worker if stuck: `make lc-worker-stop && make lc-worker-start` |

## Configuration File

Your `.laneconductor.json` should now include the Jira collector:

```json
{
  "mode": "multi-api",
  "collectors": [
    {
      "url": "http://127.0.0.1:8091",
      "token": null,
      "enabled": true
    },
    {
      "type": "jira",
      "domain": "mycompany.atlassian.net",
      "email": "your.email@example.com",
      "project_key": "KAN",
      "token_env": "JIRA_API_TOKEN"
    }
  ]
}
```

## Remove Jira Integration

To stop syncing with Jira:

```bash
lc remove-target --type jira --project-key KAN
```

This removes the Jira collector from `.laneconductor.json` but keeps your local tracks intact.
