# Track 10024: Worktrees panel: live run visibility

**Status**: plan
**Progress**: 100%

## Problem
When a Worktrees panel row is running an action (Complete & Merge, AI resolve conflict, a re-triggered lane dispatch), the row just shows a static 'Running…' badge with no way to see what's actually happening.

IMPORTANT — design direction (do not build a second transcript mechanism):
This app already has exactly one live-session-transcript mechanism scoped by
track number: TrackDetailPanel's "Transcript" toggle (Track 1087 Phase 4,
ui/src/components/TrackDetailPanel.jsx around the `transcriptOpen` state and
the "Show live session transcript" button). It resolves purely from the
track number — it does NOT need a worker_id. There is a second, separate
mechanism, WorkerActivityLatch (Track 1087 Phase 5,
ui/src/components/WorkerActivityLatch.jsx), which is worker-centric (browse
by worker, see whatever that worker is doing right now) — that one DOES need
a worker_id/current_task join. Do not build a third mechanism, and do not
wire the Worktrees panel to WorkerActivityLatch — the Worktrees panel is
inherently track-centric (one row per track), so it should reuse the
existing per-track Transcript drawer, not the worker-centric one.

The Worktrees panel already deep-links each row's `#<track> ↗` (see
WorktreeRow in ui/src/components/WorktreesPanel.jsx, `onSelectTrack`) into
TrackDetailPanel for that track. That's the one mechanism to build on.

Goal: when a Worktrees panel row is running, clicking through (the existing
`#<track> ↗` link, and/or the "Running…" badge itself becoming a link doing
the same thing) should open TrackDetailPanel for that track WITH the
Transcript drawer already expanded — instead of landing on a closed drawer
the user has to know to open themselves.

Requirements:
- Worktrees panel rows in a running state link through to TrackDetailPanel
  (reuse the existing onSelectTrack path — the "Running…" badge should be
  clickable the same way `#<track> ↗` already is, not just decorative text).
- Arriving at TrackDetailPanel via that path auto-opens the Transcript
  drawer (Phase 4's `transcriptOpen`), so the user sees live activity
  immediately rather than a closed drawer.
- Works for all worktree-triggered actions: auto-complete-track,
  ai-resolve-conflict, merge-worktree, and a plain lane re-dispatch — since
  all of them are just this track's own lane/dispatch activity, which the
  existing Phase 4 transcript already resolves without needing to know which
  worker picked it up.
- If the row says 'Running…' but there's genuinely no live activity for
  that track (e.g. stale state after a crash), the existing Transcript
  drawer's own empty/idle state is sufficient — don't build new handling for
  this case, just don't let it look broken.
- Real test coverage (a component/unit test asserting the auto-open
  behavior, and a real browser check that clicking a running row's link
  lands on the track detail view with the transcript already visible)
  before marking this done. No new API endpoint or worker-join logic should
  be needed for this track — if you find yourself adding one, stop and
  re-read this problem statement, you're probably rebuilding
  WorkerActivityLatch by another name.

## Solution
To be defined.

## Phases
- [ ] Phase 1: Implementation
**Lane**: quality-gate
**Lane Status**: running
**Summary**: Planned: a running Worktrees row's 'Running…' badge (and its #track ↗ link) becomes clickable and opens TrackDetailPanel with the existing Phase 4 Transcript drawer already expanded — UI-only, no…
**Waiting for reply**: no
