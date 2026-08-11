# Track 1067: Jira Integration — Polling-Based Bidirectional Sync

**Lane**: review
**Lane Status**: queue

# Track 1067: Jira Integration — Polling-Based Bidirectional Sync

**Lane**: done
**Lane Status**: success
**Progress**: 0%
**Last Run**: 2026-04-14
**Summary**: ✅ COMPLETE. Worker polls Jira every 60 seconds with bidirectional sync. Latest-version-wins conflict resolution implemented. API dependency removed (local-fs mode). Jira status validation +…

## User Workflow

1. **Identity**: Generate an API Key (`lc_live_...`) in the LaneConductor UI.
2. **Inbound Setup**: 
   - Point your external service (e.g., Jira Webhook) to `POST /v1/webhooks/:format?token=<YOUR_KEY>`.
   - The API resolves the `workspace_id` from the token and translates the provider payload into LC actions.
3. **Outbound Setup**: 
   - Add target credentials (e.g., Jira domain/token) to the `integrations` column on the `projects` table.
   - Define `hooks` in `workflow.json` to trigger feedback on lane entry.
4. **Sync**: Configure multiple collectors in `.laneconductor.json` to keep local and cloud environments in sync.

## Project Configuration

The `projects` table now supports an `integrations` JSONB column:
```json
{
  "jira": {
    "domain": "your-domain.atlassian.net",
    "email": "user@email.com",
    "token": "ATATT...",
    "project_key": "PROJ"
  }
}
```

## Progress Log

> **human** (note): Infrastructure Hardening Phase completed successfully.
> - Refactored CLI to support `lc worker` command suite (`start`, `stop`, `restart`, `status`, `logs`, `sync`).
> - Implemented fan-out broadcast to multiple enabled targets.
> - Integrated GCP Secret Manager for production API keys (`LC_WORKER_PROD_KEY`).
> - Verified multi-collector synchronization in both `local-fs` and `local-api` modes.
>
> **human** (note): Integration Architecture Phase 1 & 2 complete.
> - Created modular Inbound Adapter registry with Jira support.
> - Implemented secure POST `/v1/webhooks/:provider` endpoint with token validation.
> - Implemented outbound Integration Proxy for worker-led feedback to Jira.
> - Added 'Integrations' section to Project Settings UI for self-serve configuration.
> - Standardized API routes between Local Server and Cloud Functions to ensure parity.
>
> **human** (note): Target Mapping implemented for Jira
> - Configurable lane-to-status target mapping logic added to Jira Collector
> - Added `lc add-target-mapping` CLI tool to let users update their mappings easily
> - Expanded base fallback lanes to recognize standard workflow `plan`, `implement`, `review`, `quality-gate`, `done`
>
> **human** (note): Multi-file sync via Atlassian Document Format (ADF) added
> - Refactored Jira collector to aggregate `index.md`, `plan.md`, `spec.md`, and `test.md` into the Jira description
> - Uses markdown `codeBlock` under appropriate `heading` within Jira ADF
> - Bidirectional parser extracts individual files back out flawlessly during inbound sync
**Phase**: Optional - Jira Workflow Status Creation
