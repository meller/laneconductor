# Track 10032: F18 claim-timeout — surface the outcome in the UI

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Type**: dev
**Summary**: Track 1102's Phase 12 added `reapStaleDispatches()` (`ui/server/index.mjs`) — a dispatch left `pending` past a bounded window is reassigned to another live worker, or marked failed with a reason if…

## Problem
`reapStaleDispatches()` reassigns or fails a stale dispatch entirely server/DB-side. There is no UI affordance (toast, activity-panel entry, dispatch-history annotation) that surfaces a reassignment or claim-timeout failure to the user.

## Solution
Surface the outcome somewhere a user would actually see it — likely the Activity panel or the track's dispatch history — so a claim-timeout event isn't only visible via a direct DB query.

## Phases
- [ ] Phase 1: Decide where this belongs in the UI (Activity panel entry vs. dispatch-history annotation vs. toast) and implement it
- [ ] Phase 2: Real test coverage — a spawned-worker/dispatch test proving the API response carries the reassignment/failure reason, plus a live browser check that it renders

## Depends on
- [1102](../1102-e2e-session-findings/index.md) — F18 follow-up (Phase 12), the DB-level mechanism this surfaces
**Auto Run**: yes
