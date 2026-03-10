**Phase**: Bug Fix — Remove
# Track 013: Planning Lane + Smart New-Track Flow

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem

Three related issues with the current new-track flow:

1. **Template bug**: `plan.md` template includes `⏳ IN PROGRESS` on Phase 1, causing
   the sync worker to immediately set `lane_status = 'in-progress'` on every newly created
   track — which then auto-fires `/laneconductor implement` via Track 010's loop.

2. **No staging area**: New tracks jump straight to `backlog` (or accidentally to `in-progress`).
   There's no place where a just-created track sits while the user reviews the generated files
   and decides whether to start it now or defer it.

3. **UI always creates new tracks**: The New Track modal's Feature/Bug buttons always create
   a brand-new track. The SKILL has `/laneconductor featureRequest` and `/laneconductor reportaBug`
   which check for an existing track first — the UI doesn't have this intelligence.

## Solution

1. Fix the template: remove the `⏳ IN PROGRESS` marker from the default plan.md.
2. Add a `planning` lane as the default landing zone for new tracks — a staging area
   before the user decides to start (→ in-progress) or defer (→ backlog).
3. Make the NewTrackModal smarter: when creating a Feature or Bug, search non-done tracks
   and offer to add to an existing one instead of always creating a new track.

## Phases

- [x] Phase 1: Bug fix — remove ⏳ IN PROGRESS from template
- [x] Phase 2: Add planning lane (DB, API, Kanban UI, sync worker, SKILL)
- [x] Phase 3: Smart intake in NewTrackModal (search existing tracks, offer to extend)
- [x] Phase 4: Implementation & Polish
- [x] Phase 5: Consolidate Intake & Planning (intake.md + planTrack)
- [x] Phase 6: Final polish and review gaps
