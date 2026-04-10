#!/bin/bash
# LaneConductor — Integration Verification Script
# This script seeds the local DB with a test token and hits the local endpoints.

API_URL="http://localhost:8091"
PROJECT_ID=1
TEST_TOKEN="test-token-123"

echo "🧪 Starting integration verification..."

# 1. Setup Local DB
echo "   [1/3] Seeding project $PROJECT_ID with test token..."
psql -h localhost -U postgres -d laneconductor -c "UPDATE projects SET integrations = jsonb_set(COALESCE(integrations, '{}'), '{jira}', '{\"webhookToken\": \"$TEST_TOKEN\", \"domain\": \"mock.atlassian.net\", \"email\": \"admin@mock.com\", \"token\": \"dummy\"}') WHERE id = $PROJECT_ID;" > /dev/null

# 2. Test Inbound Webhook
echo "   [2/3] Simulating Jira webhook (Inbound)..."
curl -s -X POST "$API_URL/v1/webhooks/jira?token=$TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookEvent": "jira:issue_updated",
    "issue": {
      "id": "10001",
      "key": "PROJ-1067",
      "fields": {
        "summary": "Verify Unified Integration",
        "description": "Auto-test payload",
        "labels": ["ai-task"],
        "status": { "name": "To Do" },
        "updated": "2026-04-10T10:00:00.000+0000"
      }
    }
  }' | grep -q "ok" && echo "   ✅ Webhook Success" || echo "   ❌ Webhook Failed (Is the API running at $API_URL?)"

# 3. Test Proxy API
echo "   [3/3] Testing Cloud Proxy (Outbound)..."
# Note: This requires a valid user session or to skip auth for testing
# We'll just check if the route exists and returns 401/403 vs 404
curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/v1/projects/$PROJECT_ID/integrations/jira/proxy" \
  -H "Content-Type: application/json" \
  -d '{"path": "/rest/api/2/issue/10001/comment", "method": "POST", "body": "test"}' | grep -E "200|401" > /dev/null && echo "   ✅ Proxy Route Reachable" || echo "   ❌ Proxy Route Failed"

echo ""
echo "🏁 Verification Done."
