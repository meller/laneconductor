# Track 1004: Smart LLM Provider Exhaustion Handling

## Phase 1: Exhaustion Detection and Schema
**Problem**: No way to track LLM provider health.
**Solution**: Create DB schema for provider status and implement parsing of CLI errors to detect exhaustion.

- [x] Create `provider_status` table schema
- [x] Implement `updateProviderStatus` in Collector API
- [x] Add regex/parsing logic for Gemini exhaustion messages
- [x] Add regex/parsing logic for Claude exhaustion messages (if identifiable)

## Phase 2: Worker Backoff Logic
**Problem**: Sync worker spawns tasks regardless of provider health.
**Solution**: Check `reset_at` time before launching CLI agents.

- [x] Fetch provider status in sync worker loop
- [x] Skip `spawnCli` if provider is exhausted and `reset_at` > `NOW()`
- [x] Log "Provider [X] is exhausted, skipping auto-launch" in worker logs

## Phase 3: Dashboard Integration
**Problem**: User doesn't know why automation stopped.
**Solution**: Display provider health in the Workers panel.

- [x] Add `GET /api/projects/:id/providers` endpoint
- [x] Update `WorkersList.jsx` to show provider status (Green/Red)
- [x] Add "Resets in: X min" countdown to UI

**Impact**: Reduced API spam, better user feedback, and smoother automation transitions.
