# Track 10017: track auto run configuration

**Status**: plan
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)

## Problem
lets have a configuration per track (both FS and DB) if they could be picked by workers that are not sync only - default no (backward compatibily for workers - if no indicator - dont pick it up)

## Solution
Add a per-track `auto_run` boolean (FS marker `**Auto Run**: yes|no` in
`index.md`, DB column `tracks.auto_run`, default `false`). A `sync+poll`
worker's auto-launch loop (`autoLaunchLocalFs` → `isTrackClaimable` in
`conductor/claim-scope.mjs`) will only auto-claim a queued track when this
flag is `true`, bypassed only when the track is already mid-conversation
(`waiting_for_reply: true`) — mirroring the existing assignee-gate bypass.
Explicit dispatch, `lc worker run <track>`, and `sync-only` workers are
unaffected (they don't go through this gate at all). Toggleable via a new
`PATCH /api/projects/:id/tracks/:num/auto-run` endpoint and a small UI
control, with DB→FS sync-back so the file marker stays authoritative for
the worker's own decision loop.

## Phases
- [x] Phase 1: DB schema — `tracks.auto_run` column
- [x] Phase 2: FS marker — `**Auto Run**` parsing + sync payload
- [x] Phase 3: Enforcement — claim-scope gate in auto-launch
- [x] Phase 4: API surface — expose + toggle `auto_run`, DB→FS sync-back
- [x] Phase 5: UI toggle + SKILL.md docs
- [x] Phase 6: Tests — unit, API, E2E
- [x] Phase 7: Connect auto_run to Complete & Merge button + dedicated E2E
**Lane**: review
**Lane Status**: queue
**Summary**: All 7 phases implemented, tested with real DB/worker/browser verification (see conversation.md) — grep for "auto_run" now returns real matches across sync.mjs, claim-scope.mjs, index.mjs, and TrackDetailPanel.jsx/WorktreesPanel.jsx.
**Waiting for reply**: no
