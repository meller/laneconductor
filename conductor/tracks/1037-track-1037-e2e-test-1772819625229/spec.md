# Spec: Track 1037: E2E Test 1772819625229

## Problem Statement
Automated Playwright e2e — verifies new track flows to worker and back.

## Requirements
- REQ-1: The worker must detect new-track requests in `file_sync_queue.md`.
- REQ-2: The worker must scaffold the track folder and files (index, spec, plan).
- REQ-3: The worker must update the track status to `planning` and `progress` to `0%`.
- REQ-4: The worker must mark the queue request as `processed`.

## Acceptance Criteria
- [ ] Playwright test runs without errors
- [ ] Test creates new track via UI and waits for worker
- [ ] Worker-created track folder exists: `conductor/tracks/1037-*`
- [ ] All required files exist: `index.md`, `spec.md`, `plan.md` with proper markers
- [ ] Track appears in UI with correct lane and status within 15s
- [ ] Database entry synced correctly (lane, progress, phase)
- [ ] Test passes consistently on local machine and CI

## Test Environment
- **Framework**: Playwright (Node.js)
- **Target**: Vite UI at `localhost:8090`
- **Worker**: Running via `lc start` (mode: `local-api`)
- **Timeout**: 15s max wait for worker to process new track
- **Dependencies**: `@playwright/test`, Node.js 18+
