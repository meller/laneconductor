# Track 10032: F18 claim-timeout — surface the outcome in the UI

**Lane**: implement
**Lane Status**: running
**Progress**: 100%
**Last Run**: claude/claude-opus-5 (primary)
**Type**: dev
**Track Kind**: feature
**Summary**: Track 1102's Phase 12 added `reapStaleDispatches()` (`ui/server/index.mjs`) — a dispatch left `pending` past a bounded window is reassigned to another live worker, or marked failed with a reason if…

## Problem
`reapStaleDispatches()` reassigns or fails a stale dispatch entirely server/DB-side. There is no UI affordance (toast, activity-panel entry, dispatch-history annotation) that surfaces a reassignment or claim-timeout failure to the user.

## Solution
Record the reap outcome durably on the dispatch row (`reaped_at` + `reap_reason`, which no later worker PATCH overwrites), annotate both dispatch-history surfaces with it, and push a track-scoped reap into the Inbox as a `system` ⚠️/❌ comment — the existing affordance for "tell the user something happened while they weren't looking". No toast: there is no toast infrastructure in the app, and the event fires ≥5 minutes after the dispatch, almost always with no relevant panel open.

## Phases
- [ ] Phase 1: Record the reap outcome durably — `worker_dispatch.reaped_at` + `reap_reason` (migration `011_dispatch_reap.sql`), written on both the reassign and fail branches
- [ ] Phase 2: Push a track-scoped reap into the Inbox as a `system` ⚠️/❌ comment + `track:updated` broadcast
- [ ] Phase 3: Annotate the per-track dispatch history strip (`TrackDetailPanel`) — reassignment is currently indistinguishable from a healthy pending dispatch
- [ ] Phase 4: Annotate the project-level CI/CD dispatch history (`CICDView`) — the only surface for `track_number IS NULL` dispatches
- [ ] Phase 5: Real test coverage — mocked-pool unit tests, a supertest API-shape test, and a fast-tier Playwright check that it renders

## Depends on
- [1102](../1102-e2e-session-findings/index.md) — F18 follow-up (Phase 12), the DB-level mechanism this surfaces
**Auto Run**: yes
