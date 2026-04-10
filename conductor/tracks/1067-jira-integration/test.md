# Verification: Unified Integration Architecture (Track 1067)

This document contains commands and payloads to verify the end-to-end integration loop.

## 1. DB Verification
Ensure the `integrations` column exists and is functional.
```bash
# Check projects table
psql -h localhost -U postgres -d laneconductor -c "SELECT name, integrations FROM projects LIMIT 1"

# Check tracks table
psql -h localhost -U postgres -d laneconductor -c "SELECT track_number, integrations FROM tracks LIMIT 1"
```

## 2. Inbound Webhook (Jira -> LC)
Simulate a Jira webhook hit to the new modular router.
Replace `YOUR_PROJECT_TOKEN` with the value set in `projects.integrations->'jira'->'webhookToken'`.

```bash
# Setup: Seed project 1 with a test token
psql -h localhost -U postgres -d laneconductor -c "UPDATE projects SET integrations = '{\"jira\": {\"webhookToken\": \"test-token-123\", \"domain\": \"mock.atlassian.net\", \"email\": \"admin@mock.com\", \"token\": \"dummy\"}}' WHERE id = 1;"

curl -X POST "http://localhost:8091/v1/webhooks/jira?token=test-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookEvent": "jira:issue_updated",
    "issue": {
      "id": "10001",
      "key": "PROJ-1067",
      "self": "https://your-domain.atlassian.net/rest/api/2/issue/10001",
      "fields": {
        "summary": "Verify Unified Integration",
        "description": "This is a test issue from verification script.",
        "labels": ["ai-task"],
        "status": { "name": "To Do" },
        "updated": "2026-04-10T10:00:00.000+0000"
      }
    }
  }'
```

## 3. Proxy API (Worker -> Jira)
Simulate the worker calling the Cloud Proxy.
Prerequisite: You must have a record in `projects.integrations` for `jira`.

```bash
# Setup mock project integration first (run in psql)
# UPDATE projects SET integrations = '{"jira": {"domain": "mock.atlassian.net", "email": "admin@mock.com", "token": "dummy"}}' WHERE id = 1;

curl -X POST "http://localhost:8091/v1/projects/1/integrations/jira/proxy" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/rest/api/2/issue/PROJ-1067/comment",
    "method": "POST",
    "action": "comment",
    "body": "This is a proxied comment from LaneConductor verification."
  }'
```

## 4. Worker Hook Execution
To verify the worker's hook engine:
1. Ensure `workflow.json` has the hook definition (added in previous step).
2. Move a track to the `done` lane locally.
3. Observe the worker logs for: `[hooks] Executing jira hook for track...`.
