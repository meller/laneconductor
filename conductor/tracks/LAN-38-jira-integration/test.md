# Test: Jira Polling-Based Bidirectional Sync (Track 1067)

## Setup

Prerequisites:
1. Local LaneConductor running: `make lc-start-all`
2. Jira project configured: `lc add-target --type jira --domain YOUR_DOMAIN --email USER@DOMAIN.COM --project-key KAN --token-env JIRA_API_TOKEN`
3. `JIRA_API_TOKEN` environment variable set with valid Jira API token
4. `conductor/tracks-metadata.json` exists (created at first sync)

## T1: Jira Poll Detection

**Scenario**: Worker polls Jira and detects new issue.

```bash
# 1. Verify Jira config in .laneconductor.json
grep -A5 '"type": "jira"' .laneconductor.json

# 2. Start worker
make lc-worker-start

# 3. Create issue in Jira with title "Test Poll Detection" in KAN project
# (Do this via Jira UI)

# 4. Wait 60 seconds (poll interval) then check:
ls -la conductor/tracks/KAN-*/
cat conductor/tracks/KAN-*/index.md  # should show "Test Poll Detection"

# 5. Verify logs
tail -20 conductor/.sync.log | grep -i "jira\|polling"
# Expected: "[jira-polling] Polling KAN for issues..."
# Expected: "[jira-polling] Found 1 issue to sync"
```

## T2: Bidirectional Sync - Jira to FS (Inbound)

**Scenario**: Issue updated in Jira → track updated in FS within grace period.

```bash
# 1. Create issue "KAN-10" in Jira with status "To Do"
# (Do this via Jira UI)

# 2. Check it appears in LC
sleep 60
ls conductor/tracks/KAN-10-*/  # should exist

# 3. Check lane is correct
grep -o 'lane: [a-z]*' conductor/tracks/KAN-10-*/index.md
# Expected: "lane: queue" (To Do → queue)

# 4. Update issue in Jira: change status to "In Progress"
# (Do this via Jira UI)

# 5. Wait 60 seconds and verify LC track updated
sleep 60
grep -o 'lane: [a-z]*' conductor/tracks/KAN-10-*/index.md
# Expected: "lane: running" (In Progress → running)

# 6. Check tracks-metadata.json was updated
grep -A2 '"KAN-10"' conductor/tracks-metadata.json
# Expected: jira_last_synced timestamp within last 70 seconds
```

## T3: Bidirectional Sync - FS to Jira (Outbound)

**Scenario**: Track updated locally → Jira issue updated within grace period.

```bash
# 1. Find existing track KAN-5 in conductor/tracks/
cd conductor/tracks/KAN-5-*

# 2. Edit index.md: change lane from "queue" to "running"
sed -i 's/^lane: queue/lane: running/' index.md

# 3. Wait 10 seconds for sync, then check worker logs
sleep 10
tail -30 conductor/.sync.log | grep "KAN-5"
# Expected: "[sync] Pushing to Jira..."

# 4. Verify in Jira: KAN-5 status changed to "In Progress"
# (Check via Jira UI)
```

## T4: Conflict Resolution - Latest Version Wins

**Scenario**: Both Jira and FS change within grace period → latest (by timestamp) wins.

```bash
# Setup: Have a track KAN-7 in both places

# 1. Simultaneous updates (within 5 seconds):
#    - Update index.md lane: queue → success
#    - Update Jira issue status: To Do → Done (In Jira UI)

# 2. Wait 60 seconds for next poll cycle

# 3. Check which version won:
grep -o 'lane: [a-z]*' conductor/tracks/KAN-7-*/index.md

# 4. Verify in Jira - should match the track lane
# (Check via Jira UI)

# Note: Winner is determined by `updated` timestamp.
# If Jira updated later: FS should reflect Done
# If FS updated later: Jira should reflect the FS lane
```

## T5: Comment Sync

**Scenario**: Comments added in Jira appear in conversation.md

