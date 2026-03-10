# Spec: Smart LLM Provider Exhaustion Handling

## Problem Statement
The sync worker currently lacks awareness of LLM provider rate limits. When a 429 error occurs (e.g., "You have exhausted your capacity on this model"), the worker marks the track as `waiting` and retries almost immediately, leading to massive log spam and potential further rate limiting.

## Requirements
- **REQ-1**: Detect 429/Exhaustion errors from Claude and Gemini CLI outputs.
- **REQ-2**: Extract "reset time" or "retry delay" from error messages if available.
- **REQ-3**: Store provider health status (available/exhausted) and next available time in the database.
- **REQ-4**: Prevent the sync worker from launching tasks using an exhausted provider.
- **REQ-5**: Show provider status (including a countdown if exhausted) in the UI's Workers panel.

## Implementation Details
- **Detection**: Parse `stdout`/`stderr` for known exhaustion strings.
  - Gemini: `You have exhausted your capacity on this model. Your quota will reset after X.`
  - Claude: (Need to verify exact string, but similar 429 pattern).
- **Storage**: Add a `provider_status` table or update the `projects`/`workers` table to include LLM health.
- **Worker**: Update the `spawnCli` logic to check provider health before spawning.

## API Contracts / Data Models
### Provider Status Table
```sql
CREATE TABLE provider_status (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL, -- 'claude', 'gemini'
  status       TEXT NOT NULL DEFAULT 'available', -- 'available', 'exhausted'
  reset_at     TIMESTAMP,
  last_error   TEXT,
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, provider)
);
```