```bash
# 1. Find existing track KAN-6 in conductor/tracks/
# 2. Add comment in Jira issue KAN-6: "Test comment from Jira"
#    (Do this via Jira UI)

# 3. Wait 60 seconds
sleep 60

# 4. Check conversation.md
cat conductor/tracks/KAN-6-*/conversation.md
# Expected: comment text appears with "jira" source attribution

# 5. Add comment locally in conversation.md
cd conductor/tracks/KAN-6-*/
echo "Local comment from LaneConductor" >> conversation.md

# 6. Wait 10 seconds for outbound sync
sleep 10

# 7. Verify in Jira - new comment should appear
#    (Check via Jira UI on issue KAN-6)
```

## T6: Multiple Workers (Race Condition)

**Scenario**: Two workers poll same Jira project → no duplicate tracks.

```bash
# 1. Start first worker
make lc-worker-start

# 2. Create new issue in Jira: "KAN-99 Duplicate Test"
#    (Do this via Jira UI)

# 3. Wait for first poll (60 seconds)
sleep 60

# 4. Count tracks created
TRACK_COUNT=$(find conductor/tracks/KAN-99-* -type d 2>/dev/null | wc -l)
echo "Tracks after Worker 1: $TRACK_COUNT"
# Expected: 1

# 5. Start second worker (in different terminal)
# cd /home/meller/Code/laneconductor
# LC_SKIP_GIT_LOCK=1 timeout 120 node conductor/laneconductor.sync.mjs --mode sync+poll

# 6. Wait 60 more seconds for second worker's first poll
sleep 60

# 7. Count tracks again
TRACK_COUNT=$(find conductor/tracks/KAN-99-* -type d 2>/dev/null | wc -l)
echo "Tracks after Worker 2: $TRACK_COUNT"
# Expected: still 1 (second worker detected existing, skipped via timestamp)

# 8. Check logs both workers
tail -30 conductor/.sync.log | grep "KAN-99"
# Expected: Worker 1 "Found 1 issue", Worker 2 "Found 0 issues" (or detected existing)
```

## T7: Jira Setup Validation

**Scenario**: Verify `lc add-target --type jira` stores config correctly.

```bash
# 1. Run add-target command
lc add-target --type jira \
  --domain example.atlassian.net \
  --email test@example.com \
  --project-key TEST \
  --token-env TEST_JIRA_TOKEN

# 2. Verify in .laneconductor.json
grep -A6 '"type": "jira"' .laneconductor.json
# Expected output:
# "type": "jira",
# "domain": "example.atlassian.net",
# "email": "test@example.com",
# "project_key": "TEST",
# "token_env": "TEST_JIRA_TOKEN"

# 3. Verify lc list-targets shows Jira
lc list-targets | grep -i jira
# Expected: "jira: TEST @ example.atlassian.net"
```

## T8: Grace Period (No Thrashing)

**Scenario**: Rapid FS changes don't trigger Jira updates repeatedly.

```bash
# 1. Edit track KAN-8 index.md, change lane 5 times in 30 seconds
for i in {1..5}; do
  sed -i "s/^lane:.*/lane: queue # edit $i/" conductor/tracks/KAN-8-*/index.md
  sleep 5
done

# 2. Check worker logs - should see only 1 or 2 pushes (not 5)
tail -50 conductor/.sync.log | grep "KAN-8.*Pushing"
# Expected: ~1-2 occurrences (grace period de-dupes rapid changes)

# 3. This prevents Jira API rate limits and unnecessary churn
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Track not appearing in LC | Is Jira token valid? `echo $JIRA_API_TOKEN` |
| Poll not running | Check worker logs: `tail conductor/.sync.log \| grep jira` |
| Jira not updating | Check outbound push logs: `tail conductor/.sync.log \| grep "Pushing to Jira"` |
| Comments not syncing | Is `conversation.md` readable? Check file permissions |
| Duplicate tracks | Check timestamps in `tracks-metadata.json`, ensure all workers use same `jira_last_synced` |
